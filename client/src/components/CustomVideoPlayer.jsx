import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, Download, Gauge, Check, AlertCircle } from 'lucide-react';
import { apiUrl } from '../utils/api';

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 1.75, 2];

function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function CustomVideoPlayer({ src, fallbackSources = [], fallbackDuration = 0, autoPlay = false, className = '', downloadFilename = '' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const speedMenuRef = useRef(null);

  const fallbackSourcesKey = Array.isArray(fallbackSources) ? fallbackSources.join('|') : '';

  // Build candidate sources list: try primary src, then any provided fallbackSources, plus auto .mp4/.webm variations
  const candidateSources = React.useMemo(() => {
    const list = [];
    const seen = new Set();
    const add = (u) => {
      if (u && typeof u === 'string' && u.trim() && !seen.has(u)) {
        seen.add(u);
        list.push(u);
      }
    };
    add(src);
    if (Array.isArray(fallbackSources)) {
      fallbackSources.forEach(add);
    }
    // Also auto-generate alternative formats for Cloudinary
    if (src && src.includes('cloudinary.com')) {
      if (src.includes('.webm')) {
        add(src.replace(/\.webm(\?.*)?$/i, '.mp4$1'));
      } else if (src.includes('.mp4')) {
        add(src.replace(/\.mp4(\?.*)?$/i, '.webm$1'));
      } else if (!src.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i)) {
        add(src + '.mp4');
        add(src + '.webm');
      }
    }
    return list;
  }, [src, fallbackSourcesKey]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  const activeRawSrc = candidateSources[candidateIndex] || src;
  const resolvedSrc = activeRawSrc?.startsWith('blob:') || activeRawSrc?.startsWith('data:')
    ? activeRawSrc
    : (activeRawSrc ? apiUrl(activeRawSrc) : '');

  const lastLoadedSrcRef = useRef('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isBuffering, setIsBuffering] = useState(true);
  const hideControlsTimer = useRef(null);
  const isSeeking = useRef(false); // prevent onTimeUpdate from overwriting seek position
  const retryCountRef = useRef(0); // tracks how many times we've retried on error

  // Reset candidate index when src or fallbackSources change
  useEffect(() => {
    setCandidateIndex(0);
  }, [src, fallbackSourcesKey]);

  // YouTube-like Controls State
  const [doubleTapFeedback, setDoubleTapFeedback] = useState(null); // { side: 'left'|'right', count: 5, id: number }
  const [isLongPress2x, setIsLongPress2x] = useState(false);

  // Gesture tracking refs
  const longPressTimerRef = useRef(null);
  const isLongPressActiveRef = useRef(false);
  const wasPlayingBeforeLongPressRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const lastTapSideRef = useRef(null);
  const singleTapTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const playbackSpeedRef = useRef(playbackSpeed);

  // Keep playbackSpeedRef in sync
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // Clean up gesture timers on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  // Reload video element ONLY when active resolvedSrc actually changes
  useEffect(() => {
    if (!resolvedSrc) {
      setIsBuffering(false);
      return;
    }
    if (lastLoadedSrcRef.current === resolvedSrc) {
      return;
    }
    lastLoadedSrcRef.current = resolvedSrc;

    setIsPlaying(false);
    setCurrentTime(0);
    setHasError(false);
    setErrorMessage('');
    setIsBuffering(true);
    retryCountRef.current = 0;
    if (fallbackDuration > 0) {
      setDuration(fallbackDuration);
    }
    setIsLongPress2x(false);
    isLongPressActiveRef.current = false;
    setDoubleTapFeedback(null);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      if (autoPlay) {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }, [resolvedSrc, autoPlay]);

  useEffect(() => {
    if (fallbackDuration > 0 && (!duration || isNaN(duration) || duration === Infinity)) {
      setDuration(fallbackDuration);
    }
  }, [fallbackDuration]);

  // Close speed menu on outside click or touch
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target)) {
        setSpeedMenuOpen(false);
      }
    };
    if (speedMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [speedMenuOpen]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      // If ended or near the end, smoothly rewind to 0 for replay
      const maxD = (duration && !isNaN(duration) && duration !== Infinity && duration > 0) ? duration : (fallbackDuration || 0);
      if (v.ended || (maxD > 1 && v.currentTime >= maxD - 0.25)) {
        v.currentTime = 0;
        setCurrentTime(0);
      }
      v.play().then(() => setIsPlaying(true)).catch((err) => {
        console.warn('Playback error:', err);
      });
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const triggerDoubleTapFeedback = (side) => {
    setDoubleTapFeedback({ side, id: Date.now() });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setDoubleTapFeedback(null);
    }, 650);
  };

  // Pointer & Gesture Handlers for YouTube-like controls
  const handleZonePointerDown = (e, side) => {
    // Only handle primary mouse button or touch
    if (e.button !== undefined && e.button !== 0) return;
    resetHideControls();

    // Clear any previous long press timer
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

    // Start 350ms long press timer to trigger 2x speed
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      setIsLongPress2x(true);
      const v = videoRef.current;
      if (v) {
        wasPlayingBeforeLongPressRef.current = !v.paused && !v.ended;
        v.playbackRate = 2.0;
        if (v.paused || v.ended) {
          v.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }
    }, 350);
  };

  const handleZonePointerUp = (e, side) => {
    if (e.button !== undefined && e.button !== 0) return;

    // Clear long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // If long press 2x was active, restore normal speed and pause state
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      setIsLongPress2x(false);
      const v = videoRef.current;
      if (v) {
        v.playbackRate = playbackSpeedRef.current;
        if (!wasPlayingBeforeLongPressRef.current) {
          v.pause();
          setIsPlaying(false);
        }
      }
      return; // Do NOT trigger single/double tap actions
    }

    // Handle double-tap vs single-tap
    const now = Date.now();
    const timeDiff = now - lastTapTimeRef.current;

    if (timeDiff < 280 && lastTapSideRef.current === side) {
      // DOUBLE TAP detected!
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapTimeRef.current = 0;

      if (side === 'left') {
        handleSkip(-5);
        triggerDoubleTapFeedback('left');
      } else {
        handleSkip(5);
        triggerDoubleTapFeedback('right');
      }
    } else {
      // First tap — wait for potential second tap
      lastTapTimeRef.current = now;
      lastTapSideRef.current = side;

      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        togglePlay();
      }, 280);
    }
  };

  const handleZonePointerLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      setIsLongPress2x(false);
      const v = videoRef.current;
      if (v) {
        v.playbackRate = playbackSpeedRef.current;
        if (!wasPlayingBeforeLongPressRef.current) {
          v.pause();
          setIsPlaying(false);
        }
      }
    }
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setHasError(false);
    v.playbackRate = playbackSpeed;
    if (v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0) {
      setDuration(v.duration);
    } else if (fallbackDuration > 0) {
      setDuration(fallbackDuration);
    }
    if (autoPlay) {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleVideoError = () => {
    const v = videoRef.current;
    // If there is another candidate source, switch to it immediately before showing error
    if (candidateIndex + 1 < candidateSources.length) {
      const nextIdx = candidateIndex + 1;
      console.warn(`Video source failed [${candidateIndex}]: ${candidateSources[candidateIndex]}, advancing to candidate [${nextIdx}]: ${candidateSources[nextIdx]}`);
      setIsBuffering(true);
      setCandidateIndex(nextIdx);
      retryCountRef.current = 0;
      return;
    }

    // Auto-retry up to 2 times on the final source
    if (retryCountRef.current < 2 && v) {
      retryCountRef.current += 1;
      setIsBuffering(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
          if (autoPlay) videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }, 1200 * retryCountRef.current); // 1.2s, then 2.4s
      return; // don't show error yet
    }
    setIsBuffering(false);
    setHasError(true);
    setErrorMessage('Preview could not be decoded by this browser. The file is preserved and can be downloaded or saved.');
  };

  const handleSpeedSelect = (speed) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setSpeedMenuOpen(false);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || isSeeking.current) return;
    setCurrentTime(v.currentTime);
    if (v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0) {
      setDuration(v.duration);
    } else if (fallbackDuration > 0 && (!duration || isNaN(duration) || duration === Infinity)) {
      setDuration(fallbackDuration);
    }
  };

  // Fires after the browser finishes seeking — confirms actual currentTime
  const handleSeeked = () => {
    isSeeking.current = false;
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  };

  const handleSeek = (e) => {
    const target = parseFloat(e.target.value);
    const v = videoRef.current;
    if (!v) return;
    isSeeking.current = true;
    setCurrentTime(target); // update UI immediately
    try {
      v.currentTime = target;
    } catch (err) {}
    setTimeout(() => {
      isSeeking.current = false;
    }, 250);
  };

  const handleSkip = (seconds) => {
    const v = videoRef.current;
    if (!v) return;
    const maxD = Math.max(
      (duration && !isNaN(duration) && duration !== Infinity && duration > 0) ? duration : 0,
      fallbackDuration || 0,
      v.currentTime || 0,
      1
    );
    const newTime = Math.min(Math.max(0, v.currentTime + seconds), maxD);
    try {
      v.currentTime = newTime;
      setCurrentTime(newTime);
    } catch (err) {}
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isMuted) {
      v.muted = false;
      v.volume = volume || 1;
      setIsMuted(false);
    } else {
      v.muted = true;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };


  const handleDownload = async (e) => {
    e?.stopPropagation?.();
    const currentDownloadSrc = activeRawSrc || src;
    if (!currentDownloadSrc) return;
    try {
      const ext = currentDownloadSrc.includes('.mp4') ? '.mp4' : '.webm';
      let safeName = downloadFilename || `lecturette-recording-${Date.now()}`;
      if (!safeName.endsWith('.mp4') && !safeName.endsWith('.webm')) {
        safeName += ext;
      }

      // Local blob / data URLs — direct download, no fetch needed
      if (currentDownloadSrc.startsWith('blob:') || currentDownloadSrc.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = currentDownloadSrc;
        a.download = safeName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      // Build download URL — inject fl_attachment for Cloudinary to force Content-Disposition header
      const cleanBase = safeName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      let dlUrl = apiUrl(currentDownloadSrc);
      if (dlUrl.includes('cloudinary.com') && dlUrl.includes('/upload/')) {
        dlUrl = dlUrl.replace('/upload/', `/upload/fl_attachment:${cleanBase}/`);
      }

      // Fetch as blob — bypasses browser cross-origin download restriction
      try {
        const res = await fetch(dlUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (blob && blob.size > 0) {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = safeName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            return;
          }
        }
      } catch (fetchErr) {
        console.warn('Blob download fallback to direct link:', fetchErr);
      }

      // Fallback: open in new tab (fl_attachment flag makes Cloudinary serve it as download)
      window.open(dlUrl, '_blank');
    } catch (err) {
      window.open(apiUrl(currentDownloadSrc), '_blank');
    }
  };

  const resetHideControls = () => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000);
    }
  };

  useEffect(() => {
    resetHideControls();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isPlaying]);

  // For the seek bar: use actual duration when available; for Infinity-duration blobs
  // use Math.max of duration, fallbackDuration, and currentTime so the bar stays accurate and scrubbable.
  const maxVal = Math.max(
    (duration && !isNaN(duration) && duration !== Infinity && duration > 0) ? duration : 0,
    fallbackDuration > 0 ? fallbackDuration : 0,
    currentTime > 0 ? currentTime : 0,
    1
  );

  const handleKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      handleSkip(-5);
      triggerDoubleTapFeedback('left');
    } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      handleSkip(5);
      triggerDoubleTapFeedback('right');
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={resetHideControls}
      onMouseEnter={resetHideControls}
      onMouseDown={resetHideControls}
      onTouchStart={resetHideControls}
      onWheel={resetHideControls}
      onClick={resetHideControls}
      className={`relative bg-black flex items-center justify-center group overflow-hidden select-none outline-none focus:ring-1 focus:ring-blue-500/40 ${!controlsVisible && isPlaying ? 'cursor-none' : ''} ${className}`}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        playsInline
        preload="auto"
        onLoadedMetadata={handleLoadedMetadata}
        onLoadedData={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => { setIsBuffering(false); setIsPlaying(true); }}
        onTimeUpdate={handleTimeUpdate}
        onSeeked={handleSeeked}
        onEnded={() => {
          setIsPlaying(false);
          const v = videoRef.current;
          if (v) setCurrentTime(maxVal);
        }}
        onError={handleVideoError}
        className={`w-full h-full object-contain ${hasError ? 'hidden' : 'block'}`}
      />

      {/* Blue Loading / Buffering Spinner */}
      {isBuffering && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none z-20">
          <div className="w-10 h-10 border-[3px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}

      {/* Fallback Display if video cannot be decoded in browser */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-slate-900 text-center space-y-3 z-30">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h4 className="text-xs font-bold text-slate-200">Video Preview Unavailable</h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setIsBuffering(true);
                retryCountRef.current = 0;
                setCandidateIndex(0);
                lastLoadedSrcRef.current = '';
                if (videoRef.current) {
                  videoRef.current.load();
                  videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                }
              }}
              className="btn-secondary bg-slate-800 hover:bg-slate-700 text-xs px-3 py-1.5 flex items-center gap-1.5 shadow text-slate-200"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="btn-secondary bg-slate-800 hover:bg-slate-700 text-xs px-3 py-1.5 flex items-center gap-1.5 shadow"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Download & Open</span>
            </button>
          </div>
        </div>
      )}

      {/* YouTube Gesture Zones: Left (rewind 5s) & Right (fast-forward 5s) + Press & Hold 2x Speed */}
      {!hasError && (
        <>
          <div
            className="absolute inset-y-0 left-0 w-1/2 z-10 cursor-pointer"
            onPointerDown={(e) => handleZonePointerDown(e, 'left')}
            onPointerUp={(e) => handleZonePointerUp(e, 'left')}
            onPointerLeave={handleZonePointerLeave}
            onPointerCancel={handleZonePointerLeave}
          />
          <div
            className="absolute inset-y-0 right-0 w-1/2 z-10 cursor-pointer"
            onPointerDown={(e) => handleZonePointerDown(e, 'right')}
            onPointerUp={(e) => handleZonePointerUp(e, 'right')}
            onPointerLeave={handleZonePointerLeave}
            onPointerCancel={handleZonePointerLeave}
          />
        </>
      )}

      {/* YouTube-like "⚡ 2X SPEED" Pill Indicator (when pressing and holding) */}
      {isLongPress2x && (
        <div className="absolute top-4 inset-x-0 flex items-center justify-center z-30 pointer-events-none animate-fadeIn">
          <div className="flex items-center gap-1.5 bg-black/85 backdrop-blur-md px-4 py-1.5 rounded-full border border-blue-400/50 shadow-2xl text-white font-mono text-xs font-extrabold tracking-wider">
            <span className="text-amber-400 text-sm animate-pulse"></span>
            <span className="text-blue-300">2X SPEED</span>
          </div>
        </div>
      )}

      {/* Double Tap -5s Animated Feedback on Left */}
      {doubleTapFeedback?.side === 'left' && (
        <div className="absolute inset-y-0 left-0 w-1/2 flex items-center justify-center pointer-events-none z-30 animate-fadeIn">
          <div className="flex flex-col items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-blue-600/40 backdrop-blur-md border border-blue-400/50 text-white shadow-2xl scale-100 animate-pulse">
            <RotateCcw className="w-6 h-6 sm:w-7 sm:h-7 stroke-[2.5]" />
            <span className="text-xs sm:text-sm font-black font-mono mt-1 tracking-wide">-5 SECONDS</span>
          </div>
        </div>
      )}

      {/* Double Tap +5s Animated Feedback on Right */}
      {doubleTapFeedback?.side === 'right' && (
        <div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center pointer-events-none z-30 animate-fadeIn">
          <div className="flex flex-col items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-blue-600/40 backdrop-blur-md border border-blue-400/50 text-white shadow-2xl scale-100 animate-pulse">
            <RotateCcw className="w-6 h-6 sm:w-7 sm:h-7 stroke-[2.5] transform -scale-x-100" />
            <span className="text-xs sm:text-sm font-black font-mono mt-1 tracking-wide">+5 SECONDS</span>
          </div>
        </div>
      )}

      {/* Center Play Overlay when paused — Blue button */}
      {!isPlaying && !hasError && !isLongPress2x && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer transition-opacity z-10 pointer-events-none"
        >
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-2xl transform hover:scale-105 transition-all focus:outline-none ring-4 ring-blue-500/30 pointer-events-auto"
            title="Play"
          >
            <Play className="w-7 h-7 fill-current translate-x-0.5" />
          </button>
        </div>
      )}

      {/* Floating Bottom Playback Controls — Blue controls & Blue buttons */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent p-2 sm:p-3 pt-4 sm:pt-6 flex flex-col gap-1.5 sm:gap-2 transition-opacity duration-300 z-20 ${
          controlsVisible || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Blue Seek Bar */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max={maxVal}
            step="0.05"
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1.5 sm:h-2 bg-blue-950/80 border border-blue-800/40 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
            title="Seek"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-xs gap-1.5 flex-wrap sm:flex-nowrap">
          {/* Left Buttons & Blue Time Counter */}
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            {/* Blue Play/Pause Button */}
            <button
              type="button"
              onClick={togglePlay}
              className="p-1 sm:p-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors focus:outline-none"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-current" /> : <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-current" />}
            </button>

            {/* Blue -5s Skip Button */}
            <button
              type="button"
              onClick={() => handleSkip(-5)}
              className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors text-[9px] sm:text-[10px] font-mono flex items-center gap-0.5 focus:outline-none"
              title="Rewind 5s"
            >
              <RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> -5s
            </button>

            {/* Blue +5s Skip Button */}
            <button
              type="button"
              onClick={() => handleSkip(5)}
              className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors text-[9px] sm:text-[10px] font-mono flex items-center gap-0.5 focus:outline-none"
              title="Forward 5s"
            >
              +5s <RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3 transform -scale-x-100" />
            </button>

            {/* Blue Time Counter */}
            <span className="font-mono text-[10px] sm:text-[11px] text-blue-300 font-semibold ml-0.5 sm:ml-1 bg-blue-950/50 px-1.5 sm:px-2 py-0.5 rounded border border-blue-800/30">
              {formatTime(currentTime)} / {formatTime(maxVal)}
            </span>
          </div>

          {/* Right Controls: Blue Volume Button, Blue Volume Slider, Blue Download Button & Blue Fullscreen Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto sm:ml-0">
            {/* Volume Control */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1 sm:p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors focus:outline-none"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <Volume2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="hidden sm:block w-14 sm:w-18 h-1.5 bg-blue-950 border border-blue-800/40 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                title="Volume"
              />
            </div>

            {/* Speed Controls (0.25x, 0.5x, 1x, 1.5x, 1.75x, 2x) */}
            <div className="relative" ref={speedMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSpeedMenuOpen(v => !v);
                }}
                className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-white shadow-md transition-all font-mono font-bold text-[10px] sm:text-[11px] flex items-center gap-1 focus:outline-none ${
                  playbackSpeed !== 1
                    ? 'bg-blue-500 ring-2 ring-blue-300'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
                title="Playback Speed (0.25x - 2x)"
              >
                <Gauge className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                <span>{playbackSpeed}x</span>
              </button>

              {speedMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full mb-2 right-0 bg-slate-950/95 backdrop-blur-md border border-blue-500/50 rounded-lg shadow-2xl p-1.5 flex flex-col gap-0.5 min-w-[105px] z-50 animate-fadeIn"
                >
                  <div className="text-[9px] text-blue-300 font-bold px-2 py-0.5 border-b border-blue-900/60 uppercase tracking-wider flex items-center justify-between">
                    <span>Speed</span>
                    <span className="text-[8px] text-blue-400 font-normal">Controls</span>
                  </div>
                  {SPEED_OPTIONS.map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => handleSpeedSelect(spd)}
                      className={`px-2 py-1 text-left text-[11px] font-mono rounded flex items-center justify-between transition-colors ${
                        playbackSpeed === spd
                          ? 'bg-blue-600 text-white font-bold'
                          : 'text-slate-200 hover:bg-blue-900/60 hover:text-blue-200'
                      }`}
                    >
                      <span>{spd}x</span>
                      {spd === 1 && <span className="text-[9px] opacity-75 font-sans">(Normal)</span>}
                      {playbackSpeed === spd && <Check className="w-3 h-3 text-white ml-1" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Blue Download Button */}
            <button
              type="button"
              onClick={handleDownload}
              className="p-1 sm:p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors focus:outline-none flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold"
              title="Download Video"
            >
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden md:inline">Download</span>
            </button>

            {/* Blue Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1 sm:p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-colors focus:outline-none"
              title="Fullscreen"
            >
              <Maximize2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
