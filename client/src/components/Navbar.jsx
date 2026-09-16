import React, { useState } from 'react';
import { Shield, Folder, Upload, Play, Sun, Moon, Volume2, VolumeX, Bell } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, isMuted, toggleMute, onTestAudio, dbConnected, isDark, toggleTheme }) {
  const [playingSound, setPlayingSound] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Play },
    { id: 'folders',   label: 'Folders',   icon: Folder },
    { id: 'upload',    label: 'Upload',    icon: Upload },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-dark-900/80 backdrop-blur-md border-b border-slate-200 dark:border-dark-600">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* Brand */}
        <button
          onClick={() => setActiveTab('dashboard')}
          className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:opacity-80 transition-opacity"
        >
          <Shield className="w-5 h-5" />
          <span className="font-bold text-sm tracking-wide text-slate-800 dark:text-white">SSB Psych</span>
        </button>

        {/* Tabs */}
        <nav className="flex items-center gap-0.5 bg-slate-100 dark:bg-dark-800 p-1 rounded-lg border border-slate-200 dark:border-dark-600">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                activeTab === id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-1.5">
          {/* DB dot */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-slate-500 mr-1">
            <span className={`w-1.5 h-1.5 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {dbConnected ? 'Atlas' : '...'}
          </div>

          {/* Test Sound button */}
          <button
            onClick={() => {
              if (onTestAudio) onTestAudio();
              setPlayingSound(true);
              setTimeout(() => setPlayingSound(false), 800);
            }}
            className={`p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all flex items-center gap-1 text-xs font-medium ${
              playingSound ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 scale-105' : ''
            }`}
            title="Test transition chime sound"
          >
            <Bell className={`w-4 h-4 ${playingSound ? 'animate-bounce text-indigo-500' : ''}`} />
            <span className="hidden md:inline">Test Sound</span>
          </button>

          {/* Mute */}
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Dark/Light toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
