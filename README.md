# NOVA

NOVA is a personal AI assistant, connected-service hub, and persistent Work-Tree mission interface. The production backend embeds the **official OpenClaw runtime** as its local agent control plane and uses **Composio** as the dynamic connected-app tool layer.

- **Production:** `https://nova-luis.onrender.com/` (fallback: `https://nova-sszi.onrender.com`)
- **Repository:** `https://github.com/ABBYCRM/NovaLuis`
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **OpenClaw runbook:** [`docs/OPENCLAW_BACKEND.md`](docs/OPENCLAW_BACKEND.md)
- **Composio runbook:** [`docs/COMPOSIO.md`](docs/COMPOSIO.md)

## Runtime topology

```text
Browser / NOVA UI
        │
        ├─ chat → /api/agent/v1/chat/completions
        │             │
        │             ▼
        │       OpenClaw Gateway 127.0.0.1:18789
        │         ├─ real agent loop, tools, skills and sessions
        │         ├─ model calls → /api/v1/chat/completions
        │         └─ nova-services → /api/integrations/composio/*
        │                                   │
        │                                   ▼
        │                         Composio connected apps
        │                  GitHub · Gmail · Slack · Notion · etc.
        │
        └─ settings/integrations → Express API :8080
```

The Gateway binds to loopback only. Normal browser chat and Work Tree both execute through OpenClaw. `/api/v1/*` remains the private server-side model-provider proxy and is not the browser's agent endpoint.

## Workspace layout

```text
artifacts/nova                         frontend SPA
artifacts/nova/public/assets/composio-settings.js
                                      Composio Settings app picker + chat route shim
artifacts/api-server                  Express API and Work-Tree persistence
artifacts/api-server/src/lib/composio.ts
                                      Composio session and REST client
artifacts/api-server/src/routes/composio.ts
                                      catalog, connection, search and execution routes
artifacts/api-server/src/routes/agent-chat.ts
                                      browser chat → OpenClaw agent gateway
openclaw/openclaw.json                strict Gateway/model/tool configuration
openclaw/workspace/skills/nova-services
                                      authenticated native + Composio service adapter
scripts/start-openclaw.mjs            process supervisor and readiness gate
skills/*                              existing repository skill catalog
```

## Connected services available to OpenClaw

| Capability | NOVA endpoint | OpenClaw access |
|---|---|---|
| Composio catalog and status | `/api/integrations/composio/*` | `nova-services composio-*` |
| GitHub repositories/issues/PRs | discovered through Composio | `composio-search` then `composio-execute` |
| Any connected Composio toolkit | discovered through Composio | `composio-search` then `composio-execute` |
| Gmail message search | `/api/integrations/gmail/messages` | `nova-services gmail` |
| Google Drive search | `/api/integrations/drive/files` | `nova-services drive` |
| Google Docs read | `/api/integrations/docs/:id` | `nova-services docs` |
| Google Sheets read | `/api/integrations/sheets/:id` | `nova-services sheets` |
| YouTube search | `/api/integrations/youtube/search` | `nova-services youtube` |
| Instagram media | `/api/integrations/instagram/media` | `nova-services instagram` |
| Knowledge search/ingest | `/api/knowledge/*` | `nova-services knowledge-*` |
| Scratchpad | `/api/scratchpad` | `nova-services scratchpad` |
| Skill catalog | `/api/skills/*` | `nova-services skills` |

## Composio Settings

Settings contains a searchable dropdown-style app showcase. It loads Composio's live toolkit catalog, displays featured apps, opens hosted OAuth Connect Links, and refreshes connection state when the connection window returns.

Use either:

```text
COMPOSIO_API_KEY=<project API key>
COMPOSIO_USER_ID=nova-luis
PUBLIC_BASE_URL=https://nova-luis.onrender.com
```

or enter the project API key in **Settings → Composio Apps**. The API key is write-only from the browser and connected-app OAuth credentials remain outside NOVA chat.

## Build and validation

**pnpm is the only package manager for this workspace.** Production secrets belong in Render environment variables and must never be committed.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
node --check artifacts/nova/public/assets/composio-settings.js
node --check openclaw/workspace/skills/nova-services/nova-services.mjs
```

GitHub verification also parses every real `.json` file, compiles every Git-tracked `.py` file, validates the pinned OpenClaw configuration and `nova-services` skill, builds the production image, starts the container, and checks the API, OpenClaw readiness, normal agent-chat route, Composio status route, UI, `bob.js`, and the Composio Settings asset.

Documentation and templates use accurate extensions: the governance design is `GOVERNANCE.md`, and the commented strict TypeScript template is `tsconfig-strict.jsonc`. `scripts/agentic_demo.py` is stored as runnable Python rather than a Markdown-fenced paste.

The production Docker image pins Node `24.18.0` and OpenClaw `2026.6.11`. At startup, `scripts/start-openclaw.mjs` generates missing internal secrets in memory, starts the loopback Gateway, waits for `/readyz`, and starts the API only after the Gateway is ready.

## Important environment variables

| Variable | Purpose |
|---|---|
| `COMPOSIO_API_KEY` | Composio project API key used by the server-side Tool Router client |
| `COMPOSIO_USER_ID` | Stable connected-account owner ID; defaults to `nova-luis` |
| `PUBLIC_BASE_URL` | Public callback origin used for hosted Composio Connect Links |
| `OPENCLAW_GATEWAY_TOKEN` | Optional persistent Gateway bearer token; generated at boot when absent |
| `OPENCLAW_STATE_DIR` | OpenClaw sessions/state directory; point this at a persistent Render disk to retain state across deploys |
| `NOVA_OPENCLAW_MODEL_ID` | Model ID sent through NOVA's server-side proxy; defaults to `WORK_TREE_MODEL` or `gpt-4o-mini` |
| `OPENAI_API_KEY` | Used by NOVA proxy for `gpt-*` models |
| `GEMINI_API_KEY` | Used by NOVA proxy for `gemini-*` models |
| `BITDEER_API_KEY` | Used by NOVA proxy for other configured model IDs |
| `SUPERNOVA_API_KEY` / `OPENCLAW_API_KEY` | Internal peer authentication for gated NOVA service endpoints |
| `DATABASE_URL` | Work-Tree, knowledge and integration persistence |
