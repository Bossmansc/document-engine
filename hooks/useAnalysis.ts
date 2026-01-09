import { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedFile, Message, AnalysisDepth, AnalysisState, Session, TextSource } from '../types';
import { useLocalStorage } from './useLocalStorage';

// Change this to local server
const API_URL = 'http://localhost:5000'; // Changed from Render.com to local
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; 

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
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown');
  
  const fileObjectsRef = useRef<Record<string, File>>({});

  const checkBackendHealth = useCallback(async (retryCount = 0): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Shorter timeout for local
      
      const response = await fetch(`${API_URL}/health`, {
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
  }, []);

  const fetchWithRetry = useCallback(async (
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<Response> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); 
      
      const response = await fetch(`${API_URL}${endpoint}`, {
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
  }, []);

  useEffect(() => {
    checkBackendHealth();
    
    const interval = setInterval(() => {
      checkBackendHealth();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  // Rest of the file remains the same...
  // [Previous code continues here - only changed API_URL]
