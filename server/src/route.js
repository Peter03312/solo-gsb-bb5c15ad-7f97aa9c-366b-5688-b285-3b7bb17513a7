import { readVersionGraph } from './graph.js';
import { currentVersion } from './versions.js';
import { badRequest, notFound, parseTime } from './util.js';

/**
 * “途中不等待、全程避开封闭”的时间相关最短路 —— 前向时间 Dijkstra（只走简单路径）。
 *
 * 语义：访客在 departAt 离开起点；到达某节点后必须立刻进入下一路段，
 * 既不能在节点等待，也不能靠在环路上绕圈来消耗时间（绕圈等价于变相等待）。
 * 路段 e 可在时刻 t 进入，当且仅当通行区间 [t, t+e.minutes) 与其封闭区间
 * 互不相交（端点相接允许）。
 *
 * 为什么“只走简单路径”不损失最优性：
 *  所有边耗时为正。若一条路径含环，删去该环后到达其后每个节点的时刻都严格提前；
 *  在“某一时刻可进入某边”的封闭区间模型下，更早到达不会让原本可通行的边变不可通行。
 *  因此只要存在含环可行路径，就存在到达不更晚的简单可行路径。故只需在“节点不重复”
 *  的状态空间中搜索，天然排除等待型环路，且最早到达解保持不变。
 *
 * 状态：(节点, 到达相对分钟, 已访问节点掩码)。时间只严格增加，按到达时刻的小顶堆
 *  弹出的第一个终点状态即最早到达。同一 (节点, 相对分钟, 掩码) 不重复扩展。
 */

const MAX_STATES = Number(process.env.ROUTE_MAX_STATES || 2_000_000);
/** 动态窗口上限（分钟）：只考虑出发后该范围内的封闭，超出视为不影响本次行程。 */
const HORIZON_MIN = Number(process.env.ROUTE_HORIZON_MIN || 60 * 24 * 30);
/** 精确掩码搜索支持的最大节点数；超出则拒绝（园区路网规模通常远小于此）。 */
const MAX_NODES_EXACT = Number(process.env.ROUTE_MAX_NODES || 18);

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t <= a[i].t) break;
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
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.fromNode)) adj.set(e.fromNode, []);
    adj.get(e.fromNode).push(e);
  }
  return adj;
}

/** 各节点到 target 的静态（忽略封闭、无台阶已过滤）分钟距离。 */
function distancesTo(edges, target) {
  const rev = new Map();
  for (const e of edges) {
    if (!rev.has(e.toNode)) rev.set(e.toNode, []);
    rev.get(e.toNode).push({ node: e.fromNode, minutes: e.minutes });
  }
  const dist = new Map([[target, 0]]);
  const heap = new MinHeap();
  heap.push({ t: 0, node: target });
  while (heap.size) {
    const { t, node } = heap.pop();
    if (t !== dist.get(node)) continue;
    for (const { node: prev, minutes } of rev.get(node) ?? []) {
      const nd = t + minutes;
      if (!dist.has(prev) || nd < dist.get(prev)) {
        dist.set(prev, nd);
        heap.push({ t: nd, node: prev });
      }
    }
  }
  return dist;
}

/** 通行区间 [enterMs, leaveMs) 是否与封闭相交；端点相接（<）不算。 */
function isBlocked(edge, enterMs, leaveMs, closuresByEdge) {
  const list = closuresByEdge.get(edge.code);
  if (!list) return false;
  for (const c of list) {
    if (c.sMs < leaveMs && enterMs < c.eMs) return true;
  }
  return false;
}

/**
 * 查询一条可行路线（须在事务中调用，以保证路网 + 封闭为同一致快照）。
 */
