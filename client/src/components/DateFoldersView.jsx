import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, Play, Trash2, Eye, EyeOff, Plus, Search, X,
  ChevronDown, ChevronUp, AlertTriangle, Layers, ZoomIn,
  RotateCcw, Leaf, ChevronLeft, ChevronRight, FileText, Video,
  Upload, Edit3, Download, Calendar, Check, Image as ImageIcon, AlignLeft,
  Compass, Map
} from 'lucide-react';
import PdfViewerModal from './PdfViewerModal';
import CustomVideoPlayer from './CustomVideoPlayer';
import NotesEditor from './NotesEditor';
import { apiUrl } from '../utils/api';
import PanZoomModal from './PanZoomModal';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function DateFoldersView({ folders, onStartTest, onNavigate, onDeleteFolder, onDeleteBatch, onRefresh }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [inspectModal, setInspectModal] = useState(null); // { type, dateFolder }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, dateFolder }
  const [deleteResourceConfirm, setDeleteResourceConfirm] = useState(null); // { type: 'solution'|'lecturette', dateFolder, id, label }
  const [deletingLecturetteId, setDeletingLecturetteId] = useState(null);
  const [bigImage, setBigImage] = useState(null);

  // PDF Solutions & Lecturette state
  const [activePdfSolution, setActivePdfSolution] = useState(null); // { solution, dateFolder }
  const [pdfUploadModal, setPdfUploadModal] = useState(null); // { dateFolder }
  const [videoModal, setVideoModal] = useState(null); // { url, title }
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDate, setPdfDate] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfTestType, setPdfTestType] = useState('TAT');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Lecturette Upload state
  const [lecturetteUploadModal, setLecturetteUploadModal] = useState(null); // { dateFolder }
  const [lecFile, setLecFile] = useState(null);
  const [lecDate, setLecDate] = useState('');
  const [lecTitle, setLecTitle] = useState('');
  const [uploadingLec, setUploadingLec] = useState(false);
  const [lecUploadProgress, setLecUploadProgress] = useState(null);
  const [lecUploadError, setLecUploadError] = useState(null);

  // GPE Upload state
  const [gpeUploadModal, setGpeUploadModal] = useState(null); // { dateFolder }
  const [gpeFileInput, setGpeFileInput] = useState(null);
  const [gpeFilePreview, setGpeFilePreview] = useState(null);
  const [gpeNarrativeFileInput, setGpeNarrativeFileInput] = useState(null);
  const [gpeNarrativeFilePreview, setGpeNarrativeFilePreview] = useState(null);
  const [gpeNarrativeTab, setGpeNarrativeTab] = useState('text'); // 'text' | 'image'
  const [gpeTitleInput, setGpeTitleInput] = useState('');
  const [gpeScaleInput, setGpeScaleInput] = useState('1 cm = 2 km');
  const [gpeDescInput, setGpeDescInput] = useState('');
  const [gpeModelSolInput, setGpeModelSolInput] = useState('');
  const [uploadingGpe, setUploadingGpe] = useState(false);
  const [gpeUploadError, setGpeUploadError] = useState(null);
  const gpeModalFileRef = useRef(null);
  const gpeModalNarrativeFileRef = useRef(null);

  const handleUploadGpeModal = async (e) => {
    e.preventDefault();
    if (!gpeFileInput || !gpeUploadModal) return;
    if (!gpeDescInput.trim() && !gpeNarrativeFileInput) {
      setGpeUploadError('Please provide problem statement either by uploading narrative card image or pasting text');
      return;
    }
    setUploadingGpe(true);
    setGpeUploadError(null);
    try {
      const fd = new FormData();
      fd.append('map', gpeFileInput);
      if (gpeNarrativeFileInput) {
        fd.append('narrativeImage', gpeNarrativeFileInput);
      }
      fd.append('title', (gpeTitleInput || `GPE Exercise ${gpeUploadModal.dateFolder}`).trim());
      fd.append('scale', (gpeScaleInput || '1 cm = 2 km').trim());
      fd.append('description', gpeDescInput.trim());
      fd.append('modelSolution', gpeModelSolInput.trim());

      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(gpeUploadModal.dateFolder)}/gpes`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload GPE');

      setGpeUploadModal(null);
      setGpeFileInput(null);
      if (gpeFilePreview) URL.revokeObjectURL(gpeFilePreview);
      setGpeFilePreview(null);
      setGpeNarrativeFileInput(null);
      if (gpeNarrativeFilePreview) URL.revokeObjectURL(gpeNarrativeFilePreview);
      setGpeNarrativeFilePreview(null);
      setGpeNarrativeTab('text');
      setGpeTitleInput('');
      setGpeDescInput('');
      setGpeModelSolInput('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setGpeUploadError(err.message);
    } finally {
      setUploadingGpe(false);
    }
  };

  const handleDeleteGpe = async (dateFolder, gpeId) => {
    try {
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}/gpes/${encodeURIComponent(gpeId)}`), {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete GPE');
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUploadLecturette = async (e) => {
    e.preventDefault();
    if (!lecFile || !lecturetteUploadModal) return;
    setUploadingLec(true);
    setLecUploadError(null);
    setLecUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('video', lecFile);
      const chosenDate = (lecDate || lecturetteUploadModal.dateFolder || today).trim();
      fd.append('recordedDate', chosenDate);
      fd.append('title', (lecTitle || lecFile.name.replace(/\.[^/.]+$/, '') || `Lecturette ${chosenDate}`).trim());

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl(`/api/folders/${encodeURIComponent(chosenDate)}/lecturette`));
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setLecUploadProgress(pct);
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

      setLecturetteUploadModal(null);
      setLecFile(null);
      setLecTitle('');
      setLecDate('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setLecUploadError(err.message);
    } finally {
      setUploadingLec(false);
      setLecUploadProgress(null);
    }
  };

  const toggle = (df) => setExpanded(p => ({ ...p, [df]: !isOpen(df) }));
  const isOpen = (df) => {
    if (expanded[df] !== undefined) return expanded[df];
    return folders[0]?.dateFolder === df; // only the latest folder is open by default
  };

  const handleUploadPdf = async (e) => {
    e.preventDefault();
    if (!pdfFile || !pdfUploadModal) return;
    setUploadingPdf(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const chosenDate = pdfDate || pdfUploadModal.dateFolder;
      fd.append('solutionDate', chosenDate);
      fd.append('title', pdfTitle || chosenDate);
      fd.append('testType', pdfTestType);

      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(pdfUploadModal.dateFolder)}/solutions`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload PDF');

      setPdfUploadModal(null);
      setPdfFile(null);
      setPdfTitle('');
      setPdfDate('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleDeleteSolution = async (dateFolder, solutionId) => {
    try {
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solutionId)}`), {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete solution');
      if (activePdfSolution?.solution?.id === solutionId) {
        setActivePdfSolution(null);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteLecturette = async (dateFolder, lecturetteId) => {
    setDeletingLecturetteId(lecturetteId);
    try {
      if (!lecturetteId) throw new Error('No lecturette ID specified');
      let res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder || 'any')}/lecturette/${encodeURIComponent(lecturetteId)}`), {
        method: 'DELETE'
      });
      if (!res.ok) {
        // Fallback to top-level delete route
        res = await fetch(apiUrl(`/api/lecturettes/${encodeURIComponent(lecturetteId)}`), {
          method: 'DELETE'
        });
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to delete lecturette');
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingLecturetteId(null);
    }
  };

  // Confirmed resource deletion dispatcher
  const executeResourceDelete = async () => {
    if (!deleteResourceConfirm) return;
    const { type, dateFolder, id } = deleteResourceConfirm;
    if (type === 'solution') await handleDeleteSolution(dateFolder, id);
    else if (type === 'lecturette') await handleDeleteLecturette(dateFolder, id);
    else if (type === 'gpe') await handleDeleteGpe(dateFolder, id);
    setDeleteResourceConfirm(null);
  };

  // Per-folder active tab: 'tat' | 'wat' | 'solutions' | 'lecturette'
  const [folderTabs, setFolderTabs] = useState({});
  const getFolderTab = (df) => folderTabs[df] || 'tat';
  const setFolderTab = (df, tab) => setFolderTabs(p => ({ ...p, [df]: tab }));

  // Lecturette inline edit state
  const [editingLecturette, setEditingLecturette] = useState(null); // { id, dateFolder, title, recordedDate }
  const [lecEditSaving, setLecEditSaving] = useState(false);

  const handleSaveLecturetteEdit = async () => {
    if (!editingLecturette) return;
    setLecEditSaving(true);
    try {
      const { id, dateFolder, title, recordedDate } = editingLecturette;
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}/lecturette/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, recordedDate })
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditingLecturette(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setLecEditSaving(false);
    }
  };

  const filtered = folders.filter(f => {
    const q = search.toLowerCase();
    return f.dateFolder.includes(q) || (f.folderTitle || '').toLowerCase().includes(q);
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Date Folders</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="input pl-8 w-40 sm:w-52"
            />
          </div>
          <button onClick={() => onNavigate('upload')} className="btn-primary flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Batch</span>
          </button>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card p-10 text-center space-y-3">
          <Folder className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
          <p className="text-sm text-slate-400">{search ? 'No results found' : 'No batches yet. Upload your first set.'}</p>
          <button onClick={() => onNavigate('upload')} className="btn-primary inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Upload Batch
          </button>
        </div>
      )}

      {/* Folder list */}
      <div className="space-y-3">
        {filtered.map(folder => {
          const tatCount = folder.tat?.count || 0;
          const watCount = folder.wat?.count || 0;
          const open = isOpen(folder.dateFolder);

          return (
            <div key={folder.dateFolder} className="card overflow-hidden">

              {/* Folder header */}
              <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-dark-600">
                <button
                  onClick={() => toggle(folder.dateFolder)}
                  className="flex items-center gap-2 text-left min-w-0 flex-1"
                >
                  {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800 dark:text-white font-mono text-sm">{folder.dateFolder}</span>
                    {folder.folderTitle && (
                      <span className="text-xs text-slate-400 ml-1.5 hidden sm:inline">· {folder.folderTitle}</span>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-2">
                  {tatCount > 0 && <span className="badge-indigo text-[10px] px-1.5">{tatCount} TAT</span>}
                  {watCount > 0 && <span className="badge-cyan text-[10px] px-1.5">{watCount} WAT</span>}
                  {(folder.gpes?.length || 0) > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 hidden xs:inline-flex">
                      {folder.gpes.length} GPE
                    </span>
                  )}
                  {(folder.solutions?.length || 0) > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hidden xs:inline-flex">
                      {folder.solutions.length} Sol
                    </span>
                  )}
                  {(folder.lecturettes?.length || 0) > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 hidden xs:inline-flex">
                      {folder.lecturettes.length} Lec
                    </span>
                  )}
                  {((folder.reviews?.length || 0) + (folder.noteCards?.length || (Boolean(folder.notes?.content?.trim() && folder.notes.content !== '<p><br></p>') ? 1 : 0))) > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hidden sm:inline-flex">
                      {(folder.reviews?.length || 0) + (folder.noteCards?.length || (Boolean(folder.notes?.content?.trim() && folder.notes.content !== '<p><br></p>') ? 1 : 0))} Notes
                    </span>
                  )}
                  <button
                    onClick={() => onNavigate('upload', folder.dateFolder)}
                    className="p-1.5 rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                    title="Add to this folder"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ type: 'FOLDER', dateFolder: folder.dateFolder })}
                    className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    title="Delete folder"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded: Tab-based navigation */}
              {open && (() => {
                const activeTab = getFolderTab(folder.dateFolder);
                const gpeCount = folder.gpes?.length || 0;
                const solCount = folder.solutions?.length || 0;
                const lecCount = folder.lecturettes?.length || 0;

                const hasNotes = Boolean(folder.notes?.content && folder.notes.content.trim() && folder.notes.content !== '<p><br></p>');
                const noteCardsCount = folder.noteCards?.length || (hasNotes ? 1 : 0);
                const reviewsCount = folder.reviews?.length || 0;
                const totalNotesCount = noteCardsCount + reviewsCount;

                const tabs = [
                  { id: 'tat', label: 'TAT', icon: ImageIcon, color: 'indigo', count: tatCount },
                  { id: 'wat', label: 'WAT', icon: AlignLeft, color: 'cyan', count: watCount },
                  { id: 'gpe', label: 'GPE', icon: Compass, color: 'blue', count: gpeCount },
                  { id: 'solutions', label: 'Solutions', icon: FileText, color: 'emerald', count: solCount },
                  { id: 'lecturette', label: 'Lecturette', icon: Video, color: 'purple', count: lecCount },
                  { id: 'notes', label: 'Notes & Review', icon: FileText, color: 'amber', count: totalNotesCount },
                ];

                const tabColorClass = (id, isActive) => {
                  const map = {
                    tat: isActive ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/5',
                    wat: isActive ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-500/5',
                    gpe: isActive ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/5',
                    solutions: isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/5',
                    lecturette: isActive ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-b-2 border-purple-500' : 'text-slate-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/5',
                    notes: isActive ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-b-2 border-amber-500' : 'text-slate-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/5',
                  };
                  return map[id] || '';
                };

                return (
                  <div>
                    {/* Tab bar */}
                    <div className="flex overflow-x-auto border-b border-slate-100 dark:border-dark-600 bg-slate-50/50 dark:bg-dark-800/30 scrollbar-thin">
                      {tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setFolderTab(folder.dateFolder, tab.id)}
                          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${tabColorClass(tab.id, activeTab === tab.id)}`}
                        >
                          <tab.icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-black tracking-wider text-sm">{tab.label}</span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${tab.count > 0 ? 'bg-slate-200/80 dark:bg-dark-700 text-slate-600 dark:text-slate-300 font-bold' : 'text-slate-400'}`}>
                            {tab.count}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* TAT Tab */}
                    {activeTab === 'tat' && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-2xl sm:text-3xl font-black text-indigo-600 dark:text-indigo-400 font-mono tracking-wider">TAT</span>
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">· {tatCount} pictures</span>
                            {folder.tat?.rewriteCount > 0 && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                {folder.tat.rewriteCount} Rewrite
                              </span>
                            )}
                            {folder.tat?.freshCount > 0 && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                {folder.tat.freshCount} Fresh
                              </span>
                            )}
                          </div>
                          {tatCount > 0 && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setInspectModal({ type: 'TAT', dateFolder: folder.dateFolder })}
                                className="px-2 py-1 rounded text-[11px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" /><span>Inspect</span>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ type: 'TAT', dateFolder: folder.dateFolder })}
                                className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                title="Delete TAT"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {tatCount > 0 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                            {folder.tat?.pictures?.slice(0, 10).map((pic, i) => (
                              <div
                                key={pic.id || i}
                                onClick={() => setInspectModal({ type: 'TAT', dateFolder: folder.dateFolder })}
                                className="relative aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-dark-700 cursor-pointer group"
                              >
                                <img src={pic.url} alt="" className="w-full h-full object-cover blur-sm group-hover:blur-none scale-105 group-hover:scale-100 transition-all duration-300" />
                                <div className="absolute inset-0 bg-black/25 group-hover:bg-transparent transition-colors flex items-center justify-between p-1 pointer-events-none">
                                  <span className="text-[9px] font-mono text-white/90 bg-black/60 px-1 rounded">#{i + 1}</span>
                                  <span className={`w-2 h-2 rounded-full ring-1 ring-white/50 ${pic.batch === 'rewrite' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                </div>
                              </div>
                            ))}
                            {tatCount > 10 && (
                              <button
                                onClick={() => setInspectModal({ type: 'TAT', dateFolder: folder.dateFolder })}
                                className="aspect-video rounded-lg bg-slate-100 dark:bg-dark-700 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-slate-400 hover:text-indigo-500 flex items-center justify-center text-xs font-bold transition-colors"
                              >
                                +{tatCount - 10}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-8 space-y-2">
                            <p className="text-sm text-slate-400">No TAT pictures uploaded yet</p>
                            <button onClick={() => onNavigate('upload', folder.dateFolder)} className="btn-primary text-xs">
                              <Plus className="w-3 h-3" /> Upload TAT
                            </button>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => onStartTest('TAT', folder.dateFolder)}
                            disabled={tatCount === 0}
                            className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <Play className="w-3 h-3 fill-current" /> Launch TAT
                          </button>
                          {tatCount > 0 && watCount > 0 && (
                            <button
                              onClick={() => onStartTest('PSYCH', folder.dateFolder)}
                              className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Layers className="w-3 h-3" />
                              <Play className="w-3 h-3 fill-current" /> Full Psych
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* WAT Tab */}
                    {activeTab === 'wat' && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl sm:text-3xl font-black text-cyan-600 dark:text-cyan-400 font-mono tracking-wider">WAT</span>
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">· {watCount} words</span>
                          </div>
                          {watCount > 0 && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => setInspectModal({ type: 'WAT', dateFolder: folder.dateFolder })}
                                className="px-2 py-1 rounded text-[11px] font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 flex items-center gap-1 transition-colors">
                                <Eye className="w-3 h-3" /><span>Inspect</span>
                              </button>
                              <button onClick={() => setDeleteConfirm({ type: 'WAT', dateFolder: folder.dateFolder })}
                                className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" title="Delete WAT">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {watCount > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {folder.wat?.words?.slice(0, 20).map((w, i) => (
                              <span key={i} className="text-xs font-mono px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20">
                                {w}
                              </span>
                            ))}
                            {watCount > 20 && <span className="text-xs text-slate-400 self-center">+{watCount - 20} more</span>}
                          </div>
                        ) : (
                          <div className="text-center py-8 space-y-2">
                            <p className="text-sm text-slate-400">No WAT words uploaded yet</p>
                            <button onClick={() => onNavigate('upload', folder.dateFolder)} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors">
                              <Plus className="w-3 h-3" /> Upload WAT
                            </button>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => onStartTest('WAT', folder.dateFolder)}
                            disabled={watCount === 0}
                            className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors disabled:opacity-40"
                          >
                            <Play className="w-3 h-3 fill-current" /> Launch WAT
                          </button>
                          {tatCount > 0 && watCount > 0 && (
                            <button
                              onClick={() => onStartTest('PSYCH', folder.dateFolder)}
                              className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Layers className="w-3 h-3" />
                              <Play className="w-3 h-3 fill-current" /> Full Psych
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* GPE Tab */}
                    {activeTab === 'gpe' && (
                      <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Compass className="w-5 h-5 text-blue-500" />
                            <span className="text-2xl sm:text-3xl font-black text-blue-600 dark:text-blue-400 font-mono tracking-wider">GPE</span>
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">· {gpeCount} Exercise{gpeCount !== 1 ? 's' : ''}</span>
                          </div>
                          <button
                            onClick={() => {
                              setGpeUploadModal({ dateFolder: folder.dateFolder });
                              setGpeTitleInput('');
                              setGpeScaleInput('1 cm = 2 km');
                              setGpeDescInput('');
                              setGpeModelSolInput('');
                              setGpeFileInput(null);
                              setGpeFilePreview(null);
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" /> Upload GPE
                          </button>
                        </div>

                        {gpeCount > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {folder.gpes.map((gpe) => (
                              <div key={gpe.id} className="card p-4 space-y-3 border border-slate-200 dark:border-dark-600 hover:border-blue-500/50 transition-colors">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm leading-snug">{gpe.title}</h4>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-bold">
                                        Scale: {gpe.scale || '1 cm = 2 km'}
                                      </span>
                                      {(gpe.solutions?.length || 0) > 0 && (
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                          {gpe.solutions.length} Plan{gpe.solutions.length !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => setDeleteResourceConfirm({ type: 'gpe', dateFolder: folder.dateFolder, id: gpe.id, label: gpe.title })}
                                    className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
                                    title="Delete GPE"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Map & Narrative Preview Thumbnails */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div
                                    onClick={() => setBigImage({ url: gpe.mapUrl, label: `${gpe.title} (${gpe.scale || '1 cm = 2 km'}) - Map Model` })}
                                    className="relative aspect-video rounded-lg overflow-hidden bg-slate-900 cursor-pointer group border border-slate-200 dark:border-dark-700"
                                  >
                                    <img
                                      src={gpe.mapUrl}
                                      alt={gpe.title}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold">
                                      <ZoomIn className="w-4 h-4" />
                                      <span>Map Model</span>
                                    </div>
                                  </div>

                                  {gpe.narrativeImageUrl ? (
                                    <div
                                      onClick={() => setBigImage({ url: gpe.narrativeImageUrl, label: `${gpe.title} - Narrative Card` })}
                                      className="relative aspect-video rounded-lg overflow-hidden bg-slate-900 cursor-pointer group border border-slate-200 dark:border-dark-700"
                                    >
                                      <img
                                        src={gpe.narrativeImageUrl}
                                        alt="Narrative Card"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                      />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold">
                                        <ZoomIn className="w-4 h-4" />
                                        <span>Narrative Card</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-dark-800 border border-slate-200 dark:border-dark-700 flex flex-col justify-center">
                                      <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">Pasted Narrative</span>
                                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed mt-1 font-sans">
                                        {gpe.description || 'No text description'}
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Problem Statement Excerpt if narrative card also has text */}
                                {gpe.narrativeImageUrl && gpe.description && (
                                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                    {gpe.description}
                                  </p>
                                )}

                                {/* Candidate Submitted Solution Sheets */}
                                {(gpe.solutions?.length || 0) > 0 && (
                                  <div className="pt-1.5 border-t border-slate-100 dark:border-dark-700 space-y-1">
                                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">
                                      Candidate Solution Photos ({gpe.solutions.length})
                                    </span>
                                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                                      {gpe.solutions.map((sol, sIdx) => (
                                        <div
                                          key={sol.id || sIdx}
                                          onClick={() => {
                                            if (sol.solutionImageUrl) {
                                              setBigImage({ url: sol.solutionImageUrl, label: `${sol.author}'s Solution Photo` });
                                            }
                                          }}
                                          className="shrink-0 p-1.5 rounded-lg border border-slate-200 dark:border-dark-700 bg-slate-50 dark:bg-dark-800 flex items-center gap-2 cursor-pointer hover:border-purple-500/50 transition-colors"
                                          title="View solution photo"
                                        >
                                          {sol.solutionImageUrl ? (
                                            <img
                                              src={sol.solutionImageUrl}
                                              alt="Solution"
                                              className="w-8 h-8 rounded object-cover border border-purple-500/30"
                                            />
                                          ) : (
                                            <FileText className="w-5 h-5 text-purple-500" />
                                          )}
                                          <div className="text-[10px]">
                                            <p className="font-bold text-slate-800 dark:text-white truncate max-w-[100px]">{sol.author || 'Candidate'}</p>
                                            <p className="text-slate-400 font-mono">{sol.submittedAt ? new Date(sol.submittedAt).toLocaleDateString() : ''}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-dark-700 flex-wrap">
                                  <button
                                    onClick={() => onStartTest('GPE', folder.dateFolder, gpe.id)}
                                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md px-3 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors shadow-sm"
                                  >
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>Launch GPE Exercise</span>
                                  </button>
                                  <button
                                    onClick={() => setBigImage({ url: gpe.mapUrl, label: `${gpe.title} (${gpe.scale || '1 cm = 2 km'})` })}
                                    className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Map</span>
                                  </button>
                                  {gpe.narrativeImageUrl && (
                                    <button
                                      onClick={() => setBigImage({ url: gpe.narrativeImageUrl, label: `${gpe.title} - Narrative Card` })}
                                      className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"
                                    >
                                      <ImageIcon className="w-3 h-3" />
                                      <span>Narrative Card</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 space-y-2">
                            <p className="text-sm text-slate-400">No GPE exercises uploaded in this batch yet</p>
                            <button
                              onClick={() => {
                                setGpeUploadModal({ dateFolder: folder.dateFolder });
                                setGpeTitleInput('');
                                setGpeScaleInput('1 cm = 2 km');
                                setGpeDescInput('');
                                setGpeModelSolInput('');
                                setGpeFileInput(null);
                                setGpeFilePreview(null);
                              }}
                              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md px-3 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5" /> Upload GPE Map & Narrative
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Solutions Tab */}
                    {activeTab === 'solutions' && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-emerald-500" />
                            <span className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-wider">Solutions</span>
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">· {solCount} PDFs</span>
                          </div>
                          <button
                            onClick={() => {
                              setPdfUploadModal({ dateFolder: folder.dateFolder });
                              setPdfDate(folder.dateFolder);
                              setPdfTitle('');
                              setPdfFile(null);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Upload className="w-3 h-3" /> Upload PDF
                          </button>
                        </div>

                        {solCount === 0 ? (
                          <div className="text-center py-8 space-y-2">
                            <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
                            <p className="text-sm text-slate-400">No solution PDFs uploaded yet</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {folder.solutions.map(sol => (
                              <div key={sol.id}
                                className="card-sm p-3 flex items-center justify-between gap-2 border border-slate-200 dark:border-dark-600 hover:border-emerald-500/40 transition-colors"
                              >
                                <div
                                  onClick={() => setActivePdfSolution({ solution: sol, dateFolder: folder.dateFolder })}
                                  className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                                >
                                  <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-bold px-1.5 rounded uppercase font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                        {sol.testType || 'TAT'}
                                      </span>
                                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                                        {sol.title || sol.solutionDate}
                                      </p>
                                    </div>
                                    <p className="text-[10px] text-slate-400">{sol.solutionDate} · {formatBytes(sol.size)}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => setActivePdfSolution({ solution: sol, dateFolder: folder.dateFolder })}
                                    className="p-1.5 rounded text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors" title="View PDF">
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setDeleteResourceConfirm({ type: 'solution', dateFolder: folder.dateFolder, id: sol.id, label: sol.title || sol.solutionDate || 'this PDF' })}
                                    className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" title="Delete PDF">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Lecturette Tab */}
                    {activeTab === 'lecturette' && (
                      <div className="p-4 space-y-3">
                          <div className="flex items-center gap-2">
                              <Video className="w-5 h-5 text-purple-500" />
                              <span className="text-2xl sm:text-3xl font-black text-purple-600 dark:text-purple-400 font-mono tracking-wider">Lecturette</span>
                              <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">· {lecCount} videos</span>
                            </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                             <button
                               onClick={() => onNavigate('lecturette')}
                               className="bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition-colors border border-purple-700"
                               title="Record video using webcam"
                             >
                               <Video className="w-3 h-3" /> Record Live
                             </button>
                           </div>

                        {lecCount === 0 ? (
                          <div className="text-center py-8 space-y-3">
                            <Video className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
                            <p className="text-sm text-slate-400">No lecturette videos recorded yet</p>
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => onNavigate('lecturette')}
                                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md px-3 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors shadow-sm"
                              >
                                <Video className="w-3.5 h-3.5" /> Go to Lecturette Studio
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {folder.lecturettes.map((lec, idx) => {
                              const lecId = lec.id || lec._id?.toString() || lec._id || `lec-${idx}`;
                              return (
                              <div key={lecId} className="card-sm p-3 border border-slate-200 dark:border-dark-600 hover:border-purple-500/40 transition-colors space-y-2 relative">
                                {/* Loader Overlay when being deleted */}
                                {deletingLecturetteId === lecId && (
                                  <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center gap-2 z-30 animate-fadeIn select-none">
                                    <div className="w-8 h-8 border-3 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
                                    <span className="text-xs font-semibold text-red-400">Deleting video...</span>
                                  </div>
                                )}
                                {/* Video thumbnail + play */}
                                <div
                                  onClick={() => setVideoModal({ url: apiUrl(lec.url || lec.b2Url || lec.firebaseUrl), title: lec.title })}
                                  className="aspect-video bg-black rounded-lg overflow-hidden relative cursor-pointer group flex items-center justify-center"
                                >
                                  <video src={apiUrl(lec.url || lec.b2Url || lec.firebaseUrl)} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/20 transition-colors">
                                    <div className="w-10 h-10 rounded-full bg-white/90 text-slate-900 flex items-center justify-center pl-0.5 shadow-md group-hover:scale-110 transition-transform">
                                      <Play className="w-4 h-4 fill-current" />
                                    </div>
                                  </div>
                                </div>
                                {/* Info + actions */}
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{lec.title || 'Lecturette'}</p>
                                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                      <Calendar className="w-2.5 h-2.5" />{lec.recordedDate || folder.dateFolder}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => setEditingLecturette({ id: lecId, dateFolder: folder.dateFolder, title: lec.title || '', recordedDate: lec.recordedDate || folder.dateFolder })}
                                      className="p-1.5 rounded text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors"
                                      title="Edit title/date"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDeleteResourceConfirm({ type: 'lecturette', dateFolder: folder.dateFolder, id: lecId, label: lec.title || 'this lecturette video' })}
                                      className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                      title="Delete video"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );})}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes & Audio Review Tab */}
                    {activeTab === 'notes' && (
                      <NotesEditor
                        dateFolder={folder.dateFolder}
                        initialNotes={folder.notes}
                        initialNoteCards={folder.noteCards || []}
                        initialReviews={folder.reviews || []}
                        onSaveSuccess={(data) => {
                          if (data?.notes) folder.notes = data.notes;
                          if (data?.noteCards) folder.noteCards = data.noteCards;
                          if (data?.reviews) folder.reviews = data.reviews;
                          if (onRefresh) onRefresh();
                        }}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Big Image Preview with Pan and Zoom */}
      {bigImage && (
        <PanZoomModal
          isOpen={Boolean(bigImage)}
          onClose={() => setBigImage(null)}
          imageUrl={bigImage.url || bigImage}
          title={bigImage.label || 'Image Preview'}
          badgeIcon={bigImage.label?.toLowerCase().includes('solution') ? FileText : ImageIcon}
        />
      )}

      {/* Inspect Modal */}
      {inspectModal && (
        <InspectModal
          info={inspectModal}
          onClose={() => setInspectModal(null)}
          onStartTest={onStartTest}
          onRefresh={onRefresh}
        />
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-slate-800 dark:text-white">Confirm Delete</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {deleteConfirm.type === 'FOLDER' && `Delete the entire folder "${deleteConfirm.dateFolder}" and all its content?`}
              {deleteConfirm.type === 'TAT' && `Clear all TAT pictures from "${deleteConfirm.dateFolder}"?`}
              {deleteConfirm.type === 'WAT' && `Clear all WAT words from "${deleteConfirm.dateFolder}"?`}
              <span className="text-red-500 font-semibold block mt-1">This action cannot be undone.</span>
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={async () => {
                  if (deleteConfirm.type === 'FOLDER') await onDeleteFolder(deleteConfirm.dateFolder);
                  else await onDeleteBatch(deleteConfirm.dateFolder, deleteConfirm.type);
                  setDeleteConfirm(null);
                }}
                className="bg-red-500 hover:bg-red-400 text-white font-semibold rounded-lg px-4 py-2 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Resource Confirm Modal (solutions, lecturettes) */}
      {deleteResourceConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-slate-800 dark:text-white">Confirm Delete</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Delete <span className="font-semibold text-slate-700 dark:text-slate-200">"{deleteResourceConfirm.label}"</span>?<br />
              <span className="text-red-500 font-semibold">This action cannot be undone.</span>
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteResourceConfirm(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={executeResourceDelete}
                className="bg-red-500 hover:bg-red-400 text-white font-semibold rounded-lg px-4 py-2 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Solution Full Viewer Modal */}
      {activePdfSolution && (
        <PdfViewerModal
          solution={activePdfSolution.solution}
          dateFolder={activePdfSolution.dateFolder}
          onClose={() => setActivePdfSolution(null)}
          onUpdate={() => { if (onRefresh) onRefresh(); }}
          onDelete={(id) => handleDeleteSolution(activePdfSolution.dateFolder, id)}
        />
      )}

      {/* Upload Solution PDF Modal Dialog */}
      {pdfUploadModal && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleUploadPdf} className="card max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-dark-700">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-500" />
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">
                  Upload Solution PDF ({pdfUploadModal.dateFolder})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPdfUploadModal(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uploadError && (
              <p className="text-red-500 text-xs font-medium">{uploadError}</p>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="label">Solution Date (Title of PDF)</label>
                <input
                  type="date"
                  value={pdfDate || pdfUploadModal.dateFolder}
                  onChange={e => {
                    setPdfDate(e.target.value);
                    if (!pdfTitle || pdfTitle === pdfDate) setPdfTitle(e.target.value);
                  }}
                  required
                  className="input py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="label">Custom Label (optional)</label>
                <input
                  type="text"
                  value={pdfTitle}
                  onChange={e => setPdfTitle(e.target.value)}
                  placeholder="Custom label (defaults to PDF filename)"
                  className="input py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="label">Test Type</label>
                <select
                  value={pdfTestType}
                  onChange={e => setPdfTestType(e.target.value)}
                  className="input py-1.5 text-xs bg-white dark:bg-dark-800"
                >
                  <option value="TAT">TAT</option>
                  <option value="WAT">WAT</option>
                  <option value="GENERAL">General</option>
                  <option value="SRT">SRT</option>
                  <option value="SDT">SDT</option>
                </select>
              </div>

              <div>
                <label className="label">Select PDF File</label>
                <input
                  type="file"
                  accept="application/pdf"
                  required
                  onChange={e => {
                    const file = e.target.files?.[0] || null;
                    setPdfFile(file);
                    if (file) {
                      const nameWithoutExt = file.name.replace(/\.pdf$/i, '');
                      setPdfTitle(nameWithoutExt);
                    }
                  }}
                  className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 dark:file:bg-emerald-950/40 file:text-emerald-700 dark:file:text-emerald-300 hover:file:bg-emerald-100"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100 dark:border-dark-700">
              <button
                type="button"
                onClick={() => setPdfUploadModal(null)}
                className="btn-secondary py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadingPdf || !pdfFile}
                className="btn-primary bg-emerald-600 hover:bg-emerald-500 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingPdf ? 'Uploading PDF...' : 'Upload PDF'}</span>
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Lecturette Video Upload Modal */}

      {/* GPE Upload Modal Dialog */}
      {gpeUploadModal && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <form onSubmit={handleUploadGpeModal} className="card max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600 my-8">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-dark-700">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">
                  Upload GPE Exercise ({gpeUploadModal.dateFolder})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGpeUploadModal(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {gpeUploadError && (
              <p className="text-red-500 text-xs font-medium">{gpeUploadError}</p>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <label className="label">Title</label>
                  <input
                    type="text"
                    value={gpeTitleInput}
                    onChange={e => setGpeTitleInput(e.target.value)}
                    placeholder={`e.g. GPE Set 1 - ${gpeUploadModal.dateFolder}`}
                    className="input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="label">Scale</label>
                  <input
                    type="text"
                    value={gpeScaleInput}
                    onChange={e => setGpeScaleInput(e.target.value)}
                    placeholder="1 cm = 2 km"
                    className="input py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="label">GPE Map Image (Required)</label>
                <input
                  ref={gpeModalFileRef}
                  type="file"
                  accept="image/*"
                  required
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setGpeFileInput(f);
                    if (f) {
                      if (gpeFilePreview) URL.revokeObjectURL(gpeFilePreview);
                      setGpeFilePreview(URL.createObjectURL(f));
                      if (!gpeTitleInput) setGpeTitleInput(f.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
                    }
                  }}
                  className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-950/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
                />
                {gpeFilePreview && (
                  <div className="mt-2 relative rounded-lg overflow-hidden border border-slate-200 dark:border-dark-700 max-h-40 bg-black/40 flex items-center justify-center">
                    <img src={gpeFilePreview} alt="" className="max-h-36 w-auto object-contain" />
                  </div>
                )}
              </div>

              {/* Narrative Input (Image upload or Text Paste) */}
              <div className="space-y-2 border border-slate-200 dark:border-dark-600 rounded-lg p-3 bg-slate-50/50 dark:bg-dark-800/40">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="label mb-0">Problem Narrative (Image or Text)</label>
                  <div className="flex items-center bg-slate-200/80 dark:bg-dark-700 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setGpeNarrativeTab('text')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        gpeNarrativeTab === 'text' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      Paste Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setGpeNarrativeTab('image')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        gpeNarrativeTab === 'image' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      Upload Card Image
                    </button>
                  </div>
                </div>

                {gpeNarrativeTab === 'image' ? (
                  <div className="space-y-2 pt-1">
                    <input
                      ref={gpeModalNarrativeFileRef}
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setGpeNarrativeFileInput(f);
                        if (f) {
                          if (gpeNarrativeFilePreview) URL.revokeObjectURL(gpeNarrativeFilePreview);
                          setGpeNarrativeFilePreview(URL.createObjectURL(f));
                        }
                      }}
                      className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-950/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
                    />
                    {gpeNarrativeFilePreview && (
                      <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-dark-700 max-h-40 bg-black/40 flex items-center justify-center">
                        <img src={gpeNarrativeFilePreview} alt="" className="max-h-36 w-auto object-contain" />
                        <button
                          type="button"
                          onClick={() => {
                            setGpeNarrativeFileInput(null);
                            if (gpeNarrativeFilePreview) URL.revokeObjectURL(gpeNarrativeFilePreview);
                            setGpeNarrativeFilePreview(null);
                            if (gpeModalNarrativeFileRef.current) gpeModalNarrativeFileRef.current.value = '';
                          }}
                          className="absolute top-2 right-2 p-1 rounded bg-black/70 hover:bg-red-600 text-white transition-colors"
                          title="Remove narrative card image"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <textarea
                    rows={5}
                    value={gpeDescInput}
                    onChange={e => setGpeDescInput(e.target.value)}
                    placeholder="Paste or write the GTO narrative here with situation, resources, time constraints..."
                    className="input text-xs leading-relaxed resize-y scrollbar-thin font-sans"
                  />
                )}
              </div>

              <div>
                <label className="label">Model Solution (Optional)</label>
                <textarea
                  rows={2}
                  value={gpeModelSolInput}
                  onChange={e => setGpeModelSolInput(e.target.value)}
                  placeholder="Optional model solution points for candidate review..."
                  className="input text-xs leading-relaxed resize-y scrollbar-thin font-mono"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100 dark:border-dark-700">
              <button
                type="button"
                onClick={() => setGpeUploadModal(null)}
                className="btn-secondary py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadingGpe || !gpeFileInput || (!gpeDescInput.trim() && !gpeNarrativeFileInput)}
                className="btn-primary bg-blue-600 hover:bg-blue-500 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingGpe ? 'Uploading GPE...' : 'Upload GPE Exercise'}</span>
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Video Player Modal */}
      {videoModal && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4">
          <div className="card max-w-2xl w-full overflow-hidden bg-slate-950 border-slate-800">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 text-white">
              <span className="text-xs font-bold truncate">{videoModal.title || 'Lecturette Recording'}</span>
              <button
                onClick={() => setVideoModal(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3">
              <CustomVideoPlayer
                src={videoModal.url}
                autoPlay={true}
                className="w-full aspect-video rounded bg-black"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Lecturette Title and Date Modal */}
      {editingLecturette && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSaveLecturetteEdit();
            }}
            className="card max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-dark-700">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-purple-500" />
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">
                  Edit Lecturette Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingLecturette(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="label">Lecturette Title</label>
                <input
                  type="text"
                  value={editingLecturette.title}
                  onChange={e => setEditingLecturette(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. India's Defense Strategy"
                  required
                  className="input py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  value={editingLecturette.recordedDate}
                  onChange={e => setEditingLecturette(p => ({ ...p, recordedDate: e.target.value }))}
                  required
                  className="input py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100 dark:border-dark-700">
              <button
                type="button"
                onClick={() => setEditingLecturette(null)}
                className="btn-secondary py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={lecEditSaving}
                className="btn-primary bg-purple-600 hover:bg-purple-500 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{lecEditSaving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}

function InspectModal({ info, onClose, onStartTest, onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeBatchTab, setActiveBatchTab] = useState('all'); // 'all' | 'rewrite' | 'fresh'
  const [antiSpoiler, setAntiSpoiler] = useState(true); // default true: spoiler safe (blurred)
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deletePicConfirm, setDeletePicConfirm] = useState(null); // { id, originalName, index }

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/folders/${encodeURIComponent(info.dateFolder)}`))
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching folder:', err);
        setLoading(false);
      });
  }, [info.dateFolder]);

  // Handle single picture deletion
  const handleDeletePicture = async (picId) => {
    setDeletingId(picId);
    try {
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(info.dateFolder)}/tat/${encodeURIComponent(picId)}`), {
        method: 'DELETE'
      });
      const resData = await res.json();
      if (res.ok && resData.folder) {
        setData(resData.folder);
        if (onRefresh) onRefresh();
        if (lightboxIndex !== null) setLightboxIndex(null);
      }
    } catch (err) {
      console.error('Failed to delete picture:', err);
    } finally {
      setDeletingId(null);
      setDeletePicConfirm(null);
    }
  };

  const toggleRevealId = (id) => {
    setRevealedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // TAT picture groupings
  const allPics = data?.tat?.pictures || [];
  const rewritePics = allPics.filter(p => p.batch === 'rewrite');
  const freshPics = allPics.filter(p => p.batch !== 'rewrite');

  // Display pictures based on active tab (in 'all', show rewrite first then fresh to match test order)
  const displayPics = activeBatchTab === 'rewrite'
    ? rewritePics
    : activeBatchTab === 'fresh'
    ? freshPics
    : [...rewritePics, ...freshPics];

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
      } else if (e.key === 'ArrowLeft') {
        setLightboxIndex(i => (i > 0 ? i - 1 : displayPics.length - 1));
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex(i => (i < displayPics.length - 1 ? i + 1 : 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, displayPics.length]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="card max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-dark-600">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-dark-600 bg-white dark:bg-dark-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={info.type === 'TAT' ? 'badge-indigo' : 'badge-cyan'}>{info.type} Inspect</span>
            <span className="text-sm font-bold text-slate-800 dark:text-white font-mono">{info.dateFolder}</span>
            {data?.folderTitle && (
              <span className="text-xs text-slate-400 hidden sm:inline">· {data.folderTitle}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Anti-spoiler toggle for TAT */}
            {info.type === 'TAT' && allPics.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAntiSpoiler(prev => !prev);
                  setRevealedIds(new Set());
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  antiSpoiler
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-slate-100 dark:bg-dark-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-dark-500'
                }`}
                title={antiSpoiler ? 'Images are blurred. Click to reveal all images.' : 'Click to blur all images.'}
              >
                {antiSpoiler ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{antiSpoiler ? 'Anti-Spoiler ON (Blurred)' : 'Anti-Spoiler OFF (Clear)'}</span>
                <span className="sm:hidden">{antiSpoiler ? 'Blurred' : 'Clear'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading batch details...</span>
            </div>
          ) : info.type === 'TAT' ? (
            <div className="space-y-4">

              {/* TAT Flow & Batch Info Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-xs">
                <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
                  <RotateCcw className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>
                    <strong>Practice Sequence:</strong> Rewrite batch plays first (shuffled), followed by Fresh batch (shuffled).
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-[11px] font-semibold border border-amber-300 dark:border-amber-500/30">
                    {rewritePics.length} Rewrite
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold border border-emerald-300 dark:border-emerald-500/30">
                    {freshPics.length} Fresh
                  </span>
                </div>
              </div>

              {/* Batch Filter Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-dark-600 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveBatchTab('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeBatchTab === 'all'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-700'
                  }`}
                >
                  All Pictures ({allPics.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveBatchTab('rewrite')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeBatchTab === 'rewrite'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-700'
                  }`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Rewrite Batch ({rewritePics.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveBatchTab('fresh')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeBatchTab === 'fresh'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-700'
                  }`}
                >
                  <Leaf className="w-3 h-3" />
                  <span>Fresh Batch ({freshPics.length})</span>
                </button>
              </div>

              {/* Pictures Grid */}
              {displayPics.length === 0 ? (
                <div className="text-center py-12 card border-dashed border-slate-200 dark:border-dark-600">
                  <p className="text-sm text-slate-400">No pictures in this category.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {displayPics.map((pic, idx) => {
                    const picKey = pic.id || pic._id || idx;
                    const isRevealed = !antiSpoiler || revealedIds.has(picKey);

                    return (
                      <div
                        key={picKey}
                        className="card p-2 space-y-1.5 group border border-slate-200 dark:border-dark-600 hover:border-indigo-400 dark:hover:border-indigo-500 transition-all"
                      >
                        {/* Thumbnail Container */}
                        <div
                          className="relative aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-dark-700 cursor-pointer"
                          onClick={() => setLightboxIndex(idx)}
                        >
                          <img
                            src={pic.url}
                            alt={pic.originalName || 'TAT Picture'}
                            className={`w-full h-full object-cover transition-all duration-300 ${
                              isRevealed
                                ? 'blur-none scale-100'
                                : 'blur-md group-hover:blur-sm scale-105'
                            }`}
                          />

                          {/* Top Tag Badges */}
                          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10 pointer-events-none">
                            <span className="text-[10px] font-mono font-bold text-white bg-black/60 backdrop-blur-xs px-1.5 py-0.5 rounded shadow-xs">
                              #{idx + 1}
                            </span>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-xs shadow-xs ${
                              pic.batch === 'rewrite'
                                ? 'bg-amber-500/90 text-white'
                                : 'bg-emerald-500/90 text-white'
                            }`}>
                              {pic.batch === 'rewrite' ? 'Rewrite' : 'Fresh'}
                            </span>
                          </div>

                          {/* Hover action bar */}
                          <div className={`absolute inset-0 bg-black/40 ${lightboxIndex !== null ? 'hidden pointer-events-none' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex items-center justify-center gap-2 z-20`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightboxIndex(idx);
                              }}
                              className="p-1.5 rounded-full bg-white/90 text-slate-800 hover:bg-white hover:scale-110 transition-all shadow-md"
                              title="View full image"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRevealId(picKey);
                              }}
                              className="p-1.5 rounded-full bg-white/90 text-slate-800 hover:bg-white hover:scale-110 transition-all shadow-md"
                              title={isRevealed ? "Blur picture" : "Unblur picture"}
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletePicConfirm({ id: picKey, originalName: pic.originalName, index: idx + 1 });
                              }}
                              className="p-1.5 rounded-full bg-red-500 text-white hover:bg-red-600 hover:scale-110 transition-all shadow-md"
                              title="Delete this picture"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Details below image */}
                        <div className="flex items-center justify-between text-[11px] px-0.5 pt-0.5">
                          <span
                            className="font-mono text-slate-600 dark:text-slate-300 truncate max-w-[110px]"
                            title={pic.originalName}
                          >
                            {pic.originalName || `Picture ${idx + 1}`}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {formatBytes(pic.size)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* WAT Words View */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-500 uppercase tracking-wider">
                  Total Words: {data.wat?.words?.length || 0}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.wat?.words?.map((w, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg card-sm">
                    <span className="text-[10px] text-slate-400 font-mono">{i + 1}</span>
                    <span className="text-sm font-mono font-bold text-cyan-600 dark:text-cyan-400">{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 dark:border-dark-600 bg-slate-50 dark:bg-dark-800">
          <div className="text-xs text-slate-400">
            {info.type === 'TAT' && (
              <span>{allPics.length} pictures total ({rewritePics.length} Rewrite · {freshPics.length} Fresh)</span>
            )}
            {info.type === 'WAT' && (
              <span>{data?.wat?.words?.length || 0} words total</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">Close</button>
            <button
              onClick={() => { onClose(); onStartTest(info.type, info.dateFolder); }}
              className={info.type === 'TAT' ? 'btn-primary flex items-center gap-1.5' : 'bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5'}
            >
              <Play className="w-3.5 h-3.5 fill-current" /> Launch Test
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox / Fullscreen Viewer */}
      {lightboxIndex !== null && displayPics[lightboxIndex] && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-between p-4"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Lightbox Header */}
          <div
            className="w-full flex items-center justify-between text-white/90 max-w-5xl pt-2 px-2"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold">
                #{lightboxIndex + 1} of {displayPics.length}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                displayPics[lightboxIndex].batch === 'rewrite'
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
              }`}>
                {displayPics[lightboxIndex].batch === 'rewrite' ? 'Rewrite Batch' : 'Fresh Batch'}
              </span>
              <span className="text-xs text-white/60 truncate max-w-sm font-mono hidden sm:inline">
                {displayPics[lightboxIndex].originalName}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeletePicConfirm({
                  id: displayPics[lightboxIndex].id || displayPics[lightboxIndex]._id,
                  originalName: displayPics[lightboxIndex].originalName,
                  index: lightboxIndex + 1
                })}
                className="p-2 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/40 hover:text-white transition-colors"
                title="Delete picture"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="p-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Lightbox Image with Prev/Next Controls */}
          <div
            className="relative flex-1 w-full max-w-5xl flex items-center justify-center p-2"
            onClick={e => e.stopPropagation()}
          >
            {displayPics.length > 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(i => (i > 0 ? i - 1 : displayPics.length - 1))}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 text-white hover:bg-black/90 hover:scale-110 transition-all z-10"
                title="Previous (Left Arrow)"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            <img
              src={displayPics[lightboxIndex].url}
              alt={displayPics[lightboxIndex].originalName || 'TAT picture'}
              className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl"
            />

            {displayPics.length > 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(i => (i < displayPics.length - 1 ? i + 1 : 0))}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 text-white hover:bg-black/90 hover:scale-110 transition-all z-10"
                title="Next (Right Arrow)"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Lightbox Footer hint */}
          <div className="text-center text-xs text-white/40 pb-2 font-mono">
            Use arrow keys (← / →) to navigate · Esc to close
          </div>
        </div>,
        document.body
      )}

      {/* Delete Single Picture Confirmation Dialog */}
      {deletePicConfirm && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4">
          <div className="card max-w-sm w-full p-5 space-y-4 shadow-2xl border border-red-500/20">
            <div className="flex items-center gap-2.5 text-red-500">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-slate-800 dark:text-white">Delete Picture #{deletePicConfirm.index}?</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Are you sure you want to remove picture <strong className="text-slate-700 dark:text-slate-200">"{deletePicConfirm.originalName}"</strong> from this TAT batch?
              <span className="text-red-500 font-semibold block mt-1">This action cannot be undone.</span>
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setDeletePicConfirm(null)}
                className="btn-secondary text-xs"
                disabled={deletingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeletePicture(deletePicConfirm.id)}
                disabled={deletingId !== null}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg px-3.5 py-1.5 text-xs transition-colors disabled:opacity-50"
              >
                {deletingId ? 'Deleting...' : 'Delete Picture'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
