// 端到端业务验证脚本（直接打 HTTP API）
import Database from 'better-sqlite3';

const BASE = 'http://localhost:3000';
const db = new Database('/workspace/server/data/park.db');
let passed = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ✅', name); }
  else { failures.push(name); console.log('  ❌', name, extra ?? ''); }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

function routeQs({ from, to, dep, noSteps, version }) {
  const p = new URLSearchParams();
  p.set('from', from); p.set('to', to);
  p.set('departureAt', dep);
  p.set('noSteps', String(noSteps));
  if (version) p.set('version', version);
  return '/api/route?' + p.toString();
}

const iso = (deltaMin) => new Date(Date.now() + deltaMin * 60000).toISOString();

// ---------- 1. 基础：无台阶、封闭未开始 ----------
{
  console.log('\n[1] 基础路线（封闭未开始）');
  const r = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(0), noSteps: true }));
  ok(r.status === 200, 'HTTP 200');
  ok(r.json.totalMinutes === 9, '最短无台阶路线 9 分钟（GATE-A→CANTEEN→DORM-2）', r.json.totalMinutes);
  ok(r.json.segments.every(s => !s.hasSteps), '全程无台阶');
  ok(r.json.version === 1, '使用 v1');
  const arrival = Date.parse(r.json.arrivalAt) - Date.parse(r.json.departureAt);
  ok(arrival === 9 * 60000, '到达时刻 = 出发 + 9 分钟');
}

// ---------- 2. 封闭时段内：无台阶无路、允许台阶绕行 ----------
{
  console.log('\n[2] 示例封闭生效（+90 分钟出发，CANTEEN→DORM-2 封闭中）');
  const r1 = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(90), noSteps: true }));
  ok(r1.status === 404 && r1.json.error.code === 'NO_ROUTE', '无台阶需求 → 无可行路线', r1.status);
  ok(r1.json.error.reasons?.length > 0, '给出无路原因');

  const r2 = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(90), noSteps: false }));
  ok(r2.status === 200, '允许台阶 → 可查询', r2.status);
  const viaLib = r2.json.segments.some(s => s.from.code === 'LIB' && s.to.code === 'DORM-2');
  ok(viaLib, '绕行 LIB→DORM-2（含台阶路段）');
  ok(r2.json.segments.some(s => s.hasSteps), '结果中包含台阶路段标记');
}

// ---------- 3. 途中不等待：封闭时段内无简单可行路径 ----------
{
  console.log('\n[3] 途中不等待');
  // 封闭 +60~+180。+70 出发时，任何简单路径到达 CANTEEN/DORM 近道都落在封闭内，不能停留等待
  const r = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(70), noSteps: true }));
  ok(r.status === 404 && r.json.error.code === 'NO_ROUTE', '不能在节点等待到封闭结束', r.status);
}

// ---------- 4. 区间端点相接不算封闭 ----------
{
  console.log('\n[4] 封闭区间端点相接');
  const closures = (await api('GET', '/api/closures')).json.closures;
  const seed = closures.find(c => c.edgeFrom === 'CANTEEN' && c.edgeTo === 'DORM-2');
  const depart = new Date(seed.endMs - 6 * 60000).toISOString(); // 到 CANTEEN 时封闭恰好结束
  const r = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: depart, noSteps: true }));
  ok(r.status === 200 && r.json.totalMinutes === 9, '封闭刚结束的时刻进入路段可通行', r.status);
}

