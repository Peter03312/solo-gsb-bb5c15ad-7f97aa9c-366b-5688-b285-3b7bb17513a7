# 🌿 园区无障碍通行 Web 应用

Node.js + React + SQLite（better-sqlite3）实现的园区路网与无障碍路线服务。

维护者在**草稿**中录入节点与有向路段（通行分钟、是否有台阶），可反复修改；
点击**整体发布**后生成一个**不可变的新版本**，访客查询立即使用新版本，
而所有**旧版本仍可继续查询**。维护者还可按「有向路段 + 起止时刻」登记**临时封闭**，
登记一旦成功提交，之后发起的查询立即生效。

访客输入起点、终点、出发时刻及「全程无台阶」需求后，系统给出一条

- **途中不等待**（到达任一节点后必须立刻进入下一路段，也不允许靠绕圈消耗时间）；
- **每段通行全程避开已登记封闭**；
- 在满足以上条件下**到达时刻最早**

的可行路线，并返回逐步路段、到达时刻与所用路网版本。无可行路线、未知节点或无效时刻
都会返回明确原因。

---

## 一、快速启动（Docker Compose，一键）

需要 Docker 20.10+ 与 Docker Compose v2。

```bash
# 可选：准备环境变量（默认值已可直接使用）
cp .env.example .env

# 构建并后台启动
docker compose up -d --build

# 查看状态与日志
docker compose ps
docker compose logs -f
```

启动后访问：

| 入口 | 地址 |
| --- | --- |
| **Web 界面** | <http://localhost:4000> |
| 健康检查 | <http://localhost:4000/api/health> |
| 版本列表 API | <http://localhost:4000/api/versions> |

停止与清理：

```bash
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除数据库数据卷（恢复到全新初始化）
```

> 首次启动会自动建表并写入一套演示路网（v1）与两条演示封闭（见下文「演示数据」）。
> 生产环境可设置 `SEED_ON_START=false`，启动时只建表、不写入演示数据。

### 配置（环境变量）

通过 `.env` 或 `docker compose` 覆盖：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `4000` | **宿主机**映射端口，浏览器访问端口 |
| `SEED_ON_START` | `true` | 首次启动（库内无任何版本时）是否写入演示路网 |
| `DB_PATH` | `/data/park.db` | SQLite 文件位置（compose 已挂载命名卷持久化） |
| `ROUTE_MAX_STATES` | `2000000` | 单次不等待路线搜索的状态数保护上限 |
| `ROUTE_MAX_NODES` | `18` | 精确搜索支持的最大节点数（位掩码状态） |
| `ROUTE_HORIZON_MIN` | `43200` | 纳入计算的封闭远期窗口（分钟，默认 30 天） |

例如改用 8080 端口：`APP_PORT=8080 docker compose up -d --build`，然后访问
<http://localhost:8080>。

---

## 二、本地开发（不用 Docker）

要求 Node.js 20+。better-sqlite3 会使用预编译二进制，通常无需编译工具链。

```bash
# 在仓库根目录安装所有工作区依赖
npm install

# 构建前端（生产模式下由 Express 托管 client/dist）
npm run build

# 启动后端（默认 :4000，首次启动自动初始化演示数据到 server/data/park.db）
npm start
# 打开 http://localhost:4000
```

前端热更新开发（同时启动 Vite :5173 与 API :4000，`/api` 自动代理）：

```bash
npm run dev
# 打开 http://localhost:5173
```

运行服务端测试：

```bash
npm test -w server
```

本地可配置环境变量：`PORT`（默认 4000）、`HOST`（默认 0.0.0.0）、
`DB_PATH`（默认 `server/data/park.db`）、`SEED_ON_START`（默认 true）。

---

## 三、界面与操作说明

Web 界面分三个页签：

1. **访客查询**：选择起终点、出发时刻，勾选「全程无台阶」，可选指定路网版本；
   返回逐步路线（每段分钟、是否有台阶）、到达时刻、总时长与路网版本号。
2. **路网草稿与发布**：在线编辑节点与有向路段，可随时「保存草稿」（不影响线上），
   确认后「整体发布新版本」；下方可查看任一历史版本快照。
