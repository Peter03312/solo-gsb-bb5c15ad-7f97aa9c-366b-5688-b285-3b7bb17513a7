# 园区无障碍通行 Web 应用

面向园区/校园的无障碍路线查询系统：维护者维护节点与**有向路段**（通行分钟、台阶属性），
以「编辑草稿 → 整体发布」方式生成不可变路网版本；访客输入起终点、出发时刻与无台阶需求，
得到一条 **途中不等待、每段路通行全程避开临时封闭** 的可行路线、到达时刻与所依据的路网版本。

技术栈：**Node.js + Express + SQLite（better-sqlite3）/ React 18 + Vite**，Docker 一键启动。

---

## 一、快速启动（Docker Compose，推荐）

前置：安装 Docker（含 Compose 插件）。

```bash
docker compose up -d --build
```

启动后访问：

- **应用地址：http://localhost:3000**
- 健康检查：http://localhost:3000/api/health

首次启动会自动初始化数据库并写入示例路网（发布为 v1）与一条示例临时封闭。
数据持久化在 Docker 命名卷 `park-data` 中；停止、重启容器数据不丢失。

常用命令：

```bash
docker compose logs -f        # 查看日志
docker compose down           # 停止并移除容器（保留数据卷）
docker compose down -v        # 停止并同时删除数据卷（下次启动重新初始化）
```

修改宿主机端口（例如改为 8080）：

```bash
APP_PORT=8080 docker compose up -d --build     # 方式一：临时环境变量
cp .env.example .env                            # 方式二：编辑 .env 中的 APP_PORT
```

## 二、本地开发启动（不用 Docker）

需要 Node.js ≥ 20。

```bash
npm install                      # 安装 server 与 client 全部依赖（npm workspaces）
npm run dev:server               # 终端 1：后端 http://localhost:3000（自动初始化 SQLite）
npm run dev:client               # 终端 2：前端 http://localhost:5173（/api 已代理到 3000）
```

生产方式（后端直接托管前端构建产物，单端口 3000，与容器内一致）：

```bash
npm run build                    # 构建前端到 client/dist
npm start                        # 启动后端并托管静态资源：http://localhost:3000
```

端到端业务测试（需先在本地 3000 端口启动服务，会读写本地 `server/data/park.db`）：

```bash
npm start &                      # 或 docker compose up -d
npm run test:e2e                 # 45 项断言：避封闭/无等待/无台阶、发布校验、封闭保护、版本与并发一致性
```

## 三、配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端监听端口（容器内固定 3000，宿主机映射用 `APP_PORT`） |
| `DATA_DIR` | `server/data` | SQLite 文件所在目录（容器内为 `/data`） |
| `DB_PATH` | `$DATA_DIR/park.db` | SQLite 数据库文件完整路径 |
| `SEED_ON_START` | `1`（容器）/ 代码默认也初始化 | 首次启动且库为空时写入示例路网 v1；设为 `0` 不写入 |
| `MAX_LABELS` | `50000` | 无等待路线搜索的标签数上限（保护性熔断） |
| `TZ` | `Asia/Shanghai` | 容器时区 |

## 四、功能说明

### 1. 路网草稿与整体发布（维护者）

- 草稿可反复增删改：节点（编号、名称）与有向路段（起点、终点、通行分钟、是否有台阶、台阶数）。
- 点击「整体发布」在**一个 IMMEDIATE 事务**内把当前草稿固化为不可变新版本 `vN`。
- **拒绝发布**（HTTP 422，草稿原样保留）：
  - 任一路段的起点或终点在草稿节点中不存在；
  - 任一路段的通行分钟不是正整数（≤0、非数字）。
- **禁止删除封闭中的路段**（HTTP 409）：相对上一版本被删除的有向路段，
  若仍存在 `end > 当前时刻` 的未取消封闭，则发布被拒绝并列出冲突路段。
- 已发布版本永不修改、永不删除；旧版本继续可查（界面「历史版本」页或接口 `version` 参数）。

### 2. 临时封闭

- 按**有向路段身份**（起点编号 → 终点编号）与**起止时刻**登记，要求该路段存在于最新已发布版本；
  结束时刻必须晚于开始时刻。封闭不区分版本，在之后所有版本中持续生效。
- **登记成功即提交**，此后的任何路线查询都会立即读到该封闭。
- 判定规则：路段通行区间 `[进入, 离开)` 与封闭区间 `[开始, 结束)` 有重叠即不可走；
  **端点相接不算重叠**（封闭 08:00–10:00 结束，10:00 整进入该路段可以通行）。
- 支持取消封闭（取消后该路重新可用）。

### 3. 访客路线查询

输入：起点、终点、出发时刻（ISO 8601，界面按浏览器本地时区选择）、是否需要全程无台阶、
可选路网版本（留空使用最新版）。

输出：一条**最早到达的可行路线**，包括逐路段的进入/离开时刻、用时、台阶属性、
总用时、到达时刻，以及所使用的路网版本号与发布时间（旧版本会标注「旧版，仍可查询」）。

