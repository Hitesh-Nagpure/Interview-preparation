import React from 'react';
import { Play, Clock, Image as ImageIcon, Type, Folder, Layers } from 'lucide-react';

export default function Dashboard({ folders, onStartTest, onNavigate }) {
  const totalFolders = folders.length;
  const totalTat = folders.reduce((a, f) => a + (f.tat?.count || 0), 0);
  const totalWat = folders.reduce((a, f) => a + (f.wat?.count || 0), 0);
  const latest = folders[0] || null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">SSB Psych Prep</h1>
        <p className="text-sm text-slate-400 mt-1">TAT · WAT · Real-time simulation</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Folders', value: totalFolders, icon: Folder, color: 'text-indigo-500' },
          { label: 'TAT Pics', value: totalTat, icon: ImageIcon, color: 'text-cyan-500' },
          { label: 'WAT Words', value: totalWat, icon: Type, color: 'text-violet-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <Icon className={`w-5 h-5 shrink-0 ${color}`} />
            <div>
              <div className="text-xl font-bold text-slate-800 dark:text-white font-mono">{value}</div>
              <div className="text-xs text-slate-400">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Launch cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* TAT */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="badge-indigo">TAT</span>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mt-2">Thematic Apperception</h3>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5" />
              30s + 4m
            </div>
          </div>

          {latest?.tat?.count > 0 ? (
            <p className="text-xs text-slate-400">
              {latest.dateFolder} · <span className="text-indigo-500 font-semibold">{latest.tat.count} pictures</span>
            </p>
          ) : (
            <p className="text-xs text-amber-500">No TAT batch — upload one first</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onStartTest('TAT', latest?.dateFolder)}
              disabled={!latest?.tat?.count}
              className="flex-1 btn-primary flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start TAT
            </button>
            <button onClick={() => onNavigate('folders')} className="btn-secondary px-3">
              Pick
            </button>
          </div>
        </div>

        {/* WAT */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="badge-cyan">WAT</span>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mt-2">Word Association</h3>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5" />
              15s / word
            </div>
          </div>

          {latest?.wat?.count > 0 ? (
            <p className="text-xs text-slate-400">
              {latest.dateFolder} · <span className="text-cyan-500 font-semibold">{latest.wat.count} words</span>
            </p>
          ) : (
            <p className="text-xs text-amber-500">No WAT batch — upload one first</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onStartTest('WAT', latest?.dateFolder)}
              disabled={!latest?.wat?.count}
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start WAT
            </button>
            <button onClick={() => onNavigate('folders')} className="btn-secondary px-3">
              Pick
            </button>
          </div>
        </div>

        {/* Full Psych Test */}
        <div className="card p-5 space-y-4 sm:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-500 border border-violet-500/20">
                <Layers className="w-3 h-3" /> PSYCH
              </span>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mt-2">Full Psych Test</h3>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5" />
              TAT → WAT
            </div>
          </div>

          {(latest?.tat?.count > 0 && latest?.wat?.count > 0) ? (
            <p className="text-xs text-slate-400">
              {latest.dateFolder} · <span className="text-indigo-500 font-semibold">{latest.tat.count} pics</span>
              {' + '}<span className="text-cyan-500 font-semibold">{latest.wat.count} words</span>
            </p>
          ) : (
            <p className="text-xs text-amber-500">Both TAT and WAT must be uploaded first</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onStartTest('PSYCH', latest?.dateFolder)}
              disabled={!latest?.tat?.count || !latest?.wat?.count}
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start Full Psych
            </button>
            <button onClick={() => onNavigate('folders')} className="btn-secondary px-3">
              Pick
            </button>
          </div>
        </div>

      </div>

      {/* Quick reference - minimal */}
      <div className="card p-4">
        <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="space-y-1">
            <p className="font-semibold text-indigo-500 uppercase tracking-wider text-[10px]">TAT</p>
            <p>· 30s observe → 4m write</p>
            <p>· Randomly shuffled</p>
            <p>· Any batch size</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-cyan-500 uppercase tracking-wider text-[10px]">WAT</p>
            <p>· 15s per word (continuous)</p>
            <p>· Randomly shuffled</p>
            <p>· Any word count</p>
          </div>
        </div>
      </div>
    </div>
  );
}
