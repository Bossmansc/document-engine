import React, { useState } from 'react';
import { UploadedFile, AnalysisState, AnalysisDepth, TextSource } from '../types';
import { FileText, Loader2, CheckCircle2, Pause, Play, Settings2, Key, AlertCircle, Trash2, X, Type, FileWarning, ExternalLink, RefreshCw, Eraser, Bug, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import FileUpload from './FileUpload';
import { motion } from 'framer-motion';

interface AnalysisPanelProps {
  files: UploadedFile[];
  textSources: TextSource[];
  state: AnalysisState;
  depth: AnalysisDepth;
  config: { apiKey: string };
  onUpload: (files: File[]) => void;
  onAddTextSource: (name: string, content: string) => void;
  onAddUrl: (url: string) => void; 
  onDeleteFile: (fileId: string) => void;
  onDeleteTextSource: (sourceId: string) => void;
  onStart: () => void;
  onPause: () => void;
  onDepthChange: (d: AnalysisDepth) => void;
  onOpenSettings: () => void;
  backendStatus?: 'unknown' | 'healthy' | 'unhealthy';
  onRetryConnection?: () => void;
  onDebugSession?: () => void;
  onClearMemory?: () => void;
  onPerformDeepAnalysis?: (fileId: string) => void; // New Prop
}

export default function AnalysisPanel({ 
  files, textSources, state, depth, config, onUpload, onAddTextSource, onAddUrl, onDeleteFile, onDeleteTextSource, onStart, onPause, onDepthChange, onOpenSettings,
  backendStatus = 'unknown',
  onRetryConnection,
  onDebugSession,
  onClearMemory,
  onPerformDeepAnalysis
}: AnalysisPanelProps) {
  const hasApiKey = !!config.apiKey; 
  const [showTextInput, setShowTextInput] = useState(false);
  const [textSourceName, setTextSourceName] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [expandedTextSources, setExpandedTextSources] = useState<Set<string>>(new Set());

  // ... (Keep text source handlers)

  const toggleFileExpanded = (id: string) => {
    const newSet = new Set(expandedFiles);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedFiles(newSet);
  };
  
  const toggleTextSourceExpanded = (id: string) => {
    const newSet = new Set(expandedTextSources);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedTextSources(newSet);
  };

  const totalItems = files.length + textSources.length;
  const pendingCount = files.filter(f => f.status === 'pending' || f.status === 'error').length;
  const analyzedCount = files.filter(f => f.status === 'analyzed').length;

  return (
    <div className="flex flex-col h-full bg-slate-900 md:border-r border-slate-800">
      <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
             <div className="flex items-center gap-2 text-blue-400 mb-1">
              <Settings2 className="w-4 h-4" />
              <span className="text-xs font-bold tracking-wider uppercase">Configuration</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-100">Document Engine</h2>
          </div>
          <div className="flex items-center gap-2">
            {onClearMemory && (
              <button onClick={onClearMemory} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-red-400" title="Clear Memory">
                <Eraser className="w-4 h-4" />
              </button>
            )}
             <button onClick={onOpenSettings} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white" title="Settings">
              <Key className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Backend Status Warning */}
        {backendStatus === 'unhealthy' && (
           <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
             <div className="flex items-center gap-2 text-red-300">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">Backend Disconnected</span>
                {onRetryConnection && <button onClick={onRetryConnection} className="ml-auto text-xs bg-red-600 px-2 py-1 rounded">Retry</button>}
             </div>
           </div>
        )}

        {/* Upload Section */}
        <div>
          <h3 className="text-sm font-medium text-slate-400 mb-3">Add Content</h3>
          <FileUpload onFilesSelected={onUpload} onUrlAdd={onAddUrl} />
        </div>

        {/* Files List */}
        {files.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Files ({files.length})
            </h3>
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.id} className="bg-slate-800/40 border border-slate-700 rounded-lg overflow-hidden">
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                       <div className={`p-2 rounded-lg ${
                        file.status === 'analyzed' ? 'bg-green-500/20' : file.status === 'error' ? 'bg-red-500/20' : 'bg-blue-500/20'
                       }`}>
                         {file.status === 'analyzed' ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                       </div>
                       <div className="min-w-0 flex-1">
                         <p className="text-sm font-medium text-slate-200 truncate">{file.name}</p>
                         <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-slate-500">{Math.round(file.size/1024)} KB</span>
                            {file.deepAnalysis && <span className="text-xs text-purple-400 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Deep Analyzed</span>}
                         </div>
                       </div>
                    </div>
                    <div className="flex gap-1">
                       {onPerformDeepAnalysis && file.status === 'analyzed' && !file.deepAnalysis && (
                          <button 
                            onClick={() => onPerformDeepAnalysis(file.id)}
                            className="p-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                          >
                            <Sparkles className="w-3 h-3" /> Analyze
                          </button>
                       )}
                       <button onClick={() => toggleFileExpanded(file.id)} className="p-1 hover:bg-slate-700 rounded text-slate-400">
                          {expandedFiles.has(file.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                       </button>
                       <button onClick={() => onDeleteFile(file.id)} className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded">
                          <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                  </div>
                  
                  {expandedFiles.has(file.id) && (
                    <div className="px-3 pb-3 border-t border-slate-700 pt-3 bg-slate-900/50">
                      {/* Deep Analysis Result */}
                      {file.deepAnalysis ? (
                        <div className="space-y-3">
                           <div>
                              <span className="text-xs uppercase tracking-wider text-purple-400 font-bold">Executive Summary</span>
                              <p className="text-sm text-slate-300 mt-1 leading-relaxed">{file.deepAnalysis.summary}</p>
                           </div>
                           <div>
                              <span className="text-xs uppercase tracking-wider text-blue-400 font-bold">Key Topics</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {file.deepAnalysis.topics?.map((topic, i) => (
                                   <span key={i} className="text-xs bg-slate-800 text-blue-300 px-2 py-1 rounded border border-slate-700">{topic}</span>
                                ))}
                              </div>
                           </div>
                           <div>
                              <span className="text-xs uppercase tracking-wider text-green-400 font-bold">Key Points</span>
                              <ul className="text-sm text-slate-300 mt-1 space-y-1 list-disc list-inside">
                                {file.deepAnalysis.keyPoints?.map((pt, i) => <li key={i}>{pt}</li>)}
                              </ul>
                           </div>
                        </div>
                      ) : (
                         <div className="text-xs text-slate-500 italic">
                            {file.analysisResults && file.analysisResults.length > 0 ? (
                               <ul className="space-y-1 list-disc list-inside">
                                  {file.analysisResults.map((r, i) => <li key={i}>{r}</li>)}
                               </ul>
                            ) : "No deep analysis performed yet."}
                         </div>
                      )}
                      
                      {file.content && !file.deepAnalysis && (
                        <div className="mt-3">
                           <span className="text-xs text-slate-500 block mb-1">Preview:</span>
                           <p className="text-xs text-slate-400 bg-slate-950 p-2 rounded border border-slate-800 font-mono">
                             {file.content}
                           </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
