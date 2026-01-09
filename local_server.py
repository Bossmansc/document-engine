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
from langchain.prompts import PromptTemplate
import openai
import json
import pickle
import base64

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
SESSION_FILE = 'deepseek_data.pkl'

runtime_cache = {}
sessions = {}

# --- PROMPTS ---
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question. If it's general conversation, keep it as is.

Chat History:
{chat_history}

Follow Up Input: {question}

Standalone question:"""
CONDENSE_QUESTION_PROMPT = PromptTemplate.from_template(condense_template)

answer_template = """You are a helpful, conversational AI assistant analyzing documents.
Use the following pieces of context to answer the user's question. 
If the context doesn't contain the answer, you can answer from your general knowledge, but explicitly mention that it's not in the documents.

Context:
{context}

Question: {question}

Answer:"""
ANSWER_PROMPT = PromptTemplate.from_template(answer_template)

def load_sessions():
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE, 'rb') as f:
                return pickle.load(f)
    except Exception as e:
        print(f"Error loading sessions: {e}")
    return {}

def save_sessions(data):
    try:
        with open(SESSION_FILE, 'wb') as f:
            pickle.dump(data, f)
    except Exception as e:
        print(f"Error saving sessions: {e}")

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
    if session_id in runtime_cache:
        return runtime_cache[session_id]
    
    if session_id not in sessions:
        return None
        
    session_data = sessions[session_id]
    chunks = session_data.get('chunks', [])
    
    if not chunks:
        return None
        
    if not os.environ.get('OPENAI_API_KEY'):
        return None

    try:
        print(f"Rebuilding runtime for session {session_id}")
        
        embeddings = OpenAIEmbeddings()
        vectorstore = FAISS.from_texts(chunks, embeddings)
        
        memory = ConversationBufferMemory(
            memory_key='chat_history',
            return_messages=True,
            output_key='answer'
        )
        
        # Restore memory from disk
        saved_history = session_data.get('history', [])
        for role, content in saved_history:
            if role == 'user':
                memory.chat_memory.add_user_message(content)
            elif role == 'assistant':
                memory.chat_memory.add_ai_message(content)
        
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        retriever = vectorstore.as_retriever(search_kwargs={"k": 4})
        
        chain = ConversationalRetrievalChain.from_llm(
            llm=llm,
            retriever=retriever,
            memory=memory,
            return_source_documents=True,
            verbose=True,
            condense_question_prompt=CONDENSE_QUESTION_PROMPT,
            combine_docs_chain_kwargs={"prompt": ANSWER_PROMPT}
        )
        
        runtime_cache[session_id] = {
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
            if filename.endswith('.pdf'):
                text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'):
                text = extract_text_from_txt(filepath)
            else:
                return jsonify({"error": "Unsupported file type"}), 400
            
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
            )
            chunks = text_splitter.split_text(text)
            
            if session_id not in sessions:
                sessions[session_id] = {'chunks': [], 'history': []}
            
            sessions[session_id]['chunks'].extend(chunks)
            save_sessions(sessions)
            
            # Invalidate cache
            if session_id in runtime_cache:
                del runtime_cache[session_id]
            
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
    
    if not os.environ.get('OPENAI_API_KEY'):
        return jsonify({"response": "API Key is missing. Please check settings.", "sources": []}), 200

    runtime = get_session_runtime(session_id)
    
    if not runtime:
         if session_id in sessions and sessions[session_id]['chunks']:
             return jsonify({"response": "Initializing chat engine...", "sources": []}), 200
         else:
             return jsonify({"response": "Please upload a document first.", "sources": []}), 200

    try:
        qa_chain = runtime['chain']
        result = qa_chain({"question": message})
        answer = result['answer']
        
        # Persist history
        sessions[session_id]['history'].append(('user', message))
        sessions[session_id]['history'].append(('assistant', answer))
        save_sessions(sessions)
        
        sources = []
        if 'source_documents' in result:
            for doc in result['source_documents'][:3]:
                source_text = doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content
                sources.append(source_text)
        
        return jsonify({
            "response": answer,
            "sources": sources
        }), 200
        
    except Exception as e:
        print(f"Chat error: {str(e)}")
        return jsonify({
            "response": f"Error: {str(e)}",
            "sources": []
        }), 500

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in sessions:
        sessions[session_id]['history'] = []
        save_sessions(sessions)
        if session_id in runtime_cache:
            runtime_cache[session_id]['memory'].clear()
        return jsonify({"message": "Memory cleared"}), 200
    return jsonify({"error": "Session not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
