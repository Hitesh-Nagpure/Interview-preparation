import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, Upload, Trash2, Eye, Edit3, Search, X,
  Calendar, CheckCircle2, AlertCircle, Check, Download, RefreshCw
} from 'lucide-react';
import PdfViewerModal from './PdfViewerModal';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const TEST_TYPE_COLORS = {
  TAT: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
  WAT: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
  SRT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  SDT: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  GENERAL: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
};

export default function SolutionsView({ folders, onRefresh }) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  // Upload modal state
  const [uploadModal, setUploadModal] = useState(null); // { dateFolder }
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDate, setPdfDate] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfTestType, setPdfTestType] = useState('TAT');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [toast, setToast] = useState(null);

  // Viewer/editor state
  const [activeSolution, setActiveSolution] = useState(null); // { solution, dateFolder }

  // Aggregate all solutions across folders
  const allSolutions = folders.flatMap(f =>
    (f.solutions || []).map(sol => ({ ...sol, dateFolder: f.dateFolder, folderTitle: f.folderTitle }))
  );

  const filtered = allSolutions.filter(sol => {
    const q = search.toLowerCase();
    const matchSearch =
      (sol.title || '').toLowerCase().includes(q) ||
      (sol.solutionDate || '').includes(q) ||
      (sol.dateFolder || '').includes(q) ||
      (sol.testType || '').toLowerCase().includes(q);
    const matchType = filterType === 'ALL' || sol.testType === filterType;
    return matchSearch && matchType;
  });

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const openUploadModal = () => {
    const today = new Date().toISOString().split('T')[0];
    const latestFolder = folders[0]?.dateFolder || today;
    setUploadModal({ dateFolder: latestFolder });
    setPdfDate(latestFolder);
    setPdfTitle(latestFolder);
    setPdfFile(null);
    setPdfTestType('TAT');
    setUploadError(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!pdfFile || !uploadModal) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const chosenDate = pdfDate || uploadModal.dateFolder;
      fd.append('solutionDate', chosenDate);
      fd.append('title', pdfTitle || chosenDate);
      fd.append('testType', pdfTestType);

      const res = await fetch(`/api/folders/${encodeURIComponent(uploadModal.dateFolder)}/solutions`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUploadModal(null);
      setPdfFile(null);
      showToast('success', 'Solution PDF uploaded successfully.');
      if (onRefresh) onRefresh();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (dateFolder, solutionId, title) => {
    if (!window.confirm(`Delete solution "${title}"?`)) return;
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solutionId)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Delete failed');
      if (activeSolution?.solution?.id === solutionId) setActiveSolution(null);
      showToast('success', 'Solution deleted.');
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const handleUpdate = (updatedSolution, updatedFolder) => {
    showToast('success', 'Solution updated.');
    if (onRefresh) onRefresh();
    if (activeSolution) {
      setActiveSolution({ ...activeSolution, solution: updatedSolution });
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">

      {/* Toast */}
      {toast && createPortal(
        <div className={`fixed bottom-6 right-6 z-[200] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold border animate-fadeIn ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {toast.text}
        </div>,
        document.body
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-dark-700 pb-4">
        <div>
          <span className="text-sm font-black px-2.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 uppercase tracking-widest font-mono">
            SOLUTIONS
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white mt-1">
            Solution PDFs
          </h1>
          <p className="text-xs text-slate-400">
            Upload and manage handwritten solution PDFs for TAT, WAT, SRT and other tests.
          </p>
        </div>
        <button
          onClick={openUploadModal}
          className="btn-primary flex items-center gap-1.5 shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload PDF
        </button>
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, date, type..."
            className="input pl-8 w-full"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {['ALL', 'TAT', 'WAT', 'SRT', 'SDT', 'GENERAL'].map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold font-mono border transition-colors ${
                filterType === type
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-100 dark:bg-dark-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-dark-600 hover:border-indigo-400'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="text-[11px] font-mono text-slate-400 shrink-0">
          {filtered.length} / {allSolutions.length} PDFs
        </div>
      </div>

      {/* Solutions grid */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
          <p className="text-sm text-slate-400">
            {allSolutions.length === 0
              ? 'No solution PDFs yet. Upload your first handwritten solution.'
              : 'No results match your search or filter.'}
          </p>
          {allSolutions.length === 0 && (
            <button onClick={openUploadModal} className="btn-primary inline-flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Upload PDF
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(sol => (
            <div
              key={sol.id + sol.dateFolder}
              className="card p-3.5 space-y-2.5 hover:border-emerald-400/50 transition-colors group"
            >
              {/* Top: icon + type badge */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 border border-emerald-500/20">
                    <FileText className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate" title={sol.title || sol.solutionDate}>
                      {sol.title || sol.solutionDate || 'Solution'}
                    </p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Calendar className="w-2.5 h-2.5 inline shrink-0" />
                      {sol.solutionDate}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase font-mono border shrink-0 ${TEST_TYPE_COLORS[sol.testType] || TEST_TYPE_COLORS.GENERAL}`}>
                  {sol.testType}
                </span>
              </div>

              {/* Folder + size info */}
              <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 dark:border-dark-700 pt-2">
                <span className="font-mono truncate">{sol.dateFolder}{sol.folderTitle ? ` · ${sol.folderTitle}` : ''}</span>
                {sol.size ? <span>{formatBytes(sol.size)}</span> : null}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  onClick={() => setActiveSolution({ solution: sol, dateFolder: sol.dateFolder })}
                  className="flex-1 btn-secondary text-[11px] py-1 flex items-center justify-center gap-1"
                  title="View PDF"
                >
                  <Eye className="w-3 h-3" /> View
                </button>
                <button
                  onClick={() => setActiveSolution({ solution: sol, dateFolder: sol.dateFolder })}
                  className="p-1.5 rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                  title="Edit"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <a
                  href={sol.url && sol.url.startsWith('/api') ? `${sol.url}?download=true` : `/api/folders/${encodeURIComponent(sol.dateFolder)}/solutions/${encodeURIComponent(sol.id)}/file?download=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={sol.originalName || `${sol.title || 'solution'}.pdf`}
                  className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => handleDelete(sol.dateFolder, sol.id, sol.title || sol.solutionDate)}
                  className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {uploadModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-dark-900 border border-slate-200 dark:border-dark-600 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-dark-700 flex items-center justify-between bg-slate-50 dark:bg-dark-800">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-bold text-slate-800 dark:text-white">Upload Solution PDF</span>
              </div>
              <button onClick={() => setUploadModal(null)} className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="p-4 space-y-3">
              {/* Folder selector */}
              <div>
                <label className="label">Save to Batch Folder</label>
                <select
                  value={uploadModal.dateFolder}
                  onChange={e => setUploadModal({ dateFolder: e.target.value })}
                  className="input bg-white dark:bg-dark-800"
                >
                  {folders.map(f => (
                    <option key={f.dateFolder} value={f.dateFolder}>
                      {f.dateFolder}{f.folderTitle ? ` — ${f.folderTitle}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Solution date (title) */}
              <div>
                <label className="label">Solution Date <span className="text-slate-400 font-normal">(used as title)</span></label>
                <input
                  type="date"
                  value={pdfDate}
                  onChange={e => { setPdfDate(e.target.value); setPdfTitle(e.target.value); }}
                  required
                  className="input"
                />
              </div>

              {/* Test type */}
              <div>
                <label className="label">Test Type</label>
                <div className="flex flex-wrap gap-1.5">
                  {['TAT', 'WAT', 'SRT', 'SDT', 'GENERAL'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPdfTestType(type)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold font-mono border transition-colors ${
                        pdfTestType === type
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-100 dark:bg-dark-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-dark-600 hover:border-indigo-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* File picker */}
              <div>
                <label className="label">PDF File</label>
                <label className={`flex items-center gap-2 cursor-pointer border-2 border-dashed rounded-lg p-3 transition-colors text-xs ${
                  pdfFile
                    ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-300 dark:border-dark-600 text-slate-400 hover:border-indigo-400'
                }`}>
                  <FileText className={`w-4 h-4 shrink-0 ${pdfFile ? 'text-emerald-500' : ''}`} />
                  <span className="truncate">{pdfFile ? pdfFile.name : 'Click to choose a PDF file'}</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={e => setPdfFile(e.target.files?.[0] || null)}
                    required
                  />
                </label>
              </div>

              {uploadError && (
                <p className="text-red-500 text-[11px] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" /> {uploadError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setUploadModal(null)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !pdfFile}
                  className="flex-1 btn-primary flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {uploading ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload className="w-3 h-3" /> Upload</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* PDF Viewer/Editor Modal */}
      {activeSolution && (
        <PdfViewerModal
          solution={activeSolution.solution}
          dateFolder={activeSolution.dateFolder}
          onClose={() => setActiveSolution(null)}
          onUpdate={handleUpdate}
          onDelete={(id) => {
            handleDelete(activeSolution.dateFolder, id, activeSolution.solution.title || activeSolution.solution.solutionDate);
            setActiveSolution(null);
          }}
        />
      )}
    </div>
  );
}
