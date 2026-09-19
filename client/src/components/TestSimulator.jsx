import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, SkipForward, Square, Maximize2, Minimize2,
  RotateCcw, CheckCircle2, ArrowLeft, Shield, Sun, Moon
} from 'lucide-react';
import { soundEngine } from '../utils/audio';

export default function TestSimulator({ testType: testTypeProp, dateFolder, onExit, isDark, toggleTheme }) {
  // For PSYCH mode we run TAT first then WAT
  const [psychPhase, setPsychPhase] = React.useState(
    testTypeProp === 'PSYCH' ? 'TAT' : testTypeProp
  );
  const testType = testTypeProp === 'PSYCH' ? psychPhase : testTypeProp;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [folderData, setFolderData] = useState(null);
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState('BRIEFING');
  const [tatPhase, setTatPhase] = useState('OBSERVE');
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalPhaseDuration, setTotalPhaseDuration] = useState(0);
  const [responses, setResponses] = useState({});
  const [paperMode, setPaperMode] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [includeBlankSlide, setIncludeBlankSlide] = useState(true);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    fetch(`/api/folders/${encodeURIComponent(dateFolder)}`)
      .then(r => { if (!r.ok) throw new Error('Could not load batch'); return r.json(); })
      .then(data => { setFolderData(data); prepareItems(data, true); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [dateFolder]);

  // When PSYCH transitions from TAT to WAT, re-prepare items from cached data
  useEffect(() => {
    if (folderData && testTypeProp === 'PSYCH' && psychPhase === 'WAT') {
      prepareItems(folderData, false);
    }
  }, [psychPhase]);

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const prepareItems = (data, withBlank) => {
    const useBlank = withBlank !== undefined ? withBlank : includeBlankSlide;
    if (testType === 'TAT') {
      const pics = data.tat?.pictures || [];
      if (!pics.length) { setError('No TAT pictures in this folder.'); return; }
      // Separate into rewrite and fresh groups, shuffle each independently
      const rewritePics = pics.filter(p => p.batch === 'rewrite');
      const freshPics = pics.filter(p => !p.batch || p.batch === 'fresh');
      const ordered = [...shuffle(rewritePics), ...shuffle(freshPics)];
      if (useBlank) ordered.push({ id: 'blank', url: null, isBlank: true });
      setItems(ordered);
    } else {
      const words = data.wat?.words || [];
      if (!words.length) { setError('No WAT words in this folder.'); return; }
      setItems(shuffle(words));
    }
  };

  const startSimulation = () => {
    prepareItems(folderData, includeBlankSlide);
    soundEngine.init();
    setCurrentIndex(0);
    setStatus('RUNNING');
    const dur = testType === 'TAT' ? Math.round(30 / speedMultiplier) : Math.round(15 / speedMultiplier);
    if (testType === 'TAT') setTatPhase('OBSERVE');
    setTimeLeft(dur);
    setTotalPhaseDuration(dur);
    soundEngine.playTransitionChime();
  };

  useEffect(() => {
    if (status !== 'RUNNING') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { handleAutoTransition(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status, tatPhase, currentIndex, items, speedMultiplier]);

  const handleAutoTransition = () => {
    if (testType === 'TAT') {
      if (tatPhase === 'OBSERVE') {
        setTatPhase('WRITE');
        const dur = Math.round(240 / speedMultiplier);
        setTimeLeft(dur); setTotalPhaseDuration(dur);
        soundEngine.playTransitionChime();
      } else {
        // Play chime upon completion of writing time (for both regular and last blank/non-blank slide)
        soundEngine.playTransitionChime();
        if (currentIndex + 1 < items.length) {
          setCurrentIndex(i => i + 1);
          setTatPhase('OBSERVE');
          const dur = Math.round(30 / speedMultiplier);
          setTimeLeft(dur); setTotalPhaseDuration(dur);
        } else {
          finishTest();
        }
      }
    } else {
      if (currentIndex + 1 < items.length) {
        setCurrentIndex(i => i + 1);
        const dur = Math.round(15 / speedMultiplier);
        setTimeLeft(dur); setTotalPhaseDuration(dur);
        soundEngine.playTransitionChime();
      } else { finishTest(); }
    }
  };

  const handleManualSkip = () => {
    if (testType === 'TAT') {
      if (tatPhase === 'OBSERVE') {
        setTatPhase('WRITE');
        const dur = Math.round(240 / speedMultiplier);
        setTimeLeft(dur); setTotalPhaseDuration(dur);
        soundEngine.playTransitionChime();
      } else {
        // Play chime upon completion of writing time (for both regular and last blank/non-blank slide)
        soundEngine.playTransitionChime();
        if (currentIndex + 1 < items.length) {
          setCurrentIndex(i => i + 1);
          setTatPhase('OBSERVE');
          const dur = Math.round(30 / speedMultiplier);
          setTimeLeft(dur); setTotalPhaseDuration(dur);
        } else {
          finishTest();
        }
      }
    } else {
      if (currentIndex + 1 < items.length) {
        setCurrentIndex(i => i + 1);
        const dur = Math.round(15 / speedMultiplier);
        setTimeLeft(dur); setTotalPhaseDuration(dur);
        soundEngine.playTransitionChime();
      } else { finishTest(); }
    }
  };

  const finishTest = () => {
    // If PSYCH mode and we just finished TAT, transition to WAT automatically
    if (testTypeProp === 'PSYCH' && psychPhase === 'TAT') {
      setPsychPhase('WAT');
      setStatus('BRIEFING');
      setCurrentIndex(0);
      setItems([]);
      // prepareItems will be called with the new testType (WAT) via the psychPhase change
      return;
    }
    setStatus('COMPLETED');
    if (testType === 'TAT') {
      setTimeout(() => {
        soundEngine.playCompletionChime();
      }, 700);
    } else {
      soundEngine.playCompletionChime();
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // ── Toggle class ──────────────────────────────────────────
  const Toggle = ({ checked, onChange }) => (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <div className="w-9 h-5 rounded-full bg-slate-200 dark:bg-dark-600
        peer-checked:bg-indigo-600
        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
        after:bg-white after:border after:border-slate-300 after:rounded-full
        after:h-4 after:w-4 after:transition-all
        peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );

  // ── Loading ───────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-light-50 dark:bg-dark-950 text-slate-400 text-sm">
      Loading batch...
    </div>
  );

  // ── Error ─────────────────────────────────────────────────
  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-light-50 dark:bg-dark-950 px-4">
      <div className="card max-w-sm w-full p-6 text-center space-y-4">
        <p className="text-red-500 font-semibold">{error}</p>
        <button onClick={onExit} className="btn-secondary w-full">Back to Dashboard</button>
      </div>
    </div>
  );

  const currentItem = items[currentIndex];

  // ── Briefing ──────────────────────────────────────────────
  if (status === 'BRIEFING') return (
    <div className="min-h-screen bg-light-50 dark:bg-dark-950 flex items-start justify-center py-10 px-4">
      <div className="card w-full max-w-lg p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-dark-600">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              testType === 'TAT' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-cyan-500/10 text-cyan-500'
            }`}>
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                {testTypeProp === 'PSYCH'
                  ? `Full Psych Test — Phase ${psychPhase === 'TAT' ? '1' : '2'}: ${psychPhase === 'TAT' ? 'TAT' : 'WAT'}`
                  : testType === 'TAT' ? 'Thematic Apperception Test' : 'Word Association Test'}
              </h2>
              <p className="text-xs text-slate-400 font-mono">{dateFolder} · {items.length} {testType === 'TAT' ? 'pictures' : 'words'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
            <button onClick={onExit} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <ArrowLeft className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="card-sm p-3 space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex justify-between">
            <span>Timing</span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400 font-mono">
              {testType === 'TAT' ? '30s observe → 4m write' : '15s per word'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Order</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Randomly shuffled</span>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-2.5 text-xs">
          {/* Speed */}
          <div className="flex items-center justify-between card-sm px-3 py-2.5">
            <span className="font-medium text-slate-700 dark:text-slate-200">Speed</span>
            <div className="flex gap-1">
              {[1, 2, 5].map(s => (
                <button key={s} onClick={() => setSpeedMultiplier(s)}
                  className={`px-2.5 py-1 rounded font-mono font-semibold transition-colors ${
                    speedMultiplier === s
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-dark-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-dark-600'
                  }`}
                >
                  {s}x{s === 1 ? ' (Real)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Paper mode */}
          <div className="flex items-center justify-between card-sm px-3 py-2.5">
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-200">Paper Writing Mode</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Write on physical paper (recommended)</p>
            </div>
            <Toggle checked={paperMode} onChange={e => setPaperMode(e.target.checked)} />
          </div>

          {/* Blank slide – TAT only */}
          {testType === 'TAT' && (
            <div className="flex items-center justify-between card-sm px-3 py-2.5">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-200">Include Blank Slide</p>
                <p className="text-[11px] text-slate-400 mt-0.5">SSB-standard blank slide at the end</p>
              </div>
              <Toggle checked={includeBlankSlide} onChange={e => setIncludeBlankSlide(e.target.checked)} />
            </div>
          )}
        </div>

        {/* Start */}
        <button
          onClick={startSimulation}
          className="w-full py-3 btn-primary flex items-center justify-center gap-2 text-base"
        >
          <Play className="w-5 h-5 fill-current" />
          Begin Simulation
        </button>
      </div>
    </div>
  );

  // ── Completed ─────────────────────────────────────────────
  if (status === 'COMPLETED') return (
    <div className="min-h-screen bg-light-50 dark:bg-dark-950 flex items-start justify-center py-10 px-4">
      <div className="card w-full max-w-lg p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Test Completed</h2>
          <p className="text-xs text-slate-400">
            <span className={testType === 'TAT' ? 'badge-indigo' : 'badge-cyan'}>{testType}</span>
            {' '}&nbsp;{items.length} items · {dateFolder}
          </p>
        </div>

        {/* Reviewed items */}
        <div className="card-sm p-3 max-h-56 overflow-y-auto">
          {testType === 'TAT' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {items.map((it, i) => (
                <div key={i} className="rounded overflow-hidden bg-slate-200 dark:bg-dark-700 aspect-video flex items-center justify-center">
                  {it.isBlank
                    ? <span className="text-[10px] text-slate-400 font-mono">BLANK</span>
                    : <img src={it.url} alt="" className="w-full h-full object-cover" />}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {items.map((w, i) => (
                <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-cyan-600 dark:text-cyan-400 font-semibold">
                  {i + 1}. {w}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              // For PSYCH retake, restart from TAT
              if (testTypeProp === 'PSYCH') {
                setPsychPhase('TAT');
                setStatus('BRIEFING');
              } else {
                prepareItems(folderData, includeBlankSlide);
                setStatus('BRIEFING');
              }
            }}
            className="flex-1 btn-secondary flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Retake
          </button>
          <button onClick={onExit} className="flex-1 btn-primary">Back to Dashboard</button>
        </div>
      </div>
    </div>
  );

  // ── Active Simulation HUD ────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={`min-h-screen flex flex-col bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 ${
        isFullscreen ? 'fixed inset-0 z-50' : ''
      }`}
    >
      {/* Minimal HUD bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-black">
        <div className="flex items-center gap-2">
          {testType === 'TAT' ? (
            <span className={`w-2 h-2 rounded-full ${tatPhase === 'OBSERVE' ? 'bg-indigo-500' : 'bg-amber-500'}`} />
          ) : (
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
          )}
          <span className="text-[11px] font-mono text-slate-500 dark:text-white/40">
            {currentIndex + 1} / {items.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white transition-colors"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => setStatus(s => s === 'RUNNING' ? 'PAUSED' : 'RUNNING')}
            className="p-1.5 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            {status === 'RUNNING' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
          <button
            onClick={handleManualSkip}
            className="p-1.5 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onExit}
            className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 dark:text-red-400 transition-colors"
            title="Stop & return to dashboard"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-black">
        {testType === 'TAT' && (
          <>
            {tatPhase === 'OBSERVE' ? (
              currentItem?.isBlank
                ? <div className="w-full min-h-[88vh] bg-slate-50 dark:bg-black" />
                : <img src={currentItem?.url} alt="TAT" className="w-full max-h-[88vh] object-contain" />
            ) : (
              <div className="w-full min-h-[88vh] bg-slate-50 dark:bg-black" />
            )}
          </>
        )}

        {testType === 'WAT' && (
          <span className="text-6xl sm:text-8xl font-black text-slate-900 dark:text-white font-mono tracking-widest select-none">
            {currentItem}
          </span>
        )}
      </div>
    </div>
  );
}
