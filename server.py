from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import logging
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

# In-Memory Storage (Note: specific to single worker instance)
sessions = {}

# --- PROMPTS ---
# 1. Condense Question Prompt: Ensures we carry context forward
condense_template = """Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question that includes necessary context.
If the follow up question is a greeting (like "hi", "hello") or purely conversational, return it exactly as is.

Chat History:
{chat_history}

Follow Up Input: {question}

Standalone question:"""
CONDENSE_PROMPT = PromptTemplate.from_template(condense_template)

# 2. Answer Prompt: Explicitly Instructs to use History
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
4. **Tone**: Be helpful, engaging, and human-like. Do not be robotic.

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
    """Convert message objects to a string format for the prompt"""
    formatted = []
    for msg in history:
        if isinstance(msg, HumanMessage):
            formatted.append(f"User: {msg.content}")
        elif isinstance(msg, AIMessage):
            formatted.append(f"Assistant: {msg.content}")
        elif isinstance(msg, SystemMessage):
            formatted.append(f"System: {msg.content}")
        else:
            # Fallback for older langchain versions or generic messages
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
            # 1. Extract
            if filename.endswith('.pdf'):
                text = extract_text_from_pdf(filepath)
            elif filename.endswith('.txt'):
                text = extract_text_from_txt(filepath)
            else:
                return jsonify({"error": "Unsupported file type"}), 400
            
            if not text.strip():
                return jsonify({"error": "Could not extract text from file. It might be empty or scanned images."}), 400

            # 2. Chunk
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
            )
            chunks = text_splitter.split_text(text)
            
            # 3. Init Session
            if session_id not in sessions:
                sessions[session_id] = {
                    'chunks': [],
                    'vectorstore': None,
                    'memory': ConversationBufferMemory(
                        memory_key='chat_history',
                        input_key='question',
                        output_key='answer',
                        return_messages=True
                    )
                }
            
            # 4. Update Vector Store
            sessions[session_id]['chunks'].extend(chunks)
            
            # Note: We rebuild the vectorstore to include new chunks. 
            embeddings = OpenAIEmbeddings()
            sessions[session_id]['vectorstore'] = FAISS.from_texts(sessions[session_id]['chunks'], embeddings)
            
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
    
    if session_id not in sessions:
         # If no session, create a temp one for pure chat
         sessions[session_id] = {
            'chunks': [],
            'vectorstore': None,
            'memory': ConversationBufferMemory(
                memory_key='chat_history',
                input_key='question',
                output_key='answer',
                return_messages=True
            )
         }
    
    session = sessions[session_id]
    
    try:
        # Check API Key
        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({"response": "Server Error: OpenAI API Key not configured.", "sources": []}), 500

        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        
        # 1. Get History
        memory = session['memory']
        history_vars = memory.load_memory_variables({})
        chat_history = history_vars.get('chat_history', [])
        
        logger.info(f"Session {session_id} History Length: {len(chat_history)} messages")

        # 2. Condense Question (if we have history)
        standalone_question = message
        if chat_history:
            history_str = format_chat_history(chat_history)
            condense_chain = LLMChain(llm=llm, prompt=CONDENSE_PROMPT)
            standalone_question = condense_chain.run(chat_history=history_str, question=message)
            logger.info(f"Original: {message} -> Standalone: {standalone_question}")
        
        # 3. Retrieve Docs
        docs = []
        context_text = "No documents found."
        sources = []
        
        if session['vectorstore']:
            docs = session['vectorstore'].similarity_search(standalone_question, k=4)
            if docs:
                context_text = "\n\n".join([d.page_content for d in docs])
                for d in docs[:3]:
                    # Clean up source text for display
                    clean_source = " ".join(d.page_content[:150].split()) + "..."
                    sources.append(clean_source)

        # 4. Generate Answer (Explicitly passing history and context)
        history_str_for_answer = format_chat_history(chat_history)
        answer_chain = LLMChain(llm=llm, prompt=ANSWER_PROMPT)
        
        response = answer_chain.run(
            context=context_text,
            chat_history=history_str_for_answer,
            question=message 
        )
        
        # 5. Save Interaction
        memory.save_context({"question": message}, {"answer": response})
        
        return jsonify({
            "response": response,
            "sources": sources
        }), 200
        
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        return jsonify({"response": f"I encountered an error processing that: {str(e)}", "sources": []}), 500

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
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
