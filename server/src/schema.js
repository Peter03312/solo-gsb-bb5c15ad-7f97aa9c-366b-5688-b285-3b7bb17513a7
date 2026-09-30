/**
 * 全部表结构。使用 IF NOT EXISTS，启动时幂等迁移。
 *
 * 版本模型：
 *   versions / version_nodes / version_edges —— 已发布的不可变路网快照
 *   draft_nodes / draft_edges                —— 维护者编辑中的唯一草稿
 *   closures                                 —— 临时封闭登记（按路段编码全局生效）
 *   meta(current_version)                    —— 当前版本指针
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  version      INTEGER PRIMARY KEY,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS version_nodes (
  version INTEGER NOT NULL,
  code    TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (version, code)
);

CREATE TABLE IF NOT EXISTS version_edges (
  version   INTEGER NOT NULL,
  code      TEXT NOT NULL,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  minutes   INTEGER NOT NULL CHECK (minutes > 0),
  has_steps INTEGER NOT NULL CHECK (has_steps IN (0, 1)),
  PRIMARY KEY (version, code)
);

CREATE TABLE IF NOT EXISTS draft_nodes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_edges (
  code      TEXT PRIMARY KEY,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  minutes   INTEGER NOT NULL CHECK (minutes > 0),
  has_steps INTEGER NOT NULL CHECK (has_steps IN (0, 1))
);

CREATE TABLE IF NOT EXISTS closures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_code  TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_closures_end      ON closures (end_time);
CREATE INDEX IF NOT EXISTS idx_closures_edge     ON closures (edge_code);
`;

export function migrate(db) {
  db.exec(SCHEMA);
}
