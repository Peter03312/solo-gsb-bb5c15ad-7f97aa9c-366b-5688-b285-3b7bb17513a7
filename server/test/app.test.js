import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { migrate } from '../src/schema.js';
import { saveDraft, publishDraft, getVersion, listVersions } from '../src/versions.js';
import { registerClosure, listClosures } from '../src/closures.js';
import { findRoute } from '../src/route.js';
import { isoOf } from '../src/util.js';

function freshDb() {
  const db = createDb(':memory:');
  migrate(db);
  return db;
}

// 小路网：
//   A --e1(2)--> B --e2(2, 有台阶)--> C
//   A --e3(6)---------> D --e4(2)----> C
function graph1() {
  return {
    nodes: [
      { code: 'A', name: '甲' },
      { code: 'B', name: '乙' },
      { code: 'C', name: '丙' },
      { code: 'D', name: '丁' },
    ],
    edges: [
      { code: 'e1', from: 'A', to: 'B', minutes: 2, has_steps: false },
      { code: 'e2', from: 'B', to: 'C', minutes: 2, has_steps: true },
      { code: 'e3', from: 'A', to: 'D', minutes: 6, has_steps: false },
      { code: 'e4', from: 'D', to: 'C', minutes: 2, has_steps: false },
    ],
  };
}

let db;
before(() => {
  db = freshDb();
});
beforeEach(() => {
  db.exec('DELETE FROM closures; DELETE FROM versions; DELETE FROM version_nodes; DELETE FROM version_edges; DELETE FROM draft_nodes; DELETE FROM draft_edges;');
});

test('基本发布：草稿 -> v1，查询返回最短路径', () => {
  saveDraft(db, graph1());
  const pub = publishDraft(db);
  assert.equal(pub.version, 1);

  const r = db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:00:00Z' }))();
  assert.equal(r.version, 1);
  assert.equal(r.arrivalAt, '2026-09-30T08:04:00.000Z');
  assert.deepEqual(r.path, ['A', 'B', 'C']);
  assert.equal(r.durationMinutes, 4);
});

test('端点不存在或分钟非正时拒绝发布', () => {
  const g = graph1();
  g.edges.push({ code: 'bad', from: 'A', to: 'X', minutes: 3, has_steps: false });
  saveDraft(db, g);
  assert.throws(() => publishDraft(db), { name: "ApiError", code: "ENDPOINT_NOT_FOUND" });
  assert.equal(listVersions(db).length, 0, '发布失败不得产生新版本');

  // 分钟非正在保存阶段即被拒绝（发布级同样会再次校验）。
  const g2 = graph1();
  g2.edges[0] = { ...g2.edges[0], minutes: 0 };
  assert.throws(() => saveDraft(db, g2), { name: 'ApiError', code: 'INVALID_MINUTES' });

  const g3 = graph1();
  g3.edges[0] = { ...g3.edges[0], minutes: -2 };
  assert.throws(() => saveDraft(db, g3), { name: 'ApiError', code: 'INVALID_MINUTES' });
});

test('无台阶需求走无台阶替代路', () => {
  saveDraft(db, graph1());
  publishDraft(db);
  const r = db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:00:00Z', stepFree: true }))();
  assert.deepEqual(r.path, ['A', 'D', 'C']);
  assert.equal(r.arrivalAt, '2026-09-30T08:08:00.000Z');
  assert.ok(r.edges.every((e) => !e.hasSteps));
});

test('无台阶路线不存在时说明原因', () => {
  const g = graph1();
  g.edges = g.edges.filter((e) => !['e3', 'e4'].includes(e.code));
  saveDraft(db, g);
  publishDraft(db);
  assert.throws(
    () => db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:00:00Z', stepFree: true }))(),
    { name: "ApiError", code: "NO_STEP_FREE_PATH" }
  );
});

