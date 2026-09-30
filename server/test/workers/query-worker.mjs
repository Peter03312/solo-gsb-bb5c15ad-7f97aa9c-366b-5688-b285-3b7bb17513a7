import { workerData, parentPort } from 'node:worker_threads';
import { createDb } from '../../src/db.js';
import { migrate } from '../../src/schema.js';
import { findRoute } from '../../src/route.js';

// 并发测试用 worker：
//  1. 启动后立即查询并回传一条结果（保证主线程发布前已有 v1 查询）；
//  2. 收到 { go } 后再持续查询 count 次（与主线程的发布竞争）。
const db = createDb(workerData.file);
migrate(db);

const Q = () =>
  db.transaction(() =>
    findRoute(db, { from: 'A', to: 'C', departAt: '2099-02-01T00:00:00.000Z' })
  )();

const report = (phase) => {
  try {
    const r = Q();
    parentPort.postMessage({
      type: 'result',
      phase,
      version: r.version,
      edgeCount: r.edges.length,
      snapshot: r.closuresSnapshot.length,
    });
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: `${e.code}: ${e.message}` });
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  report('before');
  await new Promise((resolve) => parentPort.once('message', resolve));
  for (let i = 0; i < workerData.count; i++) {
    report('during');
    if (workerData.delayMs) await sleep(workerData.delayMs);
  }
  db.close();
};

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[query-worker fatal]', e);
    process.exit(1);
  });
