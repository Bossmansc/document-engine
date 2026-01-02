import React, { useCallback, useState } from 'react';
import { Upload, Link as LinkIcon, X } from 'lucide-react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  onUrlAdd: (url: string) => void;
}

export default function FileUpload({ onFilesSelected, onUrlAdd }: FileUploadProps) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [url, setUrl] = useState('');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  }, [onFilesSelected]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onFilesSelected(Array.from(e.target.files));
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onUrlAdd(url.trim());
      setUrl('');
      setShowUrlInput(false);
    }
  };

  return (
    <div 
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-2 border-dashed border-slate-700 bg-slate-900/50 rounded-xl p-4 md:p-6 text-center transition-all hover:border-blue-500 hover:bg-slate-900 group"
    >
      <div className="flex flex-col items-center justify-center gap-2 md:gap-3">
        {!showUrlInput ? (
          <>
            <div className="p-2 md:p-3 bg-slate-800 rounded-full group-hover:bg-blue-500/20 transition-colors">
              <Upload className="w-5 h-5 md:w-6 md:h-6 text-blue-400 group-hover:text-blue-300" />
            </div>
            <div>
              <h3 className="text-slate-200 font-medium text-sm md:text-base">Drag & drop files</h3>
              <p className="text-slate-500 text-xs md:text-sm mt-1">PDF, DOCX, TXT supported</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-2 w-full max-w-xs">
              <label className="cursor-pointer px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs md:text-sm font-medium transition-colors border border-slate-700 text-center flex-1">
                Browse Files
                <input type="file" multiple className="hidden" onChange={handleChange} />
              </label>
              <button 
                onClick={() => setShowUrlInput(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs md:text-sm font-medium transition-colors border border-slate-700 flex items-center justify-center gap-2"
              >
                <LinkIcon className="w-3 h-3" />
                Add URL
              </button>
            </div>
          </>
        ) : (
          <div className="w-full max-w-sm">
            <h3 className="text-slate-200 font-medium text-sm mb-2">Import from URL</h3>
            <form onSubmit={handleUrlSubmit} className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                disabled={!url.trim()}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUrlInput(false);
                  setUrl('');
                }}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
