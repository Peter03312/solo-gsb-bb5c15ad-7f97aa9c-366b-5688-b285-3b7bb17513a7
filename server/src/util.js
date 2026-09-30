/** 统一的 API 错误，带 HTTP 状态码与机器可读错误码。 */
export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (code, message, details) =>
  new ApiError(400, code, message, details);
export const notFound = (code, message, details) =>
  new ApiError(404, code, message, details);
export const conflict = (code, message, details) =>
  new ApiError(409, code, message, details);

export function nowIso() {
  return new Date().toISOString();
}

/**
 * 解析 ISO 8601 时刻。推荐带时区（如 2026-09-30T10:00:00Z）；
 * 不带时区的字符串按运行环境本地时区解释（Docker 内默认 UTC）。
 */
export function parseTime(value, field = 'time') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest('INVALID_TIME', `${field} 必须是 ISO 8601 日期时间字符串`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw badRequest('INVALID_TIME', `${field} 时刻无效：${value}`);
  }
  return new Date(ms);
}

export function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function isoOf(dateOrMs) {
  return new Date(dateOrMs).toISOString();
}
