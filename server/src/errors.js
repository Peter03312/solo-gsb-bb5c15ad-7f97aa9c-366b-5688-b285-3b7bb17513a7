// 统一的业务错误类型与通用校验工具

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// 把可能抛错的同步/异步 Express 处理函数包装成统一错误出口
export function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// 解析 ISO 8601 时间字符串；非法时抛出 INVALID_TIME
export function parseTime(value, field = '时间') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'INVALID_TIME', `${field}不能为空，需为 ISO 8601 时间（如 2026-09-30T08:00）`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ApiError(400, 'INVALID_TIME', `${field}格式无效：${value}，需为 ISO 8601 时间`);
  }
  return ms;
}

export function requireString(body, field, label) {
  const v = body?.[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ApiError(400, 'INVALID_PARAM', `${label}不能为空`);
  }
  return v.trim();
}

// 通行分钟必须为正整数（分钟为小数/非正/非数字均拒绝）
export function parsePositiveMinutes(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, 'INVALID_MINUTES', `通行分钟必须为正整数，收到：${String(value)}`);
  }
  return n;
}

export function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw new ApiError(400, 'INVALID_PARAM', `布尔参数无效：${String(value)}`);
}
