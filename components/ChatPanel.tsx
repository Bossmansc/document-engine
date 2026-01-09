import React, { useRef, useEffect } from 'react';
import { Message } from '../types';
import { Send, Bot, User, Download, Share2, ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (msg: string) => void;
  onBack?: () => void;
  backendStatus?: 'unknown' | 'healthy' | 'unhealthy';
  onRetryConnection?: () => void;
}

export default function ChatPanel({ 
  messages, 
  onSendMessage, 
  onBack, 
  backendStatus = 'unknown',
  onRetryConnection 
}: ChatPanelProps) {
  const [input, setInput] = React.useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {}
      <div className="h-16 border-b border-slate-800 flex items-center justify-between px-4 md:px-6 bg-slate-900/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          {}
          {onBack && (
            <button 
              onClick={onBack}
              className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Back to files"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className={`w-2 h-2 rounded-full ${
            backendStatus === 'healthy' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' :
            backendStatus === 'unhealthy' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
            'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]'
          }`}></div>
          <h2 className="font-semibold text-slate-100 text-sm md:text-base">DeepSeek Analysis</h2>
          {backendStatus === 'unhealthy' && onRetryConnection && (
            <button
              onClick={onRetryConnection}
              className="ml-2 px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-full flex items-center gap-1 transition-colors"
              title="Retry connection"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors hidden md:block">
            <Share2 className="w-4 h-4" />
          </button>
          <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors hidden md:block">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {}
      {backendStatus === 'unhealthy' && (
        <div className="bg-red-500/10 border-b border-red-500/30 p-3">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>Backend connection lost. Some features may be unavailable.</span>
            {onRetryConnection && (
              <button
                onClick={onRetryConnection}
                className="ml-auto text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded-full flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
        {messages.map((msg) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={msg.id} 
            className={`flex gap-3 md:gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              msg.role === 'assistant' ? 'bg-blue-600' : 'bg-slate-700'
            }`}>
              {msg.role === 'assistant' ? <Bot className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <User className="w-4 h-4 md:w-5 md:h-5 text-slate-200" />}
            </div>
            <div className={`flex flex-col max-w-[75%] md:max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-3 md:p-4 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-slate-800 text-slate-100 rounded-tr-none' 
                  : 'bg-slate-900 border border-slate-800 text-slate-300 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
              {}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-1 md:mt-2 flex flex-wrap gap-1 md:gap-2">
                  <span className="text-[9px] md:text-[10px] text-slate-500 font-mono uppercase">Sources:</span>
                  {msg.sources.map((source, idx) => (
                    <span key={idx} className="text-[9px] md:text-[10px] bg-slate-900 border border-slate-800 text-blue-400 px-1.5 py-0.5 rounded-full truncate max-w-[80px] md:max-w-none">
                      {source}
                    </span>
                  ))}
                </div>
              )}
              <span className="text-[9px] md:text-[10px] text-slate-600 mt-1 px-1">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {}
      <div className="p-3 md:p-4 bg-slate-900 border-t border-slate-800 shrink-0">
        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={backendStatus === 'unhealthy' ? "Backend unavailable. Retrying connection..." : "Ask about your documents..."}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-xl pl-4 pr-12 py-3 text-sm md:text-base focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={backendStatus === 'unhealthy'}
          />
          <button 
            type="submit"
            disabled={!input.trim() || backendStatus === 'unhealthy'}
            className="absolute right-2 top-2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
