// 数据初始化：首次启动（无任何已发布版本）时写入示例园区路网，
// 发布为 v1，草稿同步为 v1，并登记一条示例封闭（相对当前时刻，便于演示）。
import { db, withImmediateTransaction } from './db.js';

const NODES = [
  ['GATE-A', '园区南门'],
  ['GATE-B', '园区北门'],
  ['ADMIN', '行政楼'],
  ['LIB', '图书馆'],
  ['CANTEEN', '食堂'],
  ['DORM-1', '一号公寓'],
  ['DORM-2', '二号公寓'],
  ['CLINIC', '医务室'],
];

// [起点, 终点, 通行分钟, 是否有台阶, 台阶数]
const EDGES = [
  ['GATE-A', 'ADMIN', 4, 0, null],
  ['GATE-A', 'LIB', 10, 1, 6],
  ['GATE-A', 'CANTEEN', 6, 0, null],
  ['GATE-A', 'DORM-1', 15, 0, null],
  ['ADMIN', 'LIB', 5, 1, 3],
  ['ADMIN', 'CANTEEN', 8, 0, null],
  ['ADMIN', 'CLINIC', 7, 0, null],
  ['LIB', 'GATE-B', 4, 0, null],
  ['LIB', 'DORM-2', 3, 1, 4],
  ['LIB', 'CANTEEN', 3, 0, null],
  ['CANTEEN', 'DORM-2', 3, 0, null],
  ['CANTEEN', 'DORM-1', 4, 0, null],
  ['DORM-1', 'CLINIC', 5, 1, 2],
  ['DORM-2', 'CLINIC', 2, 0, null],
  ['GATE-B', 'DORM-2', 2, 1, 8],
  ['CLINIC', 'GATE-A', 9, 0, null],
];

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM network_versions').get().n;
  if (count > 0) return false;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const startMs = nowMs + 60 * 60 * 1000;          // 1 小时后开始
  const endMs = nowMs + 3 * 60 * 60 * 1000;        // 持续 2 小时

  withImmediateTransaction(() => {
    db.prepare('INSERT INTO network_versions(version, published_at) VALUES (1, ?)').run(nowIso);
    const insNode = db.prepare('INSERT INTO nodes(version, code, name) VALUES (1, ?, ?)');
    const insEdge = db.prepare(
      'INSERT INTO edges(version, from_code, to_code, minutes, has_steps, step_count) VALUES (1, ?, ?, ?, ?, ?)'
    );
    const insDraftNode = db.prepare('INSERT INTO draft_nodes(code, name) VALUES (?, ?)');
    const insDraftEdge = db.prepare(
      'INSERT INTO draft_edges(from_code, to_code, minutes, has_steps, step_count) VALUES (?, ?, ?, ?, ?)'
    );

    for (const [code, name] of NODES) {
      insNode.run(code, name);
      insDraftNode.run(code, name);
    }
    for (const [from, to, minutes, hasSteps, stepCount] of EDGES) {
      insEdge.run(from, to, minutes, hasSteps, stepCount);
      insDraftEdge.run(from, to, minutes, hasSteps, stepCount);
    }

    // 示例封闭：食堂 -> 二号公寓（无台阶近道，1 小时后封闭 2 小时）
    db.prepare(
      'INSERT INTO closures(edge_from, edge_to, start_ms, end_ms, reason) VALUES (?, ?, ?, ?, ?)'
    ).run('CANTEEN', 'DORM-2', startMs, endMs, '示例：无障碍坡道检修（1~3 小时后）');
  });

  return true;
}
