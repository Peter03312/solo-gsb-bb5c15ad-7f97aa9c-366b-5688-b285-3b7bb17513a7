import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { nowLocalInput, localInputToIso, formatIso } from '../time.js';

export default function ClosuresTab() {
  const [closures, setClosures] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    edgeFrom: '', edgeTo: '', start: nowLocalInput(60), end: nowLocalInput(180), reason: '',
  });

  const load = async () => {
    try {
      const r = await api.listClosures(showAll);
      setClosures(r.closures);
      setError('');
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [showAll]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    const startAt = localInputToIso(form.start);
    const endAt = localInputToIso(form.end);
    if (!startAt || !endAt) { setError('起止时刻无效'); return; }
    try {
      const c = await api.addClosure({
        edgeFrom: form.edgeFrom.trim(), edgeTo: form.edgeTo.trim(), startAt, endAt,
        reason: form.reason.trim() || null,
      });
      setNotice(`✅ 封闭登记成功（id=${c.id}）：${c.edgeFrom} → ${c.edgeTo}，${formatIso(c.startAt)} ～ ${formatIso(c.endAt)}。此后所有路线查询立即生效。`);
      setForm({ ...form, edgeFrom: '', edgeTo: '', reason: '' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const now = Date.now();
  const stateOf = (c) => c.canceled ? '已取消' : (c.startMs > now ? '未开始' : c.endMs <= now ? '已结束' : '封闭中');

  return (
    <div>
      <h2>临时封闭登记</h2>
      <p className="hint">
        按<strong>有向路段</strong>（起点 → 终点）和<strong>起止时刻</strong>登记。登记成功后立即对路线查询生效；
        发布新版本时，仍有未结束封闭的路段不允许被删除。区间端点相接（上一封闭刚结束即通行）不算冲突。
      </p>

      {notice && <div className="card ok">{notice}</div>}
      {error && <div className="card error">{error}</div>}

      <form className="card form-grid" onSubmit={submit}>
        <label>路段起点
          <input value={form.edgeFrom} onChange={(e) => setForm({ ...form, edgeFrom: e.target.value })} placeholder="如 CANTEEN" />
        </label>
        <label>路段终点
          <input value={form.edgeTo} onChange={(e) => setForm({ ...form, edgeTo: e.target.value })} placeholder="如 DORM-2" />
        </label>
        <label>封闭开始（本地时间）
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </label>
        <label>封闭结束（本地时间）
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </label>
        <label className="wide">原因（可选）
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如 无障碍坡道检修" />
        </label>
        <button className="primary">登记封闭</button>
      </form>

      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>封闭记录（{closures.length}）</h3>
          <label className="check small">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            显示已取消记录
          </label>
        </div>
        <table>
          <thead>
            <tr><th>有向路段</th><th>开始</th><th>结束</th><th>状态</th><th>原因</th><th></th></tr>
          </thead>
          <tbody>
            {closures.length === 0 && <tr><td colSpan="6" className="muted">暂无封闭记录</td></tr>}
            {closures.map((c) => (
              <tr key={c.id} className={c.canceled ? 'cancelled' : ''}>
                <td>{c.edgeFrom} → {c.edgeTo}</td>
                <td>{formatIso(c.startAt)}</td>
                <td>{formatIso(c.endAt)}</td>
                <td><span className={`tag state-${stateOf(c)}`}>{stateOf(c)}</span></td>
                <td>{c.reason || '—'}</td>
                <td className="actions">
                  {!c.canceled && c.endMs > now && (
                    <button className="danger" onClick={async () => {
                      try { await api.cancelClosure(c.id); await load(); setNotice(`已取消封闭 id=${c.id}`); }
                      catch (e) { setError(e.message); }
                    }}>取消封闭</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
