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
    deleteSession, updateConfig, exportSession, renameSession,
    backendStatus, retryBackendConnection
  } = useAnalysis();
  
  const [activeTab, setActiveTab] = useState<'analysis' | 'chat'>('analysis');
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-950 text-slate-200 font-sans overflow-hidden">
      {}
      <div className="md:hidden flex border-b border-slate-800 bg-slate-900 shrink-0">
        <button 
          onClick={() => setActiveTab('analysis')} 
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'analysis' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400'}`}
        >
          <FileText className="w-4 h-4" />
          Content
        </button>
        <button 
          onClick={() => setActiveTab('chat')} 
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400'}`}
        >
          <MessageSquare className="w-4 h-4" />
          Chat
        </button>
        <button 
          onClick={() => setShowSettings(true)} 
          className="px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {}
      <div className={`${activeTab === 'analysis' ? 'flex' : 'hidden'} md:flex w-full md:w-[400px] lg:w-[35%] flex-shrink-0 h-full overflow-hidden`}>
        <AnalysisPanel 
          files={files} textSources={textSources} state={state} depth={depth} config={config}
          onUpload={addFiles} onAddTextSource={addTextSource} onAddUrl={addFromUrl}
          onDeleteFile={deleteFile} onDeleteTextSource={deleteTextSource}
          onStart={startAnalysis} onPause={pauseAnalysis} onDepthChange={setDepth}
          onOpenSettings={() => setShowSettings(true)}
          backendStatus={backendStatus}
          onRetryConnection={retryBackendConnection}
        />
      </div>

      {}
      <div className={`${activeTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 h-full min-w-0 overflow-hidden`}>
        <ChatPanel 
          messages={messages} 
          onSendMessage={sendMessage} 
          onBack={() => setActiveTab('analysis')}
          backendStatus={backendStatus}
          onRetryConnection={retryBackendConnection}
        />
      </div>

      {}
      {showSettings && (
        <SettingsPanel
          config={config} sessions={sessions} currentSessionId={currentSessionId}
          onUpdateConfig={updateConfig} onCreateSession={createSession}
          onLoadSession={loadSession} onDeleteSession={deleteSession}
          onExportSession={exportSession} onRenameSession={renameSession}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
