from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import pickle
import logging
from werkzeug.utils import secure_filename
import PyPDF2
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
STATE_FILE = 'deepseek_state.pkl'

# Persistence
persistent_store = {}
active_runtimes = {}

def load_persistence():
    global persistent_store
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'rb') as f:
                persistent_store = pickle.load(f)
        except Exception as e:
            logger.error(f"Error loading: {e}")
            persistent_store = {}

def save_persistence():
    try:
        with open(STATE_FILE, 'wb') as f:
            pickle.dump(persistent_store, f)
    except Exception as e:
        logger.error(f"Error saving: {e}")

load_persistence()

def get_or_create_runtime(session_id):
    if session_id in active_runtimes:
        return active_runtimes[session_id]
        
    if session_id in persistent_store:
        data = persistent_store[session_id]
        memory = ConversationBufferMemory(memory_key='chat_history', input_key='question', output_key='answer', return_messages=True)
        for role, content in data.get('history', []):
            if role == 'user': memory.chat_memory.add_user_message(content)
            elif role == 'assistant': memory.chat_memory.add_ai_message(content)
            
        vectorstore = None
        chunks = data.get('chunks', [])
        if chunks and os.environ.get('OPENAI_API_KEY'):
            try:
                embeddings = OpenAIEmbeddings()
                vectorstore = FAISS.from_texts(chunks, embeddings)
            except Exception: pass
            
        runtime = {'memory': memory, 'vectorstore': vectorstore}
        active_runtimes[session_id] = runtime
        return runtime
    return None

def init_new_session(session_id):
    if session_id not in persistent_store:
        persistent_store[session_id] = {'chunks': [], 'history': []}
        save_persistence()
    if session_id not in active_runtimes:
        active_runtimes[session_id] = {
            'vectorstore': None, 
            'memory': ConversationBufferMemory(memory_key='chat_history', input_key='question', output_key='answer', return_messages=True)
        }
    return active_runtimes[session_id]

# Prompts and Helpers
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
If the question is greetings or chat, return it as is.
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
--- INSTRUCTIONS ---
1. Use CONVERSATION HISTORY to understand context.
2. Use DOCUMENT CONTEXT for factual answers.
3. Be conversational.
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

def format_chat_history(history):
    formatted = []
    for msg in history:
        if isinstance(msg, HumanMessage): formatted.append(f"User: {msg.content}")
        elif isinstance(msg, AIMessage): formatted.append(f"Assistant: {msg.content}")
        else: formatted.append(f"System: {msg.content}")
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
        
        if session_id not in persistent_store: persistent_store[session_id] = {'chunks': [], 'history': []}
        persistent_store[session_id]['chunks'].extend(chunks)
        save_persistence()
        
        if session_id in active_runtimes: del active_runtimes[session_id]
        get_or_create_runtime(session_id)
        
        os.remove(filepath)
        return jsonify({"message": "Success", "chunks_count": len(chunks)}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    if not session_id or not message: return jsonify({"error": "Missing data"}), 400
    
    runtime = get_or_create_runtime(session_id)
    if not runtime: runtime = init_new_session(session_id)
    
    try:
        if not os.environ.get('OPENAI_API_KEY'): return jsonify({"response": "API Key missing"}), 200
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        memory = runtime['memory']
        chat_history = memory.load_memory_variables({}).get('chat_history', [])
        
        standalone = message
        if chat_history:
            standalone = LLMChain(llm=llm, prompt=CONDENSE_PROMPT).run(chat_history=format_chat_history(chat_history), question=message)
            
        context = "No docs found."
        sources = []
        if runtime['vectorstore']:
            docs = runtime['vectorstore'].similarity_search(standalone, k=4)
            if docs:
                context = "\n\n".join([d.page_content for d in docs])
                sources = [d.page_content[:100] + "..." for d in docs[:3]]
                
        response = LLMChain(llm=llm, prompt=ANSWER_PROMPT).run(context=context, chat_history=format_chat_history(chat_history), question=message)
        
        memory.save_context({"question": message}, {"answer": response})
        persistent_store[session_id]['history'].append(('user', message))
        persistent_store[session_id]['history'].append(('assistant', response))
        save_persistence()
        
        return jsonify({"response": response, "sources": sources}), 200
    except Exception as e:
        return jsonify({"response": f"Error: {e}", "sources": []}), 500

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in persistent_store:
        persistent_store[session_id]['history'] = []
        save_persistence()
    if session_id in active_runtimes:
        active_runtimes[session_id]['memory'].clear()
    return jsonify({"message": "Cleared"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
