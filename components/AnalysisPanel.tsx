import React, { useState } from 'react';
import { UploadedFile, AnalysisState, AnalysisDepth, TextSource } from '../types';
import { FileText, Loader2, CheckCircle2, Pause, Play, Settings2, Key, AlertCircle, Trash2, X, Type, FileWarning, ExternalLink, RefreshCw, Globe, Plus, ChevronDown, ChevronUp } from 'lucide-react';
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
}

export default function AnalysisPanel({ 
  files, textSources, state, depth, config, onUpload, onAddTextSource, onAddUrl, onDeleteFile, onDeleteTextSource, onStart, onPause, onDepthChange, onOpenSettings,
  backendStatus = 'unknown',
  onRetryConnection
}: AnalysisPanelProps) {
  const hasApiKey = !!config.apiKey; 
  const [showTextInput, setShowTextInput] = useState(false);
  const [textSourceName, setTextSourceName] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [expandedTextSources, setExpandedTextSources] = useState<Set<string>>(new Set());

  const handleAddTextSource = () => {
    if (textSourceName.trim() && textSourceContent.trim()) {
      onAddTextSource(textSourceName, textSourceContent);
      setTextSourceName('');
      setTextSourceContent('');
      setShowTextInput(false);
    }
  };

  const toggleFileExpanded = (id: string) => {
    const newSet = new Set(expandedFiles);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedFiles(newSet);
  };

  const toggleTextSourceExpanded = (id: string) => {
    const newSet = new Set(expandedTextSources);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedTextSources(newSet);
  };

  const totalItems = files.length + textSources.length;
  const pendingCount = files.filter(f => f.status === 'pending' || f.status === 'error').length + 
                       textSources.filter(t => t.status === 'pending' || t.status === 'error').length;

  const analyzedCount = files.filter(f => f.status === 'analyzed').length + 
                        textSources.filter(t => t.status === 'analyzed').length;

  return (
    <div className="flex flex-col h-full bg-slate-900 md:border-r border-slate-800">
      {/* Header */}
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

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Backend Status Alert */}
        {backendStatus === 'unhealthy' && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/30 rounded-lg p-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-300 font-medium">Backend Connection Lost</p>
                <p className="text-xs text-red-400/80 mt-1">
                  The analysis backend is currently unreachable. Uploads and chat may fail.
                </p>
                {onRetryConnection && (
                  <button
                    onClick={onRetryConnection}
                    className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry Connection
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-300 font-medium">API Key Required</p>
                <p className="text-xs text-yellow-400/80 mt-1">
                  Set your DeepSeek API key in settings to enable document analysis.
                </p>
                <button
                  onClick={onOpenSettings}
                  className="mt-2 px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <div>
          <h3 className="text-sm font-medium text-slate-400 mb-3">Add Content</h3>
          <FileUpload onFilesSelected={onUpload} onUrlAdd={onAddUrl} />
        </div>

        {/* Text Source Input */}
        {showTextInput ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-300">Add Text Source</h3>
              <button
                onClick={() => setShowTextInput(false)}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
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
                placeholder="Paste text content here..."
                rows={4}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddTextSource}
                  disabled={!textSourceName.trim() || !textSourceContent.trim()}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex-1"
                >
                  Add Text Source
                </button>
                <button
                  onClick={() => setShowTextInput(false)}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowTextInput(true)}
            className="w-full p-3 border border-dashed border-slate-700 bg-slate-800/30 hover:bg-slate-800/50 rounded-lg text-slate-400 hover:text-slate-300 transition-colors flex items-center justify-center gap-2"
          >
            <Type className="w-4 h-4" />
            <span className="text-sm font-medium">Add Text Source</span>
          </button>
        )}

        {/* Analysis Controls */}
        <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-slate-300">Analysis Controls</h3>
              <p className="text-xs text-slate-500 mt-1">
                {analyzedCount} analyzed • {pendingCount} pending
              </p>
            </div>
            <div className="flex items-center gap-2">
              {state.isAnalyzing && (
                <button
                  onClick={onPause}
                  className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 hover:text-white transition-colors"
                  title={state.paused ? "Resume" : "Pause"}
                >
                  {state.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={onStart}
                disabled={pendingCount === 0 || !hasApiKey || backendStatus === 'unhealthy'}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {state.isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Analysis
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {state.isAnalyzing && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>{state.currentTask}</span>
                <span>{Math.round(state.progress)}%</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-blue-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${state.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {/* Depth Selector */}
          <div className="mt-4">
            <label className="block text-xs text-slate-400 mb-2">Analysis Depth</label>
            <div className="flex gap-1 bg-slate-900 p-1 rounded-lg">
              {(['quick', 'deep', 'thematic'] as AnalysisDepth[]).map((d) => (
                <button
                  key={d}
                  onClick={() => onDepthChange(d)}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
                    depth === d
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
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
                <div
                  key={file.id}
                  className="bg-slate-800/40 border border-slate-700 rounded-lg overflow-hidden"
                >
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`p-2 rounded-lg ${
                        file.status === 'analyzed' ? 'bg-green-500/20' :
                        file.status === 'processing' ? 'bg-blue-500/20' :
                        file.status === 'error' ? 'bg-red-500/20' :
                        'bg-slate-700'
                      }`}>
                        {file.status === 'analyzed' ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        ) : file.status === 'processing' ? (
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        ) : file.status === 'error' ? (
                          <FileWarning className="w-4 h-4 text-red-400" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{file.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-slate-500">
                            {Math.round(file.size / 1024)} KB
                          </span>
                          {file.status === 'analyzed' && (
                            <span className="text-xs text-green-400">
                              {file.chunksProcessed} chunks
                            </span>
                          )}
                          {file.url && (
                            <span className="text-xs text-blue-400 flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              URL
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleFileExpanded(file.id)}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                      >
                        {expandedFiles.has(file.id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteFile(file.id)}
                        className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Expanded Details */}
                  {expandedFiles.has(file.id) && (
                    <div className="px-3 pb-3 border-t border-slate-700 pt-3">
                      <div className="text-xs text-slate-400 space-y-2">
                        <div className="flex justify-between">
                          <span>Type:</span>
                          <span className="text-slate-300">{file.type}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <span className={`font-medium ${
                            file.status === 'analyzed' ? 'text-green-400' :
                            file.status === 'processing' ? 'text-blue-400' :
                            file.status === 'error' ? 'text-red-400' :
                            'text-yellow-400'
                          }`}>
                            {file.status.charAt(0).toUpperCase() + file.status.slice(1)}
                          </span>
                        </div>
                        {file.url && (
                          <div className="flex justify-between">
                            <span>Source:</span>
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open URL
                            </a>
                          </div>
                        )}
                        {file.analysisResults && file.analysisResults.length > 0 && (
                          <div>
                            <span className="block mb-1">Analysis Results:</span>
                            <ul className="text-slate-300 space-y-1">
                              {file.analysisResults.slice(0, 3).map((result, idx) => (
                                <li key={idx} className="pl-2 border-l-2 border-slate-600">
                                  {result}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Text Sources List */}
        {textSources.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <Type className="w-4 h-4" />
              Text Sources ({textSources.length})
            </h3>
            <div className="space-y-2">
              {textSources.map((source) => (
                <div
                  key={source.id}
                  className="bg-slate-800/40 border border-slate-700 rounded-lg overflow-hidden"
                >
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`p-2 rounded-lg ${
                        source.status === 'analyzed' ? 'bg-green-500/20' :
                        source.status === 'processing' ? 'bg-blue-500/20' :
                        source.status === 'error' ? 'bg-red-500/20' :
                        'bg-slate-700'
                      }`}>
                        {source.status === 'analyzed' ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        ) : source.status === 'processing' ? (
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        ) : source.status === 'error' ? (
                          <FileWarning className="w-4 h-4 text-red-400" />
                        ) : (
                          <Type className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{source.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-slate-500">
                            {source.content.length} chars
                          </span>
                          {source.status === 'analyzed' && (
                            <span className="text-xs text-green-400">
                              {source.chunksProcessed} chunks
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleTextSourceExpanded(source.id)}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                      >
                        {expandedTextSources.has(source.id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteTextSource(source.id)}
                        className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Expanded Details */}
                  {expandedTextSources.has(source.id) && (
                    <div className="px-3 pb-3 border-t border-slate-700 pt-3">
                      <div className="text-xs text-slate-400 space-y-2">
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <span className={`font-medium ${
                            source.status === 'analyzed' ? 'text-green-400' :
                            source.status === 'processing' ? 'text-blue-400' :
                            source.status === 'error' ? 'text-red-400' :
                            'text-yellow-400'
                          }`}>
                            {source.status.charAt(0).toUpperCase() + source.status.slice(1)}
                          </span>
                        </div>
                        <div>
                          <span className="block mb-1">Preview:</span>
                          <div className="text-slate-300 bg-slate-900/50 rounded p-2 max-h-32 overflow-y-auto">
                            {source.content.length > 200
                              ? `${source.content.substring(0, 200)}...`
                              : source.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {files.length === 0 && textSources.length === 0 && (
          <div className="text-center py-8">
            <div className="p-4 bg-slate-800/30 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <FileText className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-slate-300 mb-2">No Content Added</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Upload files or add text sources to begin analysis. The system supports PDF, DOCX, TXT files and direct URLs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
