import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function emptyEdge() {
  return { code: '', from: '', to: '', minutes: 3, hasSteps: false };
}

export default function DraftEditor() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [versions, setVersions] = useState([]);
  const [viewVersion, setViewVersion] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    const [d, vs] = await Promise.all([api.getDraft(), api.versions()]);
    setNodes(d.nodes);
    setEdges(d.edges);
    setVersions(vs.versions);
  };

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  const flash = (kind, text) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const save = async () => {
    setErr(null);
    try {
      const d = await api.saveDraft({ nodes, edges });
      setNodes(d.nodes);
      setEdges(d.edges.map((e) => ({ ...e, hasSteps: !!e.hasSteps })));
      flash('ok', '草稿已保存（尚未发布，不影响线上查询）');
    } catch (e) {
      setErr(e);
    }
  };

  const publish = async () => {
    setErr(null);
    if (!window.confirm('整体发布当前草稿为新版本？发布后访客查询将使用新版本，旧版本仍可查询。')) return;
    try {
      const pub = await api.publish();
      await load();
      flash('ok', `已发布 v${pub.version}，含 ${pub.nodes.length} 个节点、${pub.edges.length} 条路段`);
      setViewVersion(null);
    } catch (e) {
      setErr(e);
    }
  };

  const viewOld = async (v) => {
    setErr(null);
    try {
      setViewVersion(await api.version(v));
    } catch (e) {
      setErr(e);
    }
  };

  const updateNode = (i, key, val) =>
    setNodes(nodes.map((n, idx) => (idx === i ? { ...n, [key]: val } : n)));
  const updateEdge = (i, key, val) =>
    setEdges(edges.map((e, idx) => (idx === i ? { ...e, [key]: val } : e)));

  return (
    <div className="card">
      <h2>维护者 · 路网草稿与发布</h2>
      <p className="hint">
        先在草稿中编辑节点与有向路段（通行分钟为正整数、标注是否有台阶），可反复保存；
        点击「整体发布」后才生成新版本。端点不存在或分钟非正会被拒绝；
        仍有未结束封闭的路段不能在新版中删除。
      </p>

      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      {err && (
        <div className="alert error">
          <strong>操作被拒绝：</strong>
          {err.message}
          <code className="errcode">{err.code}</code>
          {err.details?.blockedEdges && (
            <div className="sub">需保留的路段：{err.details.blockedEdges.join('、')}</div>
          )}
        </div>
      )}

      <h3>节点（{nodes.length}）</h3>
      <table className="edit-table">
        <thead>
          <tr>
            <th>编码</th>
            <th>名称</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n, i) => (
            <tr key={i}>
              <td>
                <input value={n.code} onChange={(e) => updateNode(i, 'code', e.target.value)} />
              </td>
              <td>
                <input value={n.name} onChange={(e) => updateNode(i, 'name', e.target.value)} />
              </td>
              <td>
                <button
                  className="danger small"
                  onClick={() => setNodes(nodes.filter((_, idx) => idx !== i))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" onClick={() => setNodes([...nodes, { code: '', name: '' }])}>
        + 新增节点
      </button>

      <h3>有向路段（{edges.length}）</h3>
      <table className="edit-table">
        <thead>
          <tr>
            <th>编码</th>
            <th>起点</th>
            <th>终点</th>
            <th>分钟</th>
            <th>有台阶</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => (
            <tr key={i}>
              <td>
                <input value={e.code} onChange={(ev) => updateEdge(i, 'code', ev.target.value)} />
              </td>
              <td>
                <input
                  list="node-codes"
                  value={e.from}
                  onChange={(ev) => updateEdge(i, 'from', ev.target.value)}
                />
              </td>
              <td>
                <input
                  list="node-codes"
                  value={e.to}
                  onChange={(ev) => updateEdge(i, 'to', ev.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="1"
                  style={{ width: 80 }}
                  value={e.minutes}
                  onChange={(ev) => updateEdge(i, 'minutes', Number(ev.target.value))}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={!!e.hasSteps}
                  onChange={(ev) => updateEdge(i, 'hasSteps', ev.target.checked)}
                />
              </td>
              <td>
                <button
                  className="danger small"
                  onClick={() => setEdges(edges.filter((_, idx) => idx !== i))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="node-codes">
        {nodes.map((n) => (
          <option key={n.code} value={n.code}>
            {n.name}
          </option>
        ))}
      </datalist>
      <button className="small" onClick={() => setEdges([...edges, emptyEdge()])}>
        + 新增路段
      </button>

      <div className="actions">
        <button onClick={save}>保存草稿</button>
        <button className="primary" onClick={publish}>
          整体发布新版本
        </button>
      </div>

      <h3>已发布版本（旧版继续可查）</h3>
      <div className="version-list">
        {versions.length === 0 && <span className="muted">尚无已发布版本</span>}
        {versions.map((v) => (
          <button
            key={v.version}
            className={'version-chip' + (v.current ? ' current' : '')}
            onClick={() => viewOld(v.version)}
          >
            v{v.version}
            {v.current ? ' · 当前' : ''} · {v.node_count} 节点 / {v.edge_count} 路段
          </button>
        ))}
      </div>

      {viewVersion && (
        <div className="modal-mask" onClick={() => setViewVersion(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              v{viewVersion.version} 快照{viewVersion.current ? '（当前版本）' : ''}
            </h3>
            <p className="muted small">发布于 {new Date(viewVersion.publishedAt).toLocaleString()}</p>
            <div className="modal-scroll">
              <strong>节点：</strong>
              <ul>
                {viewVersion.nodes.map((n) => (
                  <li key={n.code}>
                    {n.code} · {n.name}
                  </li>
                ))}
              </ul>
              <strong>路段：</strong>
              <ul>
                {viewVersion.edges.map((e) => (
                  <li key={e.code}>
                    {e.code}：{e.fromNode} → {e.toNode} · {e.minutes} 分钟 ·{' '}
                    {e.hasSteps ? '有台阶' : '无台阶'}
                  </li>
                ))}
              </ul>
            </div>
            <button className="small" onClick={() => setViewVersion(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
