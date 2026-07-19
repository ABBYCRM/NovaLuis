ARG NODE_IMAGE=node:24.18.0-bookworm-slim
ARG OPENCLAW_VERSION=2026.6.11

# ── Build stage ──────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN npm install -g pnpm@10.32.1

# Preserve the repository's proven pnpm install boundary. Only workspaces needed
# by the API build are present during dependency resolution.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/

RUN pnpm install --frozen-lockfile --shamefully-hoist

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/nova/ ./artifacts/nova/
COPY scripts/ ./scripts/
COPY skills/ ./skills/
COPY openclaw/ ./openclaw/
COPY SOUL.md AGENTS.md DIRECTIVE.md IDENTITY.md USER.md \
     HEARTBEAT.md TOOLS.md TASKS.md GOVERNANCE.md ./

RUN node ./artifacts/api-server/build.mjs

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ARG OPENCLAW_VERSION
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    NOVA_STATIC_DIR=/app/nova-static \
    PUBLIC_BASE_URL=https://nova-luis-8hjvt.ondigitalocean.app \
    WORK_TREE_WORKER_ENABLED=1 \
    SOCIAL_MEDIA_WORKER_ENABLED=1 \
    SUPER_NOVA_EXEC=1 \
    NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1 \
    NOVA_MODEL_PREFERENCE=nvidia \
    OPENCLAW_AGENT_MODEL=poolside/laguna-xs-2.1 \
    NOVA_OPENCLAW_MODEL_ID=poolside/laguna-xs-2.1 \
    WORK_TREE_MODEL=poolside/laguna-xs-2.1 \
    OPENCLAW_CONFIG_PATH=/app/openclaw/openclaw.json \
    OPENCLAW_STATE_DIR=/app/.openclaw \
    OPENCLAW_GATEWAY_PORT=18789 \
    OPENCLAW_RUNTIME_VERSION=${OPENCLAW_VERSION}

# Pin the released OpenClaw package. Node 24.18.0 satisfies the package's
# supported runtime floor and the repository's Node <25 engine constraint.
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" --omit=dev --no-audit --no-fund \
    && openclaw --version

COPY --from=builder /app/artifacts/api-server/dist ./dist
# Preserve the existing public URL layout: /assets/*, not /public/assets/*.
COPY --from=builder /app/artifacts/nova/index.html ./nova-static/index.html
COPY --from=builder /app/artifacts/nova/skills.html ./nova-static/skills.html
COPY --from=builder /app/artifacts/nova/public ./nova-static/
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/openclaw ./openclaw
COPY --from=builder /app/SOUL.md /app/AGENTS.md /app/DIRECTIVE.md /app/IDENTITY.md \
     /app/USER.md /app/HEARTBEAT.md /app/TOOLS.md /app/TASKS.md /app/GOVERNANCE.md ./
COPY --from=builder /app/SOUL.md /app/AGENTS.md /app/IDENTITY.md /app/USER.md \
     /app/HEARTBEAT.md /app/TOOLS.md ./openclaw/workspace/
COPY --from=builder /app/scripts ./scripts

EXPOSE 8080

CMD ["node", "./scripts/start-openclaw.mjs"]
