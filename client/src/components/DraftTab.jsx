import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function DraftTab({ onChanged }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nodeForm, setNodeForm] = useState({ code: '', name: '' });
  const [edgeForm, setEdgeForm] = useState({
    fromCode: '', toCode: '', minutes: '', hasSteps: false, stepCount: '',
  });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setDraft(await api.getDraft());
      setError('');
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(''); setNotice('');
    try {
      await fn();
      await load();
      onChanged?.();
      if (okMsg) setNotice(okMsg);
    } catch (e) {
      setError(renderError(e));
    } finally {
      setBusy(false);
    }
  };

  const renderError = (e) => (
    <span>
      {e.message}
      {e.details?.length > 0 && (
        <ul>{e.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
    </span>
  );

  const addNode = (ev) => {
    ev.preventDefault();
    run(() => api.addNode({ code: nodeForm.code.trim(), name: nodeForm.name.trim() }), '节点已加入草稿');
    setNodeForm({ code: '', name: '' });
  };

  const addEdge = (ev) => {
    ev.preventDefault();
    const payload = {
      fromCode: edgeForm.fromCode.trim(),
      toCode: edgeForm.toCode.trim(),
      minutes: Number(edgeForm.minutes),
      hasSteps: edgeForm.hasSteps,
    };
    if (edgeForm.hasSteps && edgeForm.stepCount !== '') payload.stepCount = Number(edgeForm.stepCount);
    run(() => api.addEdge(payload), '有向路段已加入草稿');
    setEdgeForm({ fromCode: '', toCode: '', minutes: '', hasSteps: false, stepCount: '' });
  };

  const doPublish = () => run(async () => {
    const r = await api.publish();
    setNotice(`✅ 已整体发布为 v${r.version}：${r.nodeCount} 个节点、${r.edgeCount} 条有向路段。旧版本仍可查询。`);
  });

  return (
    <div>
      <h2>路网草稿（维护者）</h2>
      <p className="hint">
        先在此反复编辑节点与有向路段（通行分钟、台阶属性），确认无误后点击<strong>整体发布</strong>。
        发布时若存在端点不存在或通行分钟非正的路段将被整体拒绝；若试图删除仍有未结束封闭的路段也会被拒绝。
        {draft && <> 当前草稿基于最新版 <strong>v{draft.latestVersion ?? '—'}</strong> 继续编辑。</>}
      </p>

      {notice && <div className="card ok">{notice}</div>}
      {error && <div className="card error">{error}</div>}

      <div className="two-col">
        <section className="card">
          <h3>节点（{draft?.nodes.length ?? 0}）</h3>
          <form className="inline-form" onSubmit={addNode}>
            <input placeholder="编号，如 GATE-C" value={nodeForm.code}
              onChange={(e) => setNodeForm({ ...nodeForm, code: e.target.value })} />
            <input placeholder="名称，如西门" value={nodeForm.name}
              onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })} />
            <button disabled={busy}>加入节点</button>
          </form>
          <table>
            <thead><tr><th>编号</th><th>名称</th><th></th></tr></thead>
            <tbody>
              {draft?.nodes.map((n) => <NodeRow key={n.code} node={n} disabled={busy} onChange={run} />)}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>有向路段（{draft?.edges.length ?? 0}）</h3>
          <form className="inline-form edge-form" onSubmit={addEdge}>
            <input placeholder="起点" value={edgeForm.fromCode}
              onChange={(e) => setEdgeForm({ ...edgeForm, fromCode: e.target.value })} />
            <input placeholder="终点" value={edgeForm.toCode}
              onChange={(e) => setEdgeForm({ ...edgeForm, toCode: e.target.value })} />
            <input type="number" min="1" placeholder="分钟" className="w80" value={edgeForm.minutes}
              onChange={(e) => setEdgeForm({ ...edgeForm, minutes: e.target.value })} />
            <label className="check small">
              <input type="checkbox" checked={edgeForm.hasSteps}
                onChange={(e) => setEdgeForm({ ...edgeForm, hasSteps: e.target.checked })} />台阶
            </label>
            <input type="number" min="0" placeholder="级" className="w60" disabled={!edgeForm.hasSteps}
              value={edgeForm.stepCount}
              onChange={(e) => setEdgeForm({ ...edgeForm, stepCount: e.target.value })} />
            <button disabled={busy}>加入路段</button>
          </form>
          <table>
            <thead><tr><th>方向</th><th>分钟</th><th>台阶</th><th></th></tr></thead>
            <tbody>
              {draft?.edges.map((e) => <EdgeRow key={e.id} edge={e} disabled={busy} onChange={run} />)}
            </tbody>
          </table>
        </section>
      </div>

      <div className="publish-bar">
        <button className="primary big" disabled={busy} onClick={doPublish}>整体发布草稿为新版本</button>
        <span className="hint">发布是原子操作：要么全部成功生成新版本，要么因校验失败而草稿原样保留。</span>
      </div>
    </div>
  );
}

