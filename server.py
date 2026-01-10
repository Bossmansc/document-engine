from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import logging
import pickle
import sys
from werkzeug.utils import secure_filename
import PyPDF2
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
STATE_FILE = 'deepseek_state.pkl'
MAX_STORED_TEXT_LENGTH = 100000  # Safe limit to prevent OOM

persistent_store = {}
active_runtimes = {}

def load_persistence():
    global persistent_store
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'rb') as f:
                persistent_store = pickle.load(f)
            logger.info(f"Loaded {len(persistent_store)} sessions from disk.")
        except Exception as e:
            logger.error(f"Failed to load persistence: {e}")
            persistent_store = {}

def save_persistence():
    try:
        temp_state_file = STATE_FILE + '.tmp'
        with open(temp_state_file, 'wb') as f:
            pickle.dump(persistent_store, f)
        os.replace(temp_state_file, STATE_FILE)
    except Exception as e:
        logger.error(f"Failed to save persistence: {e}")

load_persistence()

def get_or_create_runtime(session_id):
    if session_id in active_runtimes:
        return active_runtimes[session_id]

    if session_id in persistent_store:
        data = persistent_store[session_id]
        
        memory = ConversationBufferMemory(
            memory_key='chat_history',
            input_key='question',
            output_key='answer',
            return_messages=True
        )
        
        vectorstore = None
        chunks = data.get('chunks', [])
        
        if chunks and os.environ.get('OPENAI_API_KEY'):
            try:
                embeddings = OpenAIEmbeddings()
                vectorstore = FAISS.from_texts(chunks, embeddings)
            except Exception as e:
                logger.error(f"Failed to rebuild vectorstore: {e}")
        
        runtime = {'memory': memory, 'vectorstore': vectorstore}
        active_runtimes[session_id] = runtime
        return runtime

    return None

def init_new_session(session_id):
    if session_id not in persistent_store:
        persistent_store[session_id] = {'chunks': [], 'history': [], 'file_texts': {}}
        save_persistence()
    
    if session_id not in active_runtimes:
        active_runtimes[session_id] = {
            'vectorstore': None,
            'memory': ConversationBufferMemory(
                memory_key='chat_history',
                input_key='question',
                output_key='answer',
                return_messages=True
            )
        }
    return active_runtimes[session_id]

# --- PROMPTS ---
summary_template = """You are an expert document analyst. 
Below is the beginning of a document. 
Please provide a concise analysis (max 3 bullet points) of what this document appears to be about.
Document text:
{text}
Analysis (3 bullet points):"""
SUMMARY_PROMPT = PromptTemplate.from_template(summary_template)

deep_analysis_template = """You are a senior researcher. 
Analyze the following document text and provide a structured report.
Document Text (Excerpt):
{text}
Please provide:
1. **Executive Summary**: A paragraph summarizing the core message.
2. **Key Topics**: A list of 5 key themes or entities mentioned.
3. **Critical Insight**: One major takeaway or conclusion.
Format the output as valid JSON with keys: "summary", "keyPoints" (list of strings), "topics" (list of strings)."""
DEEP_ANALYSIS_PROMPT = PromptTemplate.from_template(deep_analysis_template)

condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
Chat History: {chat_history}
Follow Up Input: {question}
Standalone question:"""
CONDENSE_PROMPT = PromptTemplate.from_template(condense_template)

answer_template = """You are a helpful and conversational AI assistant. 
--- CONVERSATION HISTORY ---
{chat_history}
--- DOCUMENT CONTEXT ---
{context}
--- USER QUESTION ---
{question}
Answer:"""
ANSWER_PROMPT = PromptTemplate(input_variables=["context", "chat_history", "question"], template=answer_template)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(filepath):
    text = ""
    try:
        with open(filepath, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                t = page.extract_text()
                if t: text += t
    except Exception as e:
        logger.error(f"Error reading PDF: {e}")
    return text

def extract_text_from_txt(filepath):
    with open(filepath, 'r', encoding='utf-8') as file:
        return file.read()

def format_history_from_list(history_list):
    formatted = []
    for msg in history_list:
        role = msg.get('role', 'user')
        content = msg.get('content', '')
        if role == 'user': formatted.append(f"User: {content}")
        elif role == 'assistant': formatted.append(f"Assistant: {content}")
    return "\n".join(formatted)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "deepseek-backend"}), 200

@app.route('/config', methods=['POST'])
def set_config():
    data = request.json
    api_key = data.get('api_key')
    if api_key:
        os.environ['OPENAI_API_KEY'] = api_key
        return jsonify({"message": "API key configured"}), 200
    return jsonify({"error": "No API key provided"}), 400

@app.route('/upload/<session_id>', methods=['POST'])
def upload_file(session_id):
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        try:
            # 1. Extract Text
            if filename.endswith('.pdf'): text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'): text = extract_text_from_txt(filepath)
            else: return jsonify({"error": "Unsupported file type"}), 400
            
            if not text.strip():
                return jsonify({"error": "File is empty or could not be read."}), 400

            # 2. Chunk
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, length_function=len)
            chunks = text_splitter.split_text(text)
            
            # 3. Persist
            if session_id not in persistent_store:
                persistent_store[session_id] = {'chunks': [], 'history': [], 'file_texts': {}}
            
            if 'file_texts' not in persistent_store[session_id]:
                persistent_store[session_id]['file_texts'] = {}
                
            persistent_store[session_id]['chunks'].extend(chunks)
            # Store limited text for analysis
            persistent_store[session_id]['file_texts'][filename] = text[:MAX_STORED_TEXT_LENGTH]
            save_persistence() 

            # 4. Update Runtime
            if session_id in active_runtimes:
                del active_runtimes[session_id]
            get_or_create_runtime(session_id)

            os.remove(filepath)
            logger.info(f"Session {session_id}: Processed {filename} with {len(chunks)} chunks")
            
            # 5. Generate Preview & Analysis
            preview = " ".join(text[:300].split()) + "..."
            analysis_points = []
            
            if os.environ.get('OPENAI_API_KEY'):
                try:
                    summary_context = text[:3000] 
                    llm = ChatOpenAI(temperature=0.3, model_name="gpt-3.5-turbo")
                    summary_chain = LLMChain(llm=llm, prompt=SUMMARY_PROMPT)
                    raw_analysis = summary_chain.run(text=summary_context)
                    analysis_points = [line.strip().lstrip('-•*').strip() for line in raw_analysis.split('\n') if line.strip()]
                except Exception as e:
                    logger.error(f"Summary error: {e}")
                    analysis_points = ["Analysis unavailable."]

            return jsonify({
                "message": "Success",
                "chunks_count": len(chunks),
                "filename": filename,
                "text_preview": preview,
                "analysis_results": analysis_points
            }), 200
            
        except Exception as e:
            logger.error(f"Upload error: {e}")
            return jsonify({"error": str(e)}), 500
    
    return jsonify({"error": "File type not allowed"}), 400

@app.route('/analyze_document', methods=['POST'])
def analyze_document():
    data = request.json
    session_id = data.get('session_id')
    filename = data.get('filename')
    
    if not session_id or not filename:
        return jsonify({"error": "Missing session_id or filename"}), 400
        
    if session_id not in persistent_store:
        return jsonify({"error": "Session not found"}), 404
        
    file_texts = persistent_store[session_id].get('file_texts', {})
    text = file_texts.get(filename)
    
    if not text:
        return jsonify({"error": "File text not found (it may have been cleared to save memory)"}), 404
        
    try:
        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({"error": "API Key missing"}), 400

        total_len = len(text)
        if total_len > 12000:
            part_len = 4000
            beginning = text[:part_len]
            middle_start = max(0, total_len // 2 - (part_len // 2))
            middle = text[middle_start : middle_start + part_len]
            end = text[-part_len:]
            analysis_context = f"--- START OF DOC ---\n{beginning}\n\n--- MIDDLE OF DOC ---\n{middle}\n\n--- END OF DOC ---\n{end}"
        else:
            analysis_context = text

        llm = ChatOpenAI(temperature=0.3, model_name="gpt-3.5-turbo")
        chain = LLMChain(llm=llm, prompt=DEEP_ANALYSIS_PROMPT)
        result_json_str = chain.run(text=analysis_context)
        
        import json
        clean_json = result_json_str.replace("