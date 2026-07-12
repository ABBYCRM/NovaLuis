# Nova-Aura-Tools — Production Dockerfile
# Multi-stage: builds API server, serves React app + skills catalog

# ── Builder stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

ENV PORT=8080
ENV BASE_PATH=/
ENV NODE_ENV=production

# Install pnpm v9 to match lockfileVersion 9.0
RUN npm install -g pnpm@9

# Copy lockfile + package manifests only (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./

# Install all workspace deps.
# --frozen-lockfile: don't resolve packages — use the lockfile directly.
#   This also bypasses minimumReleaseAge checks (lockfile is already verified).
# NODE_OPTIONS: cap V8 heap so install doesn't OOM inside Docker on 512 MB.
RUN NODE_OPTIONS="--max-old-space-size=384" pnpm install --frozen-lockfile

# Copy remaining source
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/nova/ ./artifacts/nova/
COPY scripts/ ./scripts/
COPY skills/ ./skills/
COPY skills-catalog/ ./skills-catalog/

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NOVA_STATIC_DIR=/app/nova-static

# Copy built API server
COPY --from=builder /app/artifacts/api-server/dist ./dist

# Copy static UI + skills catalog
COPY --from=builder /app/artifacts/nova/index.html ./nova-static/index.html
COPY --from=builder /app/artifacts/nova/skills.html ./nova-static/skills.html
COPY --from=builder /app/artifacts/nova/public ./nova-static/
COPY --from=builder /app/skills ./skills

# Copy identity files
COPY SOUL.md AGENTS.md DIRECTIVE.md IDENTITY.md USER.md \
      HEARTBEAT.md TOOLS.md TASKS.md GOVERNANCE.json ./

# Copy scripts (work-tree worker)
COPY --from=builder /app/scripts ./scripts

EXPOSE 8080

# Start: background worker + API server
CMD ["/bin/sh", "-c", \
  "node scripts/work-tree-worker.mjs & exec node --enable-source-maps ./dist/index.mjs"]
