import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, RotateCcw, X, FileText, Compass, Move } from 'lucide-react';

export default function PanZoomModal({
  isOpen,
  onClose,
  imageUrl,
  title = 'Image Viewer',
  subtitle = '',
  badgeIcon: BadgeIcon = FileText
}) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPos, setPanPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);

  // Reset zoom and pan when image changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setZoomLevel(1);
      setPanPos({ x: 0, y: 0 });
      dragMovedRef.current = false;
    }
  }, [isOpen, imageUrl]);

  // Keyboard controls: Esc to close, +/- to zoom, 0 to reset
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel(z => Math.min(Number((z + 0.25).toFixed(2)), 5));
      } else if (e.key === '-' || e.key === '_') {
        setZoomLevel(z => Math.max(Number((z - 0.25).toFixed(2)), 0.5));
      } else if (e.key === '0' || e.key === 'r' || e.key === 'R') {
        setZoomLevel(1);
        setPanPos({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only left mouse click
    setIsDragging(true);
    dragMovedRef.current = false;
    dragStartRef.current = {
      x: e.clientX - panPos.x,
      y: e.clientY - panPos.y
    };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStartRef.current.x;
    const newY = e.clientY - dragStartRef.current.y;
    if (Math.abs(newX - panPos.x) > 3 || Math.abs(newY - panPos.y) > 3) {
      dragMovedRef.current = true;
    }
    setPanPos({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoomLevel(prev => {
      const next = prev * zoomFactor;
      return Math.min(Math.max(Number(next.toFixed(2)), 0.5), 5);
    });
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (zoomLevel > 1.05) {
      setZoomLevel(1);
      setPanPos({ x: 0, y: 0 });
    } else {
      setZoomLevel(2);
    }
  };

  const resetZoom = (e) => {
    e?.stopPropagation();
    setZoomLevel(1);
    setPanPos({ x: 0, y: 0 });
  };

  // Close when clicking directly on backdrop without having dragged
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !dragMovedRef.current) {
      onClose();
    }
  };

  // Touch support for mobile devices
  const touchStartRef = useRef({ x: 0, y: 0 });
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragMovedRef.current = false;
      touchStartRef.current = {
        x: e.touches[0].clientX - panPos.x,
        y: e.touches[0].clientY - panPos.y
      };
    }
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    const newX = e.touches[0].clientX - touchStartRef.current.x;
    const newY = e.touches[0].clientY - touchStartRef.current.y;
    if (Math.abs(newX - panPos.x) > 3 || Math.abs(newY - panPos.y) > 3) {
      dragMovedRef.current = true;
    }
    setPanPos({ x: newX, y: newY });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return createPortal(
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[120] bg-black/95 flex flex-col items-center justify-between p-3 select-none overflow-hidden"
    >
      {/* Top Floating Control Bar */}
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-slate-900/90 border border-slate-700/80 backdrop-blur-md text-white shadow-2xl z-10 shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          {BadgeIcon && <BadgeIcon className="w-4 h-4 text-purple-400 shrink-0" />}
          <span className="font-bold text-xs truncate">{title}</span>
          {subtitle && (
            <span className="text-slate-400 text-[11px] font-mono shrink-0 hidden sm:inline">
              ({subtitle})
            </span>
          )}
        </div>

        {/* Pan & Zoom Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoomLevel(z => Math.max(Number((z - 0.25).toFixed(2)), 0.5))}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span
            className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono font-semibold text-slate-200 min-w-[50px] text-center"
            title="Current Zoom"
          >
            {Math.round(zoomLevel * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setZoomLevel(z => Math.min(Number((z + 0.25).toFixed(2)), 5))}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {/* Reset Zoom Button */}
          <button
            type="button"
            onClick={resetZoom}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              zoomLevel !== 1 || panPos.x !== 0 || panPos.y !== 0
                ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-sm ring-1 ring-purple-400/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
            title="Reset Zoom to 100% & Center Position"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <div className="w-px h-4 bg-slate-700 mx-1" />

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-red-500/20 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`w-full flex-1 flex items-center justify-center p-2 overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="Scroll mouse wheel to zoom. Click and drag to pan. Double-click to toggle 2x zoom."
      >
        <div
          style={{
            transform: `translate(${panPos.x}px, ${panPos.y}px) scale(${zoomLevel})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.08s ease-out'
          }}
          className="max-w-full max-h-full flex items-center justify-center pointer-events-none"
        >
          <img
            src={imageUrl}
            alt={title}
            className="max-h-[82vh] max-w-full object-contain pointer-events-none select-none rounded-xl shadow-2xl border border-slate-800"
            draggable={false}
          />
        </div>
      </div>

      {/* Footer Navigation Tip */}
      <div
        onClick={e => e.stopPropagation()}
        className="text-center text-[11px] text-slate-400 pb-1 font-mono flex items-center justify-center gap-3 shrink-0"
      >
        <span className="flex items-center gap-1">
          <Move className="w-3 h-3 text-purple-400" />
          <span>Drag to pan</span>
        </span>
        <span>·</span>
        <span>Scroll wheel to zoom</span>
        <span>·</span>
        <span>Double-click to toggle 2x</span>
        <span>·</span>
        <span>Esc to close</span>
      </div>
    </div>,
    document.body
  );
}
