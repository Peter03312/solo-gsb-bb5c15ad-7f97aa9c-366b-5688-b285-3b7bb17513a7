import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 打开（或创建）SQLite 数据库并设置并发相关 PRAGMA。
 *
 * - WAL：读写互不阻塞，发布写事务期间查询仍可读到完整旧版本；
 * - busy_timeout：写锁竞争时等待而不是立刻报 SQLITE_BUSY；
 * - foreign_keys：开启外键约束。
 */
export function createDb(filename = process.env.DB_PATH || './data/park.db') {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
