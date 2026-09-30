import React, { useEffect, useState } from 'react';
import VisitorTab from './components/VisitorTab.jsx';
import DraftTab from './components/DraftTab.jsx';
import ClosuresTab from './components/ClosuresTab.jsx';
import VersionsTab from './components/VersionsTab.jsx';
import { api } from './api.js';

const TABS = [
  { key: 'visitor', label: '访客路线' },
  { key: 'draft', label: '路网草稿（维护者）' },
  { key: 'closures', label: '临时封闭' },
  { key: 'versions', label: '历史版本' },
];

export default function App() {
  const [tab, setTab] = useState('visitor');
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  const refreshHealth = () => api.health().then(setHealth).catch((e) => setError(e.message));
  useEffect(() => { refreshHealth(); }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♿</span>
          <div>
            <h1>园区无障碍通行</h1>
            <p>无台阶路线 · 临时封闭避让 · 路网版本化发布</p>
          </div>
        </div>
        <div className="health">
          {error ? <span className="badge bad">后端不可用：{error}</span>
            : health ? <span className="badge ok">服务正常 · 最新版本 v{health.latestVersion} · 共 {health.versionCount} 版</span>
              : <span className="badge">连接中…</span>}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'visitor' && <VisitorTab onChanged={refreshHealth} />}
        {tab === 'draft' && <DraftTab onChanged={refreshHealth} />}
        {tab === 'closures' && <ClosuresTab />}
        {tab === 'versions' && <VersionsTab />}
      </main>

      <footer className="footer">
        Node.js + Express + SQLite（better-sqlite3） / React + Vite · 途中不等待 · 每段通行全程避开封闭
      </footer>
    </div>
  );
}
