import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import DateFoldersView from './components/DateFoldersView';
import UploadView from './components/UploadView';
import TestSimulator from './components/TestSimulator';
import { soundEngine } from './utils/audio';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem('muted') === 'true';
    } catch {
      return false;
    }
  });

  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return false;
      }
      return true; // default dark
    } catch {
      return true;
    }
  });

  // Active Test
  const [activeTest, setActiveTest] = useState(null);
  const [initialUploadDate, setInitialUploadDate] = useState('');

  // Apply dark/light class to <html> and persist preference
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch (e) {
      console.warn('Could not save theme preference:', e);
    }
  }, [isDark]);

  // Persist mute state
  useEffect(() => {
    try {
      localStorage.setItem('muted', isMuted ? 'true' : 'false');
    } catch (e) {
      console.warn('Could not save mute preference:', e);
    }
  }, [isMuted]);

  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFolders(data);
      setDbConnected(true);
    } catch {
      setDbConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFolders();
    const interval = setInterval(() => {
      fetch('/api/health')
        .then(r => r.json())
        .then(d => setDbConnected(d.dbConnected))
        .catch(() => setDbConnected(false));
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleStartTest = (testType, dateFolder) => {
    const df = dateFolder || folders[0]?.dateFolder;
    if (!df) { alert('No batch found. Upload one first.'); return; }
    setActiveTest({ testType, dateFolder: df });
  };

  const handleExitTest = () => {
    setActiveTest(null);
    fetchFolders();
  };

  const handleNavigate = (tab, date = '') => {
    setInitialUploadDate(date);
    setActiveTab(tab);
  };

  const handleDeleteFolder = async (dateFolder) => {
    await fetch(`/api/folders/${encodeURIComponent(dateFolder)}`, { method: 'DELETE' });
    fetchFolders();
  };

  const handleDeleteBatch = async (dateFolder, type) => {
    const url = type === 'TAT'
      ? `/api/folders/${encodeURIComponent(dateFolder)}/tat`
      : `/api/folders/${encodeURIComponent(dateFolder)}/wat`;
    await fetch(url, { method: 'DELETE' });
    fetchFolders();
  };

  if (activeTest) {
    return (
      <TestSimulator
        testType={activeTest.testType}
        dateFolder={activeTest.dateFolder}
        onExit={handleExitTest}
        isDark={isDark}
        toggleTheme={() => setIsDark(d => !d)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-light-50 dark:bg-dark-950 flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMuted={isMuted}
        toggleMute={() => { const m = soundEngine.toggleMute(); setIsMuted(m); }}
        onTestAudio={() => { soundEngine.init(); soundEngine.playTransitionChime(); }}
        dbConnected={dbConnected}
        isDark={isDark}
        toggleTheme={() => setIsDark(p => !p)}
      />

      <main className="flex-1 pb-12">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-slate-400 text-sm">
            Connecting...
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard folders={folders} onStartTest={handleStartTest} onNavigate={handleNavigate} />
            )}
            {activeTab === 'folders' && (
              <DateFoldersView
                folders={folders}
                onStartTest={handleStartTest}
                onNavigate={handleNavigate}
                onDeleteFolder={handleDeleteFolder}
                onDeleteBatch={handleDeleteBatch}
                onRefresh={fetchFolders}
              />
            )}
            {activeTab === 'upload' && (
              <UploadView
                initialDateFolder={initialUploadDate}
                onUploadSuccess={() => { fetchFolders(); setActiveTab('folders'); }}
                onNavigate={handleNavigate}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
