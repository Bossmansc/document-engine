import re
import io
from typing import List, Dict
import pypdf 

def process_document(filename: str, content: bytes) -> List[Dict]:
    """
    Extracts text from files including PDFs and chunks them.
    """
    text = ""
    
    # 1. Determine file type and extract text
    if filename.lower().endswith('.pdf'):
        try:
            pdf_file = io.BytesIO(content)
            reader = pypdf.PdfReader(pdf_file)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        except Exception as e:
            text = f"[Error reading PDF: {str(e)}]"
    else:
        # Default to text decoding
        try:
            text = content.decode('utf-8', errors='ignore')
        except:
            text = "[Binary or unsupported file format]"

    # 2. Clean Text
    text = re.sub(r'\s+', ' ', text).strip()
    
    # 3. Smart Chunking (Sliding Window)
    CHUNK_SIZE = 1500  # Characters (approx 300-400 tokens)
    OVERLAP = 200
    
    chunks = []
    if not text:
        return []

    for i in range(0, len(text), CHUNK_SIZE - OVERLAP):
        chunk_text = text[i:i + CHUNK_SIZE]
        if len(chunk_text) < 50: continue 
        
        chunks.append({
            "source": filename,
            "text": chunk_text,
            "start_char": i,
            "end_char": i + len(chunk_text)
        })
        
    return chunks
