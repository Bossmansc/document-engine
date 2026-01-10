from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import pickle
import logging
import json
from werkzeug.utils import secure_filename
import PyPDF2
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
STATE_FILE = 'deepseek_state.pkl'

persistent_store = {}
active_runtimes = {}

def load_persistence():
    global persistent_store
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'rb') as f:
                persistent_store = pickle.load(f)
        except Exception: persistent_store = {}

def save_persistence():
    try:
        with open(STATE_FILE, 'wb') as f:
            pickle.dump(persistent_store, f)
    except Exception: pass

load_persistence()

def get_or_create_runtime(session_id):
    if session_id in active_runtimes: return active_runtimes[session_id]
    if session_id in persistent_store:
        data = persistent_store[session_id]
        vectorstore = None
        chunks = data.get('chunks', [])
        if chunks and os.environ.get('OPENAI_API_KEY'):
            try:
                embeddings = OpenAIEmbeddings()
                vectorstore = FAISS.from_texts(chunks, embeddings)
            except Exception: pass
        runtime = {'vectorstore': vectorstore}
        active_runtimes[session_id] = runtime
        return runtime
    return None

def init_new_session(session_id):
    if session_id not in persistent_store:
        persistent_store[session_id] = {'chunks': [], 'history': [], 'file_texts': {}}
        save_persistence()
    if session_id not in active_runtimes:
        active_runtimes[session_id] = {'vectorstore': None}
    return active_runtimes[session_id]

# Prompts
summary_template = """You are an expert document analyst. 
Below is the beginning of a document. 
Please provide a concise analysis (max 3 bullet points).
Document text: {text}
Analysis (3 bullet points):"""
SUMMARY_PROMPT = PromptTemplate.from_template(summary_template)

deep_analysis_template = """You are a senior researcher. 
Analyze the following document text and provide a structured report.
Document Text (Excerpt):
{text}
Please provide:
1. Executive Summary
2. Key Topics (list)
3. Critical Insight
Format as JSON keys: "summary", "keyPoints", "topics"."""
DEEP_ANALYSIS_PROMPT = PromptTemplate.from_template(deep_analysis_template)

condense_template = """Rephrase follow up question to be standalone.
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
    with open(filepath, 'rb') as file:
        pdf_reader = PyPDF2.PdfReader(file)
        for page in pdf_reader.pages:
            t = page.extract_text()
            if t: text += t
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
    return jsonify({"status": "healthy"}), 200

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
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    if file.filename == '' or not allowed_file(file.filename): return jsonify({"error": "Invalid file"}), 400
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    try:
        if filename.endswith('.pdf'): text = extract_text_from_pdf(filepath)
        elif filename.endswith('.txt'): text = extract_text_from_txt(filepath)
        else: return jsonify({"error": "Unsupported"}), 400
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, length_function=len)
        chunks = text_splitter.split_text(text)
        
        if session_id not in persistent_store: persistent_store[session_id] = {'chunks': [], 'history': [], 'file_texts': {}}
        if 'file_texts' not in persistent_store[session_id]: persistent_store[session_id]['file_texts'] = {}
            
        persistent_store[session_id]['chunks'].extend(chunks)
        persistent_store[session_id]['file_texts'][filename] = text
        save_persistence()
        
        if session_id in active_runtimes: del active_runtimes[session_id]
        get_or_create_runtime(session_id)
        os.remove(filepath)
        preview = " ".join(text[:300].split()) + "..."
        
        analysis_points = []
        if os.environ.get('OPENAI_API_KEY'):
            try:
                summary_context = text[:4000]
                llm = ChatOpenAI(temperature=0.3, model_name="gpt-3.5-turbo")
                summary_chain = LLMChain(llm=llm, prompt=SUMMARY_PROMPT)
                raw_analysis = summary_chain.run(text=summary_context)
                analysis_points = [line.strip().lstrip('-•*').strip() for line in raw_analysis.split('\n') if line.strip()]
            except Exception: pass
            
        return jsonify({
            "message": "Success", 
            "chunks_count": len(chunks), 
            "text_preview": preview,
            "analysis_results": analysis_points
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/analyze_document', methods=['POST'])
def analyze_document():
    data = request.json
    session_id = data.get('session_id')
    filename = data.get('filename')
    
    if not session_id or not filename: return jsonify({"error": "Missing data"}), 400
    if session_id not in persistent_store: return jsonify({"error": "Session not found"}), 404
    
    text = persistent_store[session_id].get('file_texts', {}).get(filename)
    if not text: return jsonify({"error": "Text not found"}), 404
    
    try:
        if not os.environ.get('OPENAI_API_KEY'): return jsonify({"error": "API Key missing"}), 400
        total_len = len(text)
        if total_len > 12000:
            part_len = 4000
            beginning = text[:part_len]
            middle_start = total_len // 2 - (part_len // 2)
            middle = text[middle_start : middle_start + part_len]
            end = text[-part_len:]
            analysis_context = f"--- START ---\n{beginning}\n\n--- MIDDLE ---\n{middle}\n\n--- END ---\n{end}"
        else:
            analysis_context = text
            
        llm = ChatOpenAI(temperature=0.3, model_name="gpt-3.5-turbo")
        chain = LLMChain(llm=llm, prompt=DEEP_ANALYSIS_PROMPT)
        result_json_str = chain.run(text=analysis_context)
        clean_json = result_json_str.replace("