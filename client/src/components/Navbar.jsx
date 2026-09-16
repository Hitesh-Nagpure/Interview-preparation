import React, { useState } from 'react';
import {
  Shield, Folder, Upload, Play, Sun, Moon,
  Volume2, VolumeX, Bell, Menu, X
} from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, isMuted, toggleMute, onTestAudio, dbConnected, isDark, toggleTheme }) {
  const [playingSound, setPlayingSound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Play },
    { id: 'folders',   label: 'Folders',   icon: Folder },
    { id: 'upload',    label: 'Upload',    icon: Upload },
  ];

  const handleTabClick = (id) => {
    setActiveTab(id);
    setMenuOpen(false);
  };

  const handleTestSound = () => {
    if (onTestAudio) onTestAudio();
    setPlayingSound(true);
    setTimeout(() => setPlayingSound(false), 800);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-dark-900/90 backdrop-blur-md border-b border-slate-200 dark:border-dark-600">
      {/* ── Main bar ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* Brand */}
        <button
          onClick={() => handleTabClick('dashboard')}
          className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:opacity-80 transition-opacity shrink-0"
        >
          <Shield className="w-5 h-5" />
          <span className="font-bold text-sm tracking-wide text-slate-800 dark:text-white">SSB Psych</span>
        </button>

        {/* Desktop tabs */}
        <nav className="hidden sm:flex items-center gap-0.5 bg-slate-100 dark:bg-dark-800 p-1 rounded-lg border border-slate-200 dark:border-dark-600">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                activeTab === id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Desktop right controls */}
        <div className="hidden sm:flex items-center gap-1.5">
          {/* DB dot */}
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-slate-500 mr-1">
            <span className={`w-1.5 h-1.5 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {dbConnected ? 'Atlas' : '...'}
          </div>

          {/* Test Sound */}
          <button
            onClick={handleTestSound}
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

          {/* Theme */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Mobile right: theme + hamburger */}
        <div className="flex sm:hidden items-center gap-1">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Mobile dropdown menu ── */}
      <div
        className={`sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          menuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-4 pt-2 space-y-2 border-t border-slate-200 dark:border-dark-600 bg-white/95 dark:bg-dark-900/95">

          {/* Navigation tabs */}
          <div className="space-y-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-slate-200 dark:border-dark-600" />

          {/* Controls row */}
          <div className="flex items-center justify-between px-1">
            {/* DB status */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-slate-500">
              <span className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              {dbConnected ? 'DB Connected' : 'Connecting...'}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              {/* Test Sound */}
              <button
                onClick={() => { handleTestSound(); }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  playingSound
                    ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                    : 'bg-slate-100 dark:bg-dark-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                }`}
              >
                <Bell className={`w-3.5 h-3.5 ${playingSound ? 'animate-bounce' : ''}`} />
                Test Sound
              </button>

              {/* Mute */}
              <button
                onClick={toggleMute}
                className="p-2 rounded-lg bg-slate-100 dark:bg-dark-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
