import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Compass, Map, Play, Clock, Plus, Search, Trash2, Eye,
  X, CheckCircle2, FileText, Upload, Calendar, ChevronDown, ChevronUp, ZoomIn,
  Image as ImageIcon
} from 'lucide-react';
import { apiUrl } from '../utils/api';
import PanZoomModal from './PanZoomModal';

export default function GpeView({ folders, onStartTest, onNavigate, onRefresh }) {
  const [search, setSearch] = useState('');
  const [inspectMap, setInspectMap] = useState(null); // { url, title, scale }
  const [expandedNarrative, setExpandedNarrative] = useState({});
  const [expandedSolutions, setExpandedSolutions] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { gpeId, dateFolder, title }

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [uploadFolder, setUploadFolder] = useState(folders[0]?.dateFolder || today);
  const [titleInput, setTitleInput] = useState('');
  const [scaleInput, setScaleInput] = useState('1 cm = 2 km');
  const [descInput, setDescInput] = useState('');
  const [modelSolInput, setModelSolInput] = useState('');
  const [mapFile, setMapFile] = useState(null);
  const [mapPreview, setMapPreview] = useState(null);
  const [narrativeFile, setNarrativeFile] = useState(null);
  const [narrativePreview, setNarrativePreview] = useState(null);
  const [narrativeTab, setNarrativeTab] = useState('text'); // 'text' | 'image'
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const mapFileRef = useRef(null);
  const narrativeFileRef = useRef(null);

  // Aggregate all GPEs across folders
  const allGpes = folders.flatMap(f =>
    (f.gpes || []).map(g => ({
      ...g,
      dateFolder: f.dateFolder,
      folderTitle: f.folderTitle
    }))
  );

  const totalSolutionsWritten = allGpes.reduce((acc, g) => acc + (g.solutions?.length || 0), 0);

  const filtered = allGpes.filter(g => {
    const q = search.toLowerCase();
    return (
      (g.title || '').toLowerCase().includes(q) ||
      (g.description || '').toLowerCase().includes(q) ||
      (g.dateFolder || '').includes(q) ||
      (g.scale || '').toLowerCase().includes(q)
    );
  });

  const toggleNarrative = (id) => {
    setExpandedNarrative(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSolutions = (id) => {
    setExpandedSolutions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDeleteGpe = async () => {
    if (!deleteConfirm) return;
    try {
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(deleteConfirm.dateFolder)}/gpes/${encodeURIComponent(deleteConfirm.gpeId)}`), {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete GPE');
      setDeleteConfirm(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!mapFile) {
      setUploadError('Please select a map image');
      return;
    }
    if (!descInput.trim() && !narrativeFile) {
      setUploadError('Please provide problem statement either by uploading narrative card image or pasting text');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('map', mapFile);
      if (narrativeFile) {
        fd.append('narrativeImage', narrativeFile);
      }
      const chosenFolder = uploadFolder.trim() || today;
      fd.append('title', (titleInput || `GPE Exercise ${chosenFolder}`).trim());
      fd.append('scale', (scaleInput || '1 cm = 2 km').trim());
      fd.append('description', descInput.trim());
      fd.append('modelSolution', modelSolInput.trim());

      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(chosenFolder)}/gpes`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload GPE');

      setUploadModalOpen(false);
      setMapFile(null);
      if (mapPreview) URL.revokeObjectURL(mapPreview);
      setMapPreview(null);
      setNarrativeFile(null);
      if (narrativePreview) URL.revokeObjectURL(narrativePreview);
      setNarrativePreview(null);
      setNarrativeTab('text');
      setTitleInput('');
      setDescInput('');
      setModelSolInput('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

      {/* Header & Stats Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="w-6 h-6 text-blue-500" />
            <h1 className="text-2xl font-black text-slate-800 dark:text-white">
              Group Planning Exercise (GPE)
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            SSB GTO Simulation · 5 Mins Map Study + 10 Mins Solution Writing
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search GPEs..."
              className="input pl-8 w-44 sm:w-56 py-1.5 text-xs"
            />
          </div>

          <button
            onClick={() => {
              setUploadModalOpen(true);
              setUploadError(null);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-3.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors shadow-sm shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload GPE</span>
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-white">{allGpes.length}</div>
            <div className="text-[11px] text-slate-400">Total GPEs</div>
          </div>
        </div>

        <div className="card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-white">{totalSolutionsWritten}</div>
            <div className="text-[11px] text-slate-400">Plans Written</div>
          </div>
        </div>

        <div className="card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-white">05:00</div>
            <div className="text-[11px] text-slate-400">Phase 1 Study</div>
          </div>
        </div>

        <div className="card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-white">10:00</div>
            <div className="text-[11px] text-slate-400">Phase 2 Writing</div>
          </div>
        </div>
      </div>

      {/* GPE Cards Grid */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-4">
          <Map className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {search ? 'No matching GPE exercises' : 'No Group Planning Exercises yet'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Upload your high-resolution map model and problem statement narrative to practice real SSB GTO timing simulation.
            </p>
          </div>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-4 py-2 text-xs inline-flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Upload First GPE
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filtered.map(gpe => {
            const isNarrativeExpanded = expandedNarrative[gpe.id];
            const isSolutionsExpanded = expandedSolutions[gpe.id];
            const solutionsList = gpe.solutions || [];

            return (
              <div
                key={gpe.id}
                className="card p-5 space-y-4 border border-slate-200 dark:border-dark-600 hover:border-blue-500/40 transition-colors flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-bold uppercase tracking-wider">
                        Batch {gpe.dateFolder}
                      </span>
                      <h3 className="text-base font-bold text-slate-800 dark:text-white mt-1.5 leading-snug">
                        {gpe.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Scale: <strong className="text-slate-700 dark:text-slate-300">{gpe.scale || '1 cm = 2 km'}</strong>
                        </span>
                        {solutionsList.length > 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            {solutionsList.length} Plan{solutionsList.length !== 1 ? 's' : ''} Written
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setDeleteConfirm({ gpeId: gpe.id, dateFolder: gpe.dateFolder, title: gpe.title })}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="Delete GPE"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Map & Narrative Preview Thumbnails */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div
                      onClick={() => setInspectMap({ url: gpe.mapUrl, title: `${gpe.title} (${gpe.scale || '1 cm = 2 km'}) - Map Model`, scale: gpe.scale })}
                      className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 cursor-pointer group border border-slate-200 dark:border-dark-700 shadow-sm"
                    >
                      <img
                        src={gpe.mapUrl}
                        alt={gpe.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
                        <ZoomIn className="w-4 h-4" />
                        <span>Map Model</span>
                      </div>
                    </div>

                    {gpe.narrativeImageUrl ? (
                      <div
                        onClick={() => setInspectMap({ url: gpe.narrativeImageUrl, title: `${gpe.title} - Narrative Card`, scale: '' })}
                        className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 cursor-pointer group border border-slate-200 dark:border-dark-700 shadow-sm"
                      >
                        <img
                          src={gpe.narrativeImageUrl}
                          alt="Narrative Card"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
                          <ZoomIn className="w-4 h-4" />
                          <span>Narrative Card</span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-800 border border-slate-200 dark:border-dark-700 flex flex-col justify-center">
                        <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">Pasted Narrative</span>
                        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed mt-1 font-sans">
                          {gpe.description || 'No text description'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Problem Narrative Statement (if narrative card also has text) */}
                  {gpe.narrativeImageUrl && gpe.description && (
                    <div className="space-y-1">
                      <p className={`text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-sans ${
                        !isNarrativeExpanded ? 'line-clamp-3' : ''
                      }`}>
                        {gpe.description}
                      </p>
                      {gpe.description.length > 160 && (
                        <button
                          onClick={() => toggleNarrative(gpe.id)}
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 pt-0.5"
                        >
                          <span>{isNarrativeExpanded ? 'Show Less' : 'Read Full Narrative'}</span>
                          {isNarrativeExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Candidate Solutions Accordion */}
                  {solutionsList.length > 0 && (
                    <div className="border-t border-slate-100 dark:border-dark-700 pt-2">
                      <button
                        onClick={() => toggleSolutions(gpe.id)}
                        className="w-full flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-800 dark:hover:text-slate-200 py-1"
                      >
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Candidate Written Plans ({solutionsList.length})</span>
                        </span>
                        {isSolutionsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isSolutionsExpanded && (
                        <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                          {solutionsList.map((sol, idx) => (
                            <div key={sol.id || idx} className="p-2.5 rounded-lg bg-slate-50 dark:bg-dark-800 border border-slate-200 dark:border-dark-700 text-xs space-y-2">
                              <div className="flex items-center justify-between font-mono text-[10px] text-slate-400">
                                <span className="font-bold text-slate-700 dark:text-slate-300">{sol.author || 'Candidate'}</span>
                                <div className="flex items-center gap-2">
                                  <span>{sol.submittedAt ? new Date(sol.submittedAt).toLocaleDateString() : ''}</span>
                                  {sol.id && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!window.confirm('Delete this solution submission?')) return;
                                        await fetch(apiUrl(`/api/folders/${encodeURIComponent(gpe.dateFolder)}/gpes/${encodeURIComponent(gpe.id)}/solutions/${encodeURIComponent(sol.id)}`), { method: 'DELETE' });
                                        if (onRefresh) onRefresh();
                                      }}
                                      className="text-slate-400 hover:text-red-500 transition-colors p-0.5 rounded"
                                      title="Delete solution"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {sol.solutionImageUrl && (
                                <div
                                  onClick={() => setInspectMap({ url: sol.solutionImageUrl, title: `${sol.author}'s Solution Sheet`, scale: '' })}
                                  className="relative aspect-video max-h-36 rounded-lg overflow-hidden bg-black/40 border border-purple-500/30 cursor-pointer group flex items-center justify-center"
                                >
                                  <img
                                    src={sol.solutionImageUrl}
                                    alt="Solution Sheet"
                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-[11px] font-bold">
                                    <ZoomIn className="w-3.5 h-3.5" />
                                    <span>Enlarge Solution Photo</span>
                                  </div>
                                </div>
                              )}

                              {sol.solutionText && (
                                <p className="whitespace-pre-wrap font-mono text-[11px] text-slate-600 dark:text-slate-300 max-h-24 overflow-y-auto leading-relaxed">
                                  {sol.solutionText}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Launch Action Controls */}
                <div className="pt-3 border-t border-slate-100 dark:border-dark-700 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onStartTest('GPE', gpe.dateFolder, gpe.id)}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg px-4 py-2 text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all transform hover:-translate-y-0.5 active:translate-y-0 min-w-[160px]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Launch GPE Exercise</span>
                  </button>

                  <button
                    onClick={() => setInspectMap({ url: gpe.mapUrl, title: gpe.title, scale: gpe.scale })}
                    className="btn-secondary py-2 px-3 text-xs flex items-center gap-1 text-slate-600 dark:text-slate-300"
                    title="Inspect map image"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Map</span>
                  </button>

                  {gpe.narrativeImageUrl && (
                    <button
                      onClick={() => setInspectMap({ url: gpe.narrativeImageUrl, title: `${gpe.title} - Narrative Card`, scale: '' })}
                      className="btn-secondary py-2 px-3 text-xs flex items-center gap-1 text-slate-600 dark:text-slate-300"
                      title="Inspect narrative card"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Card</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inspect Modal with Pan and Zoom */}
      {inspectMap && (
        <PanZoomModal
          isOpen={Boolean(inspectMap)}
          onClose={() => setInspectMap(null)}
          imageUrl={inspectMap.url}
          title={inspectMap.title}
          subtitle={inspectMap.scale}
          badgeIcon={inspectMap.title?.toLowerCase().includes('solution') ? FileText : (inspectMap.title?.toLowerCase().includes('card') ? ImageIcon : Compass)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4">
          <div className="card max-w-sm w-full p-5 space-y-4 shadow-2xl border border-red-500/20">
            <div className="flex items-center gap-2 text-red-500 font-bold text-sm">
              <Trash2 className="w-4 h-4" />
              <span>Delete GPE Exercise</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-700 dark:text-slate-200">"{deleteConfirm.title}"</strong> from batch {deleteConfirm.dateFolder}? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="btn-secondary py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteGpe}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg px-3 py-1 text-xs transition-colors"
              >
                Delete GPE
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Quick Upload GPE Modal */}
      {uploadModalOpen && createPortal(
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <form onSubmit={handleUploadSubmit} className="card max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600 my-8">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-dark-700">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">Upload New GPE Exercise</h3>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uploadError && (
              <p className="text-red-500 text-xs font-semibold">{uploadError}</p>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Date Batch Folder</label>
                  <input
                    type="date"
                    value={uploadFolder}
                    onChange={e => setUploadFolder(e.target.value)}
                    required
                    className="input py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="label">Map Scale</label>
                  <input
                    type="text"
                    value={scaleInput}
                    onChange={e => setScaleInput(e.target.value)}
                    placeholder="1 cm = 2 km"
                    className="input py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="label">GPE Exercise Title</label>
                <input
                  type="text"
                  value={titleInput}
                  onChange={e => setTitleInput(e.target.value)}
                  placeholder="e.g. GPE Set 1 - Forest Patrol / River Rescue"
                  className="input py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="label">GPE Map Image (Required)</label>
                <input
                  type="file"
                  accept="image/*"
                  required
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setMapFile(f);
                    if (f) {
                      if (mapPreview) URL.revokeObjectURL(mapPreview);
                      setMapPreview(URL.createObjectURL(f));
                      if (!titleInput) setTitleInput(f.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
                    }
                  }}
                  className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-950/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
                />
                {mapPreview && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 dark:border-dark-700 max-h-40 bg-black/40 flex items-center justify-center p-1">
                    <img src={mapPreview} alt="" className="max-h-36 w-auto object-contain" />
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
                      onClick={() => setNarrativeTab('text')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        narrativeTab === 'text' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      Paste Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setNarrativeTab('image')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        narrativeTab === 'image' ? 'bg-blue-600 text-white font-bold' : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      Upload Card Image
                    </button>
                  </div>
                </div>

                {narrativeTab === 'image' ? (
                  <div className="space-y-2 pt-1">
                    <input
                      ref={narrativeFileRef}
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setNarrativeFile(f);
                        if (f) {
                          if (narrativePreview) URL.revokeObjectURL(narrativePreview);
                          setNarrativePreview(URL.createObjectURL(f));
                        }
                      }}
                      className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-950/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
                    />
                    {narrativePreview && (
                      <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-dark-700 max-h-40 bg-black/40 flex items-center justify-center">
                        <img src={narrativePreview} alt="" className="max-h-36 w-auto object-contain" />
                        <button
                          type="button"
                          onClick={() => {
                            setNarrativeFile(null);
                            if (narrativePreview) URL.revokeObjectURL(narrativePreview);
                            setNarrativePreview(null);
                            if (narrativeFileRef.current) narrativeFileRef.current.value = '';
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
                    value={descInput}
                    onChange={e => setDescInput(e.target.value)}
                    placeholder="Paste or write the full GTO narrative story, tasks, and constraints..."
                    className="input font-sans text-xs leading-relaxed resize-y scrollbar-thin"
                  />
                )}
              </div>

              <div>
                <label className="label">Model Solution (Optional)</label>
                <textarea
                  rows={2}
                  value={modelSolInput}
                  onChange={e => setModelSolInput(e.target.value)}
                  placeholder="Optional model solution points for review..."
                  className="input font-mono text-xs leading-relaxed resize-y scrollbar-thin"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-dark-700">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="btn-secondary py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUploading || !mapFile || (!descInput.trim() && !narrativeFile)}
                className="btn-primary bg-blue-600 hover:bg-blue-500 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploading ? 'Uploading...' : 'Upload GPE'}</span>
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

    </div>
  );
}
