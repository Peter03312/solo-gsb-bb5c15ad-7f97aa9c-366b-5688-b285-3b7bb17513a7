import { saveDraft, publishDraft } from './versions.js';
import { registerClosure } from './closures.js';
import { isoOf, nowIso } from './util.js';

/**
 * 首次启动时初始化：写入演示路网草稿并发布为 v1，登记一条当天的演示封闭。
 * 已有数据时完全不动（幂等）。
 */
export function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM versions').get();
  if (row.c > 0) return false;

  // 8 个园区节点；16 条有向路段（成对表示双向），部分路段带台阶，
  // 同时有平行的无台阶替代路段以便演示无障碍绕行。
  const graph = {
    nodes: [
      { code: 'GATE', name: '园区正门' },
      { code: 'PARKING', name: '无障碍停车场' },
      { code: 'CENTER', name: '游客服务中心' },
      { code: 'PLAZA', name: '中心广场' },
      { code: 'HALL', name: '多功能展厅' },
      { code: 'GARDEN', name: '水景花园' },
      { code: 'PLAYGROUND', name: '儿童活动区' },
      { code: 'EXIT', name: '东侧出口' },
    ],
    edges: [
      // 正门 — 中心
      { code: 'E-GATE-CENTER', from: 'GATE', to: 'CENTER', minutes: 8, has_steps: false },
      { code: 'E-CENTER-GATE', from: 'CENTER', to: 'GATE', minutes: 8, has_steps: false },
      // 停车场 — 中心（穿小广场，近路有台阶）
      { code: 'E-PARK-CENTER', from: 'PARKING', to: 'CENTER', minutes: 5, has_steps: true },
      { code: 'E-CENTER-PARK', from: 'CENTER', to: 'PARKING', minutes: 5, has_steps: true },
      // 停车场 — 正门（绕行坡道，无台阶）
      { code: 'E-PARK-GATE', from: 'PARKING', to: 'GATE', minutes: 7, has_steps: false },
      { code: 'E-GATE-PARK', from: 'GATE', to: 'PARKING', minutes: 7, has_steps: false },
      // 中心 — 广场
      { code: 'E-CENTER-PLAZA', from: 'CENTER', to: 'PLAZA', minutes: 4, has_steps: false },
      { code: 'E-PLAZA-CENTER', from: 'PLAZA', to: 'CENTER', minutes: 4, has_steps: false },
      // 广场 — 展厅（台阶近路 / 坡道远路，在 GATE 侧无连接，保持演示）
      { code: 'E-PLAZA-HALL', from: 'PLAZA', to: 'HALL', minutes: 3, has_steps: true },
      { code: 'E-HALL-PLAZA', from: 'HALL', to: 'PLAZA', minutes: 3, has_steps: true },
      { code: 'E-PLAZA-GARDEN-HALL', from: 'PLAZA', to: 'HALL', minutes: 9, has_steps: false },
      { code: 'E-HALL-GARDEN-PLAZA', from: 'HALL', to: 'PLAZA', minutes: 9, has_steps: false },
      // 广场 — 花园
      { code: 'E-PLAZA-GARDEN', from: 'PLAZA', to: 'GARDEN', minutes: 6, has_steps: false },
      { code: 'E-GARDEN-PLAZA', from: 'GARDEN', to: 'PLAZA', minutes: 6, has_steps: false },
      // 花园 — 展厅
      { code: 'E-GARDEN-HALL', from: 'GARDEN', to: 'HALL', minutes: 4, has_steps: false },
      { code: 'E-HALL-GARDEN', from: 'HALL', to: 'GARDEN', minutes: 4, has_steps: false },
      // 广场 — 活动区
      { code: 'E-PLAZA-PLAY', from: 'PLAZA', to: 'PLAYGROUND', minutes: 5, has_steps: false },
      { code: 'E-PLAY-PLAZA', from: 'PLAYGROUND', to: 'PLAZA', minutes: 5, has_steps: false },
      // 活动区 — 东出口
      { code: 'E-PLAY-EXIT', from: 'PLAYGROUND', to: 'EXIT', minutes: 6, has_steps: false },
      { code: 'E-EXIT-PLAY', from: 'EXIT', to: 'PLAYGROUND', minutes: 6, has_steps: false },
      // 展厅 — 东出口
      { code: 'E-HALL-EXIT', from: 'HALL', to: 'EXIT', minutes: 10, has_steps: false },
      { code: 'E-EXIT-HALL', from: 'EXIT', to: 'HALL', minutes: 10, has_steps: false },
    ],
  };

  saveDraft(db, graph);
  publishDraft(db);

  // 演示封闭：广场⇄展厅台阶近路，从现在起 30 分钟后封闭 2 小时。
  // 该时刻前后查询可看到绕行 / 等待差异。
  const start = new Date(Date.now() + 30 * 60_000);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  for (const edgeCode of ['E-PLAZA-HALL', 'E-HALL-PLAZA']) {
    registerClosure(db, {
      edgeCode,
      startTime: isoOf(start),
      endTime: isoOf(end),
      note: '演示数据：台阶维护临时封闭',
    });
  }

  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded_at', ?)`).run(nowIso());
  return true;
}
