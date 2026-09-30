import { badRequest, notFound, nowIso, parseTime } from './util.js';
import { currentVersion } from './versions.js';

/** 未结束（当前时刻之后结束）的封闭。 */
export function activeClosures(db, at = new Date()) {
  return db
    .prepare(
      `SELECT id, edge_code AS edgeCode, start_time AS startTime, end_time AS endTime,
              note, created_at AS createdAt
       FROM closures WHERE end_time > ? ORDER BY start_time, id`
    )
    .all(at.toISOString());
}

export function listClosures(db, { includeEnded = false } = {}) {
  const sql = includeEnded
    ? `SELECT id, edge_code AS edgeCode, start_time AS startTime,
              end_time AS endTime, note, created_at AS createdAt
         FROM closures ORDER BY start_time DESC, id DESC`
    : `SELECT id, edge_code AS edgeCode, start_time AS startTime,
              end_time AS endTime, note, created_at AS createdAt
         FROM closures WHERE end_time > ? ORDER BY start_time, id`;
  return includeEnded ? db.prepare(sql).all() : db.prepare(sql).all(nowIso());
}

/**
 * 登记临时封闭（路段编码 + 起止时刻）。
 * 成功即提交，随后的任何查询都必须读到它（WAL 下读操作立即可见已提交数据）。
 */
export function registerClosure(db, body) {
  const edgeCode = String(body?.edgeCode ?? body?.edge_code ?? '').trim();
  if (!edgeCode) throw badRequest('INVALID_CLOSURE', '缺少 edgeCode（路段编码）');

  const startTime = parseTime(body.startTime ?? body.start_time, 'startTime');
  const endTime = parseTime(body.endTime ?? body.end_time, 'endTime');
  if (!(endTime.getTime() > startTime.getTime())) {
    throw badRequest('INVALID_TIME_RANGE', '封闭结束时刻必须晚于开始时刻');
  }
  const now = new Date();
  if (endTime.getTime() <= now.getTime()) {
    throw badRequest('CLOSURE_ALREADY_ENDED', '结束时刻已过去，无法登记封闭');
  }
  const note = String(body.note ?? '').slice(0, 200);

  const version = currentVersion(db);
  if (version === null) {
    throw badRequest('NO_PUBLISHED_VERSION', '尚未发布任何路网版本，无法登记封闭');
  }
  const edge = db
    .prepare('SELECT code FROM version_edges WHERE version = ? AND code = ?')
    .get(version, edgeCode);
  if (!edge) {
    throw notFound(
      'EDGE_NOT_FOUND',
      `当前版本（v${version}）中不存在路段：${edgeCode}`
    );
  }

  const createdAt = now.toISOString();
  const info = db
    .prepare(
      `INSERT INTO closures (edge_code, start_time, end_time, note, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(edgeCode, startTime.toISOString(), endTime.toISOString(), note, createdAt);

  return {
    id: info.lastInsertRowid,
    edgeCode,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    note,
    createdAt,
  };
}

export function deleteClosure(db, id) {
  const info = db.prepare('DELETE FROM closures WHERE id = ?').run(id);
  if (info.changes === 0) {
    throw notFound('CLOSURE_NOT_FOUND', `封闭记录不存在：${id}`);
  }
}
