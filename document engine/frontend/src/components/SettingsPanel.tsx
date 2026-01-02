import React, { useState } from 'react';
import { Settings, Key, Save, Download, Upload, Trash2 } from 'lucide-react';
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
  onClose
}: SettingsPanelProps) {
  const [newSessionName, setNewSessionName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const handleImportSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const sessionData = JSON.parse(event.target?.result as string);
        if (sessionData.id && sessionData.name) {
          onCreateSession(sessionData.name);
        }
      } catch (error) {
        console.error('Failed to import session:', error);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-800">
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
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-200"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Key is securely sent to your Python backend for this session.
                </p>
              </div>
            </div>
          </div>

          {/* Session Management */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-slate-200">Session Management</h3>
              <div className="flex gap-2">
                <label className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-700 flex items-center gap-2">
                  <Upload className="w-3 h-3" />
                  Import
                  <input type="file" accept=".json" className="hidden" onChange={handleImportSession} />
                </label>
              </div>
            </div>
            
            {/* New Session */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="New session name"
                className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  if (newSessionName.trim()) {
                    onCreateSession(newSessionName);
                    setNewSessionName('');
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
              >
                Create
              </button>
            </div>

            {/* Session List */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`p-3 rounded-lg border transition-colors ${
                    currentSessionId === session.id
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{session.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-slate-500">
                          {session.files.length} files
                        </span>
                        <span className="text-xs text-slate-500">
                          {session.messages.length} messages
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
                  No sessions yet. Create one to get started.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
