export type AnalysisDepth = 'quick' | 'deep' | 'thematic';

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  status: 'pending' | 'processing' | 'analyzed' | 'error';
  chunksProcessed: number;
  totalChunks: number;
  content?: string;
  chunks?: any[];
  analysisResults?: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'system' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: number;
  sessionId?: string;
}

export interface AnalysisState {
  isAnalyzing: boolean;
  paused: boolean;
  progress: number;
  currentTask: string;
}

export interface TextSource {
  id: string;
  name: string;
  content: string;
  status: 'pending' | 'analyzed' | 'error' | 'processing';
  chunksProcessed: number;
  totalChunks: number;
  chunks?: any[];
  analysisResults?: string[];
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: UploadedFile[];
  textSources: TextSource[]; 
  messages: Message[];
  depth: AnalysisDepth;
}

export interface AppConfig {
  apiKey: string;
  autoSave: boolean;
  chunkSize: number;
  overlapSize: number;
}
