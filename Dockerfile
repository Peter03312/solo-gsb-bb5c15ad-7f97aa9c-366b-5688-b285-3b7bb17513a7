# ---- 构建阶段：安装全部依赖并构建 React 前端 ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# 先拷贝各 workspace 的 package.json 以利用层缓存
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install

# 拷贝源码并构建前端到 client/dist
COPY . .
RUN npm run build

# ---- 运行阶段：仅保留生产依赖（better-sqlite3 使用 prebuilt 二进制）----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DB_PATH=/data/park.db \
    TZ=Asia/Shanghai

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/client/dist ./client/dist
COPY server ./server

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/server.js"]