test('封闭登记成功后查询立即生效；途中不等待要求避开封闭', () => {
  saveDraft(db, graph1());
  publishDraft(db);

  // 08:02 进入 e2 将在 [08:02,08:04) 通行，与封闭 [08:03,08:10) 相交 -> 必须绕路。
  registerClosure(db, {
    edgeCode: 'e2',
    startTime: '2026-09-30T08:03:00Z',
    endTime: '2026-09-30T08:10:00Z',
  });
  assert.equal(listClosures(db).length, 1);

  const blocked = db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:00:00Z' }))();
  assert.deepEqual(blocked.path, ['A', 'D', 'C']);
  assert.equal(blocked.arrivalAt, '2026-09-30T08:08:00.000Z');

  // 封闭结束后再走：08:10 进入 e2，[08:10,08:12) 与封闭端点相接，不视为冲突。
  const after = db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:08:00Z' }))();
  assert.deepEqual(after.path, ['A', 'B', 'C']);
});

test('途中不得等待：无法用“在 B 等几分钟”穿过封闭', () => {
  // 只有 A->B->C 一条路，且 A->B 固定 2 分钟；封闭 e2 覆盖早间全部可能通行点。
  const g = {
    nodes: [{ code: 'A', name: '甲' }, { code: 'B', name: '乙' }, { code: 'C', name: '丙' }],
    edges: [
      { code: 'e1', from: 'A', to: 'B', minutes: 2, has_steps: false },
      { code: 'e2', from: 'B', to: 'C', minutes: 2, has_steps: false },
    ],
  };
  saveDraft(db, g);
  publishDraft(db);
  registerClosure(db, {
    edgeCode: 'e2',
    startTime: '2026-09-30T07:00:00Z',
    endTime: '2026-09-30T20:00:00Z',
  });
  assert.throws(
    () => db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: '2026-09-30T08:00:00Z' }))(),
    { name: "ApiError", code: "BLOCKED" }
  );
});

test('未知节点、无效时刻给出原因', () => {
  saveDraft(db, graph1());
  publishDraft(db);
  assert.throws(
    () => db.transaction(() => findRoute(db, { from: 'Z', to: 'C', departAt: '2026-09-30T08:00:00Z' }))(),
    { name: "ApiError", code: "UNKNOWN_NODE" }
  );
  assert.throws(
    () => db.transaction(() => findRoute(db, { from: 'A', to: 'C', departAt: 'not-a-time' }))(),
    { name: "ApiError", code: "INVALID_TIME" }
  );
});

test('旧版本继续可查；新版本改变路网', () => {
  saveDraft(db, graph1());
  publishDraft(db); // v1

  const g2 = graph1();
  g2.edges = g2.edges.filter((e) => e.code !== 'e1'); // 删除 A->B
  saveDraft(db, g2);
  publishDraft(db); // v2

  const old = db.transaction(() => findRoute(db, { from: 'A', to: 'B', departAt: '2026-09-30T08:00:00Z', version: 1 }))();
  assert.equal(old.version, 1);
  assert.deepEqual(old.path, ['A', 'B']);

  assert.ok(getVersion(db, 1), 'v1 快照仍可读取');
  assert.throws(
    () => db.transaction(() => findRoute(db, { from: 'A', to: 'B', departAt: '2026-09-30T08:00:00Z' }))(),
    { name: "ApiError", code: "NO_PATH" }
  );
});

test('发布不得删除尚有未结束封闭的路段', () => {
  saveDraft(db, graph1());
  publishDraft(db);
  // 直接插入一条未来封闭（绕过“结束时间必须在未来”的当前时刻限制，使用远期时间）。
  db.prepare(
    `INSERT INTO closures (edge_code, start_time, end_time, note, created_at)
     VALUES ('e2', ?, ?, 't', ?)`
  ).run('2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', isoOf(Date.now()));

  const g2 = graph1();
  g2.edges = g2.edges.filter((e) => e.code !== 'e2');
  saveDraft(db, g2);
  assert.throws(() => publishDraft(db), { name: "ApiError", code: "EDGE_HAS_ACTIVE_CLOSURE" });
  assert.equal(listVersions(db).length, 1, '拒绝发布不得产生新版本');

  // 保留该路段（即便改属性）允许发布。
  saveDraft(db, graph1());
  const pub = publishDraft(db);
  assert.equal(pub.version, 2);
});

