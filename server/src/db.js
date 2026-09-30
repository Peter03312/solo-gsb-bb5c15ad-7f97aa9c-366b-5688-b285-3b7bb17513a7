// SQLite 连接与建表（better-sqlite3 为同步驱动，同一连接上的事务天然串行，
// 配合 WAL 与 busy_timeout，保证发布与查询的隔离与完整版本快照）。
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'park.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

// IMMEDIATE 写事务：一开启即取写锁，并发发布会在此处排队，
// 避免两个发布交错导致版本错乱。
export function withImmediateTransaction(fn) {
  const tx = db.transaction(fn);
  return tx.immediate();
}

// 只读快照事务：一次查询内读到的版本、节点、路段、封闭记录为同一快照。
// WAL 下事务从首次读取起即固定快照，期间并发提交的发布不会改变本次查询所见。
export function withSnapshot(fn) {
  return db.transaction(fn)();
}

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 已发布版本（不可变）
CREATE TABLE IF NOT EXISTS network_versions (
  version    INTEGER PRIMARY KEY,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL REFERENCES network_versions(version),
  UNIQUE(version, code)
);

CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    INTEGER NOT NULL REFERENCES network_versions(version),
  from_code  TEXT NOT NULL,
  to_code    TEXT NOT NULL,
  minutes    INTEGER NOT NULL CHECK (minutes > 0),
  has_steps  INTEGER NOT NULL CHECK (has_steps IN (0, 1)),
  step_count INTEGER,
  UNIQUE(version, from_code, to_code)
);

-- 唯一草稿（发布整体生成一个新版本，草稿可反复修改）
CREATE TABLE IF NOT EXISTS draft_nodes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_code  TEXT NOT NULL,
  to_code    TEXT NOT NULL,
  minutes    INTEGER NOT NULL CHECK (minutes > 0),
  has_steps  INTEGER NOT NULL CHECK (has_steps IN (0, 1)),
  step_count INTEGER,
  UNIQUE(from_code, to_code)
);

-- 临时封闭：按“有向路段（from->to）”和起止时刻登记，跨版本生效
CREATE TABLE IF NOT EXISTS closures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_from  TEXT NOT NULL,
  edge_to    TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL CHECK (end_ms > start_ms),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  canceled   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_closures_edge ON closures(edge_from, edge_to, canceled, end_ms);
`);
