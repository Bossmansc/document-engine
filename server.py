from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import logging
import pickle
from werkzeug.utils import secure_filename
import PyPDF2

# LangChain Imports
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

# --- PERSISTENCE LAYER ---
# persistent_store structure: { session_id: { 'chunks': [], 'history': [(role, content), ...] } }
persistent_store = {}
# active_runtimes structure: { session_id: { 'vectorstore': FAISS, 'memory': BufferMemory } }
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
        with open(STATE_FILE, 'wb') as f:
            pickle.dump(persistent_store, f)
    except Exception as e:
        logger.error(f"Failed to save persistence: {e}")

# Load state on startup
load_persistence()

def get_or_create_runtime(session_id):
    """
    Retrieves an active runtime or reconstructs it from persistent storage.
    """
    # 1. Check if already active in memory
    if session_id in active_runtimes:
        return active_runtimes[session_id]

    # 2. Check if exists on disk
    if session_id in persistent_store:
        logger.info(f"Rehydrating session {session_id} from disk...")
        data = persistent_store[session_id]
        
        # Rebuild Memory
        memory = ConversationBufferMemory(
            memory_key='chat_history',
            input_key='question',
            output_key='answer',
            return_messages=True
        )
        for role, content in data.get('history', []):
            if role == 'user':
                memory.chat_memory.add_user_message(content)
            elif role == 'assistant':
                memory.chat_memory.add_ai_message(content)
        
        # Rebuild Vectorstore (if chunks exist and we have API key)
        vectorstore = None
        chunks = data.get('chunks', [])
        if chunks and os.environ.get('OPENAI_API_KEY'):
            try:
                embeddings = OpenAIEmbeddings()
                vectorstore = FAISS.from_texts(chunks, embeddings)
            except Exception as e:
                logger.error(f"Failed to rebuild vectorstore for {session_id}: {e}")
        
        runtime = {'memory': memory, 'vectorstore': vectorstore}
        active_runtimes[session_id] = runtime
        return runtime

    # 3. Create fresh if totally new
    return None

def init_new_session(session_id):
    if session_id not in persistent_store:
        persistent_store[session_id] = {'chunks': [], 'history': []}
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
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
If the follow up question is a greeting (like "hi", "hello") or purely conversational, return it exactly as is.

Chat History:
{chat_history}

Follow Up Input: {question}

Standalone question:"""
CONDENSE_PROMPT = PromptTemplate.from_template(condense_template)

answer_template = """You are a helpful and conversational AI assistant. You have access to a conversation history and a set of uploaded documents.

--- CONVERSATION HISTORY ---
{chat_history}

--- DOCUMENT CONTEXT ---
{context}

--- USER QUESTION ---
{question}

--- INSTRUCTIONS ---
1. **Conversational Continuity**: Look at the CONVERSATION HISTORY. If the user is referring to something discussed previously (like their name, a specific topic, or a previous answer), prioritize that context.
2. **Document Knowledge**: Use the DOCUMENT CONTEXT to answer specific questions about the files.
3. **General Knowledge**: If the answer is not in the documents, you may use general knowledge, but be polite and conversational about it.

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
            t = page.extract_text()
            if t: text += t
    return text

def extract_text_from_txt(filepath):
    with open(filepath, 'r', encoding='utf-8') as file:
        return file.read()

