// 访客路线查询：
//   - 图为固定版本快照（节点/路段不可变，旧版本可继续查询）
//   - 途中不等待：一旦出发，到达某节点的时刻由“出发时刻 + 已走路段分钟数”唯一确定，
//     不能在节点停留以等封闭解除
//   - 每段通行全程避开封闭：路段在 [进入时刻, 离开时刻) 内与任一未取消封闭区间有重叠则不可通行
//     （区间端点相接不算重叠：封闭 [a,b) 与通行 [b,c) 可通行）
//   - 无台阶需求时剔除所有 has_steps=1 的路段
//
// 算法：带路径标签的 Dijkstra。以“到达时刻”为键；代价（分钟）非负，
// 但封闭使可行边依赖具体到达时刻（非 FIFO），因此同一节点可能需要多个不同到达时刻的标签。
// 每个标签携带已访问节点，杜绝环；(节点, 到达时刻) 去重，第一次弹出终点即最早到达。

import { db, withSnapshot } from './db.js';
import { ApiError } from './errors.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const MAX_LABELS = Number(process.env.MAX_LABELS || 50000);

// 路段身份键（与 closures 表登记的有向身份一致；-> 不出现在节点编号中，避免拼接撞键）
function edgeKey(fromCode, toCode) {
  return `${fromCode}->${toCode}`;
}

// 通行区间 [enterAt, exitAt) 与封闭区间 [startMs, endMs) 是否重叠；端点相接不重叠
function overlaps(enterAt, exitAt, closure) {
  return enterAt < closure.end_ms && exitAt > closure.start_ms;
}