3. **临时封闭**：选择当前版本的路段、设置起止时刻与备注后登记；可查看/删除
   未结束（或全部）封闭。

### 演示数据

8 个节点（正门、无障碍停车场、游客服务中心、中心广场、多功能展厅、水景花园、
儿童活动区、东侧出口）与 22 条有向路段，其中：

- 停车场↔中心有「带台阶近路」与「无台阶坡道绕行路」；
- 广场↔展厅有「带台阶近路（3 分钟）」与「无台阶绕行路（9 分钟）」；
- 首次启动还会登记**广场↔展厅台阶近路**在启动后约 30 分钟开始、持续 2 小时的封闭，
  便于直接观察「封闭期间自动走无台阶绕行、封闭结束后走近路」的差异。

可尝试：访客查询 `PLAZA → HALL`，出发时刻分别选「现在」和「约 1 小时后」。

---

## 四、HTTP API

所有接口前缀 `/api`，请求/响应均为 JSON。错误响应形如
`{ "error": "错误码", "message": "中文原因", "details": {...} }`。

### 访客

`GET /api/route?from=GATE&to=HALL&departAt=2026-10-01T08:00:00Z&stepFree=true&version=2`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `from` / `to` | 是 | 起终点节点编码 |
| `departAt` | 是 | 出发时刻，ISO 8601（建议带时区，如 `Z`） |
| `stepFree` | 否 | `true` 时全程每段都必须无台阶 |
| `version` | 否 | 指定历史版本号；省略则用当前版本 |

成功返回 `departAt / arrivalAt / durationMinutes / path[] / pathNames[] / edges[] /
version / publishedAt / closuresSnapshot[]`。

典型错误：

| HTTP | error | 触发条件 |
| --- | --- | --- |
| 400 | `UNKNOWN_NODE` | 起点或终点不在该版本中 |
| 400 | `INVALID_TIME` | 出发时刻无法解析 |
| 404 | `VERSION_NOT_FOUND` | 指定版本不存在 |
| 404 | `NO_PATH` | 路网中本就无路线 |
| 404 | `NO_STEP_FREE_PATH` | 有路线但都含台阶，无法满足无台阶 |
| 404 | `BLOCKED` | 途中不等待且全程避开封闭时无可行路线（附相关封闭路段） |

### 维护：草稿与发布

- `GET /api/draft`：读取当前草稿。
- `PUT /api/draft`：整体覆盖保存草稿。请求体：
  ```json
  {
    "nodes": [{ "code": "GATE", "name": "园区正门" }],
    "edges": [{ "code": "E1", "from": "GATE", "to": "CENTER", "minutes": 8, "hasSteps": false }]
  }
  ```
  保存时即校验结构：编码非空不重复、`minutes` 必须为正整数。
- `POST /api/publish`：把草稿整体发布为新版本。发布前额外强制校验
  **每个路段端点都必须存在**；任一不通过则整体拒绝（400，不产生新版本）。
  若草稿删除了「当前版本中仍登记有未结束封闭」的路段，返回 409
  `EDGE_HAS_ACTIVE_CLOSURE` 并附带 `blockedEdges`，拒绝发布。
- `GET /api/versions` / `GET /api/versions/:v`：版本列表与指定版本的完整快照
  （旧版本永久可查）。

### 维护：临时封闭

- `GET /api/closures[?all=true]`：默认只列未结束封闭，`all=true` 含已结束。
- `POST /api/closures`：登记封闭。
  ```json
  { "edgeCode": "E-CENTER-PLAZA",
    "startTime": "2026-10-01T09:00:00Z",
    "endTime": "2026-10-01T11:00:00Z",
    "note": "台阶维护" }
  ```
  约束：路段须存在于当前版本（否则 404 `EDGE_NOT_FOUND`）；结束须晚于开始
  （400 `INVALID_TIME_RANGE`）；结束时刻必须尚未过去。登记成功即提交，
  **随后的所有路线查询立即避开该封闭**。
