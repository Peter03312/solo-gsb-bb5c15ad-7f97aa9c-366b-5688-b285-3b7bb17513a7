import React, { useState } from 'react';
import VisitorRoute from './components/VisitorRoute.jsx';
import DraftEditor from './components/DraftEditor.jsx';
import Closures from './components/Closures.jsx';

const TABS = [
  { key: 'visitor', label: '访客查询' },
  { key: 'draft', label: '路网草稿与发布' },
  { key: 'closures', label: '临时封闭' },
];

export default function App() {
  const [tab, setTab] = useState('visitor');
  return (
    <div className="app">
      <header>
        <h1>🌿 园区无障碍通行</h1>
        <p className="subtitle">无台阶路线 · 封闭实时避让 · 途中不等待 · 版本化路网</p>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'visitor' && <VisitorRoute />}
        {tab === 'draft' && <DraftEditor />}
        {tab === 'closures' && <Closures />}
      </main>
      <footer>Node.js + React + SQLite（better-sqlite3）</footer>
    </div>
  );
}