test('并发：查询与真正并行的发布竞争时，只能读到完整版本且封闭快照一致', async () => {
  // worker_threads 各自打开连接，对同一文件库形成真实并发。
  const os = await import('node:os');
  const path = await import('node:path');
  const url = await import('node:url');
  const { Worker } = await import('node:worker_threads');
  const { currentVersion } = await import('../src/versions.js');

  const tmpFile = path.join(
    os.tmpdir(),
    `park-conc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );

  const setupDb = createDb(tmpFile);
  migrate(setupDb);
  saveDraft(setupDb, graph1());
  publishDraft(setupDb); // v1
  const g2 = graph1();
  g2.edges.push({ code: 'e5', from: 'B', to: 'D', minutes: 1, has_steps: false });
  saveDraft(setupDb, g2); // v2 草稿：新增一条边
  registerClosure(setupDb, {
    edgeCode: 'e1',
    startTime: '2099-03-01T00:00:00Z',
    endTime: '2099-03-02T00:00:00Z',
  });
  setupDb.close();

  const workerPath = path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    'workers',
    'query-worker.mjs'
  );
  const WORKERS = 4;
  const PER_WORKER = 60;
  const workers = Array.from(
    { length: WORKERS },
    () =>
      new Worker(workerPath, {
        workerData: { file: tmpFile, count: PER_WORKER, delayMs: 2 },
      })
  );

  const collected = [];
  const failed = [];
  // 每个 worker 先回传一条发布前（必为 v1）查询结果；全部就绪后再放行竞争阶段。
  const beforeReady = workers.map(
    (w) =>
      new Promise((resolve) =>
        w.on('message', function onMsg(m) {
          if (m.type === 'result' && m.phase === 'before') {
            w.off('message', onMsg);
            resolve();
          }
        })
      )
  );
  workers.forEach((w) => {
    w.on('message', (m) => {
      if (m.type === 'result') collected.push(m);
      if (m.type === 'error') failed.push(m);
    });
    w.on('error', (e) => failed.push({ message: String(e) }));
  });

  await Promise.all(beforeReady);
  for (const r of collected.filter((c) => c.phase === 'before')) {
    assert.equal(r.version, 1, '发布前的查询必须读到 v1');
  }

  // 放行 worker 的持续查询，并在它们运行的同时发布 v2。
  const pubDb = createDb(tmpFile);
  for (const w of workers) w.postMessage({ go: true });
  assert.equal(currentVersion(pubDb), 1);
  publishDraft(pubDb);
  assert.equal(currentVersion(pubDb), 2);
  pubDb.close();

  await Promise.all(
    workers.map(
      (w) =>
        new Promise((res, rej) =>
          w.on('exit', (code) => (code === 0 ? res() : rej(new Error(`worker exit ${code}`))))
        )
    )
  );

  assert.equal(failed.length, 0, JSON.stringify(failed.slice(0, 3)));
  assert.ok(collected.length >= WORKERS * 2, `查询结果过少：${collected.length}`);

  const checkDb = createDb(tmpFile);
  const seen = new Set();
  for (const r of collected) {
    assert.ok([1, 2].includes(r.version), `读到非法版本：${r.version}`);
    seen.add(r.version);
    // 完整性：版本图与已发布快照一致，不会读到半个版本。
    const v = getVersion(checkDb, r.version);
    assert.equal(v.nodes.length, 4);
    assert.equal(v.edges.length, r.version === 1 ? 4 : 5);
    // 一致性：封闭快照只含本版本路段上、出发时刻后仍有效的封闭。
    const codes = new Set(v.edges.map((e) => e.code));
    const expected = checkDb
      .prepare('SELECT edge_code FROM closures WHERE end_time > ?')
      .all('2099-02-01T00:00:00.000Z')
      .filter((c) => codes.has(c.edge_code)).length;
    assert.equal(r.snapshot, expected);
  }
  checkDb.close();
  assert.ok(seen.has(1) && seen.has(2), `发布前后版本都应被读到，实际：${[...seen]}`);
});
