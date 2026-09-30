import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatIso } from '../time.js';

export default function VersionsTab() {
  const [versions, setVersions] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listVersions().then((r) => setVersions(r.versions)).catch((e) => setError(e.message));
  }, []);

  const open = async (v) => {
    setError('');
    try { setDetail(await api.getVersion(v)); } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <h2>历史路网版本</h2>
      <p className="hint">每次整体发布生成一个不可变版本。旧版本永远保留，访客可指定版本号继续查询。</p>
      {error && <div className="card error">{error}</div>}

      <div className="card">
        <table>
          <thead><tr><th>版本</th><th>发布时间</th><th>节点数</th><th>路段数</th><th></th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td><strong>v{v.version}</strong>{v.version === versions[0]?.version && <span className="tag nosteps"> 最新</span>}</td>
                <td>{formatIso(v.publishedAt)}</td>
                <td>{v.nodeCount}</td>
                <td>{v.edgeCount}</td>
                <td className="actions"><button onClick={() => open(v.version)}>查看快照</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>v{detail.version} 快照（发布于 {formatIso(detail.publishedAt)}）</h3>
            <button onClick={() => setDetail(null)}>关闭</button>
          </div>
          <div className="two-col">
            <div>
              <h4>节点</h4>
              <ul className="plain">{detail.nodes.map((n) => <li key={n.code}>{n.code} · {n.name}</li>)}</ul>
            </div>
            <div>
              <h4>有向路段</h4>
              <table>
                <thead><tr><th>方向</th><th>分钟</th><th>台阶</th></tr></thead>
                <tbody>
                  {detail.edges.map((e, i) => (
                    <tr key={i}>
                      <td>{e.fromCode} → {e.toCode}</td>
                      <td>{e.minutes}</td>
                      <td>{e.hasSteps ? `台阶${e.stepCount ? ` ${e.stepCount} 级` : ''}` : '无'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
