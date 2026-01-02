import requests
import json

class DeepSeekClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.api_url = "https://api.deepseek.com/chat/completions"

    def generate_response(self, context: str, user_query: str) -> str:
        if not self.api_key:
            return "Error: Backend API Key not configured. Please check server settings or enter key in frontend."

        # Relaxed prompt to allow general conversation
        prompt = f"""You are an intelligent AI assistant. 

CONTEXT FROM DOCUMENTS:
{context if context else "No specific documents found for this query."}

USER QUESTION:
{user_query}

INSTRUCTIONS:
1. If the Context contains the answer, answer based on it.
2. If the Context is empty or irrelevant, use your general knowledge to answer helpfuly.
3. Be conversational and engaging.
"""

        try:
            response = requests.post(
                self.api_url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1000
                },
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['choices'][0]['message']['content']
            else:
                return f"API Error: {response.status_code} - {response.text}"
                
        except Exception as e:
            return f"Backend Communication Error: {str(e)}"
