import { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedFile, Message, AnalysisDepth, AnalysisState, Session, DocumentChunk, TextSource } from '../types';
import { useLocalStorage } from './useLocalStorage';

// CHANGED: Empty string means "use the current domain"
const API_URL = ''; 

export const useAnalysis = () => {
  const [sessions, setSessions] = useLocalStorage<Session[]>('deepseek_sessions', []);
  const [currentSessionId, setCurrentSessionId] = useLocalStorage<string>('current_session', '');
  const [config, setConfig] = useLocalStorage('deepseek_config', {
    apiKey: '', 
    autoSave: true,
    chunkSize: 1000,
    overlapSize: 200
  });

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [textSources, setTextSources] = useState<TextSource[]>([]);
  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome',
    role: 'assistant',
    content: 'Connected to DeepSeek Backend. Upload PDF/Text files to begin.',
    timestamp: Date.now()
  }]);
  const [depth, setDepth] = useState<AnalysisDepth>('deep');
  const [state, setState] = useState<AnalysisState>({
    isAnalyzing: false,
    paused: false,
    progress: 0,
    currentTask: 'Idle'
  });

  useEffect(() => {
    if (config.apiKey) {
      // Relative path /config
      fetch(`${API_URL}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: config.apiKey })
      }).catch(err => console.error("Failed to sync config with backend", err));
    }
  }, [config.apiKey]);

  useEffect(() => {
    if (currentSessionId && sessions.length > 0) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setFiles(session.files);
        setMessages(session.messages);
      }
    } else if (!currentSessionId) {
       const newId = Date.now().toString();
       setCurrentSessionId(newId);
    }
  }, []);

  const addFiles = useCallback(async (newFiles: File[]) => {
    setState(s => ({ ...s, isAnalyzing: true, currentTask: 'Uploading & Processing...', progress: 10 }));
    const processedFiles: UploadedFile[] = [];

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${API_URL}/upload/${currentSessionId}`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error('Upload failed');
        
        const data = await response.json();
        
        processedFiles.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          type: file.type,
          size: file.size,
          status: 'analyzed', 
          chunksProcessed: data.chunks_count,
          totalChunks: data.chunks_count,
          analysisResults: []
        });

        setState(s => ({ 
          ...s, 
          progress: 10 + ((i + 1) / newFiles.length) * 90 
        }));

      } catch (error) {
        console.error(error);
        processedFiles.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          type: file.type,
          size: file.size,
          status: 'error',
          chunksProcessed: 0,
          totalChunks: 0
        });
      }
    }

    setFiles(prev => [...prev, ...processedFiles]);
    setState(s => ({ ...s, isAnalyzing: false, currentTask: 'Ready', progress: 100 }));
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content: `Processed ${processedFiles.filter(f => f.status === 'analyzed').length} files on server. Ready to chat.`,
      timestamp: Date.now()
    }]);

  }, [currentSessionId]);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: text, 
      timestamp: Date.now() 
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId,
          message: text
        })
      });

      const data = await response.json();
      
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        sources: data.sources,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
      
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `Error: Could not connect to backend.`,
        timestamp: Date.now()
      }]);
    }
  }, [currentSessionId]);

  // Stubs
  const addTextSource = () => {}; 
  const addFromUrl = () => {};
  const startAnalysis = () => {}; 
  const pauseAnalysis = () => {};
  const deleteFile = (id: string) => setFiles(p => p.filter(f => f.id !== id));
  const deleteTextSource = (id: string) => setTextSources(p => p.filter(t => t.id !== id));
  const updateConfig = (updates: any) => setConfig(p => ({ ...p, ...updates }));
  const createSession = (name: string) => {
    const id = Date.now().toString();
    setSessions(p => [...p, { id, name, createdAt: Date.now(), updatedAt: Date.now(), files: [], textSources: [], messages: [], depth: 'deep' }]);
    setCurrentSessionId(id);
    setFiles([]);
    setMessages([]);
  };
  const loadSession = (id: string) => {
    const s = sessions.find(x => x.id === id);
    if(s) {
      setCurrentSessionId(id);
      setFiles(s.files);
      setMessages(s.messages);
    }
  };
  const deleteSession = (id: string) => setSessions(p => p.filter(x => x.id !== id));
  const exportSession = () => {};

  return {
    files, textSources, messages, depth, state, sessions, currentSessionId, config,
    setDepth, addFiles, addTextSource, addFromUrl, deleteFile, deleteTextSource,
    startAnalysis, pauseAnalysis, sendMessage, createSession, loadSession, deleteSession,
    updateConfig, exportSession
  };
};