export function findRoute(db, query) {
  const from = String(query.from ?? '').trim();
  const to = String(query.to ?? '').trim();
  const stepFree =
    query.stepFree === true || query.stepFree === 'true' || query.stepFree === 1;

  if (!from) throw badRequest('INVALID_QUERY', '缺少起点 from');
  if (!to) throw badRequest('INVALID_QUERY', '缺少终点 to');
  const departDate = parseTime(query.departAt ?? query.depart_at, 'departAt');

  let version = query.version;
  if (version === undefined || version === null || version === '') {
    version = currentVersion(db);
    if (version === null) throw badRequest('NO_PUBLISHED_VERSION', '尚未发布任何路网版本');
  } else {
    version = Number(version);
    if (!Number.isInteger(version) || version <= 0) {
      throw badRequest('INVALID_VERSION', `版本号无效：${query.version}`);
    }
  }

  const versionRow = db.prepare('SELECT * FROM versions WHERE version = ?').get(version);
  if (!versionRow) throw notFound('VERSION_NOT_FOUND', `路网版本不存在：v${version}`);

  const graph = readVersionGraph(db, version);
  const nodeNames = new Map(graph.nodes.map((n) => [n.code, n.name]));
  if (!nodeNames.has(from)) throw badRequest('UNKNOWN_NODE', `未知起点节点：${from}`);
  if (!nodeNames.has(to)) throw badRequest('UNKNOWN_NODE', `未知终点节点：${to}`);

  // 无台阶需求：过滤掉带台阶路段（全程每一段都必须无台阶）。
  const eligible = graph.edges.filter((e) => !stepFree || !e.hasSteps);
  const eligibleCodes = new Set(eligible.map((e) => e.code));

  // 封闭快照：出发时刻之后仍在/才生效、且属于本版本可用路段的封闭。
  const departMs = departDate.getTime();
  const allClosures = db
    .prepare(
      'SELECT edge_code AS edgeCode, start_time AS startTime, end_time AS endTime, note FROM closures WHERE end_time > ?'
    )
    .all(departDate.toISOString());
  const relevantClosures = allClosures
    .filter((c) => eligibleCodes.has(c.edgeCode))
    .map((c) => ({ ...c, sMs: Date.parse(c.startTime), eMs: Date.parse(c.endTime) }));
  const closuresByEdge = new Map();
  for (const c of relevantClosures) {
    if (!closuresByEdge.has(c.edgeCode)) closuresByEdge.set(c.edgeCode, []);
    closuresByEdge.get(c.edgeCode).push(c);
  }

  const staticDist = distancesTo(eligible, to);

  if (from === to) {
    return buildResult({
      departDate,
      arriveRel: 0,
      states: [],
      startNode: from,
      nodeNames,
      stepFree,
      version,
      versionRow,
      relevantClosures,
    });
  }

  // 静态可达性预检（台阶过滤后 / 全量），给出明确的不可行原因。
  if (!staticDist.has(from)) {
    if (stepFree) {
      const fullDist = distancesTo(graph.edges, to);
      if (!fullDist.has(from)) {
        throw notFound('NO_PATH', `路网中不存在从 ${from} 到 ${to} 的路线`);
      }
      throw notFound(
        'NO_STEP_FREE_PATH',
        `从 ${from} 到 ${to} 没有全程无台阶路线（有路线但均包含带台阶路段）`
      );
    }
    throw notFound('NO_PATH', `路网中不存在从 ${from} 到 ${to} 的路线`);
  }

  const V = graph.nodes.length;
  if (V > MAX_NODES_EXACT) {
    throw notFound(
      'SEARCH_LIMIT',
      `路网节点数 ${V} 超出精确不等待搜索上限 ${MAX_NODES_EXACT}，请联系维护者拆分区域或放宽上限`
    );
  }

  // 仅用于错误提示与远期封闭过滤的窗口上限。
  const horizonCap = departMs + HORIZON_MIN * 60_000;

  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.code, i]));
  const adj = buildAdjacency(eligible);
  const startMask = 1 << nodeIndex.get(from);

  // 状态对象 { t(相对分钟), node, mask, parent, edge }。
  const heap = new MinHeap();
  heap.push({ t: 0, node: from, mask: startMask, parent: null, edge: null });
  const seen = new Set([`${nodeIndex.get(from)}@0#${startMask}`]);

  let processed = 0;
  let winner = null;

  while (heap.size) {
    const st = heap.pop();
    if (st.node === to) {
      winner = st; // 时间边权为正：首个弹出的终点即最早到达
      break;
    }
    if (++processed > MAX_STATES) {
      throw notFound('SEARCH_LIMIT', '可行路线搜索超出状态上限，请缩小封闭时间范围或联系维护者');
    }

    const enterMs = departMs + st.t * 60_000;
    for (const e of adj.get(st.node) ?? []) {
      const wi = nodeIndex.get(e.toNode);
      if (st.mask & (1 << wi)) continue; // 简单路径：不得重复经过节点
      if (!staticDist.has(e.toNode)) continue; // 下游静态都到不了终点

      const leaveMs = enterMs + e.minutes * 60_000;
      if (isBlocked(e, enterMs, leaveMs, closuresByEdge)) continue;

      const nt = st.t + e.minutes;
      const nmask = st.mask | (1 << wi);
      const key = `${wi}@${nt}#${nmask}`;
      if (seen.has(key)) continue;
      seen.add(key);
      heap.push({ t: nt, node: e.toNode, mask: nmask, parent: st, edge: e });
    }
  }

  if (!winner) {
    const edges = [
      ...new Set(
        relevantClosures
          .filter((c) => c.sMs < horizonCap && c.eMs > departMs)
          .map((c) => c.edgeCode)
      ),
    ];
    throw notFound(
      'BLOCKED',
      edges.length > 0
        ? `无可行路线：在出发时刻 ${departDate.toISOString()} 之后，不允许途中等待（也不能绕路耗时间）时所有路线都会撞上封闭时段` +
            `（相关封闭路段：${edges.join('、')}）；可更换出发时刻`
        : '无可行路线：无法在途中不等待且全程避开封闭',
      { closureEdges: edges }
    );
  }

  return buildResult({
    departDate,
    arriveRel: winner.t,
    states: winner,
    startNode: from,
    nodeNames,
    stepFree,
    version,
    versionRow,
    relevantClosures,
  });
}

function buildResult({
  departDate,
  arriveRel,
  states,
  startNode,
  nodeNames,
  stepFree,
  version,
  versionRow,
  relevantClosures,
}) {
  // 沿父指针回溯边。
  const pathEdges = [];
  for (let s = states; s && s.parent; s = s.parent) {
    pathEdges.unshift(s.edge);
  }
  const pathNodes = [startNode];
  for (const e of pathEdges) pathNodes.push(e.toNode);
  const arrivalMs = departDate.getTime() + arriveRel * 60_000;

  return {
    departAt: departDate.toISOString(),
    arrivalAt: new Date(arrivalMs).toISOString(),
    durationMinutes: arriveRel,
    path: pathNodes,
    pathNames: pathNodes.map((c) => nodeNames.get(c)),
    edges: pathEdges.map((e) => ({
      code: e.code,
      from: e.fromNode,
      to: e.toNode,
      minutes: e.minutes,
      hasSteps: !!e.hasSteps,
    })),
    stepFree,
    version,
    publishedAt: versionRow.published_at,
    closuresSnapshot: relevantClosures.map(({ sMs, eMs, ...c }) => c),
  };
}