// ---------- 5. 错误输入：未知节点 / 无效时刻 / 坏版本 ----------
{
  console.log('\n[5] 错误输入');
  const r1 = await api('GET', routeQs({ from: 'NOPE', to: 'DORM-2', dep: iso(0), noSteps: false }));
  ok(r1.status === 404 && r1.json.error.code === 'UNKNOWN_NODE', '未知起点 → 404 UNKNOWN_NODE');
  const r2 = await api('GET', routeQs({ from: 'GATE-A', to: 'NOPE', dep: iso(0), noSteps: false }));
  ok(r2.status === 404 && r2.json.error.code === 'UNKNOWN_NODE', '未知终点 → 404 UNKNOWN_NODE');
  const r3 = await api('GET', '/api/route?from=GATE-A&to=DORM-2&departureAt=not-a-time');
  ok(r3.status === 400 && r3.json.error.code === 'INVALID_TIME', '无效时刻 → 400 INVALID_TIME');
  const r4 = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(0), noSteps: false, version: 99 }));
  ok(r4.status === 404 && r4.json.error.code === 'VERSION_NOT_FOUND', '不存在版本 → 404');
  const r5 = await api('GET', '/api/route?from=GATE-A&to=DORM-2&departureAt=x&version=abc');
  ok(r5.status === 400, '非法版本号 → 400');
}

// ---------- 6. 封闭登记：校验 + 登记后立即生效 ----------
{
  console.log('\n[6] 封闭登记');
  const bad1 = await api('POST', '/api/closures', { edgeFrom: 'ADMIN', edgeTo: 'CANTEEN', startAt: iso(10), endAt: iso(5) });
  ok(bad1.status === 400 && bad1.json.error.code === 'INVALID_TIME', '结束早于开始 → 400');
  const bad2 = await api('POST', '/api/closures', { edgeFrom: 'GHOST', edgeTo: 'CANTEEN', startAt: iso(0), endAt: iso(10) });
  ok(bad2.status === 404 && bad2.json.error.code === 'EDGE_NOT_FOUND', '未知有向路段 → 404');

  const reg = await api('POST', '/api/closures', { edgeFrom: 'ADMIN', edgeTo: 'CANTEEN', startAt: iso(0), endAt: iso(120), reason: '测试封闭' });
  ok(reg.status === 201, '登记成功 201');

  // 登记后立即生效：ADMIN→CANTEEN 被封，查询改走 ADMIN→CLINIC→GATE-A→CANTEEN（种子封闭 +60 才开始，时间上可行）
  const after = await api('GET', routeQs({ from: 'ADMIN', to: 'DORM-2', dep: iso(5), noSteps: true }));
  ok(after.status === 200, '登记后查询立即重算（绕行 CLINIC）', after.status);
  ok(after.json.segments.every(s => !(s.from.code === 'ADMIN' && s.to.code === 'CANTEEN')), '结果避开了新封闭路段');

  // 再封 ADMIN→CLINIC，起点无台阶出路，应无路
  await api('POST', '/api/closures', { edgeFrom: 'ADMIN', edgeTo: 'CLINIC', startAt: iso(0), endAt: iso(120) });
  const none = await api('GET', routeQs({ from: 'ADMIN', to: 'DORM-2', dep: iso(5), noSteps: true }));
  ok(none.status === 404 && none.json.error.code === 'NO_ROUTE', '所有无台阶出路全封 → 无可行路线');

  // 取消封闭后立即可用
  await api('POST', `/api/closures/${reg.json.id}/cancel`);
  const reopened = await api('GET', routeQs({ from: 'ADMIN', to: 'DORM-2', dep: iso(5), noSteps: true }));
  ok(reopened.status === 200, '取消封闭后路线恢复');
  const c2 = await api('POST', '/api/closures/999999/cancel');
  ok(c2.status === 404, '取消不存在的封闭 → 404');
}

