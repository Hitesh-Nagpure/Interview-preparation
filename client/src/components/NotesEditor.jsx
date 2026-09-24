import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic, Square, Play, Pause, RotateCcw, Save, Check, Copy, Download,
  Trash2, FileText, Clock, Volume2, Cloud, AlertCircle, RefreshCw,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  Heading1, Heading2, Quote, Undo, Redo, Sparkles, User, ShieldCheck
} from 'lucide-react';

function formatDuration(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function NotesEditor({ dateFolder, initialNotes, initialReviews = [], onSaveSuccess }) {
  // Reviewer / Candidate identity state (persisted across sessions)
  const [reviewerName, setReviewerName] = useState(() => {
    try {
      return localStorage.getItem('ssb_reviewer_name') || '';
    } catch {
      return '';
    }
  });
  const [nameTouched, setNameTouched] = useState(false);

  const handleReviewerNameChange = (val) => {
    setReviewerName(val);
    try {
      localStorage.setItem('ssb_reviewer_name', val);
    } catch (e) {
      console.warn('Could not save reviewer name:', e);
    }
  };

  // Rich Text Editor states
  const editorRef = useRef(null);
  const [content, setContent] = useState('');
  const [plainText, setPlainText] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [notesError, setNotesError] = useState(null);
  const [copiedToast, setCopiedToast] = useState(false);

  // Audio Review Recording states
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const previewAudioRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [reviewTitle, setReviewTitle] = useState('');
  const [isUploadingReview, setIsUploadingReview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccessToast, setUploadSuccessToast] = useState(false);

  // Saved Reviews list
  const [reviews, setReviews] = useState(initialReviews || []);
  const [playingReviewId, setPlayingReviewId] = useState(null);
  const [activeAudioElement, setActiveAudioElement] = useState(null);
  const [activeAudioProgress, setActiveAudioProgress] = useState(0);
  const [activeAudioCurrentTime, setActiveAudioCurrentTime] = useState(0);
  const [activeAudioDuration, setActiveAudioDuration] = useState(0);

  // Synchronize initial content and reviews (zero by default)
  useEffect(() => {
    const initialHtml = initialNotes?.content || '';
    setContent(initialHtml);
    if (editorRef.current && editorRef.current.innerHTML !== initialHtml) {
      editorRef.current.innerHTML = initialHtml;
    }
    if (initialNotes?.updatedAt) {
      setLastSavedTime(new Date(initialNotes.updatedAt));
    }
  }, [dateFolder, initialNotes]);

  useEffect(() => {
    setReviews(initialReviews || []);
  }, [initialReviews]);

  // Clean up any object URLs on unmount
  useEffect(() => {
    return () => {
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [recordedAudioUrl]);

  // Update text stats when editor changes
  const updateStats = useCallback(() => {
    if (editorRef.current) {
      const text = editorRef.current.innerText || '';
      setPlainText(text);
      setContent(editorRef.current.innerHTML);
    }
  }, []);

  // Rich Text Formatting execution
  const executeCommand = (command, value = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    updateStats();
  };

  // ── AUDIO RECORDING LOGIC (Optimized for lightning-fast uploads) ───────────────
  const startRecording = async () => {
    setUploadError(null);
    setNameTouched(true);

    const trimmedName = reviewerName.trim();
    if (!trimmedName) {
      setUploadError('Reviewer name is required. Please enter your name in the field above.');
      const nameInput = document.getElementById('reviewer-name-input');
      if (nameInput) nameInput.focus();
      return;
    }

    try {
      // Single mono channel + 44.1kHz speech optimization (reduces file size by 75%)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 44100,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      // 32 kbps Opus: ultra-compact file size for instantaneous network uploads
      const recorderOptions = {
        audioBitsPerSecond: 32000
      };
      if (mimeType) recorderOptions.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        setRecordedAudioBlob(audioBlob);
        const url = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(url);
        setReviewTitle(`Review ${dateFolder} #${reviews.length + 1}`);

        // Stop all audio tracks to release microphone
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(250);
      setIsRecording(true);
      setIsPaused(false);
      setRecordDuration(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Audio recorder error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setUploadError('Microphone permission was denied. Please allow microphone access in your browser settings.');
      } else {
        setUploadError(`Could not access microphone: ${err.message}`);
      }
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      recordingTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (isRecording) {
      stopRecording();
    }
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
    }
    setRecordedAudioBlob(null);
    setRecordedAudioUrl(null);
    setRecordDuration(0);
    setUploadError(null);
    setUploadProgress(null);
  };

  // ── UPLOAD AUDIO REVIEW (High Speed with Real-Time Progress) ─────────────────
  const handleUploadReview = async () => {
    if (!recordedAudioBlob) return;
    const trimmedReviewer = reviewerName.trim();
    if (!trimmedReviewer) {
      setUploadError('Reviewer name is compulsory. Please enter your name above.');
      const nameInput = document.getElementById('reviewer-name-input');
      if (nameInput) nameInput.focus();
      return;
    }

    setIsUploadingReview(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      const ext = recordedAudioBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const filename = `review-${dateFolder}-${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append('audio', recordedAudioBlob, filename);
      formData.append('title', reviewTitle || `Audio Review ${dateFolder}`);
      formData.append('duration', recordDuration.toString());
      formData.append('reviewerName', trimmedReviewer);

      // Fast upload via XHR with streaming progress
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/folders/${encodeURIComponent(dateFolder)}/reviews`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              resolve({});
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || 'Failed to save audio review'));
            } catch {
              reject(new Error(`Upload failed with HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => reject(new Error('Network error while saving review'));
        xhr.send(formData);
      });

      // Update reviews state
      setReviews((prev) => [data.review, ...prev]);
      setUploadSuccessToast(true);
      setTimeout(() => setUploadSuccessToast(false), 3000);

      // Reset recording state
      cancelRecording();

      if (onSaveSuccess) {
        onSaveSuccess({ reviews: [data.review, ...reviews] });
      }
    } catch (err) {
      console.error('Review upload failed:', err);
      setUploadError(err.message);
    } finally {
      setIsUploadingReview(false);
      setUploadProgress(null);
    }
  };

  // Delete saved audio review
  const handleDeleteReview = async (reviewId) => {
    if (!window.confirm('Delete this audio review?')) return;
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(dateFolder)}/reviews/${encodeURIComponent(reviewId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete review');

      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      if (playingReviewId === reviewId) {
        if (activeAudioElement) activeAudioElement.pause();
        setPlayingReviewId(null);
      }
      if (onSaveSuccess) {
        onSaveSuccess({ reviews: reviews.filter((r) => r.id !== reviewId) });
      }
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  };

  // Play / Pause saved review
  const togglePlayReview = (review) => {
    if (playingReviewId === review.id) {
      if (activeAudioElement) {
        activeAudioElement.pause();
      }
      setPlayingReviewId(null);
      return;
    }

    if (activeAudioElement) {
      activeAudioElement.pause();
    }

    const audio = new Audio(review.url);
    setActiveAudioElement(audio);
    setPlayingReviewId(review.id);
    setActiveAudioCurrentTime(0);
    setActiveAudioProgress(0);

    audio.ontimeupdate = () => {
      setActiveAudioCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration)) {
        setActiveAudioDuration(audio.duration);
        setActiveAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.onended = () => {
      setPlayingReviewId(null);
      setActiveAudioProgress(0);
      setActiveAudioCurrentTime(0);
    };

    audio.play().catch((err) => {
      console.warn('Playback error:', err);
      setPlayingReviewId(null);
    });
  };

  // ── SAVE WRITTEN NOTES ──────────────────────────────────────────────────────
  const handleSaveNotes = async () => {
    if (!editorRef.current) return;
    const trimmedReviewer = reviewerName.trim();
    if (!trimmedReviewer) {
      setNotesError('Reviewer name is compulsory. Please enter your name in the field above.');
      const nameInput = document.getElementById('reviewer-name-input');
      if (nameInput) nameInput.focus();
      return;
    }

    const htmlToSave = editorRef.current.innerHTML;
    const textToSave = editorRef.current.innerText || '';

    setIsSavingNotes(true);
    setNotesSaveStatus('saving');
    setNotesError(null);

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(dateFolder)}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: htmlToSave,
          plainText: textToSave,
          author: trimmedReviewer
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save notes');

      setNotesSaveStatus('saved');
      setLastSavedTime(new Date());
      setTimeout(() => setNotesSaveStatus('idle'), 2500);

      if (onSaveSuccess) {
        onSaveSuccess({ notes: data.notes });
      }
    } catch (err) {
      console.error('Save notes error:', err);
      setNotesSaveStatus('error');
      setNotesError(err.message);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleCopyNotes = () => {
    const text = editorRef.current?.innerText || '';
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    });
  };

  const handleDownloadNotes = () => {
    const filename = `notes-${dateFolder}.txt`;
    const text = editorRef.current?.innerText || '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearNotes = () => {
    if (window.confirm('Clear all written notes for this date?')) {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        updateStats();
      }
    }
  };

  const wordsCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
  const charsCount = plainText.length;

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-5 animate-fadeIn w-full overflow-hidden">

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* COMPULSORY REVIEWER IDENTITY BAR (Remembered across sessions)           */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      <div className="bg-slate-50 dark:bg-dark-800/80 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-dark-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shrink-0">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <label htmlFor="reviewer-name-input" className="text-xs font-bold text-slate-800 dark:text-white">
                Reviewer / Author Name
              </label>
              <span className="text-[15px] font-bold text-red-500">*</span>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                Auto-Saved
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Required for recording audio reviews & saving written notes
            </p>
          </div>
        </div>

        <div className="w-full sm:w-72 shrink-0">
          <div className="relative">
            <input
              id="reviewer-name-input"
              type="text"
              value={reviewerName}
              onChange={(e) => handleReviewerNameChange(e.target.value)}
              placeholder="e.g. Major Rohit / Cadet Aryan"
              className={`input py-1.5 px-3 text-xs w-full bg-white dark:bg-dark-900 border ${nameTouched && !reviewerName.trim()
                  ? 'border-red-400 focus:border-red-500 ring-1 ring-red-400'
                  : 'border-slate-200 dark:border-dark-700 focus:border-indigo-500'
                }`}
              required
            />
            {!reviewerName.trim() && (
              <span className="absolute right-2.5 top-2 text-[10px] text-amber-500 font-semibold pointer-events-none">
                Required
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 1: AUDIO REVIEW RECORDER (Ultra-Fast Uploads)                    */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-amber-500/10 via-purple-500/5 to-transparent p-3 sm:p-5 rounded-2xl border border-amber-500/20 shadow-sm space-y-4">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Audio Reviews
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30">
                  {reviews.length} {reviews.length === 1 ? 'Review' : 'Reviews'}
                </span>
                {/* <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  <Cloud className="w-3 h-3" /> Cloud Sync
                </span> */}
              </div>
              {/* <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Record your voice review, debriefing, or feedback and store it securely
              </p> */}
            </div>
          </div>

          {/* Record Trigger Button (when not recording or reviewing) */}
          {!isRecording && !recordedAudioBlob && (
            <button
              type="button"
              onClick={startRecording}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl px-4 py-2 text-xs inline-flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all shrink-0 w-full sm:w-auto"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
              <Mic className="w-4 h-4" />
              <span>Record Voice Review</span>
            </button>
          )}
        </div>

        {/* Error Notice */}
        {uploadError && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">{uploadError}</span>
            </div>
            <button onClick={() => setUploadError(null)} className="font-bold px-1 hover:opacity-80">
              ✕
            </button>
          </div>
        )}

        {/* Success Notice */}
        {uploadSuccessToast && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4 shrink-0" />
            <span>Audio review successfully saved!</span>
          </div>
        )}

        {/* LIVE RECORDING ACTIVE INTERFACE */}
        {isRecording && (
          <div className="p-4 bg-white dark:bg-dark-800 rounded-xl border border-amber-500/40 shadow-md space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              {/* Pulsing visual wave & timer */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 h-6">
                  <span className={`w-1.5 rounded-full bg-red-500 transition-all ${isPaused ? 'h-2' : 'h-6 animate-pulse'}`} />
                  <span className={`w-1.5 rounded-full bg-amber-500 transition-all ${isPaused ? 'h-2' : 'h-4 animate-pulse'}`} />
                  <span className={`w-1.5 rounded-full bg-red-500 transition-all ${isPaused ? 'h-2' : 'h-8 animate-pulse'}`} />
                  <span className={`w-1.5 rounded-full bg-amber-500 transition-all ${isPaused ? 'h-2' : 'h-5 animate-pulse'}`} />
                  <span className={`w-1.5 rounded-full bg-red-500 transition-all ${isPaused ? 'h-2' : 'h-7 animate-pulse'}`} />
                </div>
                <div>
                  <span className="font-mono text-xl sm:text-2xl font-black text-slate-800 dark:text-white">
                    {formatDuration(recordDuration)}
                  </span>
                  <span className="text-[11px] font-bold text-red-500 uppercase tracking-widest ml-2">
                    {isPaused ? 'Paused' : 'Recording Audio'}
                  </span>
                </div>
              </div>

              {/* Recording Controls */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                {isPaused ? (
                  <button
                    type="button"
                    onClick={resumeRecording}
                    className="btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={pauseRecording}
                    className="btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                )}

                <button
                  type="button"
                  onClick={stopRecording}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg px-3.5 py-1.5 text-xs flex items-center gap-1.5 shadow"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop & Review
                </button>

                <button
                  type="button"
                  onClick={cancelRecording}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RECORDED PREVIEW & UPLOAD CARD */}
        {!isRecording && recordedAudioBlob && (
          <div className="p-4 bg-white dark:bg-dark-800 rounded-xl border border-amber-500/40 shadow-lg space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Review Recording Ready</span>
                  <span className="text-xs font-mono text-amber-500 font-semibold">
                    ({formatDuration(recordDuration)})
                  </span>
                </h4>
                <p className="text-xs text-slate-400">
                  Preview your recorded review before saving
                </p>
              </div>

              {/* Title input */}
              <input
                type="text"
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                placeholder="Review Title (optional)"
                className="input py-1 text-xs w-full sm:w-60"
              />
            </div>

            {/* Audio Player Preview */}
            <div className="bg-slate-100 dark:bg-dark-900 p-2.5 rounded-lg flex items-center gap-3">
              <audio
                ref={previewAudioRef}
                src={recordedAudioUrl}
                controls
                className="w-full h-9 accent-amber-500"
              />
            </div>

            {/* Live Upload Progress Bar */}
            {isUploadingReview && uploadProgress !== null && (
              <div className="w-full bg-slate-200 dark:bg-dark-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}

            {/* Upload or Discard Actions */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-500" />
                <span>Reviewer: <strong>{reviewerName.trim() || '(Please enter name above)'}</strong></span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelRecording}
                  disabled={isUploadingReview}
                  className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Discard
                </button>

                <button
                  type="button"
                  onClick={handleUploadReview}
                  disabled={isUploadingReview}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg px-4 py-1.5 text-xs flex items-center gap-2 shadow-md transition-all disabled:opacity-50"
                >
                  {isUploadingReview ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Review {uploadProgress !== null ? `(${uploadProgress}%)` : ''}...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Review</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SAVED REVIEWS LIST (Zero by default) */}
        <div className="space-y-2 pt-1">
          {reviews.length === 0 ? (
            /* Zero Reviews Default State */
            <div className="p-6 text-center rounded-xl bg-white/50 dark:bg-dark-900/40 border border-dashed border-slate-200 dark:border-dark-700 space-y-1.5">
              <Volume2 className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                0 Audio Reviews recorded for this date
              </p>
              <p className="text-[11px] text-slate-400">
                Click "Record Voice Review" above to record spoken analysis or psych test feedback.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {reviews.map((rev) => {
                const isPlaying = playingReviewId === rev.id;
                return (
                  <div
                    key={rev.id}
                    className="p-3 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-amber-500/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Play/Pause Button */}
                      <button
                        type="button"
                        onClick={() => togglePlayReview(rev)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md transition-all ${isPlaying
                            ? 'bg-amber-500 text-slate-950 scale-105'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        title={isPlaying ? 'Pause' : 'Play Audio Review'}
                      >
                        {isPlaying ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current translate-x-0.5" />
                        )}
                      </button>

                      {/* Info & Progress */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                            {rev.title || 'Audio Review'}
                          </p>
                          {rev.reviewerName && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center gap-1">
                              <User className="w-2.5 h-2.5" /> {rev.reviewerName}
                            </span>
                          )}
                          {rev.duration > 0 && (
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-dark-700 text-slate-500">
                              {formatDuration(rev.duration)}
                            </span>
                          )}
                        </div>

                        {/* Progress Bar when playing */}
                        {isPlaying ? (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-slate-200 dark:bg-dark-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all duration-100"
                                style={{ width: `${activeAudioProgress}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-amber-500 shrink-0">
                              {formatDuration(activeAudioCurrentTime)} / {formatDuration(activeAudioDuration || rev.duration)}
                            </span>
                          </div>
                        ) : (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Recorded on {new Date(rev.recordedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Cloud Storage
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions: Download & Delete */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <a
                        href={rev.url}
                        download={`audio-review-${rev.id}.webm`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                        title="Download audio file"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteReview(rev.id)}
                        className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        title="Delete audio review"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 2: WRITTEN PRACTICE NOTES (Rich Text Editor)                     */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      <div className="border border-slate-200 dark:border-dark-600 rounded-2xl overflow-hidden bg-white dark:bg-dark-900 shadow-sm flex flex-col">
        {/* Section Header */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-dark-800 border-b border-slate-200 dark:border-dark-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                  Written Practice Notes
                </h4>
                {initialNotes?.author && (
                  <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 flex items-center gap-1">
                    <User className="w-2.5 h-2.5" /> {initialNotes.author}
                  </span>
                )}
              </div>
              {/* <p className="text-[11px] text-slate-400">
                Detailed notes, story summaries, and psychologist observations
              </p> */}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={isSavingNotes}
            className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${notesSaveStatus === 'saved'
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
          >
            {isSavingNotes ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : notesSaveStatus === 'saved' ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Notes</span>
              </>
            )}
          </button>
        </div>

        {/* Error Notice */}
        {notesError && (
          <div className="p-3 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/40 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{notesError}</span>
            </div>
            <button onClick={() => setNotesError(null)} className="font-bold px-1 hover:opacity-80">
              ✕
            </button>
          </div>
        )}

        {/* Formatting Toolbar - Highly Responsive */}
        <div className="p-1.5 sm:p-2 bg-slate-100/60 dark:bg-dark-800/60 border-b border-slate-200 dark:border-dark-700 flex flex-wrap items-center gap-1 text-slate-700 dark:text-slate-300">
          {/* Headings */}
          <button
            type="button"
            onClick={() => executeCommand('formatBlock', '<h2>')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Heading 1"
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('formatBlock', '<h3>')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Heading 2"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('formatBlock', '<p>')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors text-xs font-bold"
            title="Paragraph"
          >
            P
          </button>

          <span className="w-px h-4 bg-slate-300 dark:bg-dark-600 mx-1 hidden xs:block" />

          {/* Inline styles */}
          <button
            type="button"
            onClick={() => executeCommand('bold')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors font-bold"
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('italic')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('underline')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Underline"
          >
            <Underline className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('strikeThrough')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </button>

          <span className="w-px h-4 bg-slate-300 dark:bg-dark-600 mx-1 hidden xs:block" />

          {/* Lists */}
          <button
            type="button"
            onClick={() => executeCommand('insertUnorderedList')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('insertOrderedList')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('formatBlock', '<blockquote>')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Quote"
          >
            <Quote className="w-4 h-4" />
          </button>

          <span className="w-px h-4 bg-slate-300 dark:bg-dark-600 mx-1 hidden xs:block" />

          {/* History */}
          <button
            type="button"
            onClick={() => executeCommand('undo')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => executeCommand('redo')}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </button>

          {/* Quick Actions */}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyNotes}
              className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors relative"
              title="Copy notes to clipboard"
            >
              <Copy className="w-4 h-4" />
              {copiedToast && (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-0.5 rounded shadow">
                  Copied!
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadNotes}
              className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-dark-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
              title="Export as .txt file"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleClearNotes}
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-slate-400 hover:text-red-500 transition-colors"
              title="Clear notes"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Contenteditable Rich Text Area */}
        <div
          ref={editorRef}
          contentEditable
          onInput={updateStats}
          onBlur={updateStats}
          className="p-4 min-h-[220px] max-h-[500px] overflow-y-auto focus:outline-none text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
          data-placeholder="Start typing your daily practice review, observations, psychologist tips, or character notes here..."
        />

        {/* Editor Bottom Stats Bar */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-dark-800/60 border-t border-slate-200 dark:border-dark-700 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
          <div className="flex items-center gap-3">
            <span>{wordsCount} words</span>
            <span>·</span>
            <span>{charsCount} characters</span>
          </div>

          <div className="flex items-center gap-2">
            {reviewerName.trim() && (
              <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                Author: {reviewerName.trim()}
              </span>
            )}
            {lastSavedTime && (
              <span>
                · Last saved: {lastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
