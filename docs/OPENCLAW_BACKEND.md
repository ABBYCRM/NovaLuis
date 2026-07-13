# OpenClaw Backend Runbook

## Purpose

This deployment embeds the released OpenClaw runtime in the NOVA container and
makes it the sole Work Tree execution backend. The integration intentionally
preserves NOVA's database, API and frontend contracts.

## Pinned runtime

The production image pins:

```text
Node:     24.18.0-bookworm-slim
OpenClaw: 2026.6.11
pnpm:     10.32.1
```

Change these only through a reviewed Dockerfile update, then rebuild and verify
the Gateway configuration against the new OpenClaw version.

## Required Render environment

| Variable | Requirement | Purpose |
|---|---|---|
| `DATABASE_URL` | required for Work Tree and knowledge | Postgres connection |
| At least one model-provider key | required | `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `BITDEER_API_KEY`, matching the selected model |
| `SESSION_SECRET` | required in production | Signs the Work Tree/operator session cookie |

## Optional environment

| Variable | Default | Purpose |
|---|---:|---|
| `NOVA_OPENCLAW_MODEL_ID` | `gpt-4o-mini` | Model id sent through NOVA's proxy |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Loopback Gateway port |
| `OPENCLAW_GATEWAY_TOKEN` | generated at boot | Gateway bearer token |
| `OPENCLAW_API_KEY` | generated at boot | Internal peer bearer token |
| `SUPERNOVA_API_KEY` | internal peer token | Compatibility alias; inherited if already configured |
| `OPENCLAW_RUN_TIMEOUT_MS` | `900000` | Work Tree Gateway request timeout |
| `OPENCLAW_STARTUP_TIMEOUT_MS` | `120000` | Maximum Gateway readiness wait |
| `OPENCLAW_RESUME_LIMIT` | `10` | Active rows reconciled after restart, capped at 25 |
| `OPENCLAW_STATE_DIR` | `/app/.openclaw` | OpenClaw state directory |
| `OPENCLAW_WORKSPACE_DIR` | `/app/openclaw/workspace` | Agent workspace and skills root |
| `NOVA_INTERNAL_API_BASE` | `http://127.0.0.1:8080/api` | Service bridge API base |
| `NOVA_INTERNAL_MODEL_BASE_URL` | `http://127.0.0.1:8080/api/v1` | OpenClaw model-provider base URL |

Generated tokens are process-local and are not printed. Explicit environment
values can be supplied when stable cross-process credentials are required.

## Local build checks

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
node --check scripts/start-openclaw.mjs
node --check openclaw/workspace/skills/nova-services/nova-services.mjs
node -e 'JSON.parse(require("fs").readFileSync("openclaw/openclaw.json","utf8"))'
```

## Production verification

1. Confirm the Render deploy references the intended Git commit.
2. Confirm `GET /api/healthz` returns HTTP 200 and `{ "status": "ok" }`.
3. Confirm `GET /api/openclaw/status` returns HTTP 200 with
   `status: "ready"` and the pinned runtime version.
4. Open the NOVA UI and verify its static assets load without console errors.
5. Unlock Work Tree and submit a low-risk mission such as:

   ```text
   Inspect the NOVA skills catalog, name three available skills, and show the
   exact tool evidence used. Do not perform external writes.
   ```

6. Verify the run transitions `pending -> running -> done`, the model field is
   `openclaw/default`, and the final report is non-empty.
7. Submit a mission that requires one configured service, such as a Gmail query,
   and verify that the `nova-services` bridge returns real API data or a precise
   configuration error.
8. Restart the service with a run in progress and verify startup reconciliation
   resumes or cleanly fails the row rather than leaving it permanently pending.

## Troubleshooting

### `/api/openclaw/status` returns 503

Inspect container logs for `start-openclaw:` and `openclaw-gateway:` lines.
Common causes are an invalid strict configuration, an unavailable port, or an
OpenClaw package/runtime mismatch. The API is not started until the Gateway
health check succeeds, so a public API response usually means the Gateway later
exited.

### Work Tree returns `OpenClaw Gateway HTTP 401`

The API and Gateway do not share the same `OPENCLAW_GATEWAY_TOKEN`. They must be
children of `start-openclaw.mjs`, or both must receive the identical explicit
environment value.

### Model request fails

Check `NOVA_OPENCLAW_MODEL_ID` against the available provider key:

- `gpt-*` requires `OPENAI_API_KEY`;
- `gemini-*` requires `GEMINI_API_KEY`;
- other configured ids route to Bitdeer and require `BITDEER_API_KEY`.

The OpenClaw provider deliberately points to NOVA's proxy, so provider failures
appear in API logs and in the Work Tree run error.

### A service command returns 401

The bridge uses `SUPERNOVA_API_KEY` or `OPENCLAW_API_KEY`. The API auth layer must
receive the same value. The supervisor normalizes these values automatically
unless separate processes bypass it.

### A run is stuck after a container restart

The API calls `resumeOpenClawRuns()` after listening. Check the database row's
status, `OPENCLAW_RESUME_LIMIT`, Gateway readiness, and application logs. The
reconciliation limit is intentionally bounded to prevent a restart storm.

## Rollback

Rollback by deploying the preceding Git commit. Do not re-enable the legacy
worker alongside OpenClaw: both consume the same Work Tree rows and would race.
A rollback must restore the prior Docker command and prior `work-tree.ts`
together.
