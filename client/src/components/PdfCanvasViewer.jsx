import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  RefreshCw, AlertCircle, ExternalLink, Download, Columns, Smartphone
} from 'lucide-react';

// Configure the worker to use CDN matching pdfjs-dist version 3.11.174
if (typeof window !== 'undefined' && pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

export default function PdfCanvasViewer({ url, title = 'PDF Document', downloadUrl, onSwitchNative }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [renderLoading, setRenderLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fitMode, setFitMode] = useState('auto'); // 'auto' | 'width' | 'custom'

  // Load the PDF document
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setCurrentPage(1);

    const loadingTask = pdfjsLib.getDocument({
      url,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true
    });

    loadingTask.promise
      .then((doc) => {
        if (!isCancelled) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('PDF.js loading error:', err);
          setError(err.message || 'Failed to parse PDF document.');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      try {
        loadingTask.destroy();
      } catch (_) {}
    };
  }, [url]);

  // Render the current page onto canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    let isCancelled = false;
    setRenderLoading(true);

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(currentPage).then((page) => {
      if (isCancelled) return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth - 32; // padding
      const unscaledViewport = page.getViewport({ scale: 1 });

      let calculatedScale = scale;
      if (fitMode === 'auto' || fitMode === 'width') {
        if (containerWidth > 0 && unscaledViewport.width > 0) {
          calculatedScale = Math.min(2.5, Math.max(0.6, containerWidth / unscaledViewport.width));
        }
      }

      // Calculate pixel ratio for crisp retina/mobile display
      const pixelRatio = Math.max(window.devicePixelRatio || 1, 1.5);
      const viewport = page.getViewport({ scale: calculatedScale * pixelRatio });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / pixelRatio}px`;
      canvas.style.height = `${viewport.height / pixelRatio}px`;

      const renderContext = {
        canvasContext: ctx,
        viewport
      };

      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;

      renderTask.promise
        .then(() => {
          if (!isCancelled) {
            setRenderLoading(false);
            renderTaskRef.current = null;
          }
        })
        .catch((err) => {
          if (err.name !== 'RenderingCancelledException') {
            console.warn('Page render error:', err);
          }
          if (!isCancelled) setRenderLoading(false);
        });
    });

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, currentPage, scale, fitMode]);

  const handleNextPage = () => {
    if (currentPage < numPages) setCurrentPage(p => p + 1);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(p => p - 1);
  };

  const handleZoomIn = () => {
    setFitMode('custom');
    setScale(s => Math.min(3.0, parseFloat((s + 0.2).toFixed(1))));
  };

  const handleZoomOut = () => {
    setFitMode('custom');
    setScale(s => Math.max(0.5, parseFloat((s - 0.2).toFixed(1))));
  };

  const handleFitWidth = () => {
    setFitMode('width');
    setScale(1.0);
  };

  const handleOpenExternal = () => {
    window.open(url, '_blank');
  };

  // Error Fallback
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-900 text-white">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4 shadow-lg">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h4 className="text-base font-bold text-white mb-1">Could not render in-canvas</h4>
        <p className="text-xs text-slate-400 max-w-sm mb-5 leading-relaxed">
          {error}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={handleOpenExternal}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-xs font-semibold shadow-lg"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Open in Device Viewer</span>
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-xs"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </a>
          )}
          {onSwitchNative && (
            <button
              onClick={onSwitchNative}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-xs"
            >
              <span>Try Native Frame</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="px-3 sm:px-4 py-2 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between text-xs text-white shrink-0 flex-wrap gap-2">
        {/* Page Nav */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || loading}
            className="p-1 sm:p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1 font-mono text-[11px] sm:text-xs text-slate-300 px-1">
            <span>Page</span>
            <span className="font-bold text-white">{currentPage}</span>
            <span>of</span>
            <span className="font-bold text-indigo-400">{numPages || '...'}</span>
          </div>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={currentPage >= numPages || loading}
            className="p-1 sm:p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Zoom & Fit Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={loading}
            className="p-1 sm:p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[11px] text-slate-400 w-12 text-center">
            {fitMode === 'width' ? 'Fit' : `${Math.round(scale * 100)}%`}
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={loading}
            className="p-1 sm:p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitWidth}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] sm:text-[11px] font-medium text-indigo-300"
            title="Fit to Width"
          >
            Fit
          </button>
        </div>

        {/* Direct Device Viewer Button */}
        <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
          <button
            type="button"
            onClick={handleOpenExternal}
            className="px-2 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm transition-colors"
            title="Open in Device Viewer / New Tab"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden sm:inline">Open in New Tab</span>
            <span className="sm:hidden">Open</span>
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-2 sm:p-4 flex items-center justify-center relative bg-slate-900/60"
      >
        {/* Loading Spinner */}
        {(loading || renderLoading) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-xs pointer-events-none">
            <div className="w-10 h-10 rounded-full border-3 border-slate-700 border-t-indigo-500 animate-spin" />
            <p className="text-xs text-indigo-300 font-medium">
              {loading ? 'Opening PDF...' : `Rendering Page ${currentPage}...`}
            </p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="shadow-2xl rounded-sm bg-white mx-auto transition-transform duration-100"
        />
      </div>

      {/* Bottom Page Bar for Mobile Swipe / Quick Select */}
      {numPages > 1 && (
        <div className="px-3 py-1 bg-slate-900 border-t border-slate-800/80 flex items-center justify-center gap-1 overflow-x-auto text-[10px] text-slate-400 shrink-0">
          {Array.from({ length: Math.min(numPages, 12) }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setCurrentPage(p)}
              className={`w-5 h-5 rounded font-mono font-bold flex items-center justify-center transition-colors ${
                currentPage === p
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300'
              }`}
            >
              {p}
            </button>
          ))}
          {numPages > 12 && (
            <span className="text-[10px] font-mono text-slate-500 ml-1">
              +{numPages - 12} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
