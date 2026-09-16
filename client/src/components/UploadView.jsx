import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Image as ImageIcon, Type, Calendar, X, CheckCircle2, AlertCircle, Sparkles, FileText, RefreshCw, Leaf } from 'lucide-react';

export default function UploadView({ initialDateFolder, onUploadSuccess }) {
  const today = new Date().toISOString().split('T')[0];
  const [dateFolder, setDateFolder] = useState(initialDateFolder || today);
  const [folderTitle, setFolderTitle] = useState('');
  const [tab, setTab] = useState('tat');

  // TAT state — two groups: rewrite & fresh
  const [tatTitle, setTatTitle] = useState('TAT Set');
  const [rewritePreviews, setRewritePreviews] = useState([]);  // batch = 'rewrite'
  const [freshPreviews, setFreshPreviews] = useState([]);       // batch = 'fresh'
  const [tatBlankSlide, setTatBlankSlide] = useState(true);
  const [tatAppend, setTatAppend] = useState(false);
  const [tatUploading, setTatUploading] = useState(false);

  // WAT state
  const [watTitle, setWatTitle] = useState('WAT Set');
  const [watText, setWatText] = useState('');
  const [watAppend, setWatAppend] = useState(false);
  const [watUploading, setWatUploading] = useState(false);

  const [toast, setToast] = useState(null); // { type, text, visible }
  const toastTimer = useRef(null);

  const showToast = useCallback((type, text) => {
    // Clear any existing timer
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, text, visible: true });
    toastTimer.current = setTimeout(() => {
      setToast(t => t ? { ...t, visible: false } : null);
      setTimeout(() => setToast(null), 400); // wait for slide-out animation
    }, 4000);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const rewriteFileRef = useRef(null);
  const freshFileRef = useRef(null);
  const watFileRef = useRef(null);

  useEffect(() => { if (initialDateFolder) setDateFolder(initialDateFolder); }, [initialDateFolder]);

  const totalTatCount = rewritePreviews.length + freshPreviews.length;

  const addFilesToGroup = (e, group) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      url: URL.createObjectURL(f)
    }));
    if (group === 'rewrite') setRewritePreviews(p => [...p, ...previews]);
    else setFreshPreviews(p => [...p, ...previews]);
    e.target.value = '';
  };

  const removePreview = (id, group) => {
    if (group === 'rewrite') {
      const item = rewritePreviews.find(p => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      setRewritePreviews(p => p.filter(p => p.id !== id));
    } else {
      const item = freshPreviews.find(p => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      setFreshPreviews(p => p.filter(p => p.id !== id));
    }
  };

  const watWords = watText
    .split(/[\r\n,]+/)
    .map(w => w.trim().toUpperCase())
    .filter(w => w.length > 0);

  const uploadTat = async (e) => {
    e.preventDefault();
    if (!totalTatCount) { showToast('error', 'Select at least one picture in either group.'); return; }
    setTatUploading(true);
    try {
      const fd = new FormData();
      // Rewrite group first, then fresh — track batch per file index
      const batchMap = [];
      rewritePreviews.forEach(p => { fd.append('pictures', p.file); batchMap.push('rewrite'); });
      freshPreviews.forEach(p => { fd.append('pictures', p.file); batchMap.push('fresh'); });
      fd.append('pictureBatches', JSON.stringify(batchMap));
      fd.append('title', tatTitle);
      fd.append('folderTitle', folderTitle);
      fd.append('hasBlankSlide', tatBlankSlide);
      fd.append('append', tatAppend);
      const res = await fetch(`/api/folders/${encodeURIComponent(dateFolder.trim())}/tat`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rewritePreviews.forEach(p => URL.revokeObjectURL(p.url));
      freshPreviews.forEach(p => URL.revokeObjectURL(p.url));
      setRewritePreviews([]);
      setFreshPreviews([]);
      showToast('success', `✅ ${totalTatCount} pictures saved to ${dateFolder}`);
      onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setTatUploading(false);
    }
  };

  const uploadWat = async (e) => {
    e.preventDefault();
    if (!watWords.length) { showToast('error', 'Enter at least one word.'); return; }
    setWatUploading(true);
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(dateFolder.trim())}/wat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: watWords, title: watTitle, folderTitle, append: watAppend })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWatText('');
      showToast('success', `✅ ${watWords.length} words saved to ${dateFolder}`);
      onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setWatUploading(false);
    }
  };

  // ── Floating toast portal ────────────────────────────────────────────────────
  const toastEl = toast && createPortal(
    <div
      className={`fixed top-5 left-1/2 z-[200] -translate-x-1/2 w-[92vw] max-w-sm transition-all duration-400 ${
        toast.visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 -translate-y-4 pointer-events-none'
      }`}
      style={{ transition: 'opacity 0.35s ease, transform 0.35s ease' }}
    >
      <div className={`relative overflow-hidden rounded-2xl shadow-2xl border backdrop-blur-md ${
        toast.type === 'success'
          ? 'bg-emerald-50/95 dark:bg-emerald-950/95 border-emerald-300 dark:border-emerald-600'
          : 'bg-red-50/95 dark:bg-red-950/95 border-red-300 dark:border-red-600'
      }`}>
        {/* Content */}
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className={`mt-0.5 shrink-0 rounded-full p-1 ${
            toast.type === 'success'
              ? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300'
          }`}>
            {toast.type === 'success'
              ? <CheckCircle2 className="w-4 h-4" />
              : <AlertCircle className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${
              toast.type === 'success'
                ? 'text-emerald-800 dark:text-emerald-200'
                : 'text-red-800 dark:text-red-200'
            }`}>
              {toast.type === 'success' ? 'Saved Successfully' : 'Upload Failed'}
            </p>
            <p className={`text-xs mt-0.5 leading-relaxed ${
              toast.type === 'success'
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-red-700 dark:text-red-300'
            }`}>
              {toast.text}
            </p>
          </div>
          <button
            onClick={() => { setToast(null); if (toastTimer.current) clearTimeout(toastTimer.current); }}
            className={`shrink-0 p-1 rounded-lg transition-colors ${
              toast.type === 'success'
                ? 'text-emerald-500 hover:bg-emerald-200 dark:hover:bg-emerald-800'
                : 'text-red-500 hover:bg-red-200 dark:hover:bg-red-800'
            }`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Progress bar */}
        <div className={`h-1 ${
          toast.type === 'success' ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-red-200 dark:bg-red-800'
        }`}>
          <div
            className={`h-full ${
              toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
            }`}
            style={{ animation: 'toast-shrink 4s linear forwards' }}
          />
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {toastEl}

      {/* Date folder row */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label"><Calendar className="w-3.5 h-3.5 inline mr-1" />Date Folder</label>
          <input type="date" value={dateFolder} onChange={e => setDateFolder(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Label (optional)</label>
          <input type="text" value={folderTitle} onChange={e => setFolderTitle(e.target.value)} placeholder="e.g. 33 SSB Prep" className="input" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-dark-600">
        <button
          onClick={() => setTab('tat')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            tab === 'tat' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          TAT Pictures {totalTatCount > 0 && <span className="badge-indigo">{totalTatCount}</span>}
        </button>
        <button
          onClick={() => setTab('wat')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            tab === 'wat' ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Type className="w-4 h-4" />
          WAT Words {watWords.length > 0 && <span className="badge-cyan">{watWords.length}</span>}
        </button>
      </div>

      {/* TAT Tab */}
      {tab === 'tat' && (
        <form onSubmit={uploadTat} className="card p-5 space-y-5">
          <div>
            <label className="label">Set Title</label>
            <input value={tatTitle} onChange={e => setTatTitle(e.target.value)} className="input" placeholder="TAT Set 1" />
          </div>

          {/* Info banner */}
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 p-3 text-xs text-indigo-700 dark:text-indigo-300 space-y-1">
            <p className="font-semibold">Two-Group Upload</p>
            <p>
              <span className="font-semibold text-amber-600 dark:text-amber-400">Rewrite</span> pictures are shown first (shuffled), then{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Fresh</span> pictures (shuffled).
            </p>
          </div>

          {/* Rewrite group */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Rewrite Batch</span>
              {rewritePreviews.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  {rewritePreviews.length} pics
                </span>
              )}
            </div>
            <div onClick={() => rewriteFileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 dark:border-dark-600 hover:border-amber-400 dark:hover:border-amber-500 rounded-xl p-5 text-center cursor-pointer transition-colors">
              <input ref={rewriteFileRef} type="file" multiple accept="image/*" className="hidden"
                onChange={e => addFilesToGroup(e, 'rewrite')} />
              <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto mb-1" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Click or drag rewrite pictures</p>
            </div>
            {rewritePreviews.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-400">{rewritePreviews.length} selected</span>
                  <button type="button" onClick={() => { rewritePreviews.forEach(p => URL.revokeObjectURL(p.url)); setRewritePreviews([]); }}
                    className="text-[11px] text-red-500 hover:underline">Clear</button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {rewritePreviews.map((p, i) => (
                    <div key={p.id} className="relative aspect-video rounded overflow-hidden bg-slate-100 dark:bg-dark-700 group">
                      <img src={p.url} alt="" className="w-full h-full object-cover blur-sm scale-105" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-mono text-white/80 bg-black/40 px-1 rounded">#{i + 1}</span>
                      </div>
                      <button type="button" onClick={() => removePreview(p.id, 'rewrite')}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 dark:border-dark-600" />

          {/* Fresh group */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Leaf className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Fresh Batch</span>
              {freshPreviews.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  {freshPreviews.length} pics
                </span>
              )}
            </div>
            <div onClick={() => freshFileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 dark:border-dark-600 hover:border-emerald-400 dark:hover:border-emerald-500 rounded-xl p-5 text-center cursor-pointer transition-colors">
              <input ref={freshFileRef} type="file" multiple accept="image/*" className="hidden"
                onChange={e => addFilesToGroup(e, 'fresh')} />
              <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto mb-1" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Click or drag fresh pictures</p>
            </div>
            {freshPreviews.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-400">{freshPreviews.length} selected</span>
                  <button type="button" onClick={() => { freshPreviews.forEach(p => URL.revokeObjectURL(p.url)); setFreshPreviews([]); }}
                    className="text-[11px] text-red-500 hover:underline">Clear</button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {freshPreviews.map((p, i) => (
                    <div key={p.id} className="relative aspect-video rounded overflow-hidden bg-slate-100 dark:bg-dark-700 group">
                      <img src={p.url} alt="" className="w-full h-full object-cover blur-sm scale-105" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-mono text-white/80 bg-black/40 px-1 rounded">#{i + 1}</span>
                      </div>
                      <button type="button" onClick={() => removePreview(p.id, 'fresh')}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-dark-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={tatBlankSlide} onChange={e => setTatBlankSlide(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-100 dark:bg-dark-700 border-slate-300 dark:border-dark-500" />
              Include blank slide
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={tatAppend} onChange={e => setTatAppend(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-100 dark:bg-dark-700 border-slate-300 dark:border-dark-500" />
              Append to existing
            </label>
          </div>

          <button type="submit" disabled={tatUploading || !totalTatCount}
            className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-40">
            <Upload className="w-4 h-4" />
            {tatUploading ? 'Saving...' : `Save ${totalTatCount || ''} Pictures`}
          </button>
        </form>
      )}

      {/* WAT Tab */}
      {tab === 'wat' && (
        <form onSubmit={uploadWat} className="card p-5 space-y-4">
          <div>
            <label className="label">Set Title</label>
            <input value={watTitle} onChange={e => setWatTitle(e.target.value)} className="input" placeholder="WAT Set 1" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Words</label>
              <div className="flex items-center gap-3 text-xs">
                <button type="button" onClick={() => setWatText(['LEADER','COURAGE','INITIATIVE','DIFFICULTY','WAR','DECISION','ALERT','FRIEND','SACRIFICE','FAILURE','DUTY','TEAM','VICTORY','HONOUR','DISCIPLINE'].join('\n'))}
                  className="text-indigo-500 hover:underline flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Sample words
                </button>
                <button type="button" onClick={() => watFileRef.current?.click()}
                  className="text-cyan-500 hover:underline flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Upload .txt
                </button>
                <input ref={watFileRef} type="file" accept=".txt,.csv" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = ev => setWatText(p => p ? p + '\n' + ev.target.result : ev.target.result);
                    r.readAsText(f);
                    e.target.value = '';
                  }} />
              </div>
            </div>
            <textarea
              rows={8}
              value={watText}
              onChange={e => setWatText(e.target.value)}
              placeholder={"LEADER\nCOURAGE\nSACRIFICE\n...one word per line or comma-separated"}
              className="input font-mono uppercase text-sm"
            />
          </div>

          {/* Word chips preview */}
          {watWords.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500">{watWords.length} words detected</span>
                <button type="button" onClick={() => setWatText('')} className="text-xs text-red-500 hover:underline">Clear</button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-hidden">
                {watWords.slice(0, 30).map((w, i) => (
                  <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-700 text-cyan-600 dark:text-cyan-400 font-semibold">
                    {w}
                  </span>
                ))}
                {watWords.length > 30 && <span className="text-[11px] text-slate-400">+{watWords.length - 30} more</span>}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-dark-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={watAppend} onChange={e => setWatAppend(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-600 bg-slate-100 dark:bg-dark-700 border-slate-300 dark:border-dark-500" />
              Append to existing
            </label>
          </div>

          <button type="submit" disabled={watUploading || !watWords.length}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-colors">
            <Upload className="w-4 h-4" />
            {watUploading ? 'Saving...' : `Save ${watWords.length || ''} Words`}
          </button>
        </form>
      )}
      </div>
    </>
  );
}
