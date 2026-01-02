import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-3xl font-bold text-blue-500">Project Migrated to Full-Stack</h1>
        <p className="text-slate-400">
          This project has been restructured for deployment on Render.
        </p>
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 text-left space-y-4">
          <p className="text-sm font-medium text-slate-300">New Structure:</p>
          <ul className="list-disc list-inside text-sm text-slate-400 space-y-2">
            <li><code className="text-blue-400">frontend/</code>: Complete React application (Use this for the UI service).</li>
            <li><code className="text-blue-400">backend/</code>: Python FastAPI service (Use this for the API service).</li>
            <li><code className="text-blue-400">render.yaml</code>: Configuration for automatic deployment.</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          The root-level files (App.tsx, hooks/, components/) are deprecated. Please refer to the 'frontend' and 'backend' directories.
        </p>
      </div>
    </div>
  );
}
