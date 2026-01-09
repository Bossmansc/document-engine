import React, { useState } from 'react';
import { Settings, Key, Save, Download, Upload, Trash2, Edit2, Plus } from 'lucide-react';
import { Session } from '../types';

interface SettingsPanelProps {
  config: {
    apiKey: string;
    autoSave: boolean;
    chunkSize: number;
    overlapSize: number;
  };
  sessions: Session[];
  currentSessionId: string;
  onUpdateConfig: (updates: any) => void;
  onCreateSession: (name: string) => void;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onExportSession: (id: string) => void;
  onRenameSession?: (id: string, name: string) => void;
  onClose: () => void;
}

export default function SettingsPanel({
  config,
  sessions,
  currentSessionId,
  onUpdateConfig,
  onCreateSession,
  onLoadSession,
  onDeleteSession,
  onExportSession,
  onRenameSession,
  onClose
}: SettingsPanelProps) {
  const [newSessionName, setNewSessionName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const handleImportSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const sessionData = JSON.parse(event.target?.result as string);
        if (sessionData.id && sessionData.name) {
          console.log("Importing not fully wired in UI yet");
        }
      } catch (error) {
        console.error('Failed to import session:', error);
      }
    };
    reader.readAsText(file);
  };

  const startEditing = (session: Session) => {
      setEditingId(session.id);
      setEditName(session.name);
  };

  const saveEdit = () => {
      if (editingId && editName.trim() && onRenameSession) {
          onRenameSession(editingId, editName.trim());
          setEditingId(null);
      }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Settings className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-100">Settings & Sessions</h2>
                <p className="text-sm text-slate-400">Configure API and manage analysis sessions</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* API Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
              <Key className="w-4 h-4" />
              DeepSeek API Configuration
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={config.apiKey}
                    onChange={(e) => onUpdateConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-200 text-xs uppercase tracking-wider font-medium"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Key is securely sent to your Python backend for this session.
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="autoSave"
                  checked={config.autoSave}
                  onChange={(e) => onUpdateConfig({ autoSave: e.target.checked })}
                  className="w-4 h-4 text-blue-500 bg-slate-800 border-slate-700 rounded focus:ring-blue-500 focus:ring-offset-slate-900"
                />
                <label htmlFor="autoSave" className="text-sm text-slate-300">
                  Auto-save sessions to local storage
                </label>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-800" />

          {/* Session Management */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-slate-200">Session Management</h3>
            </div>

            {/* Create Session */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="New session name"
                className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && newSessionName.trim() && (onCreateSession(newSessionName), setNewSessionName(''))}
              />
              <button
                onClick={() => {
                  if (newSessionName.trim()) {
                    onCreateSession(newSessionName);
                    setNewSessionName('');
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Create
              </button>
            </div>

            {/* Session List */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {sessions.sort((a,b) => b.updatedAt - a.updatedAt).map((session) => (
                <div
                  key={session.id}
                  className={`p-3 rounded-lg border transition-all ${
                    currentSessionId === session.id
                      ? 'bg-blue-900/20 border-blue-500/50'
                      : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 mr-4">
                      {editingId === session.id ? (
                          <div className="flex gap-2">
                              <input 
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white w-full"
                                autoFocus
                                onBlur={saveEdit}
                                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                              />
                          </div>
                      ) : (
                        <div className="group flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-200 truncate cursor-pointer" onClick={() => onLoadSession(session.id)}>
                                {session.name}
                            </p>
                            {onRenameSession && (
                                <button onClick={() => startEditing(session)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-white transition-opacity">
                                    <Edit2 className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500">
                          {new Date(session.updatedAt || session.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-slate-500">
                          {session.files.length} file{session.files.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-slate-500">
                          {session.messages.length} msg
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {currentSessionId !== session.id && (
                        <button
                          onClick={() => onLoadSession(session.id)}
                          className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                          title="Load session"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onExportSession(session.id)}
                        className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                        title="Export JSON"
                      >
                         <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        className="p-1.5 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="text-center py-6 text-slate-600 text-sm">
                  No sessions yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900 sticky bottom-0 rounded-b-xl">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
