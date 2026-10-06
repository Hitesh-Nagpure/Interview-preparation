import React, { useState, useEffect, useRef } from 'react';
import {
  Compass, Map, FileText, ArrowLeft, ArrowRight, CheckCircle2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Check, Download,
  AlertCircle, Eye, Sun, Moon, Camera, Upload, Trash2, RotateCcw,
  Image as ImageIcon, ChevronDown, ChevronUp, User, Sparkles, Move,
  Columns
} from 'lucide-react';
import { soundEngine } from '../utils/audio';
import {
  apiUrl,
  resolveGpeMapUrl,
  resolveGpeMapSources,
  resolveGpeNarrativeUrl,
  resolveGpeNarrativeSources,
  resolveGpeSolutionUrl,
  isCloudinaryPublicId
} from '../utils/api';
import PanZoomModal from './PanZoomModal';

export default function GpeSimulator({
  gpeId,
  dateFolder,
  initialGpe,
  onExit,
  isDark,
  toggleTheme
}) {
  // Data state
  const [loading, setLoading] = useState(!initialGpe);
  const [error, setError] = useState(null);
  const [gpe, setGpe] = useState(initialGpe || null);

  // Phases:
  // 'BRIEFING'   -> Stage 1: Map and Narrative shown for UNLIMITED time (candidate reads at own pace)
  // 'OBSERVE'    -> Stage 2: Narrative shown alongside Map for EXACT 5 MINUTES (Silent timer, NO timer on screen)
  // 'WRITE'      -> Stage 3: Writing period on paper for EXACT 10 MINUTES (Silent timer, NO digital textarea, NO timer on screen)
  // 'COMPLETED'  -> Stage 4: Test finished, upload photo of handwritten solution sheet to Cloudinary
  const [phase, setPhase] = useState('BRIEFING');

  // Background silent timers (NO display on screen)
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [isRunning, setIsRunning] = useState(false);
  const [warningBellRung, setWarningBellRung] = useState(false);

  // Narrative view toggle if both text and image are available: 'image' | 'text'
  const [narrativeTab, setNarrativeTab] = useState(() => {
    if (initialGpe) {
      const hasImg = Boolean(
        initialGpe.narrativeB2Key ||
        initialGpe.narrativeImageUrl ||
        (initialGpe.narrativePublicId && isCloudinaryPublicId(initialGpe.narrativePublicId))
      );
      if (hasImg) return 'image';
    }
    return 'image';
  });

  // Workspace layout view: 'split' (side-by-side) | 'map' (full map) | 'narrative' (full narrative card)
  const [workspaceView, setWorkspaceView] = useState('split');

  // Completed Phase 4 tab: 'upload' | 'narrative'
  const [completedTab, setCompletedTab] = useState('upload');

  // Map mouse zoom and pan controls
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPos, setPanPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Photo solution upload state (Cloudinary)
  const [solutionPhotoFile, setSolutionPhotoFile] = useState(null);
  const [solutionPhotoPreview, setSolutionPhotoPreview] = useState(null);
  const [candidateAuthor, setCandidateAuthor] = useState(() => {
    try {
      return localStorage.getItem('ssb_candidate_author') || 'Candidate';
    } catch {
      return 'Candidate';
    }
  });
  const [candidateNotes, setCandidateNotes] = useState('');
  const [isUploadingSolution, setIsUploadingSolution] = useState(false);
  const [uploadSuccessToast, setUploadSuccessToast] = useState(false);
  const [solutionUploadError, setSolutionUploadError] = useState(null);
  const [inspectImage, setInspectImage] = useState(null); // { url, title }
  const [activeCanvasView, setActiveCanvasView] = useState('map'); // 'map' | 'solution'
  const [selectedSolutionForCanvas, setSelectedSolutionForCanvas] = useState(null);
  const photoInputRef = useRef(null);

  // Fullscreen
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fallback candidate URL tracking on error
  const handleMapImageError = (e) => {
    if (!gpe) return;
    const sources = resolveGpeMapSources(gpe);
    const currentIndex = parseInt(e.target.dataset.attemptIndex || '0', 10);
    const nextIndex = currentIndex + 1;
    if (nextIndex < sources.length) {
      e.target.dataset.attemptIndex = String(nextIndex);
      e.target.src = sources[nextIndex];
    }
  };

  const handleNarrativeImageError = (e) => {
    if (!gpe) return;
    const sources = resolveGpeNarrativeSources(gpe);
    const currentIndex = parseInt(e.target.dataset.attemptIndex || '0', 10);
    const nextIndex = currentIndex + 1;
    if (nextIndex < sources.length) {
      e.target.dataset.attemptIndex = String(nextIndex);
      e.target.src = sources[nextIndex];
    }
  };

  // Fetch GPE data
  useEffect(() => {
    let isMounted = true;
    if (!dateFolder) return;

    fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}`))
      .then(res => {
        if (!res.ok) throw new Error('Could not load batch data');
        return res.json();
      })
      .then(data => {
        if (!isMounted) return;
        const gpes = data.gpes || [];
        const found = gpeId ? gpes.find(g => g.id === gpeId || g._id === gpeId) : (gpes[0] || initialGpe);
        if (!found && !initialGpe) {
          setError('No Group Planning Exercise found in this batch.');
        } else if (found) {
          setGpe(found);
          const hasImg = Boolean(
            found.narrativeB2Key ||
            found.narrativeImageUrl ||
            (found.narrativePublicId && isCloudinaryPublicId(found.narrativePublicId))
          );
          if (hasImg) {
            setNarrativeTab('image');
          } else {
            setNarrativeTab('text');
          }
        }
        setLoading(false);
      })
      .catch(err => {
        if (!isMounted) return;
        if (!initialGpe) {
          setError(err.message);
        }
        setLoading(false);
      });

    return () => { isMounted = false; };
  }, [dateFolder, gpeId, initialGpe]);

  // Handle browser back button to exit
  useEffect(() => {
    const handlePop = () => { if (onExit) onExit(); };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [onExit]);

  // Transition from Stage 1 (Unlimited) to Stage 2 (5-Minute Study)
  const startFiveMinuteObservation = () => {
    soundEngine.init();
    soundEngine.playTransitionChime();
    setPhase('OBSERVE');
    setTimeLeft(300); // 5 minutes = 300 seconds
    setIsRunning(true);
    setWarningBellRung(false);
    setActiveWorkspaceView('map');
  };

  // Transition from Stage 2 to Stage 3 (10-Minute Writing on Paper)
  const startTenMinuteWriting = () => {
    soundEngine.init();
    soundEngine.playTransitionChime();
    setPhase('WRITE');
    setTimeLeft(600); // 10 minutes = 600 seconds
    setIsRunning(true);
    setWarningBellRung(false);
    setActiveWorkspaceView('map');
  };

  // Finish writing and move to Phase 4 (Upload Solution Photo)
  const finishWritingPeriod = () => {
    soundEngine.init();
    soundEngine.playDoubleBell();
    setIsRunning(false);
    setPhase('COMPLETED');
  };

  // Silent Background Countdown Timer (NO timer displayed on screen)
  useEffect(() => {
    if (!isRunning || phase === 'BRIEFING' || phase === 'COMPLETED') return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        // In Stage 3 (writing period): Warning bell at 1 minute remaining (60s)
        if (phase === 'WRITE' && prev === 61 && !warningBellRung) {
          soundEngine.playSingleBell();
          setWarningBellRung(true);
        }

        if (prev <= 1) {
          // Time expired for this phase
          if (phase === 'OBSERVE') {
            // 5 minutes are up! Sound single bell and transition to 10-minute writing period
            soundEngine.playSingleBell();
            startTenMinuteWriting();
            return 600;
          } else if (phase === 'WRITE') {
            // 10 minutes are up! Sound double bell and move to photo upload
            soundEngine.playDoubleBell();
            setIsRunning(false);
            setPhase('COMPLETED');
            return 0;
          }
          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, phase, warningBellRung]);

  // ── MOUSE CONTROLS FOR MAP PANNING & ZOOMING ──
  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only left mouse button
    setIsDragging(true);
    setDragStart({ x: e.clientX - panPos.x, y: e.clientY - panPos.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPanPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoomLevel(prev => {
      const next = prev * zoomFactor;
      return Math.min(Math.max(Number(next.toFixed(2)), 0.6), 5);
    });
  };

  const handleDoubleClick = (e) => {
    if (zoomLevel > 1.05) {
      setZoomLevel(1);
      setPanPos({ x: 0, y: 0 });
    } else {
      setZoomLevel(2);
    }
  };

  const resetMapZoom = () => {
    setZoomLevel(1);
    setPanPos({ x: 0, y: 0 });
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  // Solution Photo selection
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setSolutionPhotoFile(file);
      if (solutionPhotoPreview) URL.revokeObjectURL(solutionPhotoPreview);
      const previewUrl = URL.createObjectURL(file);
      setSolutionPhotoPreview(previewUrl);
      setSelectedSolutionForCanvas({ solutionImageUrl: previewUrl, author: candidateAuthor || 'Selected Photo' });
      setActiveCanvasView('solution');
      resetMapZoom();
      setSolutionUploadError(null);
    }
  };

  // Upload Solution Photo to Cloudinary & save to MongoDB
  const handleUploadSolutionPhoto = async (e) => {
    if (e) e.preventDefault();
    if (!solutionPhotoFile) {
      setSolutionUploadError('Please select or capture a photo of your paper solution sheet');
      return;
    }
    setIsUploadingSolution(true);
    setSolutionUploadError(null);
    try {
      const fd = new FormData();
      fd.append('solutionPhoto', solutionPhotoFile);
      fd.append('author', candidateAuthor.trim() || 'Candidate');
      fd.append('solutionText', candidateNotes.trim());

      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}/gpes/${gpe.id}/solutions`), {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload solution photo');

      setUploadSuccessToast(true);
      if (data.gpe) setGpe(data.gpe);
      if (data.solution) {
        setSelectedSolutionForCanvas(data.solution);
        setActiveCanvasView('solution');
        resetMapZoom();
      }
      setSolutionPhotoFile(null);
      if (solutionPhotoPreview) URL.revokeObjectURL(solutionPhotoPreview);
      setSolutionPhotoPreview(null);
      setCandidateNotes('');
      try {
        localStorage.setItem('ssb_candidate_author', candidateAuthor.trim());
      } catch {}
      setTimeout(() => setUploadSuccessToast(false), 4000);
    } catch (err) {
      setSolutionUploadError(err.message);
    } finally {
      setIsUploadingSolution(false);
    }
  };

  // Delete solution photo
  const handleDeleteSolutionPhoto = async (solId) => {
    if (!window.confirm('Delete this solution submission?')) return;
    try {
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(dateFolder)}/gpes/${gpe.id}/solutions/${encodeURIComponent(solId)}`), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete solution');
      if (data.gpe) setGpe(data.gpe);
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 transition-colors ${
        isDark ? 'bg-dark-950 text-white' : 'bg-slate-100 text-slate-800'
      }`}>
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-slate-400">Loading Group Planning Exercise...</p>
      </div>
    );
  }

  if (error || !gpe) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 text-center max-w-md mx-auto transition-colors ${
        isDark ? 'bg-dark-950 text-white' : 'bg-slate-100 text-slate-800'
      }`}>
        <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
        <h2 className="text-base font-bold mb-1">GPE Not Found</h2>
        <p className="text-xs text-slate-400 mb-4">{error || 'Exercise details unavailable.'}</p>
        <button onClick={onExit} className="btn-primary text-xs">
          <ArrowLeft className="w-3.5 h-3.5" /> Return
        </button>
      </div>
    );
  }

  const hasNarrativeImage = Boolean(gpe.narrativeImageUrl || gpe.narrativeB2Key || (gpe.narrativePublicId && isCloudinaryPublicId(gpe.narrativePublicId)));
  const hasNarrativeText = Boolean(gpe.description && gpe.description.trim());
  const solutionsList = gpe.solutions || [];

  return (
    <div
      ref={containerRef}
      className={`min-h-screen flex flex-col font-sans select-none overflow-hidden h-screen transition-colors duration-200 ${
        isDark ? 'bg-dark-950 text-slate-100' : 'bg-slate-100 text-slate-800'
      }`}
    >
      {/* ── Ultra-Simple Clean Header (NO TIMER DISPLAYED) ── */}
      <header className={`h-14 shrink-0 px-3 sm:px-5 flex items-center justify-between gap-3 z-30 border-b transition-colors ${
        isDark ? 'bg-dark-900 border-dark-700' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        {/* Left: Back & Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={onExit}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-dark-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Exit GPE"
          >
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="min-w-0">
            <h1 className={`text-xs sm:text-sm font-bold truncate max-w-[200px] sm:max-w-md ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}>
              {gpe.title}
            </h1>
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-400">
              Scale: <strong className={isDark ? 'text-slate-300' : 'text-slate-700'}>{gpe.scale || '1 cm = 2 km'}</strong>
            </span>
          </div>
        </div>

        {/* Center: Clean Phase Badge (NO TICKING NUMBERS / NO TIMER DISPLAYED) */}
        <div className="flex items-center gap-2">
          {phase === 'BRIEFING' && (
            <div className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 border ${
              isDark ? 'bg-dark-800 border-dark-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
            }`}>
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Phase 1: Briefing (Unlimited Time)</span>
            </div>
          )}

          {phase === 'OBSERVE' && (
            <div className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-[11px] font-semibold text-blue-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Phase 2: Individual Study</span>
            </div>
          )}

          {phase === 'WRITE' && (
            <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Phase 3: Writing Period (Write on Paper)</span>
            </div>
          )}

          {phase === 'COMPLETED' && (
            <div className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-purple-500" />
              <span>Phase 4: Upload Solution Photo</span>
            </div>
          )}
        </div>

        {/* Right: Layout Controls, Actions & Theme Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Workspace Layout Toggle: Split / Map / Narrative */}
          <div className={`hidden sm:flex items-center p-0.5 rounded-lg border text-xs mr-1 ${
            isDark ? 'bg-dark-800 border-dark-700' : 'bg-slate-100 border-slate-300'
          }`}>
            <button
              type="button"
              onClick={() => setWorkspaceView('split')}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1 transition-all ${
                workspaceView === 'split'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Side-by-side Split View (Map + Narrative)"
            >
              <Columns className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceView('map')}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1 transition-all ${
                workspaceView === 'map'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="View Map Model Only"
            >
              <Map className="w-3 h-3" />
              <span>Map</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceView('narrative')}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1 transition-all ${
                workspaceView === 'narrative'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="View Narrative Card Only"
            >
              <FileText className="w-3 h-3" />
              <span>Narrative</span>
            </button>
          </div>

          {/* Phase 1 Action: Start 5-min observation */}
          {phase === 'BRIEFING' && (
            <button
              onClick={startFiveMinuteObservation}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              title="Start 5-minute study period"
            >
              <span>Start 5m Study</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}

          {/* Phase 2 Action: Proceed to writing on paper early if ready */}
          {phase === 'OBSERVE' && (
            <button
              onClick={startTenMinuteWriting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg px-3 py-1.5 text-xs flex items-center gap-1 transition-colors"
              title="Proceed to 10-minute solution writing on paper"
            >
              <span>Start Writing (Paper)</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}

          {/* Phase 3 Action: Finish writing & upload photo early if ready */}
          {phase === 'WRITE' && (
            <button
              onClick={finishWritingPeriod}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              title="Finished writing on paper, proceed to upload photo"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Finish Writing & Upload Photo</span>
              <span className="sm:hidden">Upload Photo</span>
            </button>
          )}

          {/* User Preferred Theme Toggle Button */}
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark ? 'text-slate-400 hover:text-white hover:bg-dark-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-dark-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── Optional Notification Banner in Phase 3 ── */}
      {phase === 'WRITE' && (
        <div className={`px-4 py-1.5 text-xs font-medium border-b flex items-center justify-between gap-2 shrink-0 ${
          isDark ? 'bg-emerald-950/40 border-emerald-900/40 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className="flex items-center gap-2 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
            <span className="truncate">
              Writing period active. Write your individual solution plan on paper. Use mouse to zoom and pan the map model.
            </span>
          </div>
          <button
            onClick={finishWritingPeriod}
            className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline shrink-0 flex items-center gap-1"
          >
            <span>Done Writing? Upload Photo</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Main Workspace Body ── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

        {/* ── MAP / SOLUTION CANVAS (Interactive with Mouse Controls) ── */}
        {(() => {
          const currentSolution = selectedSolutionForCanvas || (solutionsList.length > 0 ? solutionsList[0] : null) || (solutionPhotoPreview ? { solutionImageUrl: solutionPhotoPreview, author: candidateAuthor || 'Selected Photo' } : null);
          const currentSolutionUrl = currentSolution ? resolveGpeSolutionUrl(currentSolution) : null;
          const isViewingSolution = activeCanvasView === 'solution' && Boolean(currentSolutionUrl);

          const isMapHidden = workspaceView === 'narrative';
          const isMapFull = workspaceView === 'map';

          return (
            <div
              className={`flex-col overflow-hidden relative border-r transition-colors ${
                isMapHidden ? 'hidden' : 'flex'
              } ${
                isDark ? 'bg-dark-950 border-dark-800' : 'bg-slate-200/60 border-slate-300'
              } ${
                isMapFull
                  ? 'flex-1 w-full'
                  : (phase === 'COMPLETED' ? 'flex-1 w-full md:w-1/2' : 'flex-1 w-full md:w-1/2 lg:w-3/5')
              }`}
            >
              {/* Canvas Mouse Controls Toolbar */}
              <div className={`absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border backdrop-blur-md shadow-md text-xs transition-colors ${
                isDark ? 'bg-dark-900/90 border-dark-700 text-slate-200' : 'bg-white/95 border-slate-200 text-slate-800'
              }`}>
                {phase === 'COMPLETED' && currentSolutionUrl ? (
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-dark-800 p-0.5 rounded-lg mr-1 border border-slate-200 dark:border-dark-700">
                    <button
                      type="button"
                      onClick={() => { setActiveCanvasView('map'); resetMapZoom(); }}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1 transition-all ${
                        !isViewingSolution
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                      title="View Map Model"
                    >
                      <Map className="w-3 h-3" />
                      <span>Map</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveCanvasView('solution'); resetMapZoom(); }}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1 transition-all ${
                        isViewingSolution
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400'
                      }`}
                      title="View Solution Plan (Pan & Zoom)"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Solution</span>
                    </button>
                  </div>
                ) : (
                  <span className="font-semibold text-[11px] mr-1 flex items-center gap-1 text-blue-500">
                    <Map className="w-3.5 h-3.5" />
                    <span>Map Model</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setZoomLevel(z => Math.min(Number((z + 0.25).toFixed(2)), 5))}
                  className={`p-1 rounded transition-colors ${
                    isDark ? 'hover:bg-dark-700 text-slate-300 hover:text-white' : 'hover:bg-slate-100 text-slate-700 hover:text-slate-900'
                  }`}
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setZoomLevel(z => Math.max(Number((z - 0.25).toFixed(2)), 0.6))}
                  className={`p-1 rounded transition-colors ${
                    isDark ? 'hover:bg-dark-700 text-slate-300 hover:text-white' : 'hover:bg-slate-100 text-slate-700 hover:text-slate-900'
                  }`}
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono select-none ${
                    isDark ? 'bg-dark-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                  }`}
                  title="Current Zoom Level"
                >
                  {Math.round(zoomLevel * 100)}%
                </span>

                {/* Dedicated Reset Button */}
                <button
                  type="button"
                  onClick={resetMapZoom}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                    zoomLevel !== 1 || panPos.x !== 0 || panPos.y !== 0
                      ? isViewingSolution
                        ? 'bg-purple-600 hover:bg-purple-500 text-white ring-2 ring-purple-400/30'
                        : 'bg-blue-600 hover:bg-blue-500 text-white ring-2 ring-blue-400/30'
                      : isDark
                        ? 'bg-dark-800 hover:bg-dark-700 text-slate-200 hover:text-white border border-dark-600'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-300'
                  }`}
                  title={`Reset ${isViewingSolution ? 'solution' : 'map'} zoom to 100% and center position`}
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${zoomLevel !== 1 || panPos.x !== 0 || panPos.y !== 0 ? 'text-white' : (isViewingSolution ? 'text-purple-400' : 'text-blue-500')}`} />
                  <span>Reset</span>
                </button>

                {/* Fullscreen Inspector Button */}
                <button
                  type="button"
                  onClick={() => setInspectImage({
                    url: isViewingSolution ? currentSolutionUrl : resolveGpeMapUrl(gpe),
                    title: isViewingSolution ? 'Candidate Solution Sheet' : (gpe?.title || 'Map Model')
                  })}
                  className={`p-1 rounded transition-colors ${
                    isDark ? 'hover:bg-dark-700 text-slate-300 hover:text-white' : 'hover:bg-slate-100 text-slate-700 hover:text-slate-900'
                  }`}
                  title="Fullscreen Inspect & Pan/Zoom"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                <span className="text-[10px] text-slate-400 font-mono hidden sm:inline ml-1 border-l border-slate-300 dark:border-dark-700 pl-2">
                  Scroll: zoom · Drag: pan
                </span>
              </div>

              {/* Interactive Mouse Panning and Zooming Canvas */}
              <div
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
                className="w-full h-full flex items-center justify-center p-2 overflow-hidden cursor-grab active:cursor-grabbing select-none"
                title={`Click and drag to pan ${isViewingSolution ? 'solution' : 'map'}. Scroll mouse wheel to zoom. Double-click to toggle zoom.`}
              >
                <div
                  style={{
                    transform: `translate(${panPos.x}px, ${panPos.y}px) scale(${zoomLevel})`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.08s ease-out'
                  }}
                  className="flex items-center justify-center pointer-events-none"
                >
                  <img
                    src={isViewingSolution ? currentSolutionUrl : resolveGpeMapUrl(gpe)}
                    alt={isViewingSolution ? (currentSolution?.author ? `${currentSolution.author}'s Solution` : 'Solution Sheet') : gpe.title}
                    className="max-h-[82vh] max-w-full w-auto h-auto object-contain rounded-lg shadow-2xl"
                    draggable={false}
                    onError={handleMapImageError}
                  />
                </div>
              </div>

              {/* Floating Quick Reset Button when panned or zoomed */}
              {(zoomLevel !== 1 || panPos.x !== 0 || panPos.y !== 0) && (
                <button
                  type="button"
                  onClick={resetMapZoom}
                  className={`absolute bottom-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-xl border text-xs font-bold backdrop-blur-md transition-all transform hover:scale-105 active:scale-95 ${
                    isDark
                      ? isViewingSolution
                        ? 'bg-dark-900/95 hover:bg-purple-600 text-slate-100 hover:text-white border-dark-600 shadow-black/50'
                        : 'bg-dark-900/95 hover:bg-blue-600 text-slate-100 hover:text-white border-dark-600 shadow-black/50'
                      : isViewingSolution
                        ? 'bg-white/95 hover:bg-purple-600 text-slate-800 hover:text-white border-slate-200 shadow-slate-400/30'
                        : 'bg-white/95 hover:bg-blue-600 text-slate-800 hover:text-white border-slate-200 shadow-slate-400/30'
                  }`}
                  title={`Reset ${isViewingSolution ? 'solution' : 'map'} zoom to 100% and center position`}
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isViewingSolution ? 'text-purple-500' : 'text-blue-500'} hover:text-white transition-colors`} />
                  <span>Reset</span>
                </button>
              )}
            </div>
          );
        })()}

        {/* ── RIGHT PANEL: Narrative (in Phase 1, 2, 3) OR Solution Photo Upload (in Phase 4) ── */}
        {(() => {
          const isNarrativeHidden = workspaceView === 'map';
          const isNarrativeFull = workspaceView === 'narrative';

          return (
            <div className={`flex-col overflow-hidden transition-colors ${
              isNarrativeHidden ? 'hidden' : 'flex'
            } ${
              isDark ? 'bg-dark-900/60 border-dark-800' : 'bg-white/90 border-slate-200'
            } ${
              isNarrativeFull
                ? 'flex-1 w-full'
                : (phase === 'COMPLETED' ? 'flex-1 w-full md:w-1/2' : 'flex-1 w-full md:w-1/2 lg:w-2/5')
            }`}>

              {/* ── In Phase 1, 2, & 3 OR when viewing Narrative in Phase 4: Display Problem Narrative ── */}
              {(phase === 'BRIEFING' || phase === 'OBSERVE' || phase === 'WRITE' || (phase === 'COMPLETED' && completedTab === 'narrative')) && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Header with Card Image / Pasted Text tabs */}
                  <div className={`p-3 border-b flex items-center justify-between gap-2 shrink-0 ${
                    isDark ? 'bg-dark-900 border-dark-700' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold flex items-center gap-1.5 text-blue-500">
                        <FileText className="w-3.5 h-3.5" />
                        <span>Problem Narrative</span>
                      </span>

                      {phase === 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => setCompletedTab('upload')}
                          className="text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 ml-2"
                        >
                          <Camera className="w-3 h-3" />
                          <span>Back to Upload</span>
                        </button>
                      )}
                    </div>

                    {hasNarrativeImage && hasNarrativeText && (
                      <div className={`flex items-center p-0.5 rounded-lg border text-[11px] ${
                        isDark ? 'bg-dark-950 border-dark-700' : 'bg-slate-200/80 border-slate-300'
                      }`}>
                        <button
                          type="button"
                          onClick={() => setNarrativeTab('image')}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${
                            narrativeTab === 'image' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Card Image
                        </button>
                        <button
                          type="button"
                          onClick={() => setNarrativeTab('text')}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${
                            narrativeTab === 'text' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Pasted Text
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Narrative Body */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs scrollbar-thin">
                    {/* Display Narrative Card Image */}
                    {(narrativeTab === 'image' || (!hasNarrativeText && hasNarrativeImage)) && (
                      <div
                        className={`rounded-xl overflow-hidden border flex flex-col items-center justify-center p-2 cursor-pointer transition-all ${
                          isDark ? 'border-dark-700 bg-black/40 hover:border-blue-500/50' : 'border-slate-200 bg-slate-50 hover:border-blue-400'
                        }`}
                        onClick={() => setInspectImage({ url: resolveGpeNarrativeUrl(gpe), title: 'Narrative Problem Card' })}
                        title="Click to expand & zoom narrative card"
                      >
                        <img
                          src={resolveGpeNarrativeUrl(gpe)}
                          alt="GPE Narrative Card"
                          className="max-h-[75vh] w-auto max-w-full object-contain rounded shadow"
                          onError={handleNarrativeImageError}
                        />
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-blue-500 font-medium">
                          <Eye className="w-3.5 h-3.5" />
                          <span>Click to expand & zoom narrative card</span>
                        </div>
                      </div>
                    )}

                    {/* Display Pasted Narrative Text */}
                    {(narrativeTab === 'text' || (!hasNarrativeImage && hasNarrativeText)) && (
                      <div className={`border rounded-xl p-4 space-y-3 shadow-sm ${
                        isDark ? 'bg-dark-950/80 border-dark-800' : 'bg-white border-slate-200'
                      }`}>
                        <p className="text-[11px] font-mono text-slate-400 border-b pb-1.5 border-slate-200 dark:border-dark-800 font-bold uppercase tracking-wider">
                          Situation & Tasks Narrative
                        </p>
                        <div className={`whitespace-pre-wrap font-sans text-xs sm:text-sm leading-relaxed ${
                          isDark ? 'text-slate-200' : 'text-slate-800'
                        }`}>
                          {gpe.description}
                        </div>
                      </div>
                    )}

                    {/* Phase 1 Action: Begin 5m study */}
                    {phase === 'BRIEFING' && (
                      <div className="pt-2 space-y-2">
                        <button
                          onClick={startFiveMinuteObservation}
                          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all text-xs sm:text-sm"
                        >
                          <span>Begin 5-Minute Individual Observation</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                        <p className="text-[11px] text-slate-400 text-center font-mono">
                          A single bell chime will signal the end of the 5-minute study period.
                        </p>
                      </div>
                    )}

                    {/* Phase 2 Action: Proceed to write early */}
                    {phase === 'OBSERVE' && (
                      <div className="pt-2 space-y-2">
                        <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs flex items-center justify-between">
                          <span className="font-semibold">Phase 2: Individual 5-min study period active</span>
                          <button
                            onClick={startTenMinuteWriting}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg px-2.5 py-1 text-[11px] flex items-center gap-1 transition-colors"
                          >
                            <span>Start Writing Now</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Phase 3 Action: Finish writing & upload */}
                    {phase === 'WRITE' && (
                      <div className="pt-2 space-y-2">
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between gap-2">
                          <div>
                            <p className="font-bold">Phase 3: 10-Minute Writing Period</p>
                            <p className="text-[11px] opacity-80">Write your individual solution plan on paper.</p>
                          </div>
                          <button
                            onClick={finishWritingPeriod}
                            className="bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors shadow-sm shrink-0"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Upload Solution</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── In Phase 4: Solution Photo Upload Tab ── */}
              {phase === 'COMPLETED' && completedTab === 'upload' && (
                <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 scrollbar-thin">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className={`text-base font-bold flex items-center gap-2 ${
                        isDark ? 'text-white' : 'text-slate-900'
                      }`}>
                        <Camera className="w-5 h-5 text-purple-500" />
                        <span>Upload Solution Sheet Photo</span>
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Writing period is complete. Snap or select a clear photo of your handwritten paper solution.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCompletedTab('narrative')}
                      className="px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 shrink-0 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 border-blue-500/30 transition-colors"
                      title="Review the Problem Narrative Card"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Review Problem Card</span>
                    </button>
                  </div>

                {/* Upload Form */}
                <form onSubmit={handleUploadSolutionPhoto} className={`border rounded-2xl p-4 space-y-4 shadow-sm ${
                  isDark ? 'bg-dark-950/70 border-dark-700' : 'bg-white border-slate-200'
                }`}>
                  {solutionUploadError && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold">
                      {solutionUploadError}
                    </div>
                  )}

                  {uploadSuccessToast && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      <span>Solution photo uploaded successfully!</span>
                    </div>
                  )}

                  <div>
                    <label className="label">Candidate Chest No. / Name</label>
                    <div className="relative">
                      <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={candidateAuthor}
                        onChange={e => setCandidateAuthor(e.target.value)}
                        placeholder="e.g. Chest 14 / Aryan"
                        className="input pl-8 py-1.5 text-xs font-semibold"
                        required
                      />
                    </div>
                  </div>

                  {/* Photo Drop Area / File Input */}
                  <div className="space-y-2">
                    <label className="label">Photo of Handwritten Solution (Paper)</label>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />

                    <div
                      onClick={() => photoInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                        isDark ? 'border-dark-600 hover:border-purple-500 bg-dark-900/50' : 'border-slate-300 hover:border-purple-500 bg-slate-50'
                      }`}
                    >
                      <Camera className="w-8 h-8 text-purple-500 mx-auto mb-1.5 opacity-80" />
                      <p className={`text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {solutionPhotoFile ? solutionPhotoFile.name : 'Click to Take Photo or Select Solution Image'}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Supports JPG, PNG, WEBP solution sheets
                      </p>
                    </div>

                    {/* Preview of Selected Solution Photo */}
                    {solutionPhotoPreview && (
                      <div className="relative rounded-xl overflow-hidden border border-purple-500/30 bg-black/40 flex items-center justify-center p-2 group">
                        <img
                          src={solutionPhotoPreview}
                          alt="Solution Preview"
                          className="max-h-56 w-auto object-contain rounded cursor-pointer"
                          onClick={() => {
                            setSelectedSolutionForCanvas({ solutionImageUrl: solutionPhotoPreview, author: candidateAuthor || 'Selected Photo' });
                            setActiveCanvasView('solution');
                            resetMapZoom();
                          }}
                          title="Click to view & pan/zoom on canvas"
                        />
                        <div className="absolute top-2 right-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSolutionForCanvas({ solutionImageUrl: solutionPhotoPreview, author: candidateAuthor || 'Selected Photo' });
                              setActiveCanvasView('solution');
                              resetMapZoom();
                            }}
                            className="p-1 rounded bg-black/70 hover:bg-purple-600 text-white transition-colors"
                            title="View & pan/zoom on canvas"
                          >
                            <Move className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectImage({ url: solutionPhotoPreview, title: 'Selected Solution Sheet Preview' })}
                            className="p-1 rounded bg-black/70 hover:bg-slate-700 text-white transition-colors"
                            title="Inspect fullscreen with pan/zoom"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSolutionPhotoFile(null);
                              URL.revokeObjectURL(solutionPhotoPreview);
                              setSolutionPhotoPreview(null);
                              if (photoInputRef.current) photoInputRef.current.value = '';
                            }}
                            className="p-1 rounded bg-black/70 hover:bg-red-600 text-white transition-colors"
                            title="Remove photo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="label">Additional Notes / Self-Debrief (Optional)</label>
                    <textarea
                      rows={2}
                      value={candidateNotes}
                      onChange={e => setCandidateNotes(e.target.value)}
                      placeholder="Optional notes or priorities you solved..."
                      className="input text-xs leading-relaxed resize-y scrollbar-thin"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isUploadingSolution || !solutionPhotoFile}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all text-xs"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isUploadingSolution ? 'Uploading...' : 'Upload Solution'}</span>
                  </button>
                </form>

                {/* Previously Uploaded Solution Photos for this GPE */}
                {solutionsList.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                      Candidate Submissions ({solutionsList.length})
                    </h4>
                    <div className="space-y-3">
                      {solutionsList.map(sol => (
                        <div
                          key={sol.id}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                            isDark ? 'bg-dark-900 border-dark-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {(sol.solutionImageUrl || sol.solutionB2Key || (sol.solutionPublicId && isCloudinaryPublicId(sol.solutionPublicId))) ? (
                              <img
                                src={resolveGpeSolutionUrl(sol)}
                                alt="Solution thumbnail"
                                onClick={() => setInspectImage({ url: resolveGpeSolutionUrl(sol), title: `${sol.author}'s Solution Sheet` })}
                                className="w-14 h-14 object-cover rounded-lg border border-purple-500/30 cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                                onError={(e) => {
                                  if (sol.solutionB2Key && !e.target.src.includes('/api/media/')) {
                                    e.target.src = apiUrl(`/api/media/${sol.solutionB2Key.replace(/^\/+/, '')}`);
                                  } else if (sol.solutionImageUrl && !e.target.src.includes(sol.solutionImageUrl)) {
                                    e.target.src = apiUrl(sol.solutionImageUrl);
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-bold truncate">{sol.author || 'Candidate'}</p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {sol.submittedAt ? new Date(sol.submittedAt).toLocaleDateString() : 'Submitted'}
                              </p>
                              {sol.solutionImageUrl && (
                                <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1 rounded border border-emerald-500/20">
                                  Cloud Storage
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {(sol.solutionImageUrl || sol.solutionB2Key || (sol.solutionPublicId && isCloudinaryPublicId(sol.solutionPublicId))) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSolutionForCanvas(sol);
                                    setActiveCanvasView('solution');
                                    resetMapZoom();
                                  }}
                                  className={`p-1.5 rounded transition-colors ${
                                    activeCanvasView === 'solution' && selectedSolutionForCanvas?.id === sol.id
                                      ? 'bg-purple-600 text-white shadow-sm'
                                      : 'text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10'
                                  }`}
                                  title="View on canvas (pan & zoom)"
                                >
                                  <Move className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setInspectImage({ url: resolveGpeSolutionUrl(sol), title: `${sol.author}'s Solution Sheet` })}
                                  className="p-1.5 rounded text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors"
                                  title="Fullscreen Pan & Zoom"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteSolutionPhoto(sol.id)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                              title="Delete this solution"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model Solution if provided */}
                {gpe.modelSolution && (
                  <div className={`p-4 rounded-xl border space-y-2 ${
                    isDark ? 'bg-dark-900 border-dark-700' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-500">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>GTO Model Solution Key</span>
                    </div>
                    <p className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      {gpe.modelSolution}
                    </p>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={onExit}
                    className="btn-secondary px-4 py-2 text-xs font-semibold"
                  >
                    Finish & Return to GPE List
                  </button>
                </div>
              </div>
            )}

          </div>
        );
      })()}

      </div>

      {/* Full Size Image Inspection Modal with Pan & Zoom */}
      {inspectImage && (
        <PanZoomModal
          isOpen={Boolean(inspectImage)}
          onClose={() => setInspectImage(null)}
          imageUrl={inspectImage.url}
          title={inspectImage.title || 'Solution Photo'}
          badgeIcon={inspectImage.title?.toLowerCase().includes('map') ? Map : FileText}
        />
      )}

    </div>
  );
}
