# NOVA

NOVA is a personal AI assistant, connected-service hub, and persistent Work-Tree mission interface. The production backend embeds the **official OpenClaw runtime** as its local agent control plane, uses a deterministic server-side GitHub repository preflight for repository URLs, and uses **Composio** as the scalable connected-app layer for OAuth-backed services and account actions.

- **Production:** `https://nova-luis.onrender.com/` (fallback: `https://nova-sszi.onrender.com`)
- **Repository:** `https://github.com/ABBYCRM/NovaLuis`
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **OpenClaw runbook:** [`docs/OPENCLAW_BACKEND.md`](docs/OPENCLAW_BACKEND.md)
- **Composio runbook:** [`docs/COMPOSIO.md`](docs/COMPOSIO.md)

## Runtime topology

```text
Browser / NOVA UI
        │
        ├─ /api/agent/v1/chat/completions ─────────────┐
        │                                              │
        ├─ legacy /api/v1/chat/completions             │
        │      └─ server reroutes all non-internal     │
        │         chat into the same agent path ───────┤
        │                                              ▼
        │                                  OpenClaw Gateway
        │                                  127.0.0.1:18789
        │                                    │
        │              GitHub URL detected?  │
        │                     │              │
        │                     ▼              │
        │             GitHub REST preflight  │
        │          metadata · tree · commits │
        │            high-signal file text   │
        │                     │              │
        │                     └──── evidence ┤
        │                                    │
        │                                    ├─ model calls → internal /api/v1
        │                                    └─ nova-services → Composio/native apps
        │
        └─ settings/integrations → Express API :8080
```

The Gateway binds to loopback only. Normal browser chat and Work Tree execute through OpenClaw. `/api/v1/*` remains the server-side model-provider path **only for authenticated internal OpenClaw inference calls**; any non-internal chat request that still reaches the old browser path is rerouted into the agent endpoint before raw inference.

For a public GitHub repository URL, NOVA does **not** require Composio or GitHub OAuth. The API fetches observed repository evidence directly from GitHub before OpenClaw answers. Composio remains the preferred connected-account layer for OAuth-backed apps, private-account actions, and broader third-party automation.

## Workspace layout

```text
artifacts/nova                         frontend SPA
artifacts/nova/public/assets/composio-settings.js
                                      Composio Settings app picker + agent route compatibility shim
artifacts/api-server                  Express API and Work-Tree persistence
artifacts/api-server/src/lib/github-repo.ts
                                      deterministic GitHub URL parser, API client, cache and evidence builder
artifacts/api-server/src/routes/github.ts
                                      PIN-protected GitHub preflight diagnostic
artifacts/api-server/src/lib/composio.ts
                                      Composio session and REST client
artifacts/api-server/src/routes/composio.ts
                                      catalog, connection, search and execution routes
artifacts/api-server/src/routes/agent-chat.ts
                                      GitHub preflight + browser chat → OpenClaw agent gateway
artifacts/api-server/src/routes/openai-proxy.ts
                                      internal model proxy + legacy browser-chat server reroute
openclaw/openclaw.json                strict Gateway/model/tool configuration
openclaw/workspace/skills/nova-services
                                      authenticated native + Composio service adapter
scripts/start-openclaw.mjs            process supervisor and readiness gate
scripts/repo-audit.mjs                one-by-one tracked-file audit and JSON evidence manifest
skills/*                              existing repository skill catalog
```

## Connected services available to OpenClaw

| Capability | NOVA path | OpenClaw access |
|---|---|---|
| Public GitHub repository inspection | automatic server-side preflight; diagnostic `/api/github/preflight` | evidence is injected before the answer |
| Private GitHub/API-authenticated reads | direct GitHub preflight when a server token is present | `GITHUB_TOKEN`, `GH_TOKEN`, or `NOVA_GITHUB_TOKEN` |
| GitHub account/write actions | Composio when connected | `composio-search` then `composio-execute` |
| Composio catalog and status | `/api/integrations/composio/*` | `nova-services composio-*` |
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

**Passwords are separate surfaces:** `1234` is the Medical workspace first-use client-side soft-lock password. The canonical Work Tree/integrations operator PIN is `22`. If Render supplies `NOVA_WORK_TREE_PIN`, that configured value is accepted **in addition to** `22`, so a stale deployment override can no longer lock the operator out.

## Build and validation

**pnpm is the only package manager for this workspace.** Production secrets belong in Render environment variables and must never be committed.

```bash
pnpm install --frozen-lockfile
node scripts/repo-audit.mjs
pnpm run typecheck
pnpm --filter @workspace/api-server run build
node --check artifacts/nova/public/assets/composio-settings.js
node --check openclaw/workspace/skills/nova-services/nova-services.mjs
```

Repository Verification now enumerates **every Git-tracked path one by one** and writes a machine-readable audit artifact. Each tracked text source receives UTF-8 and merge-conflict checks plus extension-specific validation where applicable: JSON parsing, TypeScript/TSX syntax, Node JS syntax, Python compilation, shell syntax, YAML indentation checks, CSS structural checks, and symlink-target validation. Global gates then run full TypeScript checking, API bundling, tracked-Python compilation, production Docker build, OpenClaw readiness, GitHub evidence tests, and desktop/mobile Playwright proof for the Composio Settings UI.

A separate production-container compatibility gate starts NOVA with a conflicting `NOVA_WORK_TREE_PIN` and proves both canonical PIN `22` and the deployment override are accepted while a wrong PIN is rejected.

Documentation and templates use accurate extensions: the governance design is `GOVERNANCE.md`, and the commented strict TypeScript template is `tsconfig-strict.jsonc`. `scripts/agentic_demo.py` is stored as runnable Python rather than a Markdown-fenced paste.

The production Docker image pins Node `24.18.0` and OpenClaw `2026.6.11`. At startup, `scripts/start-openclaw.mjs` generates missing internal secrets in memory, starts the loopback Gateway, waits for `/readyz`, and starts the API only after the Gateway is ready.

## Important environment variables

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` / `NOVA_GITHUB_TOKEN` | Optional server-side GitHub token for higher rate limits and private repository reads; public repositories work without it |
| `COMPOSIO_API_KEY` | Composio project API key used by the server-side Tool Router client |
| `COMPOSIO_USER_ID` | Stable connected-account owner ID; defaults to `nova-luis` |
| `PUBLIC_BASE_URL` | Public callback origin used for hosted Composio Connect Links |
| `NOVA_WORK_TREE_PIN` | Optional additional Work Tree/integrations PIN. Canonical operator PIN `22` remains accepted. |
| `OPENCLAW_GATEWAY_TOKEN` | Optional persistent Gateway bearer token; generated at boot when absent |
| `OPENCLAW_STATE_DIR` | OpenClaw sessions/state directory; point this at a persistent Render disk to retain state across deploys |
| `NOVA_OPENCLAW_MODEL_ID` | Model ID sent through NOVA's server-side proxy; defaults to `WORK_TREE_MODEL` or `gpt-4o-mini` |
| `OPENAI_API_KEY` | Used by NOVA proxy for `gpt-*` models |
| `GEMINI_API_KEY` | Used by NOVA proxy for `gemini-*` models |
| `BITDEER_API_KEY` | Used by NOVA proxy for other configured model IDs |
| `SUPERNOVA_API_KEY` / `OPENCLAW_API_KEY` | Internal peer authentication for gated NOVA service endpoints |
| `DATABASE_URL` | Work-Tree, knowledge and integration persistence |