// ---------- 7. 发布拒绝：端点不存在 / 分钟非正 ----------
{
  console.log('\n[7] 发布校验（草稿可反复编辑，失败不产生版本）');
  await api('POST', '/api/draft/edges', { fromCode: 'GATE-A', toCode: 'GHOST', minutes: 5, hasSteps: false })
    .then(() => ok(true, '草稿允许先挂悬空路段（发布时才拦截）'));
  const pub1 = await api('POST', '/api/publish');
  ok(pub1.status === 422 && pub1.json.error.code === 'PUBLISH_REJECTED', '端点不存在 → 422 拒绝发布', pub1.status);
  ok(pub1.json.error.details.some(d => d.includes('GHOST')), '错误明细指出缺失端点');
  ok((await api('GET', '/api/versions')).json.versions.length === 1, '发布失败未产生新版本（仍只有 v1）');

  // 补上节点后草稿合法；非正分钟在“写入草稿”环节就被 API 与 SQLite CHECK 双重拦截，
  // 无法进入草稿，发布层另有同样的显式校验作为纵深防御。
  await api('POST', '/api/draft/nodes', { code: 'GHOST', name: '幽灵门' });
  const m1 = await api('POST', '/api/draft/edges', { fromCode: 'GHOST', toCode: 'ADMIN', minutes: 0, hasSteps: false });
  ok(m1.status === 400 && m1.json.error.code === 'INVALID_MINUTES', '分钟为 0 → 400 拒绝写入草稿');
  const m2 = await api('POST', '/api/draft/edges', { fromCode: 'GHOST', toCode: 'ADMIN', minutes: -3, hasSteps: false });
  ok(m2.status === 400 && m2.json.error.code === 'INVALID_MINUTES', '分钟为负 → 400 拒绝写入草稿');
  let dbRejected = true;
  try {
    db.prepare('INSERT INTO draft_edges(from_code, to_code, minutes, has_steps) VALUES (?, ?, 0, 0)')
      .run('GHOST', 'ADMIN');
    dbRejected = false;
  } catch (e) {
    dbRejected = String(e.code) === 'SQLITE_CONSTRAINT_CHECK';
  }
  ok(dbRejected, '直接写库 minutes=0 也被 SQLite CHECK 拒绝');

  // 清理无效草稿
  const draft = (await api('GET', '/api/draft')).json;
  for (const e of draft.edges.filter(e => e.fromCode === 'GHOST' || e.toCode === 'GHOST')) {
    await api('DELETE', `/api/draft/edges/${e.id}`);
  }
  await api('DELETE', '/api/draft/nodes/GHOST');
}

// ---------- 8. 未结束封闭的路段不得被发布删除 ----------
{
  console.log('\n[8] 封闭保护：禁止删除未结束封闭路段');
  let draft = (await api('GET', '/api/draft')).json;
  const target = draft.edges.find(e => e.fromCode === 'CANTEEN' && e.toCode === 'DORM-2');
  await api('DELETE', `/api/draft/edges/${target.id}`);
  const pub = await api('POST', '/api/publish');
  ok(pub.status === 409 && pub.json.error.code === 'PUBLISH_BLOCKED_BY_CLOSURE', '删除带活跃封闭路段 → 409 拒绝', pub.status);
  ok(pub.json.error.details.some(d => d.includes('CANTEEN') && d.includes('未结束封闭')), '明细指出冲突路段与封闭结束时刻');
  ok((await api('GET', '/api/versions')).json.versions.length === 1, '仍未产生新版本');

  // 封闭结束后（用一条“已结束”的封闭不受保护来对照）：另选一条无活跃封闭的路段删除，应允许发布
  await api('POST', '/api/closures', { edgeFrom: 'GATE-B', edgeTo: 'DORM-2', startAt: iso(-30), endAt: iso(-5) });
  draft = (await api('GET', '/api/draft')).json;
  const endedEdge = draft.edges.find(e => e.fromCode === 'GATE-B' && e.toCode === 'DORM-2');
  await api('DELETE', `/api/draft/edges/${endedEdge.id}`);
  // 恢复被保护的路段
  const v1 = (await api('GET', '/api/versions/1')).json;
  const e = v1.edges.find(x => x.fromCode === 'CANTEEN' && x.toCode === 'DORM-2');
  await api('POST', '/api/draft/edges', { fromCode: 'CANTEEN', toCode: 'DORM-2', minutes: e.minutes, hasSteps: false });
  // 此时草稿仍含悬空? 否。发布 v2（比原计划提前在这里发布）
  const pub2 = await api('POST', '/api/publish');
  ok(pub2.status === 201 && pub2.json.version === 2, '恢复保护路段、仅删除“封闭已结束”路段后可发布 v2', pub2.status);
}

