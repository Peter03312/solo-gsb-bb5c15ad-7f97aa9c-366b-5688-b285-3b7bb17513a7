import { badRequest } from './util.js';

/**
 * 把 API 请求体里的路网草稿归一化。
 *
 * 草稿保存阶段（partial）：仅做字段类型/取值层面的校验，允许引用尚不存在的节点
 * （维护者可以先录路段再补节点）。
 *
 * 发布阶段（full）：在归一化基础上额外要求
 *   1. 每个端点都存在于节点表；
 *   2. 路段编码不重复（主键保证，这里给出明确错误）；
 *   3. 通行分钟必须为正整数（要求“分钟非正拒绝”，同时保证无等待搜索的状态可终止）；
 *   4. 不允许自环。
 */
export function normalizeGraph(input, { full = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('INVALID_GRAPH', '草稿必须是包含 nodes 与 edges 的对象');
  }

  const normalizeNodes = () => {
    if (!Array.isArray(input.nodes)) {
      throw badRequest('INVALID_GRAPH', 'nodes 必须是数组');
    }
    const codes = new Set();
    const nodes = input.nodes.map((n, i) => {
      if (n === null || typeof n !== 'object' || Array.isArray(n)) {
        throw badRequest('INVALID_GRAPH', `nodes[${i}] 必须是对象`);
      }
      const code = String(n.code ?? '').trim();
      const name = String(n.name ?? '').trim();
      if (!code) throw badRequest('INVALID_NODE', `nodes[${i}] 缺少 code`);
      if (!name) throw badRequest('INVALID_NODE', `节点 ${code} 缺少名称 name`);
      if (codes.has(code)) {
        throw badRequest('DUPLICATE_NODE', `节点编码重复：${code}`);
      }
      codes.add(code);
      return { code, name };
    });
    return nodes;
  };

  const normalizeEdges = () => {
    if (!Array.isArray(input.edges)) {
      throw badRequest('INVALID_GRAPH', 'edges 必须是数组');
    }
    const codes = new Set();
    const edges = input.edges.map((e, i) => {
      if (e === null || typeof e !== 'object' || Array.isArray(e)) {
        throw badRequest('INVALID_GRAPH', `edges[${i}] 必须是对象`);
      }
      const code = String(e.code ?? '').trim();
      const fromNode = String(e.from ?? e.from_node ?? e.fromNode ?? '').trim();
      const toNode = String(e.to ?? e.to_node ?? e.toNode ?? '').trim();
      const minutesRaw = e.minutes;
      const hasSteps =
        e.has_steps === true || e.has_steps === 1 || e.hasSteps === true ? 1 : 0;

      if (!code) throw badRequest('INVALID_EDGE', `edges[${i}] 缺少 code`);
      if (codes.has(code)) {
        throw badRequest('DUPLICATE_EDGE', `路段编码重复：${code}`);
      }
      codes.add(code);
      if (!fromNode || !toNode) {
        throw badRequest('INVALID_EDGE', `路段 ${code} 缺少起点或终点`);
      }
      if (!Number.isInteger(minutesRaw) || minutesRaw <= 0) {
        throw badRequest(
          'INVALID_MINUTES',
          `路段 ${code} 的通行分钟必须是正整数（收到：${minutesRaw}）`
        );
      }
      if (full && fromNode === toNode) {
        throw badRequest('SELF_LOOP_EDGE', `路段 ${code} 不允许起点终点相同`);
      }
      return { code, fromNode, toNode, minutes: minutesRaw, hasSteps };
    });
    return edges;
  };

  const nodes = normalizeNodes();
  const edges = normalizeEdges();

  if (nodes.length === 0) {
    throw badRequest('EMPTY_GRAPH', '至少需要一个节点才能发布');
  }

  if (full) {
    const nodeCodes = new Set(nodes.map((n) => n.code));
    for (const e of edges) {
      if (!nodeCodes.has(e.fromNode)) {
        throw badRequest(
          'ENDPOINT_NOT_FOUND',
          `路段 ${e.code} 的起点节点不存在：${e.fromNode}`
        );
      }
      if (!nodeCodes.has(e.toNode)) {
        throw badRequest(
          'ENDPOINT_NOT_FOUND',
          `路段 ${e.code} 的终点节点不存在：${e.toNode}`
        );
      }
    }
  }

  return { nodes, edges };
}

export function readGraph(db, { draft = true } = {}) {
  const prefix = draft ? 'draft' : 'version';
  // version 表需要额外 version 参数，由调用方处理；这里仅供草稿使用。
  if (!draft) throw new Error('readGraph 仅支持草稿，版本快照请用 readVersionGraph');
  const nodes = db
    .prepare(`SELECT code, name FROM ${prefix}_nodes ORDER BY code`)
    .all();
  const edges = db
    .prepare(
      `SELECT code, from_node AS fromNode, to_node AS toNode, minutes,
              has_steps AS hasSteps
       FROM ${prefix}_edges ORDER BY code`
    )
    .all()
    .map((e) => ({ ...e, hasSteps: !!e.hasSteps }));
  return { nodes, edges };
}

export function readVersionGraph(db, version) {
  const nodes = db
    .prepare('SELECT code, name FROM version_nodes WHERE version = ? ORDER BY code')
    .all(version);
  const edges = db
    .prepare(
      `SELECT code, from_node AS fromNode, to_node AS toNode, minutes,
              has_steps AS hasSteps
       FROM version_edges WHERE version = ? ORDER BY code`
    )
    .all(version)
    .map((e) => ({ ...e, hasSteps: !!e.hasSteps }));
  return { nodes, edges };
}
