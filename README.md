# NOVA

NOVA is a personal AI assistant, connected-service hub, and persistent Work-Tree mission interface. The production backend now embeds the **official OpenClaw runtime** as its local agent control plane instead of forwarding Work-Tree missions to a separate service.

- **Production:** `https://nova-luis.onrender.com/` (fallback: `https://nova-sszi.onrender.com`)
- **Repository:** `https://github.com/ABBYCRM/NovaLuis`
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **OpenClaw integration runbook:** [`docs/OPENCLAW_BACKEND.md`](docs/OPENCLAW_BACKEND.md)

## Runtime topology

```text
Browser / NOVA UI
        │
        ▼
Express API :8080
  ├─ /api/v1/*                  server-side model proxy
  ├─ /api/work-tree/*           persistent mission records
  ├─ /api/integrations/*        Gmail, Drive, Docs, Sheets, YouTube, Instagram
  ├─ /api/knowledge/*           semantic knowledge search and ingest
  └─ /api/openclaw/status       runtime readiness
        │
        ▼
OpenClaw Gateway 127.0.0.1:18789
  ├─ official agent loop, sessions, tools, skills and subagents
  ├─ model provider → http://127.0.0.1:8080/api/v1
  └─ nova-services skill → http://127.0.0.1:8080/api/*
```

The Gateway binds to loopback only. Work-Tree calls its authenticated OpenAI-compatible endpoint with model `openclaw/default`; OpenClaw then executes the mission through the same agent path used by the native CLI.

## Workspace layout

```text
artifacts/nova                         frontend SPA
artifacts/api-server                  Express API and Work-Tree persistence
lib/*                                 shared DB, API schema and client packages
openclaw/openclaw.json                strict Gateway/model/tool configuration
openclaw/workspace/skills/nova-services
                                      authenticated connected-service adapter
scripts/start-openclaw.mjs            process supervisor and readiness gate
skills/*                              existing repository skill catalog
```

## Connected services available to OpenClaw

| Capability | NOVA endpoint | OpenClaw access |
|---|---|---|
| Gmail message search | `/api/integrations/gmail/messages` | `nova-services gmail` |
| Google Drive search | `/api/integrations/drive/files` | `nova-services drive` |
| Google Docs read | `/api/integrations/docs/:id` | `nova-services docs` |
| Google Sheets read | `/api/integrations/sheets/:id` | `nova-services sheets` |
| YouTube search | `/api/integrations/youtube/search` | `nova-services youtube` |
| Instagram media | `/api/integrations/instagram/media` | `nova-services instagram` |
| Knowledge search/ingest | `/api/knowledge/*` | `nova-services knowledge-*` |
| Scratchpad | `/api/scratchpad` | `nova-services scratchpad` |
| Skill catalog | `/api/skills/*` | `nova-services skills` |

## Build and validation

**pnpm is the only package manager for this workspace.** Production secrets belong in Render environment variables and must never be committed.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
```

GitHub verification also parses every real `.json` file, compiles every Git-tracked `.py` file, validates the pinned OpenClaw configuration and `nova-services` skill, builds the production image, starts the container, and checks `/api/healthz`, `/api/openclaw/status`, the UI, and `/assets/bob.js`.

Documentation and templates use accurate extensions: the governance design is `GOVERNANCE.md`, and the commented strict TypeScript template is `tsconfig-strict.jsonc`. `scripts/agentic_demo.py` is stored as runnable Python rather than a Markdown-fenced paste.

The production Docker image pins Node `24.18.0` and OpenClaw `2026.6.11`. At startup, `scripts/start-openclaw.mjs` generates missing internal secrets in memory, starts the loopback Gateway, waits for `/readyz`, and starts the API only after the Gateway is ready.

## Important environment variables

| Variable | Purpose |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Optional persistent Gateway bearer token; generated at boot when absent |
| `OPENCLAW_STATE_DIR` | OpenClaw sessions/state directory; point this at a persistent Render disk to retain state across deploys |
| `NOVA_OPENCLAW_MODEL_ID` | Model ID sent through NOVA's server-side proxy; defaults to `WORK_TREE_MODEL` or `gpt-4o-mini` |
| `OPENAI_API_KEY` | Used by NOVA proxy for `gpt-*` models |
| `GEMINI_API_KEY` | Used by NOVA proxy for `gemini-*` models |
| `BITDEER_API_KEY` | Used by NOVA proxy for other configured model IDs |
| `SUPERNOVA_API_KEY` / `OPENCLAW_API_KEY` | Internal peer authentication for gated NOVA service endpoints |
| `DATABASE_URL` | Work-Tree, knowledge and integration persistence |
