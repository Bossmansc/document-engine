import React, { useState } from 'react';
import AnalysisPanel from './components/AnalysisPanel';
import ChatPanel from './components/ChatPanel';
import SettingsPanel from './components/SettingsPanel';
import { useAnalysis } from './hooks/useAnalysis';
import { MessageSquare, FileText, Settings } from 'lucide-react';

export default function App() {
  const { 
    files, textSources, messages, depth, state, sessions, currentSessionId, config,
    setDepth, addFiles, addTextSource, addFromUrl, deleteFile, deleteTextSource,
    startAnalysis, pauseAnalysis, sendMessage, createSession, loadSession,
    deleteSession, updateConfig, exportSession
  } = useAnalysis();

  const [activeTab, setActiveTab] = useState<'analysis' | 'chat'>('analysis');
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-950 text-slate-200 font-sans overflow-hidden">
      {/* Mobile Nav */}
      <div className="md:hidden flex border-b border-slate-800 bg-slate-900">
        <button onClick={() => setActiveTab('analysis')} className={`flex-1 py-3 text-sm font-medium ${activeTab === 'analysis' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400'}`}>Content</button>
        <button onClick={() => setActiveTab('chat')} className={`flex-1 py-3 text-sm font-medium ${activeTab === 'chat' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400'}`}>Chat</button>
        <button onClick={() => setShowSettings(true)} className="px-4 py-3 text-slate-400"><Settings className="w-4 h-4" /></button>
      </div>

      {/* Analysis Panel */}
      <div className={`${activeTab === 'analysis' ? 'flex' : 'hidden'} md:flex w-full md:w-[400px] lg:w-[35%] flex-shrink-0 h-full`}>
        <AnalysisPanel 
          files={files} textSources={textSources} state={state} depth={depth} config={config}
          onUpload={addFiles} onAddTextSource={addTextSource} onAddUrl={addFromUrl}
          onDeleteFile={deleteFile} onDeleteTextSource={deleteTextSource}
          onStart={startAnalysis} onPause={pauseAnalysis} onDepthChange={setDepth}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      {/* Chat Panel */}
      <div className={`${activeTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 h-full min-w-0`}>
        <ChatPanel messages={messages} onSendMessage={sendMessage} />
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          config={config} sessions={sessions} currentSessionId={currentSessionId}
          onUpdateConfig={updateConfig} onCreateSession={createSession}
          onLoadSession={loadSession} onDeleteSession={deleteSession}
          onExportSession={exportSession} onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
