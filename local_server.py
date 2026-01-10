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
SESSION_FILE = 'deepseek_data.pkl'

sessions = {}

# --- PROMPTS ---
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
If the question is greetings or chat, return it as is.

Chat History:
{chat_history}

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
1. Use CONVERSATION HISTORY to understand context (names, topics, etc).
2. Use DOCUMENT CONTEXT for factual answers.
3. Be conversational.

Answer:"""
ANSWER_PROMPT = PromptTemplate(
    input_variables=["context", "chat_history", "question"], 
    template=answer_template
)

def load_sessions():
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE, 'rb') as f:
                return pickle.load(f)
    except Exception as e:
        logger.error(f"Error loading sessions: {e}")
    return {}

def save_sessions(data):
    try:
        with open(SESSION_FILE, 'wb') as f:
            pickle.dump(data, f)
    except Exception as e:
        logger.error(f"Error saving sessions: {e}")

sessions = load_sessions()

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

def get_session_objects(session_id):
    if session_id not in sessions:
        sessions[session_id] = {'chunks': [], 'history': []}
    
    s_data = sessions[session_id]
    
    # Rebuild Memory
    memory = ConversationBufferMemory(
        memory_key='chat_history',
        input_key='question',
        output_key='answer',
        return_messages=True
    )
    history_data = s_data.get('history', [])
    for role, content in history_data:
        if role == 'user':
            memory.chat_memory.add_user_message(content)
        elif role == 'assistant':
            memory.chat_memory.add_ai_message(content)
            
    # Rebuild Vectorstore
    vectorstore = None
    if s_data.get('chunks') and os.environ.get('OPENAI_API_KEY'):
        embeddings = OpenAIEmbeddings()
        vectorstore = FAISS.from_texts(s_data['chunks'], embeddings)
        
    return {
        'memory': memory,
        'vectorstore': vectorstore
    }

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
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        try:
            if filename.endswith('.pdf'): text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'): text = extract_text_from_txt(filepath)
            else: return jsonify({"error": "Unsupported file type"}), 400
            
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, length_function=len)
            chunks = text_splitter.split_text(text)
            
            if session_id not in sessions: sessions[session_id] = {'chunks': [], 'history': []}
            sessions[session_id]['chunks'].extend(chunks)
            save_sessions(sessions)
            os.remove(filepath)
            
            return jsonify({"message": "Success", "chunks_count": len(chunks)}), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Invalid file"}), 400

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message: return jsonify({"error": "Missing data"}), 400
    if not os.environ.get('OPENAI_API_KEY'): return jsonify({"response": "API Key missing"}), 200

    runtime = get_session_objects(session_id)

    try:
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        
        memory = runtime['memory']
        history_vars = memory.load_memory_variables({})
        chat_history = history_vars.get('chat_history', [])
        
        standalone_question = message
        if chat_history:
            history_str = format_chat_history(chat_history)
            condense_chain = LLMChain(llm=llm, prompt=CONDENSE_PROMPT)
            standalone_question = condense_chain.run(chat_history=history_str, question=message)
        
        context_text = "No docs found."
        sources = []
        if runtime['vectorstore']:
            docs = runtime['vectorstore'].similarity_search(standalone_question, k=4)
            if docs:
                context_text = "\n\n".join([d.page_content for d in docs])
                sources = [d.page_content[:100] + "..." for d in docs[:3]]
        
        history_str = format_chat_history(chat_history)
        answer_chain = LLMChain(llm=llm, prompt=ANSWER_PROMPT)
        response = answer_chain.run(context=context_text, chat_history=history_str, question=message)
        
        sessions[session_id]['history'].append(('user', message))
        sessions[session_id]['history'].append(('assistant', response))
        save_sessions(sessions)
        
        return jsonify({"response": response, "sources": sources}), 200
    except Exception as e:
        print(e)
        return jsonify({"response": f"Error: {e}", "sources": []}), 500

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in sessions:
        sessions[session_id]['history'] = []
        save_sessions(sessions)
        return jsonify({"message": "Cleared"}), 200
    return jsonify({"error": "Not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
