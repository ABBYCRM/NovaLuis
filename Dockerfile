# Nova-Aura-Tools — Production Dockerfile
# Multi-stage: builds the API server and serves the Nova static application.

FROM node:22-slim AS builder

WORKDIR /app

# Keep the package manager identical to package.json#packageManager.
RUN npm install -g pnpm@10.32.1

# Copy workspace manifests before source files so dependency installation can
# remain cached when application code changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/
COPY .npmrc ./

# CI builds must fail when package manifests and pnpm-lock.yaml disagree.
RUN pnpm install --frozen-lockfile --shamefully-hoist

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/nova/ ./artifacts/nova/
COPY scripts/ ./scripts/
COPY skills/ ./skills/

RUN node ./artifacts/api-server/build.mjs

FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NOVA_STATIC_DIR=/app/nova-static

COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/nova/index.html ./nova-static/index.html
COPY --from=builder /app/artifacts/nova/skills.html ./nova-static/skills.html
COPY --from=builder /app/artifacts/nova/public ./nova-static/
COPY --from=builder /app/skills ./skills

COPY SOUL.md AGENTS.md DIRECTIVE.md IDENTITY.md USER.md \
     HEARTBEAT.md TOOLS.md TASKS.md GOVERNANCE.json ./

COPY --from=builder /app/scripts ./scripts

EXPOSE 8080

# The API server is PID 1 so Render stop signals and exit status are preserved.
# The worker remains a child process of the shell and is terminated with the
# container. A dedicated process supervisor is preferable if more daemons are
# added later.
CMD ["/bin/sh", "-c", "node scripts/work-tree-worker.mjs & exec node --enable-source-maps ./dist/index.mjs"]