- `DELETE /api/closures/:id`：删除一条封闭登记。

curl 示例：

```bash
curl -X POST localhost:4000/api/closures -H 'Content-Type: application/json' \
  -d '{"edgeCode":"E-GATE-CENTER","startTime":"2026-10-01T09:00:00Z","endTime":"2026-10-01T10:00:00Z","note":"施工"}'
```

---

## 五、数据模型与关键设计

### 表（SQLite，启动时幂等迁移）

- `versions(version, published_at)`、`version_nodes(version, code, name)`、
  `version_edges(version, code, from_node, to_node, minutes, has_steps)`：
  每个已发布版本的**不可变完整快照**。
- `draft_nodes` / `draft_edges`：唯一的编辑中草稿，与已发布版本隔离。
- `closures(id, edge_code, start_time, end_time, note, created_at)`：封闭登记，
  按路段编码全局生效（历史版本查询时只采用属于该版本路段的封闭）。
- `meta(key,value)`：保存 `current_version` 当前版本指针。

`minutes` 有 `CHECK (minutes > 0)`、`has_steps` 有 0/1 约束。

### 草稿 → 发布

- 保存草稿与发布是两步；只有发布才推进版本。
- 发布在单个 `BEGIN IMMEDIATE` 事务中完成「写版本记录 + 写整版节点/路段快照 +
  切换当前指针」，因此并发发布在 SQLite 写锁上串行，版本号由事务内
  `MAX(version)+1` 生成；任何查询要么看到完整旧版、要么看到完整新版，读不到半个版本。
- 发布前校验：端点缺失、分钟非正、自环、空路网都会拒绝；当前版本中仍带未结束封闭的
  路段不允许在新版删除（但可以保留或修改属性）。

### 临时封闭的一致性

- 封闭登记是独立的即时写事务，成功返回后在 SQLite WAL 下对后续所有连接的查询立即可见。
- 每次路线查询整体运行在一个只读事务中，其「路网版本快照」与「封闭快照」取自同一数据库
  快照；即使查询期间发生发布或封闭登记，本次结果内部也保持一致，并回显
  `closuresSnapshot`。`server/test/app.test.js` 中用多 `worker_threads` 真实并发
  连接做了发布/查询竞争测试。

### 「途中不等待」搜索

时间相关的前向最短路（状态 = 节点 + 到达时刻 + 已访问节点集合）：

- 到达节点后**必须立刻**沿某出边离开，没有「等待」这个动作；
- 只在**节点不重复的简单路径**上搜索。正边权下，任何含环路径删环后到达后续节点的时刻
  严格提前，而更早到达不会让原本可通行的边变得不可通行，因此排除环路不损失最优解，
  也杜绝了「绕几圈耗过封闭时间」这种变相等待；
- 路段在 `[进入时刻, 进入时刻+分钟)` 与任一封闭区间相交即不可进入；区间端点相接允许
  （封闭刚结束的那一分钟可以进入）；
- 状态按到达时刻进入最小堆，时间边权为正，第一个弹出的终点即最早到达。

---

## 六、目录结构

```
.
├── Dockerfile                # 多阶段：构建前端 + 打包 Node 服务
├── docker-compose.yml        # 一键启动（含数据卷与健康检查）
├── .env.example
├── package.json              # npm workspaces 根
├── server/                   # Node.js + Express + better-sqlite3
│   ├── src/
│   │   ├── index.js          # HTTP 入口、路由、静态托管
│   │   ├── db.js schema.js   # 连接/WAL 与建表
│   │   ├── graph.js          # 草稿/版本图读取与归一化校验
│   │   ├── versions.js       # 草稿保存、整体发布（IMMEDIATE 事务）
│   │   ├── closures.js       # 封闭登记
│   │   ├── route.js          # 不等待 + 封闭的时间相关最短路
│   │   ├── seed.js           # 首次启动演示数据
│   │   └── util.js
│   └── test/app.test.js      # 10 项端到端/并发测试
└── client/                   # React + Vite
    ├── src/components/…      # 访客查询 / 草稿发布 / 封闭登记
    └── vite.config.js
```
