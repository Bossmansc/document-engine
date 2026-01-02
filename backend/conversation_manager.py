from typing import Dict, Optional, List
import time
from .memory_store import MemoryStore

class ConversationManager:
    def __init__(self, ai_client):
        self.ai = ai_client
        self.memory = MemoryStore()

    def handle_message(self, session_id: str, message: str) -> Dict:
        # 1. Retrieve Context
        context_chunks = self.memory.retrieve_context(session_id, message)
        
        # 2. Format Context
        context_str = ""
        sources = []
        if context_chunks:
            context_str = "\n---\n".join([c['text'] for c in context_chunks])
            sources = list(set([c['source'] for c in context_chunks]))
        
        # 3. Get AI Response (We now call AI even if context is empty)
        ai_response = self.ai.generate_response(context_str, message)
        
        return {
            "response": ai_response,
            "sources": sources,
            "timestamp": int(time.time() * 1000)
        }