规则：

- **途中不等待**：不能在节点停留等封闭解除；到达每个节点的时刻由出发时刻与已走路段分钟数唯一决定。
- **每段全程避开封闭**：走某条路时，从进入到离开整段时间不得与任何封闭重叠。
- **无台阶需求**：`has_steps=1` 的路段完全不参与计算。
- 有向图、分钟为正：算法为以到达时刻为键的标签 Dijkstra（标签携带已访问节点避免环，
  `(节点, 到达时刻)` 去重），可正确处理封闭导致的非 FIFO 情形。
- 失败时给出明确原因：
  - **未知节点**（404 `UNKNOWN_NODE`）：起/终点不在该版本中；
  - **无效时刻**（400 `INVALID_TIME`）：出发时刻不是合法时间；
  - **版本不存在**（404 `VERSION_NOT_FOUND`）；
  - **无可行路线**（404 `NO_ROUTE`）：说明是受方向、封闭时段还是台阶属性限制。

### 4. 并发一致性

- better-sqlite3 为同步驱动，单连接上的事务串行执行；SQLite 开启 WAL 与 `busy_timeout=5000ms`。
- **发布**使用 `BEGIN IMMEDIATE` 写事务：并发发布在锁上排队，每个版本的节点与路段要么全部可见、
  要么全部不可见，不会出现半成品版本。
- **查询**在单个快照事务内一次性读取「版本元数据 + 节点 + 路段 + 封闭记录」，
  与并发发布互不交错：查询看到的是完整版本与同一时刻一致的封闭快照。

## 五、HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/draft` | 查看当前草稿（节点/路段） |
| POST/PUT/DELETE | `/api/draft/nodes[/:code]` | 草稿节点增改删 |
| POST/PUT/DELETE | `/api/draft/edges[/:id]` | 草稿有向路段增改删 |
| POST | `/api/publish` | 整体发布草稿为新版本 |
| GET | `/api/versions` · `/api/versions/:v` | 版本列表 / 某版本完整快照 |
| GET | `/api/closures[?all=true&at=ISO]` | 封闭列表（可按时刻过滤生效中） |
| POST | `/api/closures` | 登记封闭 `{edgeFrom, edgeTo, startAt, endAt, reason}` |
| POST | `/api/closures/:id/cancel` | 取消封闭 |
| GET | `/api/route?from=&to=&departureAt=&noSteps=&version=` | 访客路线查询 |

错误响应统一形如：

```json
{ "error": { "code": "PUBLISH_REJECTED", "message": "发布被拒绝：草稿存在无效数据",
  "details": ["路段 X -> Y 的起点「X」不存在"] } }
```

## 六、快速体验脚本

容器启动后（示例封闭默认在当前时刻 1 小时后开始），可直接用 curl 验证：

```bash
# 1) 无台阶 + 出发时刻在示例封闭期间：食堂->二号公寓 被封，会绕行或无路
curl -G http://localhost:3000/api/route \
  --data-urlencode from=GATE-A --data-urlencode to=DORM-2 \
  --data-urlencode "departureAt=$(date -u -d '+90 min' +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode noSteps=true

# 2) 允许台阶：可经 LIB（图书馆）绕行，注意 LIB->DORM-2 有 4 级台阶
curl -G http://localhost:3000/api/route \
  --data-urlencode from=GATE-A --data-urlencode to=DORM-2 \
  --data-urlencode "departureAt=$(date -u -d '+90 min' +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode noSteps=false

# 3) 登记一条新封闭（登记成功后立即生效）
curl -X POST http://localhost:3000/api/closures -H 'Content-Type: application/json' -d "{
  \"edgeFrom\":\"ADMIN\",\"edgeTo\":\"CLINIC\",
  \"startAt\":\"$(date -u -d '+10 min' +%Y-%m-%dT%H:%M:%SZ)\",
  \"endAt\":\"$(date -u -d '+120 min' +%Y-%m-%dT%H:%M:%SZ)\",
  \"reason\":\"临时检修\"}"

# 4) 查历史版本（v1 永久可查）
curl http://localhost:3000/api/versions/1
```

## 七、目录结构

```
.
├── Dockerfile                # 多阶段构建（构建前端 + 生产运行）
├── docker-compose.yml        # 一键启动（端口、数据卷、健康检查、环境变量）
├── package.json              # npm workspaces 根配置
├── server/                   # Node.js + Express + SQLite 后端
│   └── src/
│       ├── server.js         # HTTP 路由
│       ├── db.js             # 连接、建表、事务封装
│       ├── seed.js           # 首次启动数据初始化
│       ├── version.js        # 草稿发布与版本查询
│       ├── routing.js        # 无等待/避封闭/无台阶 路线搜索
│       └── errors.js         # 统一错误与参数校验
└── client/                   # React 18 + Vite 前端
    └── src/
        ├── App.jsx
        ├── api.js / time.js
        └── components/       # 访客路线 / 草稿 / 封闭 / 历史版本 四个页面
```