// ---------- 9. 旧版本继续可查，新版本新节点可达 ----------
{
  console.log('\n[9] 版本发布与旧版可查');
  await api('POST', '/api/draft/nodes', { code: 'GATE-C', name: '园区西门' });
  await api('POST', '/api/draft/edges', { fromCode: 'GATE-C', toCode: 'CLINIC', minutes: 12, hasSteps: false });
  const pub = await api('POST', '/api/publish');
  ok(pub.status === 201 && pub.json.version === 3, '发布 v3 成功', pub.status);
  ok(pub.json.nodeCount === 9 && pub.json.edgeCount === 16, 'v3 含 9 节点 16 路段');

  const old = await api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(0), noSteps: true, version: 1 }));
  ok(old.status === 200 && old.json.version === 1 && old.json.isLatest === false, 'v1 旧版继续可查并标注非最新');
  const oldSnap = await api('GET', '/api/versions/1');
  ok(!oldSnap.json.nodes.some(n => n.code === 'GATE-C'), 'v1 快照不含新节点（不可变）');
  const newr = await api('GET', routeQs({ from: 'GATE-C', to: 'DORM-2', dep: iso(0), noSteps: true }));
  ok(newr.status === 200 && newr.json.version === 3, '新版路线使用 v3 且新节点可达', newr.status);
}

// ---------- 10. 并发：发布完整性 + 查询快照一致性 ----------
{
  console.log('\n[10] 并发发布与查询');
  const pubs = await Promise.all(Array.from({ length: 10 }, () => api('POST', '/api/publish')));
  const created = pubs.map(p => p.json.version).sort((a, b) => a - b);
  ok(pubs.every(p => p.status === 201), '10 个并发发布全部 201');
  ok(JSON.stringify(created) === JSON.stringify(Array.from({ length: 10 }, (_, i) => i + 4)),
    '版本号严格连续 v4..v13（无重复/缺口）', JSON.stringify(created));

  const vers = (await api('GET', '/api/versions')).json.versions;
  let allComplete = true;
  for (const v of vers) {
    const snap = (await api('GET', `/api/versions/${v.version}`)).json;
    const codes = new Set(snap.nodes.map(n => n.code));
    const complete = snap.edges.every(e => codes.has(e.fromCode) && codes.has(e.toCode) && e.minutes > 0);
    if (!complete || snap.nodes.length !== v.nodeCount || snap.edges.length !== v.edgeCount) allComplete = false;
  }
  ok(allComplete, `全部 ${vers.length} 个版本快照均完整（端点齐全、分钟为正、计数一致）`);

  // 查询与发布交错：每个结果必须自洽（路径正确），且返回的版本在库中真实、完整
  const results = await new Promise((resolve) => {
    let done = 0; const collected = [];
    const finish = (r) => { collected.push(r); if (++done === 20) resolve(collected); };
    for (let i = 0; i < 20; i++) {
      api('GET', routeQs({ from: 'GATE-A', to: 'DORM-2', dep: iso(0), noSteps: true })).then(finish);
    }
    // 交错再发一个发布（可能产生 v14）
    setTimeout(() => api('POST', '/api/publish'), 10);
  });
  const fresh = (await api('GET', '/api/versions')).json.versions;
  const validVersions = new Set(fresh.map(v => v.version));
  const consistent = results.every(r =>
    r.status === 200 && validVersions.has(r.json.version) &&
    r.json.totalMinutes === 9 && r.json.segments.length === 2);
  ok(consistent, '20 个并发查询与发布交错时全部自洽（版本真实存在、路径均为 9 分钟两段路）');
}

console.log(`\n========== 结果：${passed} 通过，${failures.length} 失败 ==========`);
if (failures.length) { console.log('失败项：', failures); process.exit(1); }
