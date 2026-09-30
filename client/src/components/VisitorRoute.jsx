import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function toLocalInput(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function VisitorRoute() {
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [versions, setVersions] = useState([]);
  const [form, setForm] = useState({
    from: '',
    to: '',
    departAt: toLocalInput(),
    stepFree: true,
    version: '',
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshMeta = async () => {
    const [d, vs] = await Promise.all([api.getDraft(), api.versions()]);
    setGraph(d);
    setVersions(vs.versions);
  };

  useEffect(() => {
    refreshMeta().catch((e) => setError(e.message));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await api.route({
        from: form.from,
        to: form.to,
        departAt: new Date(form.departAt).toISOString(),
        stepFree: form.stepFree ? 'true' : 'false',
        version: form.version,
      });
      setResult(r);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const nodeName = Object.fromEntries(graph.nodes.map((n) => [n.code, n.name]));

  return (
    <div className="card">
      <h2>访客路线查询</h2>
      <p className="hint">
        输入起终点与出发时刻，系统给出一条<strong>途中不等待、每段通行全程避开封闭</strong>
        的可行路线及到达时刻与路网版本。
      </p>
      <form onSubmit={submit} className="form-grid">
        <label>
          起点
          <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
            <option value="">请选择起点</option>
            {graph.nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.code} · {n.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          终点
          <select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
            <option value="">请选择终点</option>
            {graph.nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.code} · {n.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          出发时刻
          <input
            type="datetime-local"
            value={form.departAt}
            onChange={(e) => setForm({ ...form, departAt: e.target.value })}
          />
        </label>
        <label>
          路网版本
          <select
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
          >
            <option value="">当前版本</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.current ? '（当前）' : '（旧版）'}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.stepFree}
            onChange={(e) => setForm({ ...form, stepFree: e.target.checked })}
          />
          全程无台阶（轮椅通行）
        </label>
        <button disabled={loading} className="primary">
          {loading ? '查询中…' : '查询可行路线'}
        </button>
      </form>

      {error && (
        <div className="alert error">
          <strong>无法给出路线：</strong>
          {error.message}
          {error.code && <code className="errcode">{error.code}</code>}
          {error.details?.closureEdges?.length > 0 && (
            <div className="sub">受影响封闭路段：{error.details.closureEdges.join('、')}</div>
          )}
        </div>
      )}

      {result && (
        <div className="result">
          <div className="result-head">
            <span className="badge">v{result.version}</span>
            <span>
              到达时刻 <strong>{new Date(result.arrivalAt).toLocaleString()}</strong>
            </span>
            <span>全程 {result.durationMinutes} 分钟</span>
            {result.stepFree && <span className="ok">全程无台阶</span>}
          </div>
          {result.edges.length === 0 ? (
            <p>起点即终点，无需出行。</p>
          ) : (
            <ol className="steps">
              {result.edges.map((e, i) => (
                <li key={e.code}>
                  <span className="step-index">{i + 1}</span>
                  <div>
                    <div>
                      <strong>{e.from}</strong> → <strong>{e.to}</strong>
                      <span className="muted">
                        {' '}
                        （{nodeName[e.from] || e.from} → {nodeName[e.to] || e.to}）
                      </span>
                    </div>
                    <div className="muted small">
                      路段 {e.code} · {e.minutes} 分钟
                      {e.hasSteps ? ' · 含台阶' : ' · 无台阶'}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="muted small">
            路线版本发布于 {new Date(result.publishedAt).toLocaleString()}；本次查询采用的封闭快照含{' '}
            {result.closuresSnapshot.length} 条有效封闭登记。
          </div>
        </div>
      )}
    </div>
  );
}
