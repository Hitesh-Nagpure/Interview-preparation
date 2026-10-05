import React, { useState, useRef, useEffect } from 'react';
import fixWebmDuration from 'fix-webm-duration';
import {
  Video, VideoOff, Mic, MicOff, Play, Pause, Square, RotateCcw,
  Upload, Trash2, CheckCircle2, AlertCircle, AlertTriangle, Calendar, Film, X,
  Volume2, VolumeX, Maximize2, Edit3, Check, Bell, Clock, Download
} from 'lucide-react';
import CustomVideoPlayer from './CustomVideoPlayer';
import { soundEngine } from '../utils/audio';
import { apiUrl } from '../utils/api';

function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Sub-component: video thumbnail with loading spinner
function LectureThumbnail({ src }) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="w-7 h-7 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}
      <video
        src={src}
        className="w-full h-full object-cover"
        preload="metadata"
        onLoadedData={() => setLoaded(true)}
        onLoadedMetadata={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </>
  );
}

export default function LecturetteRecorder({ folders, onRefresh, onNavigate }) {
  const today = new Date().toISOString().split('T')[0];
  const [selectedFolder, setSelectedFolder] = useState(folders[0]?.dateFolder || today);
  const [recTitle, setRecTitle] = useState('');
  const [recDate, setRecDate] = useState(folders[0]?.dateFolder || today);
  const [editingLecturette, setEditingLecturette] = useState(null); // { id, folderDate, title, recordedDate }
  const [lecEditSaving, setLecEditSaving] = useState(false);
  const [deleteConfirmLec, setDeleteConfirmLec] = useState(null); // { folderDate, id, title }
  const [retakeConfirmOpen, setRetakeConfirmOpen] = useState(false); // Retake confirmation popup modal
  const [deletingLecturetteId, setDeletingLecturetteId] = useState(null); // id of video currently being deleted
  const [stream, setStream] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('IDLE'); // 'IDLE', 'COUNTDOWN', 'RECORDING', 'PAUSED', 'STOPPED'
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // 0-100%
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [uploadSuccessToast, setUploadSuccessToast] = useState(null); // floating toast message
  const [videoDiscardedToast, setVideoDiscardedToast] = useState(false); // shown when retake aborts an upload
  const [error, setError] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null); // { url, title, duration }

  // Wait time and SSB Bells configuration
  const [waitTime, setWaitTime] = useState(() => {
    try {
      const saved = localStorage.getItem('ssb_lecturette_wait_time');
      if (saved !== null && ['0', '3', '5', '10'].includes(saved)) {
        return parseInt(saved, 10);
      }
    } catch (e) {}
    return 5; // default 5 seconds
  });
  const [countdown, setCountdown] = useState(null);
  const [ssbBellsEnabled, setSsbBellsEnabled] = useState(true);
  const [bellAlertNotification, setBellAlertNotification] = useState(null); // { title, text } | null
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const countdownIntervalRef = useRef(null);
  const singleBellFiredRef = useRef(false);
  const doubleBellFiredRef = useRef(false);
  const bellIntervalRef = useRef(null);
  const bellToastTimerRef = useRef(null);
  const uploadXhrRef = useRef(null); // ref to abort ongoing upload if user retakes

  // Microphone and Live Sound Detection state
  const [micActive, setMicActive] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0); // 0 - 100 for live VU visualizer
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

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
  const fileInputRef = useRef(null);

  // Setup real-time audio volume visualizer (VU meter)
  const setupAudioAnalyser = (mediaStream) => {
    try {
      if (!mediaStream) return;
      const audioTracks = mediaStream.getAudioTracks();
      if (!audioTracks.length) {
        setAudioLevel(0);
        return;
      }

      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch (e) {}
        audioContextRef.current = null;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(normalized);
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      checkVolume();
    } catch (err) {
      console.warn('Audio analyser note:', err);
    }
  };

  // Safely stop all active stream tracks and audio analyzers
  const stopCamera = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    setAudioLevel(0);

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

    // CRITICAL: detach srcObject from the video element so the browser
    // releases the camera hardware (turns off the camera light)
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setMicActive(false);
  };

  // Ensure audio track is active, healthy, and attached to current stream
  const ensureAudioTrack = async (currentStream) => {
    if (!currentStream) return null;
    const existingAudio = currentStream.getAudioTracks();
    const hasLiveAudio = existingAudio.some(t => t.readyState === 'live');
    if (hasLiveAudio) {
      existingAudio.forEach(t => { t.enabled = true; });
      setMicActive(true);
      setMicMuted(false);
      setupAudioAnalyser(currentStream);
      return currentStream;
    }

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));

      if (audioStream) {
        const newTrack = audioStream.getAudioTracks()[0];
        if (newTrack) {
          existingAudio.forEach(t => {
            try { t.stop(); currentStream.removeTrack(t); } catch (e) {}
          });
          currentStream.addTrack(newTrack);
          streamRef.current = currentStream;
          setStream(currentStream);
          setMicActive(true);
          setMicMuted(false);
          setupAudioAnalyser(currentStream);
        }
      }
    } catch (err) {
      console.warn('Microphone permission / acquisition notice:', err.message);
    }
    return currentStream;
  };

  // Toggle Microphone Mute or Enable
  const toggleMicrophone = async () => {
    const activeStream = streamRef.current || stream;
    if (!activeStream) {
      startCamera();
      return;
    }

    const audioTracks = activeStream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks.some(t => t.readyState === 'live')) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));

        const newTrack = audioStream?.getAudioTracks()?.[0];
        if (newTrack) {
          activeStream.addTrack(newTrack);
          streamRef.current = activeStream;
          setStream(activeStream);
          setMicActive(true);
          setMicMuted(false);
          setupAudioAnalyser(activeStream);
        }
      } catch (err) {
        setError('Microphone access denied or device unavailable: ' + err.message);
      }
    } else {
      const nextMuted = !micMuted;
      audioTracks.forEach(t => { t.enabled = !nextMuted; });
      setMicMuted(nextMuted);
    }
  };

  // Start / Stop Camera & Mic Stream with multi-tier fallback
  const startCamera = async () => {
    setError(null);
    stopCamera();

    let videoStream = null;
    let audioStream = null;
    let lastError = null;

    // 1. Acquire video stream (Tier 1: 720p ideal, Tier 2: default video)
    const videoTiers = [
      { width: { ideal: 1280 }, height: { ideal: 720 } },
      true
    ];

    for (const vConstraint of videoTiers) {
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: vConstraint });
        if (videoStream) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!videoStream) {
      const errMsg = lastError?.message || 'Unknown error';
      if (lastError?.name === 'NotReadableError' || errMsg.toLowerCase().includes('video source')) {
        setError('Camera is currently in use or locked by another application (e.g. Teams, Zoom, Skype, or another tab). Please close any apps using the camera and click "Retry Camera".');
      } else if (lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError') {
        setError('Camera permission denied. Please allow camera and microphone access in browser site settings and reload.');
      } else {
        setError(`Camera not available (${errMsg}). Check device connection and click "Retry Camera".`);
      }
      return;
    }

    // 2. Acquire audio stream with speech-enhancement constraints
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    } catch (aErr) {
      console.warn('Microphone auto-acquisition deferred or unavailable:', aErr.message);
    }

    // 3. Combine video + audio tracks into a unified MediaStream
    const combinedTracks = [
      ...videoStream.getVideoTracks(),
      ...(audioStream ? audioStream.getAudioTracks() : [])
    ];
    const combinedStream = new MediaStream(combinedTracks);

    streamRef.current = combinedStream;
    setStream(combinedStream);
    setCameraActive(true);

    const hasAudio = combinedStream.getAudioTracks().length > 0;
    setMicActive(hasAudio);
    setMicMuted(false);

    if (hasAudio) {
      setupAudioAnalyser(combinedStream);
    }

    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = combinedStream;
    }
  };

  useEffect(() => {
    // Camera is NOT started automatically — user must click "Enable Camera" explicitly.
    // This prevents the camera indicator light from turning on just by navigating to this tab.
    return () => {
      // Use refs directly to avoid stale closure issues with stream state.
      // This ensures the camera hardware is always released when switching tabs.
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch (e) {}
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
        streamRef.current = null;
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (bellIntervalRef.current) clearInterval(bellIntervalRef.current);
      if (bellToastTimerRef.current) clearTimeout(bellToastTimerRef.current);
    };
  }, []);

  // Set or clear srcObject when stream changes
  useEffect(() => {
    if (liveVideoRef.current) {
      // Assign the new stream, or clear it to null to fully release camera hardware
      liveVideoRef.current.srcObject = stream || null;
    }
  }, [cameraActive, recordingStatus, stream]);

  const handleWaitTimeChange = (sec) => {
    setWaitTime(sec);
    try {
      localStorage.setItem('ssb_lecturette_wait_time', sec.toString());
    } catch (e) {}
  };

  const handleInitiateRecording = async () => {
    let currentStream = streamRef.current || stream;
    if (!currentStream) {
      setError('Please enable camera before recording.');
      return;
    }
    setError(null);
    setUploadSuccess(null);

    // Actively verify and attach audio track on user gesture
    currentStream = await ensureAudioTrack(currentStream);

    if (waitTime === 0) {
      executeStartRecording(currentStream);
      return;
    }

    setRecordingStatus('COUNTDOWN');
    setCountdown(waitTime);
    soundEngine.playCountdownTick(false);

    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          soundEngine.playCountdownTick(true);
          setCountdown(null);
          executeStartRecording(streamRef.current || currentStream);
          return null;
        }
        soundEngine.playCountdownTick(false);
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancelCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
    setRecordingStatus('IDLE');
  };

  // Execute recording start with synchronized audio, optimized bitrate, and SSB bell listener
  const executeStartRecording = async (providedStream) => {
    let activeStream = providedStream || streamRef.current || stream;
    if (!activeStream) {
      setError('Please enable camera before recording.');
      return;
    }

    // Ensure audio track is healthy and unmuted
    activeStream = await ensureAudioTrack(activeStream);
    const audioTracks = activeStream.getAudioTracks();
    const hasAudio = audioTracks.some(t => t.readyState === 'live' && t.enabled);

    if (!hasAudio) {
      const proceed = window.confirm(
        'Notice: Microphone is not detected or is muted. Your lecturette will be recorded WITHOUT sound.\n\nClick OK to record video-only, or Cancel to enable your microphone.'
      );
      if (!proceed) {
        setRecordingStatus('IDLE');
        return;
      }
    }

    setError(null);
    setUploadSuccess(null);
    chunksRef.current = [];
    totalDurationRef.current = 0;
    setRecordingElapsed(0);
    singleBellFiredRef.current = false;
    doubleBellFiredRef.current = false;
    setBellAlertNotification(null);
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
      // Optimize bitrate: 600 kbps video + 64 kbps mono audio — sharp speech video, reduces file size by ~40-50% for fast uploads
      const options = {
        videoBitsPerSecond: 600_000
      };
      if (hasAudio) {
        options.audioBitsPerSecond = 64_000;
      }
      if (selectedMimeType) {
        options.mimeType = selectedMimeType;
      }

      let mr = null;
      try {
        mr = new MediaRecorder(activeStream, options);
      } catch (e1) {
        try {
          mr = new MediaRecorder(activeStream, selectedMimeType ? { mimeType: selectedMimeType } : {});
        } catch (e2) {
          mr = new MediaRecorder(activeStream);
        }
      }

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mr.onstop = async () => {
        const rawBlob = new Blob(chunksRef.current, { type: mr.mimeType || selectedMimeType || 'video/webm' });
        const durationSec = totalDurationRef.current || Math.round((Date.now() - startTimeRef.current) / 1000) || 1;
        const durationMs = Math.max(1000, Math.round(durationSec * 1000));
        let finalBlob = rawBlob;

        // Patch WebM header with exact duration so downloaded video has perfectly synced seeking
        try {
          if (rawBlob.type.includes('webm') || !rawBlob.type) {
            finalBlob = await fixWebmDuration(rawBlob, durationMs, { logger: false });
          }
        } catch (fixErr) {
          console.warn('Could not patch WebM duration header:', fixErr);
          finalBlob = rawBlob;
        }

        setRecordedBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setRecordedUrl(url);
        setRecordingStatus('STOPPED');
        setIsPlaying(false);
        setCurrentTime(0);
        setVideoDuration(durationSec);
        if (bellIntervalRef.current) {
          clearInterval(bellIntervalRef.current);
          bellIntervalRef.current = null;
        }
      };

      mr.start(1000); // 1-second chunks
      mediaRecorderRef.current = mr;
      setRecordingStatus('RECORDING');

      // Start Bell tracking interval (Single bell at 2m 30s / 150s, Double bell at 3m 00s / 180s)
      if (bellIntervalRef.current) clearInterval(bellIntervalRef.current);
      bellIntervalRef.current = setInterval(() => {
        const elapsed = totalDurationRef.current + Math.round((Date.now() - startTimeRef.current) / 1000);
        setRecordingElapsed(elapsed);

        // 1. Single Bell at 2m 30s (150 seconds elapsed, 30s remaining)
        if (elapsed >= 150 && !singleBellFiredRef.current) {
          singleBellFiredRef.current = true;
          if (ssbBellsEnabled) soundEngine.playSingleBell();
          setBellAlertNotification({
            title: '30 Seconds Remaining',
            text: 'Single Bell (2m 30s) — Please conclude your speech.'
          });
          if (bellToastTimerRef.current) clearTimeout(bellToastTimerRef.current);
          bellToastTimerRef.current = setTimeout(() => setBellAlertNotification(null), 4500);
        }

        // 2. Double Bell at 3m 00s (180 seconds elapsed, time complete)
        if (elapsed >= 180 && !doubleBellFiredRef.current) {
          doubleBellFiredRef.current = true;
          if (ssbBellsEnabled) soundEngine.playDoubleBell();
          setBellAlertNotification({
            title: 'Lecturette Time Complete',
            text: 'Double Bell (3m 00s) — Lecturette time is up.'
          });
          if (bellToastTimerRef.current) clearTimeout(bellToastTimerRef.current);
          bellToastTimerRef.current = setTimeout(() => setBellAlertNotification(null), 5000);
        }
      }, 1000);
    } catch (err) {
      setError('Could not start recording: ' + err.message);
    }
  };

  // Pause recording
  const handlePauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      totalDurationRef.current += Math.round((Date.now() - startTimeRef.current) / 1000);
      setRecordingElapsed(totalDurationRef.current);
      if (bellIntervalRef.current) {
        clearInterval(bellIntervalRef.current);
        bellIntervalRef.current = null;
      }
      setRecordingStatus('PAUSED');
    }
  };

  // Resume recording
  const handleResumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setRecordingStatus('RECORDING');

      if (bellIntervalRef.current) clearInterval(bellIntervalRef.current);
      bellIntervalRef.current = setInterval(() => {
        const elapsed = totalDurationRef.current + Math.round((Date.now() - startTimeRef.current) / 1000);
        setRecordingElapsed(elapsed);

        if (elapsed >= 150 && !singleBellFiredRef.current) {
          singleBellFiredRef.current = true;
          if (ssbBellsEnabled) soundEngine.playSingleBell();
          setBellAlertNotification({
            title: '30 Seconds Remaining',
            text: 'Single Bell (2m 30s) — Please conclude your speech.'
          });
          if (bellToastTimerRef.current) clearTimeout(bellToastTimerRef.current);
          bellToastTimerRef.current = setTimeout(() => setBellAlertNotification(null), 4500);
        }

        if (elapsed >= 180 && !doubleBellFiredRef.current) {
          doubleBellFiredRef.current = true;
          if (ssbBellsEnabled) soundEngine.playDoubleBell();
          setBellAlertNotification({
            title: 'Lecturette Time Complete',
            text: 'Double Bell (3m 00s) — Lecturette time is up.'
          });
          if (bellToastTimerRef.current) clearTimeout(bellToastTimerRef.current);
          bellToastTimerRef.current = setTimeout(() => setBellAlertNotification(null), 5000);
        }
      }, 1000);
    }
  };

  // Stop recording
  const handleStopRecording = () => {
    if (bellIntervalRef.current) {
      clearInterval(bellIntervalRef.current);
      bellIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (recordingStatus === 'RECORDING') {
        totalDurationRef.current += Math.round((Date.now() - startTimeRef.current) / 1000);
      }
      mediaRecorderRef.current.stop();
    }
  };

  const handleDownloadRecorded = () => {
    if (!recordedBlob) return;
    try {
      const a = document.createElement('a');
      const ext = recordedBlob.type && recordedBlob.type.includes('mp4') ? '.mp4' : '.webm';
      const baseName = (recTitle || `lecturette-${recDate || selectedFolder}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = baseName.endsWith('.mp4') || baseName.endsWith('.webm') ? baseName : `${baseName}${ext}`;
      const dlUrl = URL.createObjectURL(recordedBlob);
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 5000);
    } catch (e) {
      console.warn('Download error:', e);
    }
  };

  const handleDownloadUrl = (url, title) => {
    if (!url) return;
    try {
      let dlUrl = apiUrl(url);
      if (dlUrl.includes('cloudinary.com') && dlUrl.includes('/upload/')) {
        dlUrl = dlUrl.replace('/upload/', '/upload/fl_attachment/');
      }
      const ext = url.includes('.mp4') ? '.mp4' : '.webm';
      const baseName = (title || 'lecturette-video').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = baseName.endsWith('.mp4') || baseName.endsWith('.webm') ? baseName : `${baseName}${ext}`;
      const a = document.createElement('a');
      a.href = dlUrl;
      a.target = '_blank';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      window.open(apiUrl(url), '_blank');
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

  // Discard & retake confirmation click — opens custom popup modal instead of browser alert
  const handleRetake = () => {
    // If there is an active recording, paused session, an ongoing upload, or a recorded blob, show the custom confirmation popup
    if (
      recordingStatus === 'RECORDING' ||
      recordingStatus === 'PAUSED' ||
      uploadXhrRef.current ||
      uploading ||
      recordedBlob
    ) {
      setRetakeConfirmOpen(true);
    } else {
      executeRetake();
    }
  };

  // Perform actual discard & retake reset cleanly
  const executeRetake = () => {
    setRetakeConfirmOpen(false);

    // Check if there was an active upload being aborted — show discarded toast in that case
    const wasUploading = Boolean(uploadXhrRef.current || uploading);

    // Abort active upload if in progress
    if (uploadXhrRef.current) {
      try { uploadXhrRef.current.abort(); } catch (e) {}
      uploadXhrRef.current = null;
    }
    setUploading(false);
    setUploadProgress(null);

    // If an upload was aborted, show a "video discarded" toast (not the success toast)
    if (wasUploading) {
      setUploadSuccessToast(null); // ensure success toast is never shown
      setVideoDiscardedToast(true);
      setTimeout(() => setVideoDiscardedToast(false), 4000);
    }

    // Stop active recorder if running
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }

    if (bellIntervalRef.current) {
      clearInterval(bellIntervalRef.current);
      bellIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (bellToastTimerRef.current) {
      clearTimeout(bellToastTimerRef.current);
      bellToastTimerRef.current = null;
    }
    setBellAlertNotification(null);
    setRecordingElapsed(0);
    singleBellFiredRef.current = false;
    doubleBellFiredRef.current = false;
    if (playbackVideoRef.current) {
      try { playbackVideoRef.current.pause(); } catch (e) {}
    }
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    chunksRef.current = [];
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingStatus('IDLE');
    setUploadSuccess(null);
    setUploadProgress(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    totalDurationRef.current = 0;
    if (streamRef.current) {
      setupAudioAnalyser(streamRef.current);
    }
  };

  useEffect(() => {
    if (folders && folders.length > 0) {
      if (!selectedFolder || !folders.some(f => f.dateFolder === selectedFolder)) {
        setSelectedFolder(folders[0].dateFolder);
        setRecDate(folders[0].dateFolder);
        if (!recTitle || recTitle.startsWith('Lecturette')) {
          setRecTitle(`Lecturette ${folders[0].dateFolder}`);
        }
      }
    }
  }, [folders]);

  useEffect(() => {
    if (selectedFolder) {
      setRecDate(selectedFolder);
      if (!recTitle || recTitle.startsWith('Lecturette')) {
        setRecTitle(`Lecturette ${selectedFolder}`);
      }
    }
  }, [selectedFolder]);

  // Handle user selecting an already recorded video file from disk
  const handleVideoFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate video format
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i)) {
      setError('Please select a valid video file (.mp4, .webm, .mov, etc.)');
      return;
    }

    // Stop active camera session cleanly
    stopCamera();
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (bellIntervalRef.current) clearInterval(bellIntervalRef.current);

    setError(null);
    setUploadSuccess(null);

    // Create object URL for local preview
    const videoUrl = URL.createObjectURL(file);
    setRecordedBlob(file);
    setRecordedUrl(videoUrl);

    // Pre-populate title from file name
    const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
    setRecTitle(baseName || `Lecturette ${recDate || selectedFolder}`);

    // Read duration from video metadata
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = videoUrl;
    tempVideo.onloadedmetadata = () => {
      const dur = Math.round(tempVideo.duration) || 0;
      totalDurationRef.current = dur;
      setVideoDuration(dur);
    };

    // Transition directly to STOPPED state (Studio Review & Cloud Save mode)
    setRecordingStatus('STOPPED');

    // Reset input so re-selecting same file works
    e.target.value = '';
  };

  // Direct Cloudinary upload with real-time progress and server fallback
  const handleSaveToCloudinary = async () => {
    if (!recordedBlob) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const targetFolder = (recDate || selectedFolder || folders[0]?.dateFolder || today).trim();
      const targetTitle = (recTitle || `Lecturette ${targetFolder}`).trim();
      const durationVal = Math.round(totalDurationRef.current || videoDuration || 0);

      let fileToUpload = recordedBlob;
      if (!(recordedBlob instanceof File)) {
        const ext = recordedBlob.type && recordedBlob.type.includes('mp4') ? '.mp4' : '.webm';
        fileToUpload = new File([recordedBlob], `lecturette-${Date.now()}${ext}`, { type: recordedBlob.type || 'video/webm' });
      }

      // Upload directly to server which streams and archives to Backblaze B2

      // Step 2: Fallback to server-side upload if direct Cloudinary upload was not possible
      const fd = new FormData();
      fd.append('video', fileToUpload);
      fd.append('title', targetTitle);
      fd.append('recordedDate', targetFolder);
      fd.append('duration', durationVal.toString());

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.timeout = 240000;
        xhr.open('POST', apiUrl(`/api/folders/${encodeURIComponent(targetFolder)}/lecturette`));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
            setUploadProgress(pct);
          }
        };
        xhr.onload = () => {
          uploadXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              resolve({});
            }
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || 'Failed to upload video'));
            } catch {
              reject(new Error(`Upload failed with HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => { uploadXhrRef.current = null; reject(new Error('Network error while uploading video')); };
        xhr.ontimeout = () => { uploadXhrRef.current = null; reject(new Error('Upload timed out after 4 minutes')); };
        xhr.onabort = () => { uploadXhrRef.current = null; reject(new Error('Upload cancelled')); };
        xhr.send(fd);
      });

      setUploadSuccess(`Lecturette "${targetTitle}" saved successfully!`);
      // Floating toast with auto-dismiss
      setUploadSuccessToast(`✓ Lecturette "${targetTitle}" uploaded successfully!`);
      setTimeout(() => setUploadSuccessToast(null), 5000);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // Edit existing lecturette title and date
  const handleSaveLecturetteEdit = async () => {
    if (!editingLecturette) return;
    setLecEditSaving(true);
    try {
      const { id, folderDate, title, recordedDate } = editingLecturette;
      const res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(folderDate)}/lecturette/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, recordedDate })
      });
      if (!res.ok) throw new Error('Failed to update lecturette');
      setEditingLecturette(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLecEditSaving(false);
    }
  };

  // Delete lecturette from folder
  const executeDeleteLecturette = async (folderDate, lecturetteId) => {
    setDeletingLecturetteId(lecturetteId);
    try {
      const idToUse = lecturetteId;
      if (!idToUse) throw new Error('No lecturette specified');
      let res = await fetch(apiUrl(`/api/folders/${encodeURIComponent(folderDate || 'any')}/lecturette/${encodeURIComponent(idToUse)}`), {
        method: 'DELETE'
      });
      if (!res.ok) {
        // Fallback to top-level delete route
        res = await fetch(apiUrl(`/api/lecturettes/${encodeURIComponent(idToUse)}`), {
          method: 'DELETE'
        });
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Could not delete video');
      }
      setDeleteConfirmLec(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingLecturetteId(null);
    }
  };

  // Aggregate past recorded lecturettes across all folders
  const allLecturettes = folders.flatMap(f =>
    (f.lecturettes || []).map(l => ({
      ...l,
      id: l.id || l._id?.toString() || l._id,
      _id: l._id?.toString() || l.id,
      folderDate: f.dateFolder
    }))
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Floating Upload Success Toast */}
      {uploadSuccessToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] animate-fadeIn pointer-events-none">
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border border-emerald-500/40 bg-emerald-600 text-white text-sm font-semibold max-w-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-200" />
            <span className="leading-snug">{uploadSuccessToast}</span>
          </div>
        </div>
      )}

      {/* Floating Video Discarded Toast (shown when retake aborts an active upload) */}
      {videoDiscardedToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] animate-fadeIn pointer-events-none">
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border border-amber-500/40 bg-amber-600 text-white text-sm font-semibold max-w-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-200" />
            <span className="leading-snug">Video discarded — upload cancelled.</span>
          </div>
        </div>
      )}

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
            Record your lecturette live and store the video securely in the cloud.
          </p>
        </div>

        {/* Target Folder Selector */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
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
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{uploadSuccess}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={executeRetake} className="btn-secondary text-[11px] py-0.5">
              Record Another
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary bg-purple-600/10 text-purple-600 dark:text-purple-400 hover:bg-purple-600/20 text-[11px] py-0.5 flex items-center gap-1"
            >
              <Upload className="w-3 h-3" />
              <span>Upload Another</span>
            </button>
          </div>
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
                  <div className="flex items-center gap-2">
                    <button onClick={startCamera} className="btn-primary text-xs flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5" /> Enable Camera
                    </button>
                  </div>
                </div>
              )}
              {/* Countdown Overlay */}
              {recordingStatus === 'COUNTDOWN' && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center z-30 animate-fadeIn select-none">
                  <div className="relative flex items-center justify-center">
                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin absolute" />
                    <span className="text-5xl sm:text-6xl font-black text-white font-mono drop-shadow-xl animate-pulse">
                      {countdown}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-200 mt-4 tracking-wide">
                    Get Ready! Recording starts in {countdown}s...
                  </p>
                  <button
                    type="button"
                    onClick={handleCancelCountdown}
                    className="mt-4 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md text-xs border border-slate-700 flex items-center gap-1 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              )}

              {/* Bell Alert Toast / Banner */}
              {bellAlertNotification && (
                <div className="absolute top-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 flex items-center gap-2.5 px-4 py-2 rounded-xl backdrop-blur-md shadow-2xl border transition-all z-20 animate-bounce bg-amber-500/95 border-amber-300 text-slate-950 font-sans">
                  <Bell className="w-4 h-4 fill-current text-slate-950 shrink-0" />
                  <div className="text-xs font-bold leading-tight">
                    <div>{bellAlertNotification.title}</div>
                    <div className="text-[11px] font-medium opacity-90">{bellAlertNotification.text}</div>
                  </div>
                </div>
              )}

              {/* Recording Indicator with Live Mic Status */}
              {recordingStatus === 'RECORDING' && (
                <div className="absolute top-4 left-4 flex items-center gap-2.5 bg-black/75 backdrop-blur-md px-3 py-1 rounded-full border border-red-500/50 z-20">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="text-[11px] font-bold text-red-400 uppercase tracking-widest font-mono">
                    REC
                  </span>
                  {micActive && !micMuted ? (
                    <span className="flex items-center gap-1 border-l border-white/20 pl-2 text-emerald-400">
                      <Mic className="w-3 h-3 text-emerald-400" />
                      <span
                        className="w-1.5 h-2.5 bg-emerald-400 rounded-full transition-all duration-75"
                        style={{ opacity: audioLevel > 5 ? 1 : 0.4 }}
                      />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 border-l border-white/20 pl-2 text-amber-400" title="Microphone is not recording voice">
                      <MicOff className="w-3 h-3 text-amber-400" />
                      <span className="text-[9px] font-mono uppercase text-amber-300">No Mic</span>
                    </span>
                  )}
                </div>
              )}
              {recordingStatus === 'PAUSED' && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full border border-amber-500/50 z-20">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-[11px] font-bold text-amber-300 uppercase tracking-widest font-mono">
                    PAUSED
                  </span>
                </div>
              )}
            </>
          ) : (
            /* Custom Recorded Video Review Player with Blue Controls & Blue Buttons */
            <CustomVideoPlayer
              src={recordedUrl}
              fallbackDuration={totalDurationRef.current}
              downloadFilename={(recTitle || `lecturette-${recDate || selectedFolder}`).replace(/[^a-zA-Z0-9_-]/g, '_')}
              className="w-full h-full"
            />
          )}
        </div>

        {/* Upload Progress Bar when uploading */}
        {uploading && uploadProgress !== null && (
          <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

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
            {/* Left: Device Toggles (Camera & Microphone) */}
            <div className="flex items-center gap-1.5">
              {cameraActive ? (
                <button
                  onClick={stopCamera}
                  disabled={recordingStatus === 'RECORDING' || recordingStatus === 'COUNTDOWN'}
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

              {/* Microphone Toggle & Real-time VU Voice Meter */}
              <button
                type="button"
                onClick={toggleMicrophone}
                disabled={recordingStatus === 'RECORDING' || recordingStatus === 'COUNTDOWN'}
                className={`p-1.5 rounded-md transition-colors flex items-center gap-1.5 text-xs font-semibold disabled:opacity-40 ${
                  !micActive
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                    : micMuted
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                    : 'bg-slate-800 text-emerald-400 hover:text-emerald-300 hover:bg-slate-700'
                }`}
                title={
                  !micActive
                    ? 'Microphone is inactive — click to enable'
                    : micMuted
                    ? 'Microphone is muted — click to unmute'
                    : 'Microphone is active & recording voice'
                }
              >
                {!micActive || micMuted ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4 text-emerald-400" />
                )}
                {micActive && !micMuted && (
                  <span className="flex items-center gap-1">
                    <span
                      className="w-1.5 rounded-full bg-emerald-400 transition-all duration-75"
                      style={{
                        height: `${Math.max(6, Math.min(16, 6 + (audioLevel / 100) * 10))}px`,
                        opacity: audioLevel > 5 ? 1 : 0.4
                      }}
                    />
                    <span className="text-[10px] font-mono text-emerald-400 hidden sm:inline">
                      {audioLevel > 5 ? 'Voice ON' : 'Mic ON'}
                    </span>
                  </span>
                )}
                {!micActive && (
                  <span className="text-[10px] font-mono text-red-400 hidden sm:inline">
                    Enable Mic
                  </span>
                )}
              </button>
            </div>

            {/* Center: Recording Action Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {recordingStatus === 'IDLE' && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Countdown Timer Selector (0s, 3s, 5s, 10s) */}
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md px-2 py-1">
                    <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 font-medium">Timer:</span>
                    {[0, 3, 5, 10].map(sec => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleWaitTimeChange(sec)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                          waitTime === sec
                            ? 'bg-blue-600 text-white font-bold shadow-sm'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                        title={`${sec} seconds countdown before recording`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleInitiateRecording}
                    disabled={!cameraActive}
                    className="btn-primary bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-white" />
                    <span>Start Recording</span>
                  </button>
                </div>
              )}

              {recordingStatus === 'COUNTDOWN' && (
                <button
                  onClick={handleCancelCountdown}
                  className="btn-secondary bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 px-3 py-1.5 text-xs flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Countdown ({countdown}s)</span>
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
                    onClick={handleDownloadRecorded}
                    className="btn-secondary bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-3 py-1 text-xs flex items-center gap-1"
                    title="Download recorded video to your computer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download</span>
                  </button>
                  <button
                    onClick={handleSaveToCloudinary}
                    disabled={uploading}
                    className="btn-primary bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1 text-xs flex items-center gap-1.5 disabled:opacity-40 shadow-sm"
                  >
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploading
                        ? (uploadProgress !== null
                            ? (uploadProgress >= 100 ? 'Saving video...' : `Uploading (${uploadProgress}%)...`)
                            : 'Saving...')
                        : 'Upload & Save Video'}
                    </span>
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
            {allLecturettes.map((lec, idx) => {
              const lecId = lec.id || lec._id?.toString() || lec._id || `lec-${idx}`;
              return (
              <div
                key={lecId}
                className="card p-3 space-y-2 relative group hover:border-purple-500/40 transition-colors"
              >
                {/* Loader Overlay when being deleted */}
                {deletingLecturetteId === lecId && (
                  <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center gap-2 z-30 animate-fadeIn select-none">
                    <div className="w-8 h-8 border-3 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
                    <span className="text-xs font-semibold text-red-400">Deleting video...</span>
                  </div>
                )}
                <div
                  onClick={() => setPlayingVideo(lec)}
                  className="aspect-video bg-black rounded-md overflow-hidden relative cursor-pointer flex items-center justify-center group-hover:opacity-90"
                >
                  {/* Video thumbnail with loading spinner */}
                  <LectureThumbnail src={apiUrl(lec.url)} />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center pl-0.5 shadow-md group-hover:scale-110 transition-transform">
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
                      onClick={() => handleDownloadUrl(lec.url, lec.title)}
                      className="p-1.5 rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                      title="Download video"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingLecturette({ id: lecId, folderDate: lec.folderDate, title: lec.title || '', recordedDate: lec.recordedDate || lec.folderDate })}
                      className="p-1.5 rounded text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors"
                      title="Edit title and date"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmLec({ folderDate: lec.folderDate, id: lecId, title: lec.title || 'this lecturette' })}
                      className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="Delete lecturette video"
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

      {/* Video Playback Modal */}
      {playingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden max-w-2xl w-full shadow-2xl space-y-2">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-slate-200">
              <span className="text-xs font-bold truncate">{playingVideo.title}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadUrl(playingVideo.url, playingVideo.title)}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs flex items-center gap-1 transition-colors"
                  title="Download video"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => setPlayingVideo(null)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-3">
              <CustomVideoPlayer
                src={apiUrl(playingVideo.url)}
                autoPlay={true}
                downloadFilename={(playingVideo.title || 'lecturette-video').replace(/[^a-zA-Z0-9_-]/g, '_')}
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

      {/* Delete Confirmation Modal for Lecturette Video */}
      {deleteConfirmLec && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-sm w-full p-5 space-y-4 shadow-2xl border border-red-500/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">Confirm Delete</h3>
                <p className="text-xs text-red-500 font-medium">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Are you sure you want to delete lecturette video <span className="font-semibold text-slate-800 dark:text-white">"{deleteConfirmLec.title}"</span>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmLec(null)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { folderDate, id } = deleteConfirmLec;
                  setDeleteConfirmLec(null);
                  await executeDeleteLecturette(folderDate, id);
                }}
                className="btn-danger text-xs flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retake Confirmation Modal Popup (replaces native browser alert/confirm) */}
      {retakeConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setRetakeConfirmOpen(false)}
        >
          <div
            className="card max-w-sm w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-850"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">Discard & Retake?</h3>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {uploading ? 'Upload in progress' : 'Current recording will be lost'}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {uploading
                ? 'The current video recording will be discarded, and the ongoing upload will be cancelled. Are you sure you want to retake?'
                : 'The current video recording will be discarded and cannot be recovered. Are you sure you want to retake and record a new lecturette?'}
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-dark-700">
              <button
                type="button"
                onClick={() => setRetakeConfirmOpen(false)}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeRetake}
                className="btn-primary bg-amber-600 hover:bg-amber-500 text-white text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Yes, Retake</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Hidden File Input for Video Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/mkv,video/x-matroska,video/*,.mp4,.webm,.mov,.mkv"
        onChange={handleVideoFileSelected}
        className="hidden"
      />
    </div>
  );
}
