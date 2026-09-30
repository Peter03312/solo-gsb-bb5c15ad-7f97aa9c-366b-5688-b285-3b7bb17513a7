// HTTP 服务入口：维护者草稿/发布 API、临时封闭 API、版本 API、访客路线 API
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { ApiError, wrap, parseTime, requireString, parsePositiveMinutes, parseBool } from './errors.js';
import { getDraft, publishDraft, listVersions, getVersion } from './version.js';
import { findRoute } from './routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

if (process.env.SEED_ON_START !== '0') {
  const seeded = seedIfEmpty();
  if (seeded) console.log('[init] 未找到数据，已写入示例路网并发布 v1');
}

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  const latest = db.prepare('SELECT MAX(version) AS v, COUNT(*) AS c FROM network_versions').get();
  res.json({ ok: true, latestVersion: latest.v, versionCount: latest.c });
});

// ---------- 草稿：节点 ----------
app.get('/api/draft', wrap((req, res) => res.json(getDraft())));

app.post('/api/draft/nodes', wrap((req, res) => {
  const code = requireString(req.body, 'code', '节点编号');
  const name = requireString(req.body, 'name', '节点名称');
  const info = db.prepare('SELECT 1 FROM draft_nodes WHERE code = ?').get(code);
  if (info) throw new ApiError(409, 'NODE_EXISTS', `草稿中已存在节点 ${code}`);
  db.prepare('INSERT INTO draft_nodes(code, name) VALUES (?, ?)').run(code, name);
  res.status(201).json({ code, name });
}));

app.put('/api/draft/nodes/:code', wrap((req, res) => {
  const name = requireString(req.body, 'name', '节点名称');
  const r = db.prepare('UPDATE draft_nodes SET name = ? WHERE code = ?').run(name, req.params.code);
  if (r.changes === 0) throw new ApiError(404, 'NODE_NOT_FOUND', `草稿中不存在节点 ${req.params.code}`);
  res.json({ code: req.params.code, name });
}));

app.delete('/api/draft/nodes/:code', wrap((req, res) => {
  const code = req.params.code;
  const tx = db.transaction(() => {
    const r = db.prepare('DELETE FROM draft_nodes WHERE code = ?').run(code);
    if (r.changes === 0) throw new ApiError(404, 'NODE_NOT_FOUND', `草稿中不存在节点 ${code}`);
    // 关联草稿路段一并移除（端点不存在的草稿本就无法发布）
    db.prepare('DELETE FROM draft_edges WHERE from_code = ? OR to_code = ?').run(code, code);
  });
  tx.immediate();
  res.status(204).end();
}));

// ---------- 草稿：有向路段 ----------
app.post('/api/draft/edges', wrap((req, res) => {
  const fromCode = requireString(req.body, 'fromCode', '起点编号');
  const toCode = requireString(req.body, 'toCode', '终点编号');
  if (fromCode === toCode) throw new ApiError(400, 'SELF_LOOP', '有向路段的起点与终点不能相同');
  const minutes = parsePositiveMinutes(req.body.minutes);
  const hasSteps = parseBool(req.body.hasSteps, false);
  const stepCount = hasSteps && req.body.stepCount != null
    ? parsePositiveMinutesOrZero(req.body.stepCount) : (hasSteps ? null : null);

  const dup = db.prepare('SELECT 1 FROM draft_edges WHERE from_code = ? AND to_code = ?')
    .get(fromCode, toCode);
  if (dup) throw new ApiError(409, 'EDGE_EXISTS', `草稿中已存在路段 ${fromCode} -> ${toCode}`);

  const r = db.prepare(
    'INSERT INTO draft_edges(from_code, to_code, minutes, has_steps, step_count) VALUES (?, ?, ?, ?, ?)'
  ).run(fromCode, toCode, minutes, hasSteps ? 1 : 0, hasSteps ? stepCount : null);
  res.status(201).json({
    id: r.lastInsertRowid, fromCode, toCode, minutes,
    hasSteps, stepCount: hasSteps ? stepCount : null,
  });
}));

function parsePositiveMinutesOrZero(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, 'INVALID_PARAM', `台阶数必须为非负整数，收到：${String(v)}`);
  }
  return n;
}

app.put('/api/draft/edges/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ApiError(400, 'INVALID_PARAM', '路段 id 无效');
  const existing = db.prepare('SELECT * FROM draft_edges WHERE id = ?').get(id);
  if (!existing) throw new ApiError(404, 'EDGE_NOT_FOUND', `草稿中不存在路段 id=${id}`);

  const fromCode = req.body.fromCode !== undefined ? requireString(req.body, 'fromCode', '起点编号') : existing.from_code;
  const toCode = req.body.toCode !== undefined ? requireString(req.body, 'toCode', '终点编号') : existing.to_code;
  if (fromCode === toCode) throw new ApiError(400, 'SELF_LOOP', '有向路段的起点与终点不能相同');
  const minutes = req.body.minutes !== undefined ? parsePositiveMinutes(req.body.minutes) : existing.minutes;
  const hasSteps = req.body.hasSteps !== undefined ? parseBool(req.body.hasSteps) : existing.has_steps === 1;
  let stepCount = existing.step_count;
  if (req.body.stepCount !== undefined) {
    stepCount = req.body.stepCount === null ? null : parsePositiveMinutesOrZero(req.body.stepCount);
  }
  const dup = db.prepare('SELECT 1 FROM draft_edges WHERE from_code = ? AND to_code = ? AND id <> ?')
    .get(fromCode, toCode, id);
  if (dup) throw new ApiError(409, 'EDGE_EXISTS', `草稿中已存在路段 ${fromCode} -> ${toCode}`);

  db.prepare('UPDATE draft_edges SET from_code=?, to_code=?, minutes=?, has_steps=?, step_count=? WHERE id=?')
    .run(fromCode, toCode, minutes, hasSteps ? 1 : 0, hasSteps ? stepCount : null, id);
  res.json({ id, fromCode, toCode, minutes, hasSteps, stepCount: hasSteps ? stepCount : null });
}));

