// 发布逻辑：把当前草稿整体固化为一个不可变的新版本。
// 全部校验与写入在一个 IMMEDIATE 事务内完成，保证并发发布的完整版本隔离。
import { db, withImmediateTransaction } from './db.js';
import { ApiError } from './errors.js';

export function getLatestVersion() {
  return db.prepare('SELECT MAX(version) AS v FROM network_versions').get().v;
}

export function getDraft() {
  const nodes = db.prepare('SELECT code, name FROM draft_nodes ORDER BY code').all();
  const edges = db.prepare(
    `SELECT id, from_code AS fromCode, to_code AS toCode, minutes,
            has_steps AS hasSteps, step_count AS stepCount
     FROM draft_edges ORDER BY from_code, to_code`
  ).all();
  return { nodes, edges, latestVersion: getLatestVersion() };
}

export function publishDraft() {
  return withImmediateTransaction(() => {
    const draftNodes = db.prepare('SELECT code, name FROM draft_nodes').all();
    const draftEdges = db.prepare(
      'SELECT from_code, to_code, minutes, has_steps, step_count FROM draft_edges'
    ).all();

    const errors = [];

    if (draftNodes.length === 0) {
      errors.push('草稿中没有任何节点，无法发布空路网');
    }

    // 校验：所有路段端点必须存在
    const nodeSet = new Set(draftNodes.map((n) => n.code));
    for (const e of draftEdges) {
      if (!nodeSet.has(e.from_code)) {
        errors.push(`路段 ${e.from_code} -> ${e.to_code} 的起点「${e.from_code}」不存在`);
      }
      if (!nodeSet.has(e.to_code)) {
        errors.push(`路段 ${e.from_code} -> ${e.to_code} 的终点「${e.to_code}」不存在`);
      }
    }

    // 校验：通行分钟必须为正（表层 CHECK 之外再做显式报错）
    for (const e of draftEdges) {
      if (!Number.isInteger(e.minutes) || e.minutes <= 0) {
        errors.push(`路段 ${e.from_code} -> ${e.to_code} 的通行分钟非正：${e.minutes}`);
      }
    }

    if (errors.length > 0) {
      throw new ApiError(422, 'PUBLISH_REJECTED', '发布被拒绝：草稿存在无效数据', errors);
    }

    const prevVersion = getLatestVersion();
    const newVersion = (prevVersion ?? 0) + 1;
    const publishedAt = new Date().toISOString();
    const nowMs = Date.now();

    // 校验：相对上一版本被删除（或改动）的旧有向路段，若仍有“未结束”的封闭，则拒绝发布。
    // 封闭语义按有向路段身份（from->to）登记，跨版本延续，必须保持可追踪。
    if (prevVersion) {
      const oldEdges = db.prepare('SELECT from_code, to_code FROM edges WHERE version = ?')
        .all(prevVersion);
      const newEdgeKeys = new Set(draftEdges.map((e) => `${e.from_code}->${e.to_code}`));
      const removed = oldEdges.filter((e) => !newEdgeKeys.has(`${e.from_code}->${e.to_code}`));

      if (removed.length > 0) {
        const blocked = db.prepare(
          `SELECT DISTINCT edge_from, edge_to, end_ms
             FROM closures
            WHERE canceled = 0 AND end_ms > ?
              AND (edge_from = ? AND edge_to = ?)`
        );
        const blocking = [];
        for (const e of removed) {
          const hit = blocked.get(nowMs, e.from_code, e.to_code);
          if (hit) {
            const endIso = new Date(hit.end_ms).toISOString();
            blocking.push(`路段 ${e.from_code} -> ${e.to_code} 存在未结束封闭（结束于 ${endIso}），禁止在发布中删除`);
          }
        }
        if (blocking.length > 0) {
          throw new ApiError(409, 'PUBLISH_BLOCKED_BY_CLOSURE',
            '发布被拒绝：存在尚未结束封闭的路段被删除', blocking);
        }
      }
    }

    db.prepare('INSERT INTO network_versions(version, published_at) VALUES (?, ?)')
      .run(newVersion, publishedAt);
    const insNode = db.prepare('INSERT INTO nodes(version, code, name) VALUES (?, ?, ?)');
    const insEdge = db.prepare(
      `INSERT INTO edges(version, from_code, to_code, minutes, has_steps, step_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const n of draftNodes) insNode.run(newVersion, n.code, n.name);
    for (const e of draftEdges) {
      insEdge.run(newVersion, e.from_code, e.to_code, e.minutes, e.has_steps, e.step_count ?? null);
    }

    return {
      version: newVersion,
      publishedAt,
      nodeCount: draftNodes.length,
      edgeCount: draftEdges.length,
      previousVersion: prevVersion,
    };
  });
}

export function listVersions() {
  return db.prepare(
    `SELECT v.version, v.published_at AS publishedAt,
            (SELECT COUNT(*) FROM nodes n WHERE n.version = v.version) AS nodeCount,
            (SELECT COUNT(*) FROM edges e WHERE e.version = v.version) AS edgeCount
       FROM network_versions v
      ORDER BY v.version DESC`
  ).all();
}

export function getVersion(version) {
  const v = db.prepare('SELECT version, published_at AS publishedAt FROM network_versions WHERE version = ?')
    .get(version);
  if (!v) return null;
  v.nodes = db.prepare('SELECT code, name FROM nodes WHERE version = ? ORDER BY code').all(version);
  v.edges = db.prepare(
    `SELECT from_code AS fromCode, to_code AS toCode, minutes,
            has_steps AS hasSteps, step_count AS stepCount
       FROM edges WHERE version = ? ORDER BY from_code, to_code`
  ).all(version);
  return v;
}
