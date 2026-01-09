from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
from werkzeug.utils import secure_filename
import PyPDF2
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import FAISS
from langchain.chat_models import ChatOpenAI
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
import openai
import json
import pickle
import base64

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# File for persistence
SESSION_FILE = 'deepseek_data.pkl'

# Global cache for runtime objects (Chains, Vectorstores) - NOT Pickled
runtime_cache = {}

# Data storage (Pickled)
# sessions[id] = {
#    'chunks': [],
#    'history': []
# }
sessions = {}

def load_sessions():
    """Load session data from local file"""
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE, 'rb') as f:
                return pickle.load(f)
    except Exception as e:
        print(f"Error loading sessions: {e}")
    return {}

def save_sessions(data):
    """Save session data to local file"""
    try:
        with open(SESSION_FILE, 'wb') as f:
            pickle.dump(data, f)
    except Exception as e:
        print(f"Error saving sessions: {e}")

# Load on startup
sessions = load_sessions()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(filepath):
    text = ""
    with open(filepath, 'rb') as file:
        pdf_reader = PyPDF2.PdfReader(file)
        for page in pdf_reader.pages:
            text += page.extract_text()
    return text

def extract_text_from_txt(filepath):
    with open(filepath, 'r', encoding='utf-8') as file:
        return file.read()

def get_session_runtime(session_id):
    """Rebuilds or retrieves the Chain and VectorStore for a session."""
    
    # 1. Check Cache
    if session_id in runtime_cache:
        return runtime_cache[session_id]
    
    # 2. Check Data
    if session_id not in sessions:
        return None
        
    session_data = sessions[session_id]
    chunks = session_data.get('chunks', [])
    
    if not chunks:
        return None
        
    # Check API Key
    if not os.environ.get('OPENAI_API_KEY'):
        print("API Key missing during runtime rebuild")
        return None

    try:
        print(f"Rebuilding runtime for session {session_id} with {len(chunks)} chunks")
        
        # Rebuild Vector Store
        embeddings = OpenAIEmbeddings()
        vectorstore = FAISS.from_texts(chunks, embeddings)
        
        # Rebuild Memory
        memory = ConversationBufferMemory(
            memory_key='chat_history',
            return_messages=True,
            output_key='answer'
        )
        
        # Populate Memory from stored history
        saved_history = session_data.get('history', [])
        for role, content in saved_history:
            if role == 'user':
                memory.chat_memory.add_user_message(content)
            elif role == 'assistant':
                memory.chat_memory.add_ai_message(content)
        
        # Rebuild Chain
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        retriever = vectorstore.as_retriever(search_kwargs={"k": 4})
        
        chain = ConversationalRetrievalChain.from_llm(
            llm=llm,
            retriever=retriever,
            memory=memory,
            return_source_documents=True,
            verbose=True
        )
        
        runtime_cache[session_id] = {
            'vectorstore': vectorstore,
            'chain': chain,
            'memory': memory
        }
        return runtime_cache[session_id]
    except Exception as e:
        print(f"Failed to rebuild runtime: {e}")
        return None

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

@app.route('/config', methods=['POST'])
def set_config():
    data = request.json
    api_key = data.get('api_key')
    if api_key:
        openai.api_key = api_key
        os.environ['OPENAI_API_KEY'] = api_key
        return jsonify({"message": "API key configured"}), 200
    return jsonify({"error": "No API key provided"}), 400

@app.route('/upload/<session_id>', methods=['POST'])
def upload_file(session_id):
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        try:
            # Extract text
            if filename.endswith('.pdf'):
                text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'):
                text = extract_text_from_txt(filepath)
            else:
                return jsonify({"error": "Unsupported file type"}), 400
            
            # Split text
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
            )
            chunks = text_splitter.split_text(text)
            
            # Update Persistent Data
            if session_id not in sessions:
                sessions[session_id] = {'chunks': [], 'history': []}
            
            sessions[session_id]['chunks'].extend(chunks)
            save_sessions(sessions)
            
            # Invalidate cache to force rebuild with new data next time
            if session_id in runtime_cache:
                del runtime_cache[session_id]
            
            # Cleanup
            os.remove(filepath)
            
            return jsonify({
                "message": "File processed successfully",
                "chunks_count": len(chunks),
                "filename": filename
            }), 200
            
        except Exception as e:
            print(f"Upload error: {e}")
            return jsonify({"error": str(e)}), 500
    
    return jsonify({"error": "File type not allowed"}), 400

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message:
        return jsonify({"error": "Missing session_id or message"}), 400
    
    # 1. Ensure API Key
    if not os.environ.get('OPENAI_API_KEY'):
        return jsonify({"response": "API Key is missing on the server. Please check settings.", "sources": []}), 200

    # 2. Get Runtime
    runtime = get_session_runtime(session_id)
    
    if not runtime:
        # Check if data exists
        if session_id in sessions and sessions[session_id]['chunks']:
             return jsonify({"response": "Error initializing chat engine. Please try again.", "sources": []}), 200
        else:
             return jsonify({"response": "No documents found. Please upload a file first.", "sources": []}), 200

    try:
        # 3. Generate Response
        qa_chain = runtime['chain']
        result = qa_chain({"question": message})
        answer = result['answer']
        
        # 4. Update History Persistence
        sessions[session_id]['history'].append(('user', message))
        sessions[session_id]['history'].append(('assistant', answer))
        save_sessions(sessions)
        
        # Extract sources
        sources = []
        if 'source_documents' in result:
            for doc in result['source_documents'][:3]:
                source_text = doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
                sources.append(source_text)
        
        return jsonify({
            "response": answer,
            "sources": sources
        }), 200
        
    except Exception as e:
        print(f"Chat error: {str(e)}")
        return jsonify({
            "response": f"Error processing your request: {str(e)}",
            "sources": []
        }), 500

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in sessions:
        sessions[session_id]['history'] = []
        save_sessions(sessions)
        
        # Clear runtime memory
        if session_id in runtime_cache:
            runtime_cache[session_id]['memory'].clear()
            
        return jsonify({"message": "Memory cleared"}), 200
    return jsonify({"error": "Session not found"}), 404

@app.route('/debug/<session_id>', methods=['GET'])
def debug_session(session_id):
    has_data = session_id in sessions
    has_runtime = session_id in runtime_cache
    
    chunks_count = len(sessions[session_id]['chunks']) if has_data else 0
    history_count = len(sessions[session_id]['history']) if has_data else 0
    
    return jsonify({
        "persisted_data": has_data,
        "chunks_count": chunks_count,
        "history_count": history_count,
        "runtime_active": has_runtime,
        "api_key_set": bool(os.environ.get('OPENAI_API_KEY'))
    }), 200

if __name__ == '__main__':
    print("Starting local DeepSeek server...")
    print("Server will run on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