function NodeRow({ node, disabled, onChange }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  if (editing) {
    return (
      <tr>
        <td>{node.code}</td>
        <td><input value={name} onChange={(e) => setName(e.target.value)} /></td>
        <td className="actions">
          <button disabled={disabled} onClick={() =>
            onChange(async () => { await api.updateNode(node.code, name.trim()); setEditing(false); }, '节点已更新')}>保存</button>
          <button disabled={disabled} onClick={() => setEditing(false)}>取消</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{node.code}</td>
      <td>{node.name}</td>
      <td className="actions">
        <button disabled={disabled} onClick={() => setEditing(true)}>改名</button>
        <button className="danger" disabled={disabled}
          onClick={() => onChange(() => api.deleteNode(node.code), `已删除节点 ${node.code} 及其关联草稿路段`)}>删除</button>
      </td>
    </tr>
  );
}

function EdgeRow({ edge, disabled, onChange }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    fromCode: edge.fromCode, toCode: edge.toCode, minutes: edge.minutes,
    hasSteps: edge.hasSteps, stepCount: edge.stepCount ?? '',
  });
  if (editing) {
    return (
      <tr>
        <td>
          <input className="w70" value={f.fromCode} onChange={(e) => setF({ ...f, fromCode: e.target.value })} /> →
          <input className="w70" value={f.toCode} onChange={(e) => setF({ ...f, toCode: e.target.value })} />
        </td>
        <td><input type="number" min="1" className="w60" value={f.minutes}
          onChange={(e) => setF({ ...f, minutes: e.target.value })} /></td>
        <td>
          <label className="check small"><input type="checkbox" checked={f.hasSteps}
            onChange={(e) => setF({ ...f, hasSteps: e.target.checked })} />台阶</label>
          <input type="number" min="0" className="w60" disabled={!f.hasSteps} value={f.stepCount}
            onChange={(e) => setF({ ...f, stepCount: e.target.value })} />
        </td>
        <td className="actions">
          <button disabled={disabled} onClick={() => onChange(async () => {
            const payload = {
              fromCode: f.fromCode.trim(), toCode: f.toCode.trim(), minutes: Number(f.minutes),
              hasSteps: f.hasSteps,
            };
            if (f.hasSteps && f.stepCount !== '') payload.stepCount = Number(f.stepCount);
            if (f.hasSteps && f.stepCount === '') payload.stepCount = null;
            await api.updateEdge(edge.id, payload);
            setEditing(false);
          }, '路段已更新')}>保存</button>
          <button disabled={disabled} onClick={() => setEditing(false)}>取消</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{edge.fromCode} → {edge.toCode}</td>
      <td>{edge.minutes}</td>
      <td>{edge.hasSteps ? <span className="tag steps">台阶{edge.stepCount ? ` ${edge.stepCount} 级` : ''}</span>
        : <span className="tag nosteps">无台阶</span>}</td>
      <td className="actions">
        <button disabled={disabled} onClick={() => setEditing(true)}>编辑</button>
        <button className="danger" disabled={disabled}
          onClick={() => onChange(() => api.deleteEdge(edge.id), '路段已从草稿删除（发布后生效）')}>删除</button>
      </td>
    </tr>
  );
}
