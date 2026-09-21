import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Download, Trash2, Edit3, Check, FileText, Upload,
  Calendar, RefreshCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Eye, Image as ImageIcon
} from 'lucide-react';

export default function PdfViewerModal({
  solution,
  dateFolder,
  onClose,
  onUpdate,
  onDelete
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [solutionDate, setSolutionDate] = useState(solution.solutionDate || dateFolder || '');
  const [title, setTitle] = useState(solution.title || solution.solutionDate || '');
  const [testType, setTestType] = useState(solution.testType || 'TAT');
  const [replacementFile, setReplacementFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // View mode: 'pdf' (iframe) or 'images' (pages)
  const [viewMode, setViewMode] = useState('pdf');
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [loadingPages, setLoadingPages] = useState(false);

  if (!solution) return null;

  // Reliable server stream URL that avoids Cloudinary 401 ACL failure
  const fileUrl = solution.url && solution.url.startsWith('/api')
    ? solution.url
    : `/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solution.id)}/file`;
  const downloadUrl = `${fileUrl}?download=true`;

  useEffect(() => {
    // Check if Cloudinary page images are available
    fetch(`/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solution.id)}/pages`)
      .then(r => r.json())
      .then(d => {
        if (d.pages && d.pages.length > 0) {
          setPages(d.pages);
        }
      })
      .catch(() => {});
  }, [dateFolder, solution.id]);

  const handleDateChange = (newDate) => {
    setSolutionDate(newDate);
    if (!title || title === solutionDate) {
      setTitle(newDate);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('solutionDate', solutionDate);
      fd.append('title', title || solutionDate);
      fd.append('testType', testType);
      if (replacementFile) {
        fd.append('file', replacementFile);
      }

      const res = await fetch(`/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solution.id)}`, {
        method: 'PUT',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update solution');
      setIsEditing(false);
      setReplacementFile(null);
      if (onUpdate) onUpdate(data.solution, data.folder);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete this solution PDF (${title || solutionDate})?`)) {
      onDelete(solution.id);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-dark-900 border border-slate-200 dark:border-dark-600 rounded-xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Top Bar */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-dark-700 flex items-center justify-between gap-3 bg-slate-50 dark:bg-dark-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
              solution.testType === 'TAT'
                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                : solution.testType === 'WAT'
                ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30'
                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
            }`}>
              {solution.testType}
            </span>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-white truncate">
                {title || solutionDate || 'Solution PDF'}
              </h3>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 inline" /> {solutionDate} · {solution.originalName || 'solution.pdf'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* View Mode Toggle (if pages available) */}
            {pages.length > 0 && (
              <div className="flex items-center bg-slate-200 dark:bg-dark-700 rounded p-0.5 text-xs">
                <button
                  onClick={() => setViewMode('pdf')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    viewMode === 'pdf'
                      ? 'bg-white dark:bg-dark-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                  title="View as embedded PDF"
                >
                  PDF
                </button>
                <button
                  onClick={() => setViewMode('images')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    viewMode === 'images'
                      ? 'bg-white dark:bg-dark-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                  title="View pages as high-resolution images"
                >
                  Pages ({pages.length})
                </button>
              </div>
            )}

            {/* Edit Button */}
            <button
              onClick={() => setIsEditing(v => !v)}
              className={`p-1.5 rounded transition-colors ${
                isEditing
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-dark-700'
              }`}
              title="Edit solution details or replace PDF"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

            {/* Direct Download Button via Backend Streaming */}
            <a
              href={downloadUrl}
              download={solution.originalName || `${title || 'solution'}.pdf`}
              className="p-1.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
              title="Download PDF directly"
            >
              <Download className="w-3.5 h-3.5" />
            </a>

            {/* Delete Button */}
            <button
              onClick={handleDelete}
              className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              title="Delete PDF"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edit Panel Drawer */}
        {isEditing && (
          <form onSubmit={handleSave} className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/40 grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end text-xs shrink-0">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Solution Date (Title)
              </label>
              <input
                type="date"
                value={solutionDate}
                onChange={e => handleDateChange(e.target.value)}
                required
                className="input py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Custom Label (optional)
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. TAT Set 1 Solutions"
                className="input py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Test Type
              </label>
              <select
                value={testType}
                onChange={e => setTestType(e.target.value)}
                className="input py-1 text-xs bg-white dark:bg-dark-800"
              >
                <option value="TAT">TAT</option>
                <option value="WAT">WAT</option>
                <option value="GENERAL">General</option>
                <option value="SRT">SRT</option>
                <option value="SDT">SDT</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <label className="flex-1 btn-secondary flex items-center justify-center gap-1 cursor-pointer truncate">
                <Upload className="w-3 h-3 shrink-0" />
                <span className="truncate">{replacementFile ? replacementFile.name : 'Replace PDF'}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setReplacementFile(f);
                    if (f) {
                      setTitle(f.name.replace(/\.[^/.]+$/, ''));
                    }
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex items-center justify-center gap-1"
              >
                <Check className="w-3 h-3" />
                <span>{saving ? 'Saving...' : 'Save'}</span>
              </button>
            </div>
            {error && (
              <p className="col-span-full text-red-500 text-[11px] font-medium">{error}</p>
            )}
          </form>
        )}

        {/* Content Viewer Area */}
        <div className="flex-1 w-full h-full bg-slate-900 relative overflow-hidden flex flex-col">
          {viewMode === 'pdf' ? (
            /* Streamed PDF Frame */
            <div className="w-full h-full flex flex-col relative">
              <iframe
                src={`${fileUrl}#toolbar=1&navpanes=0`}
                title={`Solution: ${title || solutionDate}`}
                className="w-full h-full border-none bg-slate-100 dark:bg-dark-950"
              />
            </div>
          ) : (
            /* High-Res Pages Viewer */
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
              {/* Pages Controls Bar */}
              <div className="px-4 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-white shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs">
                    Page {currentPage} of {pages.length}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(pages.length, p + 1))}
                    disabled={currentPage === pages.length}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setZoom(z => Math.max(50, z - 20))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs text-slate-400 w-10 text-center">{zoom}%</span>
                  <button
                    onClick={() => setZoom(z => Math.min(250, z + 20))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setZoom(100)}
                    className="text-[10px] text-indigo-400 hover:underline px-1"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Page Image Container */}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                {pages[currentPage - 1] && (
                  <img
                    src={pages[currentPage - 1]}
                    alt={`Page ${currentPage}`}
                    style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }}
                    className="shadow-2xl rounded object-contain transition-all duration-150 select-none bg-white"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
