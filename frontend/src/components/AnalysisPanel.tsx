import React, { useState } from 'react';
import { UploadedFile, AnalysisState, AnalysisDepth, TextSource } from '../types';
import { FileText, Loader2, CheckCircle2, Pause, Play, Settings2, Key, AlertCircle, Trash2, X, Type } from 'lucide-react';
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
}

export default function AnalysisPanel({ 
  files, textSources, state, depth, config, onUpload, onAddTextSource, onAddUrl, onDeleteFile, onDeleteTextSource, onStart, onPause, onDepthChange, onOpenSettings 
}: AnalysisPanelProps) {
  const pendingCount = files.filter(f => f.status === 'pending').length + textSources.filter(t => t.status === 'pending').length;
  // In full-stack mode, we don't strictly need the API key in frontend state to *start* upload, 
  // but we show the warning if it's not set for clarity.
  const hasApiKey = !!config.apiKey; 
  const [showTextInput, setShowTextInput] = useState(false);
  const [textSourceName, setTextSourceName] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');

  const handleAddTextSource = () => {
    if (textSourceName.trim() && textSourceContent.trim()) {
      onAddTextSource(textSourceName, textSourceContent);
      setTextSourceName('');
      setTextSourceContent('');
      setShowTextInput(false);
    }
  };

  const totalItems = files.length + textSources.length;

  return (
    <div className="flex flex-col h-full bg-slate-900 md:border-r border-slate-800">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/50">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-400 mb-1">
              <Settings2 className="w-4 h-4" />
              <span className="text-xs font-bold tracking-wider uppercase">Configuration</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-100">Document Engine</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="md:hidden text-slate-400 text-sm">
              {totalItems} item{totalItems !== 1 ? 's' : ''}
            </div>
            <button
              onClick={onOpenSettings}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
              title="Settings"
            >
              <Key className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-amber-300 font-medium">API Key Required</p>
                <p className="text-xs text-amber-400/80 mt-1">
                  Enter your DeepSeek API key in settings. It will be secured on your backend.
                </p>
                <button
                  onClick={onOpenSettings}
                  className="mt-2 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-full transition-colors"
                >
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Depth Selector */}
        <div className="space-y-3">
          <label className="text-sm text-slate-400 font-medium">Analysis Depth</label>
          <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['quick', 'deep', 'thematic'] as AnalysisDepth[]).map((d) => (
              <button
                key={d}
                onClick={() => onDepthChange(d)}
                className={`text-xs py-2 md:py-1.5 rounded-md capitalize transition-all ${
                  depth === d 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Text Source Input */}
        {showTextInput ? (
          <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">Add Text Source</h3>
              <button
                onClick={() => setShowTextInput(false)}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={textSourceName}
              onChange={(e) => setTextSourceName(e.target.value)}
              placeholder="Source name"
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <textarea
              value={textSourceContent}
              onChange={(e) => setTextSourceContent(e.target.value)}
              placeholder="Paste your text here..."
              rows={4}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowTextInput(false)}
                className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTextSource}
                disabled={!textSourceName.trim() || !textSourceContent.trim()}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="flex-1">
              <FileUpload onFilesSelected={onUpload} onUrlAdd={onAddUrl} />
            </div>
            <button
              onClick={() => setShowTextInput(true)}
              className="flex-shrink-0 w-12 md:w-auto px-3 md:px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-700 flex items-center justify-center gap-2"
              title="Add text source"
            >
              <Type className="w-4 h-4" />
              <span className="hidden md:inline">Text</span>
            </button>
          </div>
        )}

        {/* Queue List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm text-slate-400 font-medium">Queue ({totalItems})</label>
          </div>

          <div className="space-y-2">
            {/* Files */}
            {files.map(file => (
              <div key={file.id} className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 group hover:border-slate-700 transition-colors relative">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${
                      file.status === 'analyzed' ? 'bg-green-500/10 text-green-400' :
                      file.status === 'error' ? 'bg-red-500/10 text-red-400' :
                      file.status === 'processing' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-slate-900 text-slate-400'
                    }`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium truncate">{file.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {(file.size / 1024).toFixed(1)} KB • {file.type.split('/')[1] || 'file'} • {file.totalChunks} chunks
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {file.status === 'processing' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                    {file.status === 'analyzed' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    {file.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                    <button
                      onClick={() => onDeleteFile(file.id)}
                      className="p-1.5 hover:bg-red-500/20 rounded-md text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                {(file.status === 'processing' || file.status === 'analyzed') && (
                  <div className="w-full bg-slate-950 rounded-full h-1.5 mt-2 overflow-hidden">
                    <motion.div 
                      className={`h-full rounded-full ${
                        file.status === 'analyzed' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(file.chunksProcessed / file.totalChunks) * 100}%` }}
                    />
                  </div>
                )}
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">{file.status}</span>
                  {file.status !== 'pending' && (
                    <span className="text-[10px] text-slate-500">{file.chunksProcessed}/{file.totalChunks} chunks</span>
                  )}
                </div>
              </div>
            ))}

            {totalItems === 0 && (
              <div className="text-center py-8 text-slate-600 text-sm italic">
                No content in queue. <br/>Upload files, add text, or URLs to begin.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global Status Footer */}
      <div className="p-4 bg-slate-950 border-t border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-blue-400 truncate max-w-[70%] md:max-w-[200px]">
            {state.currentTask}
          </span>
          {state.isAnalyzing && (
            <div className="flex items-center gap-2">
               <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
            </div>
          )}
        </div>
        <div className="w-full bg-slate-900 rounded-full h-1">
          <motion.div 
            className={`h-full rounded-full ${state.paused ? 'bg-amber-500' : 'bg-blue-500'}`}
            animate={{ width: `${state.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
