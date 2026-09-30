// 后端 API 封装，统一错误处理
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 204 等无响应体 */
  }
  if (!res.ok) {
    const err = new Error(payload?.error?.message || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    err.code = payload?.error?.code;
    err.details = payload?.error?.details;
    err.reasons = payload?.error?.reasons;
    throw err;
  }
  return payload;
}

export const api = {
  health: () => request('/api/health'),
  getDraft: () => request('/api/draft'),
  addNode: (node) => request('/api/draft/nodes', { method: 'POST', body: JSON.stringify(node) }),
  updateNode: (code, name) => request(`/api/draft/nodes/${encodeURIComponent(code)}`, {
    method: 'PUT', body: JSON.stringify({ name }),
  }),
  deleteNode: (code) => request(`/api/draft/nodes/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  addEdge: (edge) => request('/api/draft/edges', { method: 'POST', body: JSON.stringify(edge) }),
  updateEdge: (id, edge) => request(`/api/draft/edges/${id}`, { method: 'PUT', body: JSON.stringify(edge) }),
  deleteEdge: (id) => request(`/api/draft/edges/${id}`, { method: 'DELETE' }),
  publish: () => request('/api/publish', { method: 'POST' }),
  listVersions: () => request('/api/versions'),
  getVersion: (v) => request(`/api/versions/${v}`),
  listClosures: (all = false) => request(`/api/closures${all ? '?all=true' : ''}`),
  addClosure: (c) => request('/api/closures', { method: 'POST', body: JSON.stringify(c) }),
  cancelClosure: (id) => request(`/api/closures/${id}/cancel`, { method: 'POST' }),
  findRoute: (params) => {
    const qs = new URLSearchParams({
      from: params.from,
      to: params.to,
      departureAt: params.departureAt,
      noSteps: params.noSteps ? 'true' : 'false',
    });
    if (params.version) qs.set('version', params.version);
    return request(`/api/route?${qs.toString()}`);
  },
};
