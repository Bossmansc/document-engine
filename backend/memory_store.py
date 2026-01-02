from typing import List, Dict

class MemoryStore:
    def __init__(self):
        # Structure: {session_id: [chunks]}
        # In prod, use ChromaDB, Pinecone, or FAISS
        self._store: Dict[str, List[Dict]] = {}
        
    def add_documents(self, session_id: str, chunks: List[Dict]):
        if session_id not in self._store:
            self._store[session_id] = []
        self._store[session_id].extend(chunks)
        
    def retrieve_context(self, session_id: str, query: str, limit=5) -> List[Dict]:
        """
        Naive keyword matching for demo. 
        Real impl: Embedding similarity search.
        """
        if session_id not in self._store:
            return []
            
        docs = self._store[session_id]
        if not docs:
            return []

        # Simple scoring based on word overlap
        query_words = set(query.lower().split())
        scored_docs = []
        
        for doc in docs:
            doc_words = set(doc['text'].lower().split())
            # Basic intersection count
            score = len(query_words.intersection(doc_words))
            scored_docs.append((score, doc))
            
        # Sort by score descending
        scored_docs.sort(key=lambda x: x[0], reverse=True)
        
        # Return top N, but only if they have some relevance (score > 0)
        # If no keywords match, return empty list (letting the LLM handle it)
        return [d[1] for d in scored_docs[:limit] if d[0] > 0]
