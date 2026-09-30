# 多阶段构建：先构建 React 静态产物，再打包 Node 服务
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 优先复制清单以利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server ./server
COPY client ./client
RUN npm run build -w client

# ---- 运行镜像 ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV DB_PATH=/data/park.db
ENV SEED_ON_START=true

# better-sqlite3 在 node:20-bookworm-slim 有预编译二进制；
# 若目标平台无预编译包，构建时需要 python3/make/g++，这里保留以备源码编译。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server \
  && npm cache clean --force

COPY --from=build /app/client/dist ./client/dist
COPY server ./server

# SQLite 数据持久化目录
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4000

# 简单健康检查（容器内自带 node，不额外安装 curl）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
