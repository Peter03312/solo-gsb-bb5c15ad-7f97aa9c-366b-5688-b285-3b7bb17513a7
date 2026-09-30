import { normalizeGraph, readGraph, readVersionGraph } from './graph.js';
import { conflict, nowIso } from './util.js';

export function getDraft(db) {
  return readGraph(db, { draft: true });
}

export function saveDraft(db, body) {
  // 先编辑草稿：保存阶段只做结构归一化，不做端点存在性等“发布级”校验。
  const { nodes, edges } = normalizeGraph(body, { full: false });

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM draft_nodes').run();
    db.prepare('DELETE FROM draft_edges').run();
    const insNode = db.prepare('INSERT INTO draft_nodes (code, name) VALUES (?, ?)');
    const insEdge = db.prepare(
      `INSERT INTO draft_edges (code, from_node, to_node, minutes, has_steps)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const n of nodes) insNode.run(n.code, n.name);
    for (const e of edges) insEdge.run(e.code, e.fromNode, e.toNode, e.minutes, e.hasSteps);
  });
  replace();
  return getDraft(db);
}

export function currentVersion(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'current_version'`).get();
  return row ? Number(row.value) : null;
}

export function listVersions(db) {
  const versions = db
    .prepare(
      `SELECT v.version, v.published_at,
              (SELECT COUNT(*) FROM version_nodes n WHERE n.version = v.version) AS node_count,
              (SELECT COUNT(*) FROM version_edges e WHERE e.version = v.version) AS edge_count
       FROM versions v ORDER BY v.version`
    )
    .all();
  const current = currentVersion(db);
  return versions.map((v) => ({ ...v, current: v.version === current }));
}

export function getVersion(db, version) {
  const v = db.prepare('SELECT * FROM versions WHERE version = ?').get(version);
  if (!v) return null;
  const graph = readVersionGraph(db, version);
  return {
    version: v.version,
    publishedAt: v.published_at,
    current: v.version === currentVersion(db),
    ...graph,
  };
}

/**
 * 整体发布：
 *  - 发布级校验（端点不存在、分钟非正等）不通过则整体拒绝，版本号不前进；
 *  - 路网快照、版本记录、当前指针在同一个 IMMEDIATE 事务中提交，
 *    查询要么看到完整旧版本，要么看到完整新版本，绝不会读到半个版本；
 *  - 草稿中被删除、但当前版本仍登记有未结束封闭的路段会阻止发布。
 */
export function publishDraft(db) {
  const draft = (() => {
    // 直接从表读取，绕过请求体重新做 full 校验。
    const nodes = db.prepare('SELECT code, name FROM draft_nodes').all();
    const edges = db
      .prepare(
        `SELECT code, from_node AS fromNode, to_node AS toNode, minutes,
                has_steps AS hasSteps
         FROM draft_edges`
      )
      .all()
      .map((e) => ({ ...e, hasSteps: e.hasSteps ? true : false }));
    return normalizeGraph({ nodes, edges }, { full: true });
  })();

  const before = currentVersion(db);
  const now = nowIso();

  // IMMEDIATE：发布一开始即获取写锁，两个并发发布的版本号由同一事务内
  // MAX(version)+1 串行产生，不会互相覆盖；事务提交对查询整体可见。
  const txn = db.transaction(() => {
    const nextRow = db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM versions')
      .get();
    const next = nextRow.v;

    if (before !== null) {
      // 新草稿缺少的旧路段：只要还有未结束封闭，就禁止发布删除它。
      const blocked = db
        .prepare(
          `SELECT DISTINCT e.code, c.id, c.start_time, c.end_time
           FROM version_edges e
           JOIN closures c ON c.edge_code = e.code AND c.end_time > ?
           WHERE e.version = ?
             AND e.code NOT IN (SELECT code FROM draft_edges)`
        )
        .all(now, before);
      if (blocked.length > 0) {
        throw conflict(
          'EDGE_HAS_ACTIVE_CLOSURE',
          `存在未结束封闭的路段被删除，拒绝发布：${blocked.map((b) => b.code).join('、')}`,
          { blockedEdges: blocked.map((b) => b.code) }
        );
      }
    }

    const insVersion = db.prepare('INSERT INTO versions (version, published_at) VALUES (?, ?)');
    const insNode = db.prepare(
      'INSERT INTO version_nodes (version, code, name) VALUES (?, ?, ?)'
    );
    const insEdge = db.prepare(
      `INSERT INTO version_edges (version, code, from_node, to_node, minutes, has_steps)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    insVersion.run(next, now);
    for (const n of draft.nodes) insNode.run(next, n.code, n.name);
    for (const e of draft.edges) {
      insEdge.run(next, e.code, e.fromNode, e.toNode, e.minutes, e.hasSteps ? 1 : 0);
    }
    db.prepare(`INSERT INTO meta (key, value) VALUES ('current_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(next));
    return next;
  });

  // 以 IMMEDIATE 模式执行：发布一开始即拿到写锁，并发发布在事务层面串行，
  // 版本号由同一事务内 MAX(version)+1 产生；提交后整体可见，查询读不到半个版本。
  // ApiError 会原样抛出交由路由层处理。
  txn.immediate();
  return { version: currentVersion(db), publishedAt: now, ...draft };
}