def format_chat_history(history):
    formatted = []
    for msg in history:
        if isinstance(msg, HumanMessage):
            formatted.append(f"User: {msg.content}")
        elif isinstance(msg, AIMessage):
            formatted.append(f"Assistant: {msg.content}")
        elif isinstance(msg, SystemMessage):
            formatted.append(f"System: {msg.content}")
        else:
            role = getattr(msg, 'type', 'unknown')
            formatted.append(f"{role}: {msg.content}")
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
            # 1. Extract
            if filename.endswith('.pdf'): text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'): text = extract_text_from_txt(filepath)
            else: return jsonify({"error": "Unsupported file type"}), 400
            
            if not text.strip():
                return jsonify({"error": "File is empty or could not be read."}), 400

            # 2. Chunk
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, length_function=len)
            chunks = text_splitter.split_text(text)
            
            # 3. Update Persistence
            if session_id not in persistent_store:
                persistent_store[session_id] = {'chunks': [], 'history': []}
            persistent_store[session_id]['chunks'].extend(chunks)
            save_persistence() # Save to disk

            # 4. Update Runtime (In-Memory)
            # We invalidate the runtime to force a rebuild with new chunks next time it's used
            if session_id in active_runtimes:
                del active_runtimes[session_id]
            
            # Force rebuild immediately to ensure readiness
            get_or_create_runtime(session_id)

            os.remove(filepath)
            logger.info(f"Session {session_id}: Processed {filename} with {len(chunks)} chunks")
            
            return jsonify({
                "message": "File processed successfully",
                "chunks_count": len(chunks),
                "filename": filename
            }), 200
            
        except Exception as e:
            logger.error(f"Upload error: {e}")
            return jsonify({"error": str(e)}), 500
    
    return jsonify({"error": "File type not allowed"}), 400

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message:
        return jsonify({"error": "Missing session_id or message"}), 400
    
    # Ensure session exists
    runtime = get_or_create_runtime(session_id)
    if not runtime:
        runtime = init_new_session(session_id)
    
    try:
        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({"response": "Server Error: OpenAI API Key not configured.", "sources": []}), 500

        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        
        # 1. Get History
        memory = runtime['memory']
        history_vars = memory.load_memory_variables({})
        chat_history = history_vars.get('chat_history', [])
        
        # 2. Condense Question
        standalone_question = message
        if chat_history:
            history_str = format_chat_history(chat_history)
            condense_chain = LLMChain(llm=llm, prompt=CONDENSE_PROMPT)
            standalone_question = condense_chain.run(chat_history=history_str, question=message)
        
        # 3. Retrieve Docs
        docs = []
        context_text = "No documents found."
        sources = []
        
        if runtime['vectorstore']:
            docs = runtime['vectorstore'].similarity_search(standalone_question, k=4)
            if docs:
                context_text = "\n\n".join([d.page_content for d in docs])
                for d in docs[:3]:
                    clean_source = " ".join(d.page_content[:150].split()) + "..."
                    sources.append(clean_source)

        # 4. Generate Answer
        history_str_for_answer = format_chat_history(chat_history)
        answer_chain = LLMChain(llm=llm, prompt=ANSWER_PROMPT)
        
        response = answer_chain.run(
            context=context_text,
            chat_history=history_str_for_answer,
            question=message 
        )
        
        # 5. Update Memory & Persistence
        memory.save_context({"question": message}, {"answer": response})
        
        # Save to disk
        if session_id not in persistent_store:
            persistent_store[session_id] = {'chunks': [], 'history': []}
        
        persistent_store[session_id]['history'].append(('user', message))
        persistent_store[session_id]['history'].append(('assistant', response))
        save_persistence()
        
        return jsonify({
            "response": response,
            "sources": sources
        }), 200
        
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        return jsonify({"response": f"I encountered an error processing that: {str(e)}", "sources": []}), 500

@app.route('/debug/<session_id>', methods=['GET'])
def debug_session(session_id):
    runtime = get_or_create_runtime(session_id)
    if runtime:
        mem = runtime.get('memory')
        msgs = len(mem.chat_memory.messages) if mem else 0
        chunks_count = len(persistent_store.get(session_id, {}).get('chunks', []))
        return jsonify({
            "has_chunks": chunks_count > 0,
            "chunk_count": chunks_count,
            "has_vectorstore": runtime['vectorstore'] is not None,
            "memory_message_count": msgs,
            "persistence_active": True
        }), 200
    return jsonify({"error": "Session not found"}), 404

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in persistent_store:
        persistent_store[session_id]['history'] = []
        save_persistence()
    
    if session_id in active_runtimes:
        active_runtimes[session_id]['memory'].clear()
        
    return jsonify({"message": "Memory cleared"}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
