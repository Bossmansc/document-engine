import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .document_processor import process_document
from .deepseek_client import DeepSeekClient
from .conversation_manager import ConversationManager

app = FastAPI()

# Enable CORS (useful for local dev, but in prod everything is same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Services
ds_client = DeepSeekClient(api_key=os.getenv("DEEPSEEK_API_KEY", "")) 
conv_manager = ConversationManager(ai_client=ds_client)

class ChatRequest(BaseModel):
    session_id: str
    message: str

class ConfigRequest(BaseModel):
    api_key: str

# --- API Routes ---

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/config")
async def update_config(config: ConfigRequest):
    ds_client.api_key = config.api_key
    return {"status": "updated"}

@app.post("/upload/{session_id}")
async def upload_document(session_id: str, file: UploadFile = File(...)):
    try:
        content = await file.read()
        filename = file.filename
        
        chunks = process_document(filename, content)
        conv_manager.memory.add_documents(session_id, chunks)
        
        return {
            "status": "success", 
            "file_id": filename,
            "chunks_count": len(chunks)
        }
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        response = conv_manager.handle_message(request.session_id, request.message)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Static File Serving (Must be last) ---

# 1. Mount the 'assets' folder from the React build
if os.path.exists("frontend/dist/assets"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

# 2. Catch-all route to serve index.html for any other path (React Router support)
@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    # If the file exists in dist (e.g., favicon.ico), serve it
    file_path = f"frontend/dist/{full_path}"
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # Otherwise, serve the app entry point
    if os.path.exists("frontend/dist/index.html"):
        return FileResponse("frontend/dist/index.html")
    
    return {"error": "Frontend not built. Run 'npm run build' in frontend/ directory."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
