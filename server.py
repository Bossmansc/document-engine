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
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
import openai

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'docx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# In-Memory Storage
sessions = {}

# --- PROMPTS ---

# 1. STANDALONE QUESTION GENERATOR
# Takes history + new question -> Search Query
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question that captures all necessary context from the history.
If the question is a greeting or purely conversational (like "hello", "how are you"), just return it as is.

Chat History:
{chat_history}

Follow Up Input: {question}

Standalone question:"""
CONDENSE_PROMPT = PromptTemplate.from_template(condense_template)

# 2. FINAL ANSWER GENERATOR
# Takes History + Docs + Query -> Final Answer
answer_template = """You are a highly intelligent and conversational AI assistant capable of analyzing documents.

CONTEXT FROM DOCUMENTS:
{context}

CONVERSATION HISTORY:
{chat_history}

USER QUESTION: {question}

INSTRUCTIONS:
1. Prioritize answering from the "CONTEXT FROM DOCUMENTS" if the information is there.
2. If the answer is in the "CONVERSATION HISTORY" (e.g., user's name, previous topic), use that.
3. If the answer is not in documents or history, you may use general knowledge but strictly label it as such (e.g., "This isn't in the documents, but...").
4. Be conversational and helpful.

Answer:"""
ANSWER_PROMPT = PromptTemplate(
    input_variables=["context", "chat_history", "question"], 
    template=answer_template
)

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
            # 1. Extract Text
            if filename.endswith('.pdf'):
                text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'):
                text = extract_text_from_txt(filepath)
            else:
                return jsonify({"error": "Unsupported file type"}), 400
            
            # 2. Chunk Text
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
            )
            chunks = text_splitter.split_text(text)
            
            # 3. Initialize Session Data
            if session_id not in sessions:
                sessions[session_id] = {
                    'chunks': [],
                    'vectorstore': None,
                    'memory': ConversationBufferMemory(
                        memory_key='chat_history',
                        input_key='question',
                        return_messages=True
                    )
                }
            
            # 4. Update Vectors
            sessions[session_id]['chunks'].extend(chunks)
            embeddings = OpenAIEmbeddings()
            sessions[session_id]['vectorstore'] = FAISS.from_texts(sessions[session_id]['chunks'], embeddings)
            
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
    
    # Validation
    if session_id not in sessions:
         return jsonify({"response": "Session not found. Please upload a document to start.", "sources": []}), 200
    
    session = sessions[session_id]
    
    try:
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        
        # 1. Get Chat History
        memory = session['memory']
        chat_history = memory.load_memory_variables({})['chat_history']
        
        # 2. Generate Standalone Question (if history exists)
        standalone_question = message
        if chat_history:
            condense_chain = LLMChain(llm=llm, prompt=CONDENSE_PROMPT)
            # We convert list of messages to string for the prompt
            history_str = "\n".join([f"{m.type}: {m.content}" for m in chat_history])
            standalone_question = condense_chain.run(chat_history=history_str, question=message)
        
        # 3. Retrieve Documents (if vectorstore exists)
        docs = []
        context_text = "No documents uploaded."
        sources = []
        
        if session['vectorstore']:
            docs = session['vectorstore'].similarity_search(standalone_question, k=4)
            context_text = "\n\n".join([d.page_content for d in docs])
            for d in docs[:3]:
                source_text = d.page_content[:150].replace('\n', ' ') + "..."
                sources.append(source_text)

        # 4. Generate Answer
        # We manually format the inputs for the Answer Prompt to ensure history is included
        history_str = "\n".join([f"{m.type}: {m.content}" for m in chat_history])
        
        answer_chain = LLMChain(llm=llm, prompt=ANSWER_PROMPT)
        response = answer_chain.run(
            context=context_text,
            chat_history=history_str,
            question=message 
        )
        
        # 5. Save Interaction to Memory
        memory.save_context({"question": message}, {"answer": response})
        
        return jsonify({
            "response": response,
            "sources": sources
        }), 200
        
    except Exception as e:
        print(f"Chat error: {str(e)}")
        return jsonify({"response": f"I encountered an error: {str(e)}", "sources": []}), 500

@app.route('/debug/<session_id>', methods=['GET'])
def debug_session(session_id):
    if session_id in sessions:
        mem = sessions[session_id].get('memory')
        msgs = len(mem.chat_memory.messages) if mem else 0
        return jsonify({
            "has_chunks": len(sessions[session_id]['chunks']) > 0,
            "has_vectorstore": sessions[session_id]['vectorstore'] is not None,
            "memory_message_count": msgs,
            "type": "InMemory (Cloud)"
        }), 200
    return jsonify({"error": "Session not found"}), 404

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in sessions:
        sessions[session_id]['memory'].clear()
        return jsonify({"message": "Memory cleared"}), 200
    return jsonify({"error": "Session not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
