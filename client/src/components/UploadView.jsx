import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Image as ImageIcon, Type, Calendar, X, CheckCircle2, AlertCircle, Sparkles, FileText, RefreshCw, Leaf, ArrowRight, FastForward, Video, Compass, Map } from 'lucide-react';
import { apiUrl } from '../utils/api';
import CustomVideoPlayer from './CustomVideoPlayer';

export default function UploadView({ initialDateFolder, onUploadSuccess, onRefresh }) {
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

  // Solutions PDF state
  const [solTitle, setSolTitle] = useState('');
  const [solDate, setSolDate] = useState(initialDateFolder || today);
  const [solTestType, setSolTestType] = useState('TAT');
  const [solFile, setSolFile] = useState(null);
  const [solUploading, setSolUploading] = useState(false);
  const solFileRef = useRef(null);

  // Lecturette Video state
  const [lecTitle, setLecTitle] = useState('');
  const [lecDate, setLecDate] = useState(initialDateFolder || today);
  const [lecFile, setLecFile] = useState(null);
  const [lecPreview, setLecPreview] = useState(null);
  const [lecDuration, setLecDuration] = useState(0);
  const [lecUploading, setLecUploading] = useState(false);
  const [lecProgress, setLecProgress] = useState(null);
  const lecFileRef = useRef(null);

  // GPE (Group Planning Exercise) state
  const [gpeTitle, setGpeTitle] = useState('');
  const [gpeScale, setGpeScale] = useState('1 cm = 2 km');
  const [gpeDescription, setGpeDescription] = useState('');
  const [gpeNarrativeFile, setGpeNarrativeFile] = useState(null);
  const [gpeNarrativePreview, setGpeNarrativePreview] = useState(null);
  const [gpeNarrativeTab, setGpeNarrativeTab] = useState('text'); // 'text' | 'image'
  const [gpeModelSolution, setGpeModelSolution] = useState('');
  const [gpeMapFile, setGpeMapFile] = useState(null);
  const [gpeMapPreview, setGpeMapPreview] = useState(null);
  const [gpeUploading, setGpeUploading] = useState(false);
  const gpeFileRef = useRef(null);
  const gpeNarrativeFileRef = useRef(null);

  const handleGpeMapChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setGpeMapFile(file);
      if (gpeMapPreview) URL.revokeObjectURL(gpeMapPreview);
      setGpeMapPreview(URL.createObjectURL(file));
      if (!gpeTitle) {
        setGpeTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      }
    }
  };

  const handleGpeNarrativeChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setGpeNarrativeFile(file);
      if (gpeNarrativePreview) URL.revokeObjectURL(gpeNarrativePreview);
      setGpeNarrativePreview(URL.createObjectURL(file));
    }
  };

  const uploadGpe = async (e) => {
    e.preventDefault();
    if (!gpeMapFile) {
      showToast('error', 'Please upload a GPE map image.');
      return;
    }
    const hasText = gpeDescription && gpeDescription.trim().length > 0;
    const hasImage = Boolean(gpeNarrativeFile);
    if (!hasText && !hasImage) {
      showToast('error', 'Please provide the GPE narrative either by pasting text or uploading a narrative card image.');
      return;
    }
    setGpeUploading(true);
    try {
      const fd = new FormData();
      fd.append('map', gpeMapFile);
      if (gpeNarrativeFile) {
        fd.append('narrativeImage', gpeNarrativeFile);
      }
      const chosenDate = dateFolder || today;
      const titleToUse = gpeTitle || `GPE Exercise ${chosenDate}`;
      fd.append('title', titleToUse);
      fd.append('description', gpeDescription || '');
      fd.append('scale', gpeScale || '1 cm = 2 km');
      fd.append('modelSolution', gpeModelSolution || '');

      const targetFolder = chosenDate.trim();
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(targetFolder)}/gpes`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload GPE');

      showToast('success', `GPE "${titleToUse}" uploaded successfully to batch ${targetFolder}.`);
      setGpeMapFile(null);
      if (gpeMapPreview) {
        URL.revokeObjectURL(gpeMapPreview);
        setGpeMapPreview(null);
      }
      setGpeNarrativeFile(null);
      if (gpeNarrativePreview) {
        URL.revokeObjectURL(gpeNarrativePreview);
        setGpeNarrativePreview(null);
      }
      setGpeTitle('');
      setGpeDescription('');
      setGpeModelSolution('');
      if (gpeFileRef.current) gpeFileRef.current.value = '';
      if (gpeNarrativeFileRef.current) gpeNarrativeFileRef.current.value = '';
      if (onRefresh) onRefresh();
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setGpeUploading(false);
    }
  };

  const uploadLecturetteVideo = async (e) => {
    e.preventDefault();
    if (!lecFile) return;
    setLecUploading(true);
    setLecProgress(0);
    try {
      const fd = new FormData();
      fd.append('video', lecFile);
      const chosenDate = lecDate || dateFolder || today;
      const defaultTitle = lecFile ? lecFile.name.replace(/\.[^/.]+$/, '') : `Lecturette ${chosenDate}`;
      fd.append('recordedDate', chosenDate);
      fd.append('title', lecTitle || defaultTitle);
      if (lecDuration) fd.append('duration', lecDuration.toString());

      const targetFolder = (lecDate || dateFolder || chosenDate).trim();

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl(`/api/folders/${encodeURIComponent(targetFolder)}/lecturette`));
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setLecProgress(pct);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || 'Failed to upload video'));
            } catch {
              reject(new Error(`Upload failed with HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => reject(new Error('Network error while uploading video'));
        xhr.send(fd);
      });

      showToast('success', `Lecturette video "${lecTitle || defaultTitle}" saved to batch ${targetFolder}.`);
      setLecFile(null);
      if (lecPreview) {
        URL.revokeObjectURL(lecPreview);
        setLecPreview(null);
      }
      setLecDuration(0);
      setLecTitle('');
      if (lecFileRef.current) lecFileRef.current.value = '';
      if (onRefresh) onRefresh();
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLecUploading(false);
      setLecProgress(null);
    }
  };

  const [toast, setToast] = useState(null); // { type, text, visible }
  const toastTimer = useRef(null);

  const handleSkipAll = async () => {
    try {
      const res = await fetch(apiUrl('/api/folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFolder: dateFolder.trim(), folderTitle })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', `Batch ${dateFolder} registered without uploaded materials.`);
      if (onRefresh) onRefresh();
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    }
  };

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

  useEffect(() => {
    if (initialDateFolder) {
      setDateFolder(initialDateFolder);
      setSolDate(initialDateFolder);
      if (!solTitle) setSolTitle(initialDateFolder);
    }
  }, [initialDateFolder]);

  const uploadSolution = async (e) => {
    e.preventDefault();
    if (!solFile) {
      showToast('error', 'Please select a PDF file.');
      return;
    }
    setSolUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', solFile);
      const chosenDate = solDate || dateFolder || today;
      const defaultTitle = solFile ? solFile.name.replace(/\.[^/.]+$/, '') : chosenDate;
      fd.append('solutionDate', chosenDate);
      fd.append('title', solTitle || defaultTitle);
      fd.append('testType', solTestType);

      const targetFolder = (dateFolder || chosenDate).trim();
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(targetFolder)}/solutions`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload solution PDF');

      showToast('success', `Solution PDF "${solTitle || defaultTitle}" uploaded to batch ${targetFolder}.`);
      setSolFile(null);
      if (solFileRef.current) solFileRef.current.value = '';
      if (onRefresh) onRefresh();
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSolUploading(false);
    }
  };

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
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder.trim())}/tat`), { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rewritePreviews.forEach(p => URL.revokeObjectURL(p.url));
      freshPreviews.forEach(p => URL.revokeObjectURL(p.url));
      setRewritePreviews([]);
      setFreshPreviews([]);
      showToast('success', `✅ ${totalTatCount} pictures saved to ${dateFolder}. Switching to WAT...`);
      if (onRefresh) onRefresh();
      setTab('wat');
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
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder.trim())}/wat`), {
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

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5">

      {/* Date folder row */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label"><Calendar className="w-3.5 h-3.5 inline mr-1" />Date Folder</label>
            <input type="date" value={dateFolder} onChange={e => setDateFolder(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Label (optional)</label>
            <input type="text" value={folderTitle} onChange={e => setFolderTitle(e.target.value)} placeholder="e.g. 33 SSB Prep" className="input" />
          </div>
        </div>
        <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-dark-700">
          <button
            type="button"
            onClick={handleSkipAll}
            className="btn-secondary py-1 text-xs flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
            title="Create or register this date folder without uploading materials"
          >
            <FastForward className="w-3 h-3 text-amber-500" />
            <span>Skip Uploading Materials & Create Batch</span>
          </button>
        </div>
      </div>

      {/* Tabs with larger test titles */}
      <div className="flex border-b border-slate-200 dark:border-dark-600 overflow-x-auto scrollbar-thin">
        <button
          onClick={() => setTab('tat')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            tab === 'tat' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span className="text-sm sm:text-base font-black tracking-wide font-mono">TAT</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">Pictures</span>
          {totalTatCount > 0 && <span className="badge-indigo">{totalTatCount}</span>}
        </button>
        <button
          onClick={() => setTab('wat')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            tab === 'wat' ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Type className="w-4 h-4" />
          <span className="text-sm sm:text-base font-black tracking-wide font-mono">WAT</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">Words</span>
          {watWords.length > 0 && <span className="badge-cyan">{watWords.length}</span>}
        </button>
        <button
          onClick={() => setTab('solutions')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            tab === 'solutions' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span className="text-sm sm:text-base font-black tracking-wide font-mono">SOL</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">PDF</span>
          {solFile && <span className="badge-emerald">1</span>}
        </button>
        <button
          onClick={() => setTab('lecturette')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            tab === 'lecturette' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Video className="w-4 h-4" />
          <span className="text-sm sm:text-base font-black tracking-wide font-mono">LEC</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">Video</span>
          {lecFile && <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">1</span>}
        </button>
        <button
          onClick={() => setTab('gpe')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            tab === 'gpe' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Compass className="w-4 h-4" />
          <span className="text-sm sm:text-base font-black tracking-wide font-mono">GPE</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">Exercise</span>
          {gpeMapFile && <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">1</span>}
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

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={tatUploading || !totalTatCount}
              className="btn-primary px-4 py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{tatUploading ? 'Saving...' : `Save ${totalTatCount || ''} Pictures`}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('wat')}
              className="btn-secondary py-1.5 px-3 flex items-center gap-1 text-xs"
              title="Skip TAT upload and proceed to WAT"
            >
              <span>Skip TAT</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
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

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={watUploading || !watWords.length}
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md px-4 py-1.5 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{watUploading ? 'Saving...' : `Save ${watWords.length || ''} Words`}</span>
            </button>
            <button
              type="button"
              onClick={handleSkipAll}
              className="btn-secondary py-1.5 px-3 flex items-center gap-1 text-xs"
              title="Skip WAT upload and finish batch"
            >
              <span>Skip WAT</span>
            </button>
          </div>
        </form>
      )}

      {/* Solutions PDF Tab */}
      {tab === 'solutions' && (
        <form onSubmit={uploadSolution} className="card p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label"><Calendar className="w-3.5 h-3.5 inline mr-1" />Solution Date</label>
              <input
                type="date"
                value={solDate}
                onChange={e => {
                  setSolDate(e.target.value);
                  if (!solTitle || solTitle === solDate) setSolTitle(e.target.value);
                }}
                className="input"
              />
            </div>
            <div>
              <label className="label">Test Type</label>
              <select
                value={solTestType}
                onChange={e => setSolTestType(e.target.value)}
                className="input"
              >
                <option value="TAT">TAT</option>
                <option value="WAT">WAT</option>
                <option value="SRT">SRT</option>
                <option value="SDT">SDT</option>
                <option value="GENERAL">General Psych</option>
              </select>
            </div>
            <div>
              <label className="label">Custom Label / Title</label>
              <input
                type="text"
                value={solTitle}
                onChange={e => setSolTitle(e.target.value)}
                placeholder="Custom label (defaults to PDF filename)"
                className="input"
              />
            </div>
          </div>

          {/* PDF File Picker */}
          <div>
            <label className="label">Handwritten Solution PDF Document</label>
            <input
              ref={solFileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => {
                if (e.target.files?.[0]) {
                  const file = e.target.files[0];
                  setSolFile(file);
                  const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                  setSolTitle(nameWithoutExt);
                }
              }}
            />
            {!solFile ? (
              <div
                onClick={() => solFileRef.current?.click()}
                className="border-2 border-dashed border-emerald-500/30 dark:border-emerald-500/20 hover:border-emerald-500 rounded-xl p-8 text-center cursor-pointer transition-colors bg-emerald-50/20 dark:bg-emerald-950/10 space-y-2"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Click to select or drag and drop paper-written solution PDF
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Maximum size: 50 MB (.pdf)</p>
                </div>
              </div>
            ) : (
              <div className="card-sm p-3 flex items-center justify-between border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{solFile.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {(solFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSolFile(null);
                    if (solFileRef.current) solFileRef.current.value = '';
                  }}
                  className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  title="Remove selected file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Submit button */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-dark-600">
            <span className="text-[11px] text-slate-400">
              Batch Folder: <strong className="font-mono text-slate-600 dark:text-slate-300">{dateFolder}</strong>
            </span>
            <button
              type="submit"
              disabled={solUploading || !solFile}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-md px-4 py-1.5 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{solUploading ? 'Uploading Solution PDF...' : 'Upload Solution PDF'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Lecturette Tab */}
      {tab === 'lecturette' && (
        <form onSubmit={uploadLecturetteVideo} className="card p-5 space-y-4">
          <div>
            <label className="label">Lecturette Title (optional)</label>
            <input
              type="text"
              value={lecTitle}
              onChange={e => setLecTitle(e.target.value)}
              placeholder="e.g. Modern Geopolitics & Defense"
              className="input"
            />
          </div>

          <div>
            <label className="label">Date of Recording</label>
            <input
              type="date"
              value={lecDate}
              onChange={e => setLecDate(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Select Video File (.mp4, .webm, .mov, etc.)</label>
            <div className="flex items-center gap-2">
              <input
                ref={lecFileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/mkv,video/x-matroska,video/*,.mp4,.webm,.mov,.mkv"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  if (lecPreview) {
                    URL.revokeObjectURL(lecPreview);
                    setLecPreview(null);
                  }
                  setLecFile(f);
                  if (f) {
                    const url = URL.createObjectURL(f);
                    setLecPreview(url);
                    if (!lecTitle) {
                      setLecTitle(f.name.replace(/\.[^/.]+$/, ''));
                    }
                    const tempV = document.createElement('video');
                    tempV.preload = 'metadata';
                    tempV.src = url;
                    tempV.onloadedmetadata = () => {
                      setLecDuration(Math.round(tempV.duration) || 0);
                    };
                  } else {
                    setLecDuration(0);
                  }
                }}
                className="input py-1 text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-purple-50 dark:file:bg-purple-950/40 file:text-purple-700 dark:file:text-purple-300 hover:file:bg-purple-100"
              />
              {lecFile && (
                <button
                  type="button"
                  onClick={() => {
                    setLecFile(null);
                    if (lecPreview) {
                      URL.revokeObjectURL(lecPreview);
                      setLecPreview(null);
                    }
                    setLecDuration(0);
                    if (lecFileRef.current) lecFileRef.current.value = '';
                  }}
                  className="p-1.5 rounded text-slate-400 hover:text-red-500"
                  title="Remove selected video"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Video File Information and Interactive Preview Player */}
            {lecFile && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {lecFile.name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-dark-700">
                      {(lecFile.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                    {lecDuration > 0 && (
                      <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-bold">
                        {Math.floor(lecDuration / 60)}:{(lecDuration % 60).toString().padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>

                {lecPreview && (
                  <div className="relative rounded-xl overflow-hidden aspect-video bg-black border border-slate-700 shadow-xl max-h-72 w-full">
                    <CustomVideoPlayer
                      src={lecPreview}
                      fallbackDuration={lecDuration}
                      downloadFilename={lecTitle || 'lecturette-video'}
                      className="w-full h-full"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {lecUploading && lecProgress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Uploading lecturette video...</span>
                <span>{lecProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-dark-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-purple-600 h-full transition-all duration-200"
                  style={{ width: `${lecProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-dark-600">
            <span className="text-[11px] text-slate-400">
              Batch Folder: <strong className="font-mono text-slate-600 dark:text-slate-300">{lecDate || dateFolder}</strong>
            </span>
            <button
              type="submit"
              disabled={lecUploading || !lecFile}
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md px-4 py-1.5 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lecUploading ? (lecProgress !== null ? `Uploading (${lecProgress}%)...` : 'Saving...') : 'Upload Lecturette Video'}</span>
            </button>
          </div>
        </form>
      )}

      {/* GPE (Group Planning Exercise) Tab */}
      {tab === 'gpe' && (
        <form onSubmit={uploadGpe} className="card p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="label">GPE Exercise Title</label>
              <input
                value={gpeTitle}
                onChange={e => setGpeTitle(e.target.value)}
                className="input"
                placeholder="e.g. GPE Set 1 - Forest Patrol or River Rescue"
              />
            </div>
            <div>
              <label className="label">Map Scale</label>
              <input
                value={gpeScale}
                onChange={e => setGpeScale(e.target.value)}
                className="input font-mono"
                placeholder="1 cm = 2 km"
              />
            </div>
          </div>

          {/* Real SSB timing info card */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-blue-500" />
              Real SSB Timing Format: 5 Mins Map Study + 10 Mins Solution Writing
            </p>
            <p className="text-[11px] text-blue-600 dark:text-blue-300/80">
              Upload the high-resolution map model image and paste the GTO problem statement below. During test execution, candidates get exactly 5 minutes to study the map & problem narrative, followed by 10 minutes to write their individual solution plan.
            </p>
          </div>

          {/* Map Image Upload */}
          <div className="space-y-2">
            <label className="label flex items-center justify-between">
              <span>GPE Map Image (Required)</span>
              {gpeMapFile && <span className="text-[11px] text-emerald-500 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Map selected</span>}
            </label>

            <div
              onClick={() => gpeFileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 dark:border-dark-600 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl p-5 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-dark-800/30"
            >
              <input
                ref={gpeFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleGpeMapChange}
              />
              <Map className="w-8 h-8 text-blue-400 dark:text-blue-500 mx-auto mb-2 opacity-80" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {gpeMapFile ? gpeMapFile.name : 'Click to select or drag and drop GPE Map Image'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Supports JPG, PNG, WEBP high-resolution maps
              </p>
            </div>

            {/* Map Preview Thumbnail */}
            {gpeMapPreview && (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-dark-600 max-h-60 bg-black/40 flex items-center justify-center p-2 group">
                <img
                  src={gpeMapPreview}
                  alt="GPE Map Preview"
                  className="max-h-56 w-auto object-contain rounded"
                />
                <button
                  type="button"
                  onClick={() => {
                    setGpeMapFile(null);
                    URL.revokeObjectURL(gpeMapPreview);
                    setGpeMapPreview(null);
                    if (gpeFileRef.current) gpeFileRef.current.value = '';
                  }}
                  className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/70 hover:bg-red-600 text-white transition-colors"
                  title="Remove map"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Narrative / Problem Statement Section (Upload Image OR Paste Text) */}
          <div className="space-y-2 border border-slate-200 dark:border-dark-600 rounded-xl p-3.5 bg-slate-50/50 dark:bg-dark-800/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="label mb-0">Problem Statement Narrative (Upload Image or Paste Text)</label>
              <div className="flex items-center bg-slate-200/80 dark:bg-dark-700 p-0.5 rounded-lg text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setGpeNarrativeTab('text')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    gpeNarrativeTab === 'text' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  type="button"
                  onClick={() => setGpeNarrativeTab('image')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    gpeNarrativeTab === 'image' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                  }`}
                >
                  Upload Card Image
                </button>
              </div>
            </div>

            {/* Narrative Image Upload */}
            {gpeNarrativeTab === 'image' ? (
              <div className="space-y-2 pt-1">
                <div
                  onClick={() => gpeNarrativeFileRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-dark-600 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl p-4 text-center cursor-pointer transition-colors bg-white dark:bg-dark-900"
                >
                  <input
                    ref={gpeNarrativeFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleGpeNarrativeChange}
                  />
                  <ImageIcon className="w-6 h-6 text-blue-400 mx-auto mb-1 opacity-80" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {gpeNarrativeFile ? gpeNarrativeFile.name : 'Click to upload scanned/photo narrative card'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">JPG, PNG, WEBP narrative cards</p>
                </div>

                {gpeNarrativePreview && (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-dark-600 max-h-56 bg-black/40 flex items-center justify-center p-2 group">
                    <img
                      src={gpeNarrativePreview}
                      alt="Narrative Card Preview"
                      className="max-h-52 w-auto object-contain rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setGpeNarrativeFile(null);
                        URL.revokeObjectURL(gpeNarrativePreview);
                        setGpeNarrativePreview(null);
                        if (gpeNarrativeFileRef.current) gpeNarrativeFileRef.current.value = '';
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-red-600 text-white transition-colors"
                      title="Remove narrative card image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Paste Narrative Text Directly */
              <div className="space-y-1 pt-1">
                <textarea
                  rows={6}
                  value={gpeDescription}
                  onChange={e => setGpeDescription(e.target.value)}
                  className="input font-sans text-xs leading-relaxed resize-y scrollbar-thin bg-white dark:bg-dark-900"
                  placeholder="Paste or type the full GTO narrative here...&#10;&#10;e.g. You are a group of 8 college students returning from an excursion in a jeep. At 1400 hrs, near Milestone 15, you witness a truck overturn injuring two passengers... Meanwhile, a railway gang-man informs you of a broken rail track on which the Express Train will pass at 1530 hrs...&#10;&#10;Resources Available: Your Jeep, local bus route, telephone booth at Shampur, village dispensary 4 km away."
                />
                <div className="flex justify-between text-[11px] text-slate-400 pt-0.5">
                  <span>Direct text entry</span>
                  <span>{gpeDescription.trim().length} characters</span>
                </div>
              </div>
            )}
          </div>

          {/* Optional Model Solution */}
          <div className="space-y-1.5">
            <label className="label flex items-center justify-between">
              <span>Model Solution / GTO Key Points (Optional)</span>
              <span className="text-[11px] text-slate-400 font-normal">Can be revealed after candidate finishes</span>
            </label>
            <textarea
              rows={3}
              value={gpeModelSolution}
              onChange={e => setGpeModelSolution(e.target.value)}
              className="input font-mono text-xs leading-relaxed resize-y scrollbar-thin"
              placeholder="Optional: Recommended priority order, sub-group tasks, time-distance calculations for review..."
            />
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-dark-600">
            <span className="text-[11px] text-slate-400">
              Target Batch: <strong className="font-mono text-slate-600 dark:text-slate-300">{dateFolder}</strong>
            </span>
            <button
              type="submit"
              disabled={gpeUploading || !gpeMapFile || (!gpeDescription.trim() && !gpeNarrativeFile)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md px-5 py-2 text-xs flex items-center justify-center gap-2 disabled:opacity-40 transition-colors shadow-sm w-full sm:w-auto"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{gpeUploading ? 'Uploading GPE...' : 'Upload GPE Exercise'}</span>
            </button>
          </div>
        </form>
      )}
      </div>
    </>
  );
}
