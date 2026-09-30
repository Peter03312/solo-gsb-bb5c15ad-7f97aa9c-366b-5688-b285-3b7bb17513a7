// 极简 fetch 封装：成功返回 JSON，失败抛出带错误码的 Error。
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `请求失败（${res.status}）`);
    err.code = data?.error || 'ERROR';
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  getDraft: () => request('/api/draft'),
  saveDraft: (graph) => request('/api/draft', { method: 'PUT', body: JSON.stringify(graph) }),
  publish: (graph) =>
    request('/api/publish', {
      method: 'POST',
      body: graph ? JSON.stringify(graph) : undefined,
    }),
  versions: () => request('/api/versions'),
  version: (v) => request(`/api/versions/${v}`),
  closures: (all = false) => request(`/api/closures${all ? '?all=true' : ''}`),
  addClosure: (body) => request('/api/closures', { method: 'POST', body: JSON.stringify(body) }),
  deleteClosure: (id) => request(`/api/closures/${id}`, { method: 'DELETE' }),
  route: (params) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    return request(`/api/route?${qs.toString()}`);
  },
};
