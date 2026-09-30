import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function toLocalInput(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function Closures() {
  const [closures, setClosures] = useState([]);
  const [versions, setVersions] = useState([]);
  const [currentEdges, setCurrentEdges] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({
    edgeCode: '',
    startTime: toLocalInput(new Date(Date.now() + 5 * 60_000)),
    endTime: toLocalInput(new Date(Date.now() + 2 * 60 * 60_000)),
    note: '',
  });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    const [cs, vs] = await Promise.all([api.closures(showAll), api.versions()]);
    setClosures(cs.closures);
    setVersions(vs.versions);
    const current = vs.versions.find((v) => v.current);
    if (current) {
      const detail = await api.version(current.version);
      setCurrentEdges(detail.edges);
    } else {
      setCurrentEdges([]);
    }
  };

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [showAll]);

  const flash = (kind, text) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const c = await api.addClosure({
        edgeCode: form.edgeCode,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        note: form.note,
      });
      flash('ok', `封闭登记成功（#${c.id}），之后的查询立即生效`);
      setForm({ ...form, edgeCode: '', note: '' });
      await load();
    } catch (ex) {
      setErr(ex);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(`删除封闭登记 #${id}？`)) return;
    setErr(null);
    try {
      await api.deleteClosure(id);
      await load();
    } catch (ex) {
      setErr(ex);
    }
  };

  return (
    <div className="card">
      <h2>维护者 · 临时封闭登记</h2>
      <p className="hint">
        按<strong>有向路段 + 起止时刻</strong>登记封闭；登记成功提交后，之后发起的访客查询立即避开。
        结束时刻必须晚于开始时刻且尚未结束。
      </p>

      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      {err && (
        <div className="alert error">
          <strong>登记失败：</strong>
          {err.message}
          <code className="errcode">{err.code}</code>
        </div>
      )}

      <form onSubmit={submit} className="form-grid">
        <label>
          封闭路段（当前版本）
          <select
            value={form.edgeCode}
            onChange={(e) => setForm({ ...form, edgeCode: e.target.value })}
          >
            <option value="">请选择路段</option>
            {currentEdges.map((e) => (
              <option key={e.code} value={e.code}>
                {e.code} · {e.fromNode}→{e.toNode}（{e.minutes} 分钟
                {e.hasSteps ? '，有台阶' : '，无台阶'}）
              </option>
            ))}
          </select>
        </label>
        <label>
          开始时刻
          <input
            type="datetime-local"
            value={form.startTime}
            onChange={(e) => setForm({ ...form, startTime: e.target.value })}
          />
        </label>
        <label>
          结束时刻
          <input
            type="datetime-local"
            value={form.endTime}
            onChange={(e) => setForm({ ...form, endTime: e.target.value })}
          />
        </label>
        <label>
          备注
          <input
            type="text"
            placeholder="如：台阶维护"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <button className="primary" disabled={versions.length === 0}>
          登记封闭
        </button>
      </form>

      <div className="row-between">
        <h3>{showAll ? '全部封闭记录' : '未结束的封闭'}（{closures.length}）</h3>
        <label className="check small">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          显示已结束记录
        </label>
      </div>
      <table className="edit-table">
        <thead>
          <tr>
            <th>#</th>
            <th>路段</th>
            <th>开始</th>
            <th>结束</th>
            <th>备注</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {closures.map((c) => {
            const ended = new Date(c.endTime).getTime() <= Date.now();
            return (
              <tr key={c.id} className={ended ? 'ended' : ''}>
                <td>{c.id}</td>
                <td>
                  <code>{c.edgeCode}</code>
                </td>
                <td>{new Date(c.startTime).toLocaleString()}</td>
                <td>{new Date(c.endTime).toLocaleString()}</td>
                <td>{c.note}</td>
                <td>
                  <button className="danger small" onClick={() => remove(c.id)}>
                    删除
                  </button>
                </td>
              </tr>
            );
          })}
          {closures.length === 0 && (
            <tr>
              <td colSpan="6" className="muted center">
                暂无记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
