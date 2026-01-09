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

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Global storage for sessions
sessions = {}

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
        
        # Extract text based on file type
        if filename.endswith('.pdf'):
            text = extract_text_from_pdf(filepath)
        elif filename.endswith('.txt'):
            text = extract_text_from_txt(filepath)
        else:
            return jsonify({"error": "Unsupported file type"}), 400
        
        # Initialize session if not exists
        if session_id not in sessions:
            sessions[session_id] = {
                'documents': [],
                'vectorstore': None,
                'conversation_chain': None,
                'memory': ConversationBufferMemory(
                    memory_key='chat_history',
                    return_messages=True,
                    output_key='answer'
                )
            }
        
        # Split text into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        chunks = text_splitter.split_text(text)
        
        # Store chunks in session
        sessions[session_id]['documents'].extend(chunks)
        
        # Create embeddings and vectorstore
        embeddings = OpenAIEmbeddings()
        if sessions[session_id]['vectorstore'] is None:
            sessions[session_id]['vectorstore'] = FAISS.from_texts(chunks, embeddings)
        else:
            sessions[session_id]['vectorstore'].add_texts(chunks)
        
        # Initialize conversation chain if not already exists
        if sessions[session_id]['conversation_chain'] is None:
            llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
            retriever = sessions[session_id]['vectorstore'].as_retriever(
                search_kwargs={"k": 4}
            )
            
            qa_chain = ConversationalRetrievalChain.from_llm(
                llm=llm,
                retriever=retriever,
                memory=sessions[session_id]['memory'],
                return_source_documents=True
            )
            
            sessions[session_id]['conversation_chain'] = qa_chain
        
        # Clean up file
        os.remove(filepath)
        
        return jsonify({
            "message": "File processed successfully",
            "chunks_count": len(chunks),
            "filename": filename
        }), 200
    
    return jsonify({"error": "File type not allowed"}), 400

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message:
        return jsonify({"error": "Missing session_id or message"}), 400
    
    if session_id not in sessions or sessions[session_id]['conversation_chain'] is None:
        return jsonify({
            "response": "Please upload documents first before asking questions.",
            "sources": []
        }), 200
    
    try:
        # Get the conversation chain
        qa_chain = sessions[session_id]['conversation_chain']
        
        # Get response - the memory is already maintained by the chain
        result = qa_chain({"question": message})
        
        # Extract sources
        sources = []
        if 'source_documents' in result:
            for doc in result['source_documents'][:3]:  # Limit to top 3 sources
                source_text = doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
                sources.append(source_text)
        
        return jsonify({
            "response": result['answer'],
            "sources": sources
        }), 200
        
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        return jsonify({
            "response": f"Error processing your request: {str(e)}",
            "sources": []
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
