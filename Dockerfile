FROM node:24-slim AS builder

RUN npm install -g pnpm@10

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NOVA_STATIC_DIR=/app/nova-static

COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY artifacts/nova/index.html ./nova-static/index.html
COPY artifacts/nova/public ./nova-static
COPY SOUL.md AGENTS.md DIRECTIVE.md IDENTITY.md USER.md HEARTBEAT.md TOOLS.md TASKS.md GOVERNANCE.json ./

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
