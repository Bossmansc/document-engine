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

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# In-Memory Storage for Cloud Version
# sessions[id] = {
#    'chunks': [],
#    'vectorstore': ...,
#    'chain': ...,
#    'memory': ...
# }
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
            
            # Init session
            if session_id not in sessions:
                sessions[session_id] = {
                    'chunks': [],
                    'vectorstore': None,
                    'chain': None,
                    'memory': ConversationBufferMemory(
                        memory_key='chat_history',
                        return_messages=True,
                        output_key='answer'
                    )
                }
            
            # Store chunks
            sessions[session_id]['chunks'].extend(chunks)
            
            # Rebuild Vectorstore
            embeddings = OpenAIEmbeddings()
            sessions[session_id]['vectorstore'] = FAISS.from_texts(sessions[session_id]['chunks'], embeddings)
            
            # Rebuild Chain
            llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
            retriever = sessions[session_id]['vectorstore'].as_retriever(search_kwargs={"k": 4})
            
            qa_chain = ConversationalRetrievalChain.from_llm(
                llm=llm,
                retriever=retriever,
                memory=sessions[session_id]['memory'],
                return_source_documents=True,
                verbose=True
            )
            sessions[session_id]['chain'] = qa_chain
            
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
    
    if session_id not in sessions or not sessions[session_id]['chain']:
        return jsonify({"response": "Please upload documents first.", "sources": []}), 200
    
    try:
        qa_chain = sessions[session_id]['chain']
        result = qa_chain({"question": message})
        
        sources = []
        if 'source_documents' in result:
            for doc in result['source_documents'][:3]:
                source_text = doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
                sources.append(source_text)
        
        return jsonify({
            "response": result['answer'],
            "sources": sources
        }), 200
        
    except Exception as e:
        print(f"Chat error: {str(e)}")
        return jsonify({"response": f"Error: {str(e)}", "sources": []}), 500

@app.route('/debug/<session_id>', methods=['GET'])
def debug_session(session_id):
    if session_id in sessions:
        return jsonify({
            "has_chunks": len(sessions[session_id]['chunks']) > 0,
            "has_vectorstore": sessions[session_id]['vectorstore'] is not None,
            "has_chain": sessions[session_id]['chain'] is not None
        }), 200
    return jsonify({"error": "Session not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
