import React, { useState } from 'react';
import { api } from '../api.js';
import { nowLocalInput, localInputToIso, formatIso } from '../time.js';

export default function VisitorTab() {
  const [form, setForm] = useState({
    from: 'GATE-A', to: 'DORM-2', departure: nowLocalInput(90), noSteps: true, version: '',
  });
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setRoute(null);
    const departureAt = localInputToIso(form.departure);
    if (!departureAt) {
      setError({ message: '出发时刻无效，请选择有效的日期与时间' });
      return;
    }
    setLoading(true);
    try {
      const r = await api.findRoute({
        from: form.from.trim(), to: form.to.trim(), departureAt,
        noSteps: form.noSteps, version: form.version,
      });
      setRoute(r);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>访客路线查询</h2>
      <p className="hint">
        输入起点、终点与出发时刻。路线<strong>途中不等待</strong>，每段路在其被经过的整段时间内都不会处于封闭状态；
        勾选“无台阶”后仅使用无台阶路段。
      </p>

      <form className="card form-grid" onSubmit={submit}>
        <label>起点节点编号
          <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="如 GATE-A" />
        </label>
        <label>终点节点编号
          <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="如 DORM-2" />
        </label>
        <label>出发时刻（本地时间）
          <input type="datetime-local" value={form.departure} onChange={(e) => setForm({ ...form, departure: e.target.value })} />
        </label>
        <label>路网版本（留空 = 最新）
          <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="如 1" />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.noSteps} onChange={(e) => setForm({ ...form, noSteps: e.target.checked })} />
          我需要全程无台阶
        </label>
        <button className="primary" disabled={loading}>{loading ? '查询中…' : '查询可行路线'}</button>
      </form>

      {error && (
        <div className="card error">
          <strong>
            {error.status === 404 && error.code === 'NO_ROUTE' ? '无可行路线'
              : error.status === 404 && error.code === 'UNKNOWN_NODE' ? '未知节点'
                : error.status === 400 ? '输入无效'
                  : '查询失败'}
          </strong>
          <div>{error.message}</div>
          {error.reasons?.length > 0 && (
            <ul>{error.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          )}
        </div>
      )}

      {route && (
        <div className="card result">
          <h3>推荐路线（最早到达，途中不等待）</h3>
          <div className="summary">
            <div><span>起点</span><strong>{route.from.code} · {route.from.name}</strong></div>
            <div><span>终点</span><strong>{route.to.code} · {route.to.name}</strong></div>
            <div><span>出发</span><strong>{formatIso(route.departureAt)}</strong></div>
            <div><span>到达</span><strong className="arrival">{formatIso(route.arrival)}</strong></div>
            <div><span>总用时</span><strong>{route.totalMinutes} 分钟</strong></div>
            <div>
              <span>路网版本</span>
              <strong>v{route.version}{route.isLatest ? '（最新）' : '（旧版，仍可查询）'} · 发布于 {formatIso(route.publishedAt)}</strong>
            </div>
          </div>

          <ol className="segments">
            {route.segments.length === 0 && <li className="zero">起点与终点相同，无需出行</li>}
            {route.segments.map((s, i) => (
              <li key={i}>
                <div className="seg-head">
                  <strong>{s.from.code} → {s.to.code}</strong>
                  <span className="seg-time">{formatIso(s.enterAt)} ～ {formatIso(s.exitAt)} · {s.minutes} 分钟</span>
                </div>
                <div className="seg-meta">
                  {s.from.name} → {s.to.name}
                  {s.hasSteps
                    ? <em className="steps">含台阶{s.stepCount ? ` ${s.stepCount} 级` : ''}</em>
                    : <em className="nosteps">无台阶</em>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
