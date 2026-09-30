import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { migrate } from './schema.js';
import { seedIfEmpty } from './seed.js';
import { getDraft, saveDraft, publishDraft, listVersions, getVersion } from './versions.js';
import { listClosures, registerClosure, deleteClosure } from './closures.js';
import { findRoute } from './route.js';
import { ApiError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

const db = createDb(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'park.db'));
migrate(db);
if (process.env.SEED_ON_START !== 'false') {
  const seeded = seedIfEmpty(db);
  if (seeded) console.log('[seed] 已初始化演示路网 v1 与演示封闭');
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// 简单访问日志。
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- 草稿 ----------
app.get('/api/draft', (_req, res) => res.json(getDraft(db)));

app.put('/api/draft', (req, res, next) => {
  try {
    res.json(saveDraft(db, req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/publish', (req, res, next) => {
  try {
    // 允许直接提交路网发布（等价于先保存草稿再整体发布），
    // 但标准流程是先 PUT /api/draft 编辑，再调用本端点整体发布。
    if (req.body && (Array.isArray(req.body.nodes) || Array.isArray(req.body.edges))) {
      saveDraft(db, req.body);
    }
    res.status(201).json(publishDraft(db));
  } catch (e) {
    next(e);
  }
});

// ---------- 版本 ----------
app.get('/api/versions', (_req, res) => res.json({ versions: listVersions(db) }));
app.get('/api/versions/:version', (req, res, next) => {
  try {
    const v = getVersion(db, Number(req.params.version));
    if (!v) throw new ApiError(404, 'VERSION_NOT_FOUND', `版本不存在：v${req.params.version}`);
    res.json(v);
  } catch (e) {
    next(e);
  }
});

// ---------- 临时封闭 ----------
app.get('/api/closures', (req, res) => {
  const includeEnded = req.query.all === 'true' || req.query.all === '1';
  res.json({ closures: listClosures(db, { includeEnded }) });
});

app.post('/api/closures', (req, res, next) => {
  try {
    // 登记是独立的即时提交事务：成功返回后，随后所有查询必须读到它。
    const row = db.transaction(() => registerClosure(db, req.body)).immediate();
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

app.delete('/api/closures/:id', (req, res, next) => {
  try {
    db.transaction(() => deleteClosure(db, Number(req.params.id))).immediate();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---------- 访客路线查询 ----------
app.get('/api/route', (req, res, next) => {
  try {
    // 只读事务：保证路网版本快照与封闭快照在同一次查询中一致，
    // 即使此刻有发布或封闭登记正在提交。
    const result = db.transaction(() => findRoute(db, req.query))();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ---------- 静态前端 ----------
const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// ---------- 错误处理 ----------
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError || err?.status) {
    const body = { error: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: '请求体不是合法 JSON' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'INTERNAL', message: '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`园区无障碍通行服务已启动: http://${HOST}:${PORT}`);
});
