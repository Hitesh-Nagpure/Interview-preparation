import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2 } from 'lucide-react';

function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function CustomVideoPlayer({ src, fallbackDuration = 0, autoPlay = false, className = '' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef(null);

  useEffect(() => {
    if (fallbackDuration > 0 && (!duration || isNaN(duration) || duration === Infinity)) {
      setDuration(fallbackDuration);
    }
  }, [fallbackDuration]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0) {
      setDuration(v.duration);
    } else if (fallbackDuration > 0) {
      setDuration(fallbackDuration);
    }
    if (autoPlay) {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0) {
      setDuration(v.duration);
    }
  };

  const handleSeek = (e) => {
    const target = parseFloat(e.target.value);
    const v = videoRef.current;
    if (v) {
      v.currentTime = target;
      setCurrentTime(target);
    }
  };

  const handleSkip = (seconds) => {
    const v = videoRef.current;
    if (!v) return;
    const maxD = duration || fallbackDuration || 1000;
    const newTime = Math.min(Math.max(0, v.currentTime + seconds), maxD);
    v.currentTime = newTime;
    setCurrentTime(newTime);
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

  const resetHideControls = () => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  };

  const maxVal = duration && !isNaN(duration) && duration !== Infinity ? duration : (fallbackDuration || 1);

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideControls}
      onClick={resetHideControls}
      className={`relative bg-black flex items-center justify-center group overflow-hidden select-none ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="auto"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Center Play Overlay when paused */}
      {!isPlaying && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer transition-opacity z-10"
        >
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-2xl transform hover:scale-105 transition-all focus:outline-none ring-4 ring-red-600/30"
            title="Play"
          >
            <Play className="w-7 h-7 fill-current translate-x-0.5" />
          </button>
        </div>
      )}

      {/* Floating Bottom Playback Controls — Blue controls & Red buttons */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950 via-slate-950/85 to-transparent p-3 pt-6 flex flex-col gap-2 transition-opacity duration-300 z-20 ${
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
            className="flex-1 h-2 bg-blue-950/80 border border-blue-800/40 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
            title="Seek"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-xs">
          {/* Left Buttons & Blue Time Counter */}
          <div className="flex items-center gap-2">
            {/* Red Play/Pause Button */}
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors focus:outline-none"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>

            {/* Red -5s Skip Button */}
            <button
              type="button"
              onClick={() => handleSkip(-5)}
              className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors text-[10px] font-mono flex items-center gap-0.5 focus:outline-none"
              title="Rewind 5s"
            >
              <RotateCcw className="w-3 h-3" /> -5s
            </button>

            {/* Red +5s Skip Button */}
            <button
              type="button"
              onClick={() => handleSkip(5)}
              className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors text-[10px] font-mono flex items-center gap-0.5 focus:outline-none"
              title="Forward 5s"
            >
              +5s <RotateCcw className="w-3 h-3 transform -scale-x-100" />
            </button>

            {/* Blue Time Counter */}
            <span className="font-mono text-[11px] text-blue-300 font-semibold ml-1.5 bg-blue-950/50 px-2 py-0.5 rounded border border-blue-800/30">
              {formatTime(currentTime)} / {formatTime(maxVal)}
            </span>
          </div>

          {/* Right Controls: Red Volume Button, Blue Volume Slider & Red Fullscreen Button */}
          <div className="flex items-center gap-3">
            {/* Volume Control */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 rounded bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors focus:outline-none"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 sm:w-20 h-1.5 bg-blue-950 border border-blue-800/40 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                title="Volume"
              />
            </div>

            {/* Red Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors focus:outline-none"
              title="Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
