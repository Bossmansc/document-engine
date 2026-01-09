import { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedFile, Message, AnalysisDepth, AnalysisState, Session, TextSource } from '../types';
import { useLocalStorage } from './useLocalStorage';

// Default to the working hosted backend, but allow override via config
const DEFAULT_API_URL = 'https://deepseek-monolith.onrender.com';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; 

export const useAnalysis = () => {
  const [sessions, setSessions] = useLocalStorage<Session[]>('deepseek_sessions', []);
  const [currentSessionId, setCurrentSessionId] = useLocalStorage<string>('current_session', '');
  
  // Updated config to include apiUrl
  const [config, setConfig] = useLocalStorage('deepseek_config', {
    apiKey: '', 
    apiUrl: DEFAULT_API_URL,
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
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown');
  
  const fileObjectsRef = useRef<Record<string, File>>({});

  // Helper to get effective URL (removes trailing slash if present)
  const getApiUrl = useCallback(() => {
    const url = config.apiUrl || DEFAULT_API_URL;
    return url.replace(/\/$/, '');
  }, [config.apiUrl]);

  const checkBackendHealth = useCallback(async (retryCount = 0): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); 
      
      const response = await fetch(`${getApiUrl()}/health`, {
        signal: controller.signal,
        method: 'GET'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        setBackendStatus('healthy');
        return true;
      } else {
        setBackendStatus('unhealthy');
        return false;
      }
    } catch (error) {
      console.error('Backend health check failed:', error);
      setBackendStatus('unhealthy');
      
      if (retryCount < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return checkBackendHealth(retryCount + 1);
      }
      return false;
    }
  }, [getApiUrl]);

  const fetchWithRetry = useCallback(async (
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<Response> => {
    const baseUrl = getApiUrl();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); 
      
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      console.error(`Fetch attempt ${retryCount + 1} failed:`, error);
      
      if (retryCount < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(endpoint, options, retryCount + 1);
      }
      throw error;
    }
  }, [getApiUrl]);

  useEffect(() => {
    checkBackendHealth();
    
    const interval = setInterval(() => {
      checkBackendHealth();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  useEffect(() => {
    if (config.apiKey) {
      fetchWithRetry('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: config.apiKey })
      }).catch(err => {
        console.error("Failed to sync config with backend", err);
      });
    }
  }, [config.apiKey, fetchWithRetry]);

  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setFiles(session.files || []);
        setTextSources(session.textSources || []);
        setMessages(session.messages || []);
        setDepth(session.depth || 'deep');
      } 
    } else {
       const newId = Date.now().toString();
       setCurrentSessionId(newId);
    }
  }, [currentSessionId]); 

  useEffect(() => {
    if (!currentSessionId || !config.autoSave) return;
    const hasData = files.length > 0 || textSources.length > 0 || messages.length > 1;
    setSessions(prevSessions => {
      const index = prevSessions.findIndex(s => s.id === currentSessionId);
      if (index === -1 && !hasData) return prevSessions;
      const currentData = {
        files,
        textSources,
        messages,
        depth,
        updatedAt: Date.now()
      };
      if (index >= 0) {
        const prev = prevSessions[index];
        const filesChanged = prev.files.length !== files.length || (files.length > 0 && files[files.length-1].id !== prev.files[prev.files.length-1]?.id);
        const msgsChanged = prev.messages.length !== messages.length;
        if (!filesChanged && !msgsChanged && prev.textSources.length === textSources.length && prev.depth === depth && prev.files.every((f, i) => f.status === files[i].status)) {
             return prevSessions;
        }
        const newSessions = [...prevSessions];
        newSessions[index] = { ...prev, ...currentData };
        return newSessions;
      } else {
        return [...prevSessions, {
          id: currentSessionId,
          name: `Analysis ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          createdAt: Date.now(),
          ...currentData
        }];
      }
    });
  }, [files, textSources, messages, depth, currentSessionId, config.autoSave]);

  const processFile = async (file: File, fileId?: string) => {
    if (!currentSessionId) return null;
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetchWithRetry(`/upload/${currentSessionId}`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload failed:', errorText);
        throw new Error(`Upload failed: ${response.status}`);
      }
      
      const data = await response.json();
      return {
        chunksProcessed: data.chunks_count,
        totalChunks: data.chunks_count
      };
    } catch (error) {
      console.error('File processing error:', error);
      throw error;
    }
  };

  const startProcessing = async (fileEntries: UploadedFile[], rawFiles?: File[]) => {
    if (!config.apiKey) {
      alert("Please set your API Key in settings first.");
      return;
    }

    const isHealthy = await checkBackendHealth();
    if (!isHealthy) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `⚠️ Backend at ${getApiUrl()} is unreachable. Please check settings or try again.`,
        timestamp: Date.now()
      }]);
      return;
    }

    setState(s => ({ ...s, isAnalyzing: true, currentTask: 'Initializing...', progress: 5 }));
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      let fileToUpload: File | undefined = rawFiles ? rawFiles[i] : fileObjectsRef.current[entry.id];
      
      setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'processing' } : f));
      
      try {
        if (!fileToUpload && entry.url) {
            setState(s => ({ ...s, currentTask: `Downloading ${entry.name}...` }));
            try {
                let fetchUrl = entry.url;
                if (window.location.protocol === 'https:' && entry.url.startsWith('http:')) {
                    fetchUrl = entry.url.replace('http:', 'https:');
                }
                const res = await fetch(fetchUrl, { mode: 'cors' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                fileToUpload = new File([blob], entry.name, { type: blob.type });
            } catch (err: any) {
                if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
                    throw new Error('SECURITY_BLOCK');
                }
                throw new Error('DOWNLOAD_FAILED');
            }
        }
        
        if (fileToUpload) {
            setState(s => ({ ...s, currentTask: `Uploading ${entry.name}...` }));
            const result = await processFile(fileToUpload, entry.id);
            if (result) {
                setFiles(prev => prev.map(f => f.id === entry.id ? { 
                    ...f, 
                    status: 'analyzed', 
                    chunksProcessed: result.chunksProcessed, 
                    totalChunks: result.totalChunks 
                } : f));
                successCount++;
                delete fileObjectsRef.current[entry.id];
                
                setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  role: 'system',
                  content: `✅ Successfully uploaded "${entry.name}"`,
                  timestamp: Date.now()
                }]);
            }
        } else {
            throw new Error("File data lost. Please remove and re-upload.");
        }
      } catch (error: any) {
        console.error("Processing failed for", entry.name, error);
        failCount++;
        
        setFiles(prev => prev.map(f => f.id === entry.id ? { 
            ...f, 
            status: 'error',
        } : f));
        
        if (error.message === 'SECURITY_BLOCK' || error.message === 'DOWNLOAD_FAILED') {
             setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                content: `⚠️ Could not auto-download "${entry.name}". Please download manually and upload.`,
                timestamp: Date.now()
            }]);
        } else {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            content: `❌ Failed to process "${entry.name}": ${error.message}`,
            timestamp: Date.now()
          }]);
        }
      }
      
      setState(s => ({ 
        ...s, 
        progress: 10 + ((i + 1) / fileEntries.length) * 90 
      }));
    }
    
    setState(s => ({ ...s, isAnalyzing: false, currentTask: 'Ready', progress: 100 }));
  };

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (!currentSessionId) return;
    
    const newFileEntries: UploadedFile[] = newFiles.map(file => {
        const id = Math.random().toString(36).substr(2, 9);
        fileObjectsRef.current[id] = file;
        return {
            id,
            name: file.name,
            type: file.type,
            size: file.size,
            status: 'pending', 
            chunksProcessed: 0,
            totalChunks: 0,
            analysisResults: []
        };
    });
    
    setFiles(prev => [...prev, ...newFileEntries]);
    
    if (config.apiKey) {
        startProcessing(newFileEntries, newFiles);
    }
  }, [currentSessionId, config.apiKey]);

  const addFromUrl = (url: string) => {
    const rawName = url.split('/').pop() || 'document.pdf';
    const name = rawName.split('?')[0];
    const newFile: UploadedFile = {
      id: Math.random().toString(36).substr(2, 9),
      name: name,
      type: 'application/pdf', 
      size: 0,
      status: 'pending',
      chunksProcessed: 0,
      totalChunks: 0,
      url: url
    };
    
    setFiles(prev => [...prev, newFile]);
    
    if (config.apiKey) {
        startProcessing([newFile]);
    }
  };

  const startAnalysis = () => {
      const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error');
      if (pendingFiles.length > 0) {
          startProcessing(pendingFiles);
      }
  };

  const pauseAnalysis = () => {
      setState(s => ({ ...s, paused: !s.paused }));
  };

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: text, 
      timestamp: Date.now() 
    };
    setMessages(prev => [...prev, userMsg]);
    
    try {
      const response = await fetchWithRetry('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId,
          message: text
        })
      });
      
      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }
      
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
        content: `Error: Could not connect to backend at ${getApiUrl()}. The service may be temporarily unavailable.`,
        timestamp: Date.now()
      }]);
    }
  }, [currentSessionId, fetchWithRetry, getApiUrl]);

  const addTextSource = (name: string, content: string) => {
    const newSource: TextSource = {
        id: Date.now().toString(),
        name,
        content,
        status: 'analyzed',
        chunksProcessed: 1,
        totalChunks: 1
    };
    setTextSources(prev => [...prev, newSource]);
  }; 

  const deleteFile = (id: string) => {
      setFiles(p => p.filter(f => f.id !== id));
      delete fileObjectsRef.current[id];
  };

  const deleteTextSource = (id: string) => setTextSources(p => p.filter(t => t.id !== id));

  const updateConfig = (updates: any) => setConfig(p => ({ ...p, ...updates }));

  const createSession = (name: string) => {
    const id = Date.now().toString();
    const newSession: Session = { 
        id, 
        name, 
        createdAt: Date.now(), 
        updatedAt: Date.now(), 
        files: [], 
        textSources: [], 
        messages: [{
            id: 'welcome',
            role: 'assistant',
            content: 'New session started. Upload documents to begin.',
            timestamp: Date.now()
        }], 
        depth: 'deep' 
    };
    setSessions(p => [...p, newSession]);
    setCurrentSessionId(id);
    fileObjectsRef.current = {}; 
  };

  const renameSession = (id: string, newName: string) => {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  const loadSession = (id: string) => {
      setCurrentSessionId(id);
      fileObjectsRef.current = {}; 
  };

  const deleteSession = (id: string) => {
      setSessions(p => p.filter(x => x.id !== id));
      if (currentSessionId === id) {
          const remaining = sessions.filter(x => x.id !== id);
          if (remaining.length > 0) {
              loadSession(remaining[0].id);
          } else {
              const newId = Date.now().toString();
              setCurrentSessionId(newId);
              setFiles([]);
              setTextSources([]);
              setMessages([{
                  id: 'welcome',
                  role: 'assistant',
                  content: 'Session deleted. Started new session.',
                  timestamp: Date.now()
              }]);
          }
      }
  };

  const exportSession = (id: string) => {
      const session = sessions.find(s => s.id === id);
      if (!session) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(session));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `${session.name || 'session'}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const retryBackendConnection = async () => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content: 'Attempting to reconnect to backend...',
      timestamp: Date.now()
    }]);
    
    const isHealthy = await checkBackendHealth();
    if (isHealthy) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: '✅ Backend connection restored!',
        timestamp: Date.now()
      }]);
    }
  };

  const debugSession = async () => {
    try {
      const response = await fetchWithRetry(`/debug/${currentSessionId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: `🔍 Debug Info:\nChunks: ${data.chunks_count}\nHistory: ${data.history_count}\nRuntime Active: ${data.runtime_active}`,
          timestamp: Date.now()
        }]);
      }
    } catch (error) {
      console.error('Debug error:', error);
    }
  };

  const clearMemory = async () => {
    try {
      const response = await fetchWithRetry(`/clear_memory/${currentSessionId}`, {
        method: 'POST'
      });
      if (response.ok) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: '🧹 Memory cleared for current session.',
          timestamp: Date.now()
        }]);
      }
    } catch (error) {
      console.error('Clear memory error:', error);
    }
  };

  return {
    files, textSources, messages, depth, state, sessions, currentSessionId, config,
    setDepth, addFiles, addTextSource, addFromUrl, deleteFile, deleteTextSource,
    startAnalysis, pauseAnalysis, sendMessage, createSession, loadSession, deleteSession,
    updateConfig, exportSession, renameSession, backendStatus, retryBackendConnection,
    debugSession, clearMemory
  };
};