app.delete('/api/draft/edges/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('DELETE FROM draft_edges WHERE id = ?').run(id);
  if (r.changes === 0) throw new ApiError(404, 'EDGE_NOT_FOUND', `草稿中不存在路段 id=${id}`);
  res.status(204).end();
}));

// ---------- 发布 ----------
app.post('/api/publish', wrap((req, res) => {
  const result = publishDraft();
  res.status(201).json(result);
}));

// ---------- 版本 ----------
app.get('/api/versions', wrap((req, res) => res.json({ versions: listVersions() })));
app.get('/api/versions/:version', wrap((req, res) => {
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '版本号必须为正整数');
  }
  const v = getVersion(version);
  if (!v) throw new ApiError(404, 'VERSION_NOT_FOUND', `版本 ${version} 不存在（旧版本仍可查询，除非数据卷被清除）`);
  res.json(v);
}));

// ---------- 临时封闭 ----------
app.get('/api/closures', wrap((req, res) => {
  const includeCanceled = parseBool(req.query.all, false);
  const atMs = req.query.at ? parseTime(req.query.at, 'at') : null;
  let sql = `SELECT c.id, c.edge_from AS edgeFrom, c.edge_to AS edgeTo,
                    c.start_ms AS startMs, c.end_ms AS endMs,
                    c.reason, c.canceled, c.created_at AS createdAt
               FROM closures c`;
  const conds = [];
  const params = [];
  if (!includeCanceled) conds.push('c.canceled = 0');
  if (atMs !== null) {
    conds.push('c.start_ms <= ? AND c.end_ms > ?');
    params.push(atMs, atMs);
  }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY c.start_ms DESC';
  const rows = db.prepare(sql).all(...params).map((r) => ({
    ...r,
    startAt: new Date(r.startMs).toISOString(),
    endAt: new Date(r.endMs).toISOString(),
    canceled: r.canceled === 1,
  }));
  res.json({ closures: rows });
}));

app.post('/api/closures', wrap((req, res) => {
  const edgeFrom = requireString(req.body, 'edgeFrom', '路段起点');
  const edgeTo = requireString(req.body, 'edgeTo', '路段终点');
  if (edgeFrom === edgeTo) throw new ApiError(400, 'INVALID_PARAM', '封闭路段的起点与终点不能相同');
  const startMs = parseTime(req.body.startAt, '封闭开始时刻');
  const endMs = parseTime(req.body.endAt, '封闭结束时刻');
  if (endMs <= startMs) {
    throw new ApiError(400, 'INVALID_TIME', '封闭结束时刻必须晚于开始时刻');
  }
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : null;

  // 该有向路段必须在最新已发布路网中存在（按有向身份登记，后续版本持续生效）
  const latest = db.prepare('SELECT MAX(version) AS v FROM network_versions').get().v;
  if (!latest) throw new ApiError(409, 'NO_NETWORK', '路网尚未发布任何版本，无法登记封闭');
  const edge = db.prepare(
    'SELECT 1 FROM edges WHERE version = ? AND from_code = ? AND to_code = ?'
  ).get(latest, edgeFrom, edgeTo);
  if (!edge) {
    throw new ApiError(404, 'EDGE_NOT_FOUND',
      `最新版本 v${latest} 中不存在有向路段 ${edgeFrom} -> ${edgeTo}，请先在草稿中创建并发布`);
  }

  const r = db.prepare(
    'INSERT INTO closures(edge_from, edge_to, start_ms, end_ms, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(edgeFrom, edgeTo, startMs, endMs, reason);

  // 登记成功即已提交，此后的任何路线查询都会在同一数据库中读到该封闭
  res.status(201).json({
    id: r.lastInsertRowid, edgeFrom, edgeTo, startMs, endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    reason, canceled: false,
  });
}));

app.post('/api/closures/:id/cancel', wrap((req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('UPDATE closures SET canceled = 1 WHERE id = ? AND canceled = 0').run(id);
  if (r.changes === 0) throw new ApiError(404, 'CLOSURE_NOT_FOUND', `封闭记录 id=${id} 不存在或已取消`);
  res.json({ id, canceled: true });
}));

// ---------- 访客路线 ----------
app.get('/api/route', wrap((req, res) => {
  const from = requireString(req.query, 'from', '起点');
  const to = requireString(req.query, 'to', '终点');
  const departureMs = parseTime(req.query.departureAt, '出发时刻');
  const noSteps = parseBool(req.query.noSteps, false);
  let version;
  if (req.query.version !== undefined && req.query.version !== '') {
    version = Number(req.query.version);
    if (!Number.isInteger(version) || version <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '版本号必须为正整数');
    }
  }
  const route = findRoute({ from, to, departureMs, noSteps, version });
  res.json(route);
}));

// ---------- 统一错误处理 ----------
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, reasons: err.reasons },
    });
  }
  if (err && err.code === 'SQLITE_BUSY') {
    return res.status(503).json({ error: { code: 'BUSY', message: '数据库繁忙，请稍后重试' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
});

// ---------- 生产环境托管 React 构建产物（SPA 回退）----------
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`园区无障碍通行服务已启动: http://0.0.0.0:${PORT}`);
});