export function findRoute({ from, to, departureMs, noSteps, version: requestedVersion }) {
  return withSnapshot(() => {
    // 1) 确定版本快照（默认最新）
    const latest = db.prepare('SELECT MAX(version) AS v FROM network_versions').get().v;
    const version = requestedVersion ?? latest;
    if (!Number.isInteger(version)) {
      throw new ApiError(409, 'NO_NETWORK', '路网尚未发布任何版本');
    }
    const verRow = db.prepare('SELECT version, published_at AS publishedAt FROM network_versions WHERE version = ?')
      .get(version);
    if (!verRow) {
      throw new ApiError(404, 'VERSION_NOT_FOUND', `路网版本 ${version} 不存在`);
    }

    // 2) 校验节点（未知节点明确报出）
    const nodeRow = db.prepare('SELECT code, name FROM nodes WHERE version = ? AND code = ?');
    const fromNode = nodeRow.get(version, from);
    if (!fromNode) throw new ApiError(404, 'UNKNOWN_NODE', `起点节点「${from}」在版本 v${version} 中不存在`);
    const toNode = nodeRow.get(version, to);
    if (!toNode) throw new ApiError(404, 'UNKNOWN_NODE', `终点节点「${to}」在版本 v${version} 中不存在`);

    // 3) 同一快照内载入该版本全部路段，以及全部可能影响行程的封闭（保证封闭快照一致）
    const edgeRows = db.prepare(
      `SELECT from_code AS fromCode, to_code AS toCode, minutes,
              has_steps AS hasSteps, step_count AS stepCount
         FROM edges WHERE version = ?`
    ).all(version);

    // end_ms > 出发时刻：早于出发就已结束的封闭不可能影响行程
    const closureRows = db.prepare(
      `SELECT edge_from, edge_to, start_ms, end_ms
         FROM closures
        WHERE canceled = 0 AND end_ms > ?`
    ).all(departureMs);

    const closuresByEdge = new Map();
    for (const c of closureRows) {
      const k = edgeKey(c.edge_from, c.edge_to);
      if (!closuresByEdge.has(k)) closuresByEdge.set(k, []);
      closuresByEdge.get(k).push(c);
    }

    const adjacency = new Map();
    for (const e of edgeRows) {
      if (noSteps && e.hasSteps === 1) continue;
      if (!adjacency.has(e.fromCode)) adjacency.set(e.fromCode, []);
      adjacency.get(e.fromCode).push(e);
    }
    for (const list of adjacency.values()) list.sort((a, b) => a.minutes - b.minutes);

    const nameByCode = new Map(
      db.prepare('SELECT code, name FROM nodes WHERE version = ?').all(version)
        .map((n) => [n.code, n.name])
    );

    const buildResult = (arrivalMs, pathEdges) => ({
      from: { code: fromNode.code, name: fromNode.name },
      to: { code: toNode.code, name: toNode.name },
      departureAt: new Date(departureMs).toISOString(),
      arrivalAt: new Date(arrivalMs).toISOString(),
      totalMinutes: (arrivalMs - departureMs) / 60000,
      noSteps,
      version,
      publishedAt: verRow.publishedAt,
      isLatest: version === latest,
      segments: pathEdges,
    });

    // 4) 起终点相同：零段路线
    if (from === to) {
      return buildResult(departureMs, []);
    }

    // 5) 标签 Dijkstra
    const heap = new MinHeap();
    const seen = new Set();
    heap.push({
      key: departureMs,
      code: from,
      arrival: departureMs,
      visited: new Set([from]),
      path: [{ code: from, arrivalMs: departureMs }],
    });

    let labelsProcessed = 0;
    while (heap.size > 0) {
      const label = heap.pop();
      const dedupeKey = `${label.code}@${label.arrival}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      labelsProcessed += 1;
      if (labelsProcessed > MAX_LABELS) {
        throw new ApiError(503, 'SEARCH_LIMIT', '路线搜索超出规模上限，请缩小路网或联系管理员');
      }

      if (label.code === to) {
        const segments = [];
        for (let i = 1; i < label.path.length; i++) {
          const prev = label.path[i - 1];
          const cur = label.path[i];
          const edge = edgeRows.find(
            (e) => e.fromCode === prev.code && e.toCode === cur.code &&
              e.minutes * 60000 === cur.arrivalMs - prev.arrivalMs
          );
          segments.push({
            from: { code: prev.code, name: nameByCode.get(prev.code) },
            to: { code: cur.code, name: nameByCode.get(cur.code) },
            enterAt: new Date(prev.arrivalMs).toISOString(),
            exitAt: new Date(cur.arrivalMs).toISOString(),
            minutes: (cur.arrivalMs - prev.arrivalMs) / 60000,
            hasSteps: edge ? edge.hasSteps === 1 : false,
            stepCount: edge ? edge.stepCount : null,
          });
        }
        return buildResult(label.arrival, segments);
      }

      const out = adjacency.get(label.code) || [];
      for (const e of out) {
        if (label.visited.has(e.toCode)) continue; // 简单路径，避免环
        const enterAt = label.arrival;
        const exitAt = enterAt + e.minutes * 60000;
        const closures = closuresByEdge.get(edgeKey(e.fromCode, e.toCode));
        if (closures && closures.some((c) => overlaps(enterAt, exitAt, c))) {
          continue; // 该路段在被经过的整段时间内处于封闭，不可通行且不能等待
        }
        const nextVisited = new Set(label.visited);
        nextVisited.add(e.toCode);
        const nextPath = label.path.concat([{ code: e.toCode, arrivalMs: exitAt }]);
        heap.push({
          key: exitAt,
          code: e.toCode,
          arrival: exitAt,
          visited: nextVisited,
          path: nextPath,
        });
      }
    }

    // 6) 无可行路线：尽量说明原因
    const reasons = [];
    if (noSteps && !edgeRows.some((e) => e.fromCode === from && e.hasSteps === 0)) {
      reasons.push(`起点「${from}」没有无台阶的出发路段`);
    }
    const hasAnyOut = edgeRows.some((e) => e.fromCode === from);
    if (reasons.length === 0) {
      reasons.push(hasAnyOut
        ? '受有向路段方向、沿途封闭时段或台阶属性限制，起终点之间不存在可行路径（途中不允许等待封闭结束）'
        : '起点没有任何出发的有向路段');
    }
    const err = new ApiError(404, 'NO_ROUTE', '无可行路线');
    err.reasons = reasons;
    throw err;
  });
}
