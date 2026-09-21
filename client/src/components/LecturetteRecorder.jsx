import React, { useState, useRef, useEffect } from 'react';
import {
  Video, VideoOff, Mic, MicOff, Play, Pause, Square, RotateCcw,
  Upload, Trash2, CheckCircle2, AlertCircle, Calendar, Film, X,
  Volume2, VolumeX, Maximize2, Edit3, Check
} from 'lucide-react';
import CustomVideoPlayer from './CustomVideoPlayer';

function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function LecturetteRecorder({ folders, onRefresh, onNavigate }) {
  const today = new Date().toISOString().split('T')[0];
  const [selectedFolder, setSelectedFolder] = useState(folders[0]?.dateFolder || today);
  const [recTitle, setRecTitle] = useState('');
  const [recDate, setRecDate] = useState(folders[0]?.dateFolder || today);
  const [editingLecturette, setEditingLecturette] = useState(null); // { id, folderDate, title, recordedDate }
  const [lecEditSaving, setLecEditSaving] = useState(false);
  const [stream, setStream] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('IDLE'); // 'IDLE', 'RECORDING', 'PAUSED', 'STOPPED'
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null); // { url, title, duration }

  // Custom playback controls state for review
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsPlaybackMuted] = useState(false);

  const liveVideoRef = useRef(null);
  const playbackVideoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);
  const totalDurationRef = useRef(0); // in seconds, tracked in background
  const streamRef = useRef(null);

  // Safely stop all active stream tracks
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      streamRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      setStream(null);
    }
    setCameraActive(false);
  };

  // Start / Stop Camera Stream with multi-tier fallback
  const startCamera = async () => {
    setError(null);
    stopCamera();

    // DirectShow/MediaFoundation on Windows throws NotReadableError if facingMode: 'user' is specified
    const constraintTiers = [
      // Tier 1: 720p ideal, audio enabled (no facingMode)
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true },
      // Tier 2: Basic video + audio
      { video: true, audio: true },
      // Tier 3: Basic video only (in case microphone is locked in exclusive mode by another app)
      { video: true, audio: false }
    ];

    let mediaStream = null;
    let lastError = null;

    for (const constraints of constraintTiers) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (mediaStream) break;
      } catch (err) {
        lastError = err;
        // Continue to try fallback constraints
      }
    }

    if (mediaStream) {
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraActive(true);
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = mediaStream;
      }
    } else {
      const errMsg = lastError?.message || 'Unknown error';
      if (lastError?.name === 'NotReadableError' || errMsg.toLowerCase().includes('video source')) {
        setError('Camera is currently in use or locked by another application (e.g. Teams, Zoom, Skype, or another tab), or requires device reset. Please close any apps using the camera and click "Retry Camera".');
      } else if (lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError') {
        setError('Camera/Microphone permission denied. Please allow camera and microphone access in browser site settings and reload.');
      } else {
        setError(`Camera/Microphone not available (${errMsg}). Check device connection and click "Retry Camera".`);
      }
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  // Set stream when video element binds
  useEffect(() => {
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.srcObject = stream;
    }
  }, [cameraActive, recordingStatus, stream]);

  // Start recording
  const handleStartRecording = () => {
    if (!stream) {
      setError('Please enable camera before recording.');
      return;
    }
    setError(null);
    setUploadSuccess(null);
    chunksRef.current = [];
    totalDurationRef.current = 0;
    startTimeRef.current = Date.now();

    // Select supported mimeType
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    let selectedMimeType = '';
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        selectedMimeType = mt;
        break;
      }
    }

    try {
      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mr = new MediaRecorder(stream, options);

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: selectedMimeType || 'video/webm' });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordingStatus('STOPPED');
        setIsPlaying(false);
        setCurrentTime(0);
        setVideoDuration(totalDurationRef.current || 0);
      };

      mr.start(1000); // 1-second chunks
      mediaRecorderRef.current = mr;
      setRecordingStatus('RECORDING');
    } catch (err) {
      setError('Could not start recording: ' + err.message);
    }
  };

  // Pause recording
  const handlePauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      totalDurationRef.current += Math.round((Date.now() - startTimeRef.current) / 1000);
      setRecordingStatus('PAUSED');
    }
  };

  // Resume recording
  const handleResumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setRecordingStatus('RECORDING');
    }
  };

  // Stop recording
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (recordingStatus === 'RECORDING') {
        totalDurationRef.current += Math.round((Date.now() - startTimeRef.current) / 1000);
      }
      mediaRecorderRef.current.stop();
    }
  };

  // Review Video Player Handlers
  const handleLoadedMetadata = (e) => {
    const v = e.target;
    if (!v) return;
    let dur = v.duration;
    if (!dur || dur === Infinity || isNaN(dur)) {
      // Workaround for WebM MediaRecorder lacking duration header
      dur = totalDurationRef.current || 1;
      v.currentTime = 1e101;
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        v.currentTime = 0;
        if (v.duration && v.duration !== Infinity && !isNaN(v.duration)) {
          setVideoDuration(v.duration);
        } else {
          setVideoDuration(totalDurationRef.current || 1);
        }
      };
    } else {
      setVideoDuration(dur);
      v.currentTime = 0.001; // render first frame poster
    }
  };

  const handleTimeUpdate = () => {
    if (playbackVideoRef.current) {
      setCurrentTime(playbackVideoRef.current.currentTime);
      if (playbackVideoRef.current.ended) {
        setIsPlaying(false);
      }
    }
  };

  const handleSeek = (e) => {
    const t = parseFloat(e.target.value);
    if (playbackVideoRef.current) {
      playbackVideoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const togglePlay = () => {
    if (!playbackVideoRef.current) return;
    if (playbackVideoRef.current.paused || playbackVideoRef.current.ended) {
      playbackVideoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      playbackVideoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSkip = (seconds) => {
    if (!playbackVideoRef.current) return;
    const maxD = videoDuration || totalDurationRef.current || 1;
    const nextTime = Math.max(0, Math.min(maxD, playbackVideoRef.current.currentTime + seconds));
    playbackVideoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMute = () => {
    if (!playbackVideoRef.current) return;
    const nextMuted = !isMuted;
    playbackVideoRef.current.muted = nextMuted;
    setIsPlaybackMuted(nextMuted);
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    if (playbackVideoRef.current) {
      playbackVideoRef.current.volume = val;
      playbackVideoRef.current.muted = val === 0;
      setVolume(val);
      setIsPlaybackMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Discard & retake
  const handleRetake = () => {
    if (playbackVideoRef.current) {
      playbackVideoRef.current.pause();
    }
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingStatus('IDLE');
    setUploadSuccess(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    totalDurationRef.current = 0;
  };

  useEffect(() => {
    if (selectedFolder) {
      setRecDate(selectedFolder);
      if (!recTitle || recTitle.startsWith('Lecturette')) {
        setRecTitle(`Lecturette ${selectedFolder}`);
      }
    }
  }, [selectedFolder]);

  // Upload to Cloudinary
  const handleSaveToCloudinary = async () => {
    if (!recordedBlob) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      const ext = recordedBlob.type.includes('mp4') ? '.mp4' : '.webm';
      const file = new File([recordedBlob], `lecturette-${Date.now()}${ext}`, { type: recordedBlob.type });
      fd.append('video', file);
      const targetFolder = (recDate || selectedFolder).trim();
      const targetTitle = (recTitle || `Lecturette ${targetFolder}`).trim();
      fd.append('title', targetTitle);
      fd.append('recordedDate', targetFolder);
      fd.append('duration', totalDurationRef.current.toString());

      const res = await fetch(`/api/folders/${encodeURIComponent(targetFolder)}/lecturette`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload video');

      setUploadSuccess(`Lecturette "${targetTitle}" saved successfully to Cloudinary!`);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Edit existing lecturette title and date
  const handleSaveLecturetteEdit = async () => {
    if (!editingLecturette) return;
    setLecEditSaving(true);
    try {
      const { id, folderDate, title, recordedDate } = editingLecturette;
      const res = await fetch(`/api/folders/${encodeURIComponent(folderDate)}/lecturette/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, recordedDate })
      });
      if (!res.ok) throw new Error('Failed to update lecturette');
      setEditingLecturette(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setLecEditSaving(false);
    }
  };

  // Delete lecturette from folder
  const handleDeleteLecturette = async (folderDate, lecturetteId) => {
    if (!window.confirm('Are you sure you want to delete this lecturette video?')) return;
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folderDate)}/lecturette/${encodeURIComponent(lecturetteId)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Could not delete video');
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  // Aggregate past recorded lecturettes across all folders
  const allLecturettes = folders.flatMap(f => (f.lecturettes || []).map(l => ({ ...l, folderDate: f.dateFolder })));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-dark-700 pb-4">
        <div>
          <span className="text-sm font-black px-2.5 py-0.5 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30 uppercase tracking-widest font-mono">
            LECTURETTE
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white mt-1">
            Live Lecturette Video Recorder
          </h1>
          <p className="text-xs text-slate-400">
            Record your lecturette live and store the video in Cloudinary.
          </p>
        </div>

        {/* Target Folder Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
            Save to Folder:
          </label>
          <select
            value={selectedFolder}
            onChange={e => setSelectedFolder(e.target.value)}
            className="input py-1 text-xs max-w-[160px] bg-white dark:bg-dark-800"
          >
            {folders.map(f => (
              <option key={f.dateFolder} value={f.dateFolder}>
                {f.dateFolder}
              </option>
            ))}
            {!folders.some(f => f.dateFolder === today) && (
              <option value={today}>{today} (Today)</option>
            )}
          </select>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="leading-relaxed">{error}</span>
          </div>
          <button
            type="button"
            onClick={startCamera}
            className="shrink-0 px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors shadow"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry Camera</span>
          </button>
        </div>
      )}

      {uploadSuccess && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{uploadSuccess}</span>
          </div>
          <button onClick={handleRetake} className="btn-secondary text-[11px] py-0.5">
            Record Another
          </button>
        </div>
      )}

      {/* Main Studio Card */}
      <div className="card overflow-hidden bg-slate-900 border-slate-800 shadow-xl">
        <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
          
          {/* Live Stream View */}
          {recordingStatus !== 'STOPPED' ? (
            <>
              <video
                ref={liveVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform -scale-x-100 ${
                  cameraActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 space-y-3">
                  <VideoOff className="w-10 h-10 text-slate-600" />
                  <p className="text-xs">Camera is offline</p>
                  <button onClick={startCamera} className="btn-primary text-xs flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5" /> Enable Camera
                  </button>
                </div>
              )}
              {/* Recording Indicator (subtle red dot, no timer text on screen) */}
              {recordingStatus === 'RECORDING' && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-red-500/40">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="text-[11px] font-bold text-red-400 uppercase tracking-widest font-mono">
                    Recording
                  </span>
                </div>
              )}
              {recordingStatus === 'PAUSED' && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-amber-500/40">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-[11px] font-bold text-amber-300 uppercase tracking-widest font-mono">
                    Paused
                  </span>
                </div>
              )}
            </>
          ) : (
            /* Custom Recorded Video Review Player with Blue Controls & Red Buttons */
            <CustomVideoPlayer
              src={recordedUrl}
              fallbackDuration={totalDurationRef.current}
              className="w-full h-full"
            />
          )}
        </div>

        {/* Studio Controls Bar */}
        <div className="px-3 sm:px-4 py-3 bg-slate-950 border-t border-slate-800 flex flex-col gap-3">
          {/* If STOPPED: Title and Date edit fields */}
          {recordingStatus === 'STOPPED' && (
            <div className="w-full pb-3 border-b border-slate-800 animate-fadeIn">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Lecturette Title
                  </label>
                  <input
                    type="text"
                    value={recTitle}
                    onChange={e => setRecTitle(e.target.value)}
                    placeholder={`e.g. Lecturette ${recDate || selectedFolder}`}
                    className="input py-1.5 text-xs bg-slate-900 border-slate-700 text-white w-full focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={recDate}
                    onChange={e => setRecDate(e.target.value)}
                    className="input py-1.5 text-xs bg-slate-900 border-slate-700 text-white w-full focus:border-purple-500"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left: Device Toggles */}
            <div className="flex items-center gap-1.5">
              {cameraActive ? (
                <button
                  onClick={stopCamera}
                  disabled={recordingStatus === 'RECORDING'}
                  className="p-1.5 rounded-md bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-30"
                  title="Turn off camera"
                >
                  <VideoOff className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={startCamera}
                  className="p-1.5 rounded-md bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                  title="Turn on camera"
                >
                  <Video className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Center: Recording Action Controls */}
            <div className="flex items-center gap-2">
              {recordingStatus === 'IDLE' && (
                <button
                  onClick={handleStartRecording}
                  disabled={!cameraActive}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-40"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-white" />
                  <span>Start Recording</span>
                </button>
              )}

              {recordingStatus === 'RECORDING' && (
                <>
                  <button
                    onClick={handlePauseRecording}
                    className="btn-secondary bg-slate-800 hover:bg-slate-700 text-white border-slate-700 px-3 py-1.5 text-xs flex items-center gap-1"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                  <button
                    onClick={handleStopRecording}
                    className="btn-primary bg-red-600 hover:bg-red-500 px-4 py-1.5 text-xs flex items-center gap-1"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                </>
              )}

              {recordingStatus === 'PAUSED' && (
                <>
                  <button
                    onClick={handleResumeRecording}
                    className="btn-primary bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs flex items-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Resume</span>
                  </button>
                  <button
                    onClick={handleStopRecording}
                    className="btn-secondary bg-red-600/20 text-red-400 hover:bg-red-600/30 border-red-500/30 px-3 py-1.5 text-xs flex items-center gap-1"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                </>
              )}

              {recordingStatus === 'STOPPED' && (
                <>
                  <button
                    onClick={handleRetake}
                    className="btn-secondary bg-slate-800 hover:bg-slate-700 text-white border-slate-700 px-3 py-1 text-xs flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retake</span>
                  </button>
                  <button
                    onClick={handleSaveToCloudinary}
                    disabled={uploading}
                    className="btn-primary bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Upload className="w-3 h-3" />
                    <span>{uploading ? 'Saving...' : 'Save'}</span>
                  </button>
                </>
              )}
            </div>

            {/* Right: State summary */}
            <div className="text-[11px] font-mono text-slate-400">
              {recordingStatus === 'STOPPED' ? 'Reviewing' : recordingStatus}
            </div>
          </div>
        </div>
      </div>

      {/* Past Recorded Lecturettes Section */}
      <div className="space-y-3 pt-2">
        <h2 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Film className="w-4 h-4 text-purple-500" />
          <span>Recorded Lecturettes ({allLecturettes.length})</span>
        </h2>

        {allLecturettes.length === 0 ? (
          <div className="card p-6 text-center text-xs text-slate-400">
            No lecturette videos recorded yet. Click &quot;Start Recording&quot; above to capture one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allLecturettes.map(lec => (
              <div
                key={lec.id}
                className="card p-3 space-y-2 relative group hover:border-purple-500/40 transition-colors"
              >
                <div
                  onClick={() => setPlayingVideo(lec)}
                  className="aspect-video bg-black rounded-md overflow-hidden relative cursor-pointer flex items-center justify-center group-hover:opacity-90"
                >
                  <video src={lec.url} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-white/90 text-slate-900 flex items-center justify-center pl-0.5 shadow-md group-hover:scale-110 transition-transform">
                      <Play className="w-4 h-4 fill-current" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 dark:text-white truncate">
                      {lec.title || 'Lecturette Recording'}
                    </p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5 inline" /> {lec.recordedDate || lec.folderDate}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingLecturette({ id: lec.id, folderDate: lec.folderDate, title: lec.title || '', recordedDate: lec.recordedDate || lec.folderDate })}
                      className="p-1.5 rounded text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors"
                      title="Edit title and date"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteLecturette(lec.folderDate, lec.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="Delete lecturette video"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Video Playback Modal */}
      {playingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden max-w-2xl w-full shadow-2xl space-y-2">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-slate-200">
              <span className="text-xs font-bold truncate">{playingVideo.title}</span>
              <button
                onClick={() => setPlayingVideo(null)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3">
              <CustomVideoPlayer
                src={playingVideo.url}
                autoPlay={true}
                className="w-full aspect-video rounded bg-black"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Lecturette Title and Date Modal */}
      {editingLecturette && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSaveLecturetteEdit();
            }}
            className="card max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-850"
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
        </div>
      )}
    </div>
  );
}
