# NOVA / ABBYCLAW — FULL SYSTEM MAP
> Last audited: 2026-07-15 | Branch: 2026-07-14/playwright-e2e-render-deploy-composio-fix

```
NOVA / ABBYCLAW  ═══════════════════════════════════════════════════════════════════
github.com/ABBYCRM/NovaLuis                         Production: Render  nova-luis
════════════════════════════════════════════════════════════════════════════════════

MONOREPO  (pnpm workspaces)
│
├── artifacts/                          ← deployable apps (each binds $PORT)
│   │
│   ├── nova/                           ← React + Vite  — main chat UI
│   │   ├── vite.config.ts              ← dev server, BASE_PATH, PORT, /api-proxy
│   │   └── src/
│   │       ├── App.tsx                 ← router: /  /skills  /capabilities
│   │       ├── main.tsx
│   │       ├── pages/
│   │       │   ├── home.tsx            ← Nova chat interface (SSE streaming)
│   │       │   ├── skills-catalog.tsx  ← browse / search Nova skills
│   │       │   ├── capabilities.tsx    ← live integration status grid (18 integrations)
│   │       │   └── not-found.tsx
│   │       ├── components/ui/          ← Radix UI primitives (55+ components)
│   │       ├── hooks/
│   │       │   ├── use-mobile.tsx
│   │       │   └── use-toast.ts
│   │       └── lib/
│   │           └── utils.ts            ← cn() class merge helper
│   │
│   ├── api-server/                     ← Express + TypeScript  — central backend
│   │   └── src/
│   │       ├── app.ts                  ← middleware: pino, cors, body-parser
│   │       ├── index.ts                ← server entry, PORT binding
│   │       ├── social-cron.ts          ← scheduled social-media jobs
│   │       │
│   │       ├── routes/
│   │       │   ├── openai-proxy.ts     ← ALL /api/v1/* — intercepts chat → OpenClaw
│   │       │   ├── agent-chat.ts       ← /api/agent/v1/chat  enrichment + dispatch
│   │       │   ├── work-tree.ts        ← /api/work-tree  run creation + polling
│   │       │   ├── capabilities.ts     ← GET /api/capabilities  18 integrations
│   │       │   ├── composio.ts         ← /api/integrations/composio
│   │       │   ├── composio-scenarios.ts
│   │       │   ├── github.ts           ← /api/github  repo read, file fetch
│   │       │   ├── github-scenarios.ts
│   │       │   ├── knowledge.ts        ← /api/knowledge  RAG ingest + query
│   │       │   ├── vector-memory.ts    ← /api/vector-memory  Pinecone ops
│   │       │   ├── voice.ts            ← /api/voice  TTS via OpenAI
│   │       │   ├── skills.ts           ← /api/skills  plugin catalog
│   │       │   ├── workspaces.ts       ← /api/workspaces  agent file browser
│   │       │   ├── social-media.ts     ← /api/social  post, fetch feed
│   │       │   ├── media.ts            ← /api/media  A2E video gen, image-to-video
│   │       │   ├── favorites.ts        ← /api/favorites
│   │       │   ├── integrations.ts     ← /api/integrations  status hub
│   │       │   ├── nova-config.ts      ← /api/nova/config
│   │       │   ├── render-scenarios.ts
│   │       │   ├── firecrawl-steel-scenarios.ts
│   │       │   └── health.ts           ← GET /healthz  GET /openclaw/status
│   │       │
│   │       └── lib/
│   │           ├── vector-memory-fetch-hook.ts  ← RAG inject into OpenClaw turns
│   │           ├── scratchpad.ts        ← conversation memory DB ops
│   │           ├── composio.ts          ← Composio Tool Router client
│   │           ├── github-repo.ts       ← GitHub preflight (trees, files, commits)
│   │           ├── integrations.ts      ← key-presence checker
│   │           ├── knowledge.ts         ← RAG pipeline helpers
│   │           ├── google.ts
│   │           ├── vector-memory.ts     ← Pinecone client
│   │           ├── vector-memory.self-test.ts
│   │           ├── work-tree-auth.ts    ← WT token issuance + verification
│   │           └── logger.ts
│   │
│   └── mockup-sandbox/                 ← Vite component preview (Canvas iframes)
│       ├── mockupPreviewPlugin.ts       ← serves /preview/* routes
│       └── src/
│           ├── App.tsx
│           └── components/ui/           ← mirrored Radix UI set
│
├── scripts/                            ← Node.js workers + agent runtime
│   │
│   ├── ── AGENT RUNTIME ──────────────────────────────────────────────────
│   ├── work-tree-worker.mjs            ← DECOMP-Ω ReAct loop (parallel branches)
│   ├── deep-worker.mjs                 ← Responses API: webSearch/codeInterp/shell
│   ├── scratchpad-daemon.mjs           ← distils turns → scratchpad_entries
│   ├── poll-events.mjs                 ← monitors logs + queues tasks to work-tree
│   ├── social-media-worker.mjs         ← autonomous social posting + monitoring
│   ├── start-openclaw.mjs              ← OpenClaw gateway bootstrap helper
│   │
│   ├── ── LLM LAYER ───────────────────────────────────────────────────────
│   ├── super-nova-router.mjs           ← provider router: 4 roles + Helicone headers
│   │     ├── DECOMP-Ω  → gpt-4o        (planning + decomposition)
│   │     ├── EXEC-Ω    → gpt-4o-mini   (tool execution)
│   │     ├── SYNTH-Ω   → gpt-4o        (synthesis + final answer)
│   │     └── RAPID-Ω   → gpt-4o-mini   (quick turns)
│   │
│   ├── super-nova-tools.mjs            ← full tool registry
│   │     │
│   │     ├── SAFE TOOLS  (no SUPER_NOVA_EXEC required)
│   │     │   ├── http_fetch             → direct HTTP with SSRF guard
│   │     │   ├── browser_fetch          → Steel.dev headless browser
│   │     │   ├── web_search             → Firecrawl search
│   │     │   ├── image_generate         → OpenAI DALL-E
│   │     │   ├── calculator             → safe math eval
│   │     │   ├── read_file / list_directory / grep_files / git_status / git_diff
│   │     │   ├── memory_get / memory_put / memory_search
│   │     │   ├── send_email             → Resend API
│   │     │   ├── screenshot_url         → ScreenshotOne API
│   │     │   ├── exa_search             → Exa AI neural search
│   │     │   ├── tavily_search          → Tavily search + direct answer
│   │     │   ├── scrapingbee_fetch      → ScrapingBee bot-bypass scraper
│   │     │   ├── scrapfly_fetch         → Scrapfly anti-scraping proxy
│   │     │   ├── e2b_run_code           → E2B isolated cloud VM
│   │     │   ├── openai_retrieval       → OpenAI Vector Store (nova-knowledge)
│   │     │   ├── openai_code_interpreter→ OpenAI Assistants sandbox
│   │     │   ├── openai_hosted_shell    → OpenAI Responses API shell
│   │     │   ├── brave_search           → Brave Search API (BRAVE_SEARCH_API_KEY)
│   │     │   ├── pinecone_query         → Pinecone vector search
│   │     │   ├── pinecone_upsert        → Pinecone vector write
│   │     │   ├── github_read            → GitHub REST API (trees/files/commits)
│   │     │   ├── composio_execute       → Composio tool action (300+ apps)
│   │     │   ├── composio_connect       → Composio OAuth connect link
│   │     │   ├── tool_search / tool_describe
│   │     │   └── finish / ask_user / update_plan / goal / steer
│   │     │
│   │     └── DANGEROUS TOOLS  (SUPER_NOVA_EXEC=1 required)
│   │         ├── run_python / run_node / code_execution
│   │         ├── shell / exec / bash
│   │         ├── write_file / edit_file / apply_patch / delete_path
│   │         ├── git_commit / clone_repo
│   │         └── render_deploy          → Render deploy trigger
│   │
│   ├── tool-catalog.mjs                ← tool schema + OpenAI function defs
│   │
│   ├── ── DATA PIPELINES ──────────────────────────────────────────────────
│   ├── fill-embeddings.mjs             ← Gemini-first embed → Pinecone (batch=1)
│   ├── ingest-composio-scenarios.mjs
│   ├── ingest-firecrawl-steel-scenarios.mjs
│   ├── ingest-github-scenarios.mjs
│   ├── ingest-render-scenarios.mjs
│   │
│   ├── ── DB MIGRATIONS ───────────────────────────────────────────────────
│   ├── migrate-supernova-db.mjs        ← idempotent DDL: all 5 core tables ✓
│   ├── migrate-favorites.mjs
│   ├── migrate-social-media.mjs
│   └── migrate-workspace-files.mjs
│
├── lib/                                ← shared TypeScript packages
│   ├── api-client-react/               ← React hooks (generated from OpenAPI)
│   ├── api-spec/                       ← OpenAPI spec + Orval codegen
│   ├── api-zod/                        ← Zod schemas (auto-generated)
│   └── db/                             ← Drizzle ORM + PostgreSQL schema
│       └── src/schema/
│           ├── scratchpad.ts           ← conversation_turns, scratchpad_entries
│           ├── work-tree.ts            ← work_tree_runs, nodes, governance
│           ├── knowledge.ts            ← knowledge_chunks (RAG)
│           ├── vector-memory.ts        ← vector_memory_entries
│           ├── workspaces.ts           ← workspace_files
│           ├── social-media.ts         ← social_posts, social_accounts
│           ├── integrations.ts         ← connected_integrations
│           └── favorites.ts
│
├── tools/
│   └── anti-hallucinate/               ← hallucination verifier
│       ├── verifier.mjs
│       ├── corpus.mjs
│       ├── guarded.mjs
│       ├── cli.mjs
│       └── run-tests.mjs
│
├── .nova-data/                         ← runtime state (gitignored)
│   ├── identity/device.json            ← Ed25519 device key pair + deviceId
│   ├── agents/                         ← per-agent config + personality state
│   ├── jobs/                           ← WT job files (pending/running/done/failed)
│   ├── state/openclaw.sqlite           ← OpenClaw internal SQLite
│   ├── plugin-skills/                  ← loaded skill plugins at runtime
│   └── workspace/                      ← symlinked files exposed to agents
│
├── .github/workflows/
│   ├── openclaw-backend-ci.yml         ← CI: typecheck + unit tests
│   ├── playwright-e2e.yml              ← E2E: browser tests
│   └── repo-verify.yml                 ← doc + consistency checks
│
├── Dockerfile                          ← multi-stage: builder + runtime (node:24)
├── render.yaml                         ← Render service definition (healthCheck: /healthz)
├── fly.toml                            ← Fly.io (standby target)
├── AGENTS.md                           ← agent identity + behavioral rules
├── DIRECTIVE.md                        ← operational directives
├── GOVERNANCE.md                       ← system modification governance
├── TASKS.md                            ← active roadmap
└── SYSTEM_MAP.md                       ← this file


════════════════════════════════════════════════════════════════════════════════════
RUNTIME TOPOLOGY
════════════════════════════════════════════════════════════════════════════════════

  USER BROWSER
      │  POST /api/v1/chat/completions  (SSE stream)
      ▼
  ┌──────────────────────────────────────────────────────────┐
  │  API SERVER  :8080                 paths=["/api"]         │
  │                                                           │
  │  openai-proxy.ts                                          │
  │  ┌──────────────────────────────────────────────────┐    │
  │  │  isChat && !isInternalOpenClaw?                   │    │
  │  │    YES → proxyBrowserChatToAgent()                │    │
  │  │    NO  → RAG inject + raw inference passthrough   │    │
  │  └──────────────────┬────────────────────────────────┘   │
  │                     │  POST /api/agent/v1/chat/completions│
  │                     ▼                                     │
  │  agent-chat.ts                                            │
  │  ┌──────────────────────────────────────────────────┐    │
  │  │  1. GitHub preflight   (repo URLs in message)     │    │
  │  │  2. Composio preflight (Teams/Slack/Gmail intent) │    │
  │  │  3. Inject TOOL_SYSTEM_PROMPT + evidence blocks   │    │
  │  │  4. POST → OpenClaw Gateway :18789                │    │
  │  └──────────────────┬────────────────────────────────┘   │
  └─────────────────────┼────────────────────────────────────┘
                        │
                        ▼
  ┌──────────────────────────────────────────────────────────┐
  │  OPENCLAW GATEWAY  :18789                                 │
  │  node_modules/.bin/openclaw gateway                       │
  │                                                           │
  │  Persona : NOVA                                           │
  │  Model   : openclaw/default → gpt-4o-mini (via proxy)    │
  │  Tools   : nova-services skill                            │
  │                                                           │
  │  ┌──────────────────────────────────────────────────┐    │
  │  │  receive message                                  │    │
  │  │    ↓                                              │    │
  │  │  POST /api/v1/chat/completions                    │    │
  │  │    (NOVA_OPENCLAW_PROXY_KEY — bypasses reroute)   │    │
  │  │    ↓                                              │    │
  │  │  vector-memory-fetch-hook injects RAG memories    │    │
  │  │    ↓                                              │    │
  │  │  tool_calls? → execute via nova-services          │    │
  │  │    ↓                                              │    │
  │  │  stream final content back to user                │    │
  │  └──────────────────────────────────────────────────┘    │
  └──────────────────────────────────────────────────────────┘
                        │  (parallel, independent)
                        ▼
  ┌──────────────────────────────────────────────────────────┐
  │  BACKGROUND WORKERS                                       │
  │                                                           │
  │  work-tree-worker    DECOMP-Ω parallel ReAct loop         │
  │  ├─ receives jobs from .nova-data/jobs/                   │
  │  ├─ decomposes goal → sub-nodes                           │
  │  ├─ calls super-nova-router per node (4 roles)            │
  │  └─ executes 25 SAFE / DANGEROUS tools from registry      │
  │                                                           │
  │  deep-worker         Responses API heavy lifting          │
  │  ├─ job.webSearch   → openai web_search_preview           │
  │  ├─ job.codeInterp  → openai code_interpreter             │
  │  └─ job.hostedShell → openai computer_use_preview         │
  │                                                           │
  │  scratchpad-daemon   memory distillation                   │
  │  └─ conversation_turns → scratchpad_entries (LLM)  ✓ LIVE│
  │                                                           │
  │  poll-events         log monitor + task queue             │
  │  └─ new errors in openclaw-*.log → queued WT task         │
  │                                                           │
  │  social-media-worker scheduled posts + feed monitor       │
  └──────────────────────────────────────────────────────────┘


════════════════════════════════════════════════════════════════════════════════════
DATABASE  (PostgreSQL — Render supernova_db)          ✓ all tables live
════════════════════════════════════════════════════════════════════════════════════

  conversation_turns        raw per-turn capture (user + assistant text)
  scratchpad_entries        distilled long-lived memory per conversation
  work_tree_runs            one row per autonomous WT execution
  work_tree_nodes           decomposed sub-tasks within a run
  work_tree_governance      approval gates + policy records
  knowledge_chunks          RAG document chunks
  vector_memory_entries     vector store metadata
  workspace_files           agent-accessible file registry
  social_posts              scheduled + published social content
  social_accounts           connected social accounts
  connected_integrations    Composio + OAuth state
  favorites                 user-bookmarked items


════════════════════════════════════════════════════════════════════════════════════
EXTERNAL SERVICES  (18 in /api/capabilities)          ✓ = key confirmed present
════════════════════════════════════════════════════════════════════════════════════

  CATEGORY          SERVICE                    KEY                       STATUS
  ────────────────────────────────────────────────────────────────────────────────
  LLM / AI          OpenAI                     OPENAI_API_KEY            ✓
                    Gemini                     GEMINI_API_KEY            ✓
                    A2E AI (video)             A2E_AI_API_KEY            ✓

  OBSERVABILITY     Helicone  (LLM proxy)      HELICONE_API_KEY          ✓
                    Inngest   (event bus)       INNGEST_EVENT_KEY         ✓

  MEMORY / SEARCH   Pinecone  (vectors)        PINECONE_API_KEY          ✓
                    Embeddings API             EMBEDDINGS_API_KEY        ✓
                    OpenAI Vector Store        OPENAI_VECTOR_STORE_ID    ✓
                    Exa AI  (neural search)    EXA_API_KEY               ✓
                    Tavily  (search+answer)    TAVILY_API_KEY            ✓

  WEB / SCRAPING    Firecrawl                  FIRECRAWL_API_KEY         ✓
                    ScrapingBee                SCRAPINGBEE_API_KEY       ✓
                    Scrapfly                   SCRAPFLY_API_KEY          ✓
                    Steel.dev                  STEEL_API_KEY             ✓
                    ScreenshotOne              SCREENSHOTONE_ACCESS_KEY  ✓

  CODE EXECUTION    E2B  (cloud VM)            E2B_API_KEY               ✓
                    OpenAI Code Interpreter    via OPENAI_API_KEY        ✓
                    OpenAI Hosted Shell        via OPENAI_API_KEY        ✓

  INTEGRATIONS      Composio  (300+ apps)      COMPOSIO_API_KEY          ✓
                      └── Slack, Teams, Gmail, Notion, Linear,
                          Salesforce, HubSpot, GitHub, Google …
                    Twilio    (SMS/voice)       MCP server                ✓

  COMMUNICATIONS    Resend  (email)            RESEND_API_KEY            ✓

  TOOL KEYS         Brave Search (optional)    BRAVE_SEARCH_API_KEY      ✗ not set
                    Pinecone index (optional)  PINECONE_INDEX_HOST       ✗ not set

  INFRASTRUCTURE    GitHub                     GITHUB_PERSONAL_ACCESS_TOKEN ✓
                    Render  (deploy)           RENDER_API_KEY            ✓
                    Session                    SESSION_SECRET            ✓


════════════════════════════════════════════════════════════════════════════════════
CHAT MESSAGE LIFECYCLE  (end-to-end)
════════════════════════════════════════════════════════════════════════════════════

  1.  User types in Nova chat (artifacts/nova/src/pages/home.tsx)
  2.  POST /api/v1/chat/completions  SSE stream → API Server (:8080, path /api)
  3.  openai-proxy detects chat, not internal → proxyBrowserChatToAgent()
  4.  agent-chat enriches:
        a. GitHub preflight — fetch tree/files for any repo URLs in message
        b. Composio preflight — detect Teams/Slack/Gmail intent, search Tool Router
        c. Inject TOOL_SYSTEM_PROMPT + evidence system messages
        d. POST to OpenClaw :18789  (x-openclaw-session-key, x-openclaw-message-channel)
  5.  OpenClaw agent loop:
        a. POST /api/v1/chat/completions with NOVA_OPENCLAW_PROXY_KEY (raw path)
        b. vector-memory-fetch-hook injects Pinecone RAG memories before call
        c. Model replies — tool_calls? → execute nova-services → append results
        d. Loop until stopReason=stop
  6.  SSE stream piped back through API Server → browser (token-by-token)
  7.  recordTurn() → conversation_turns (async, non-blocking)
  8.  scratchpad-daemon distils unprocessed turns → scratchpad_entries
  9.  Next turn: scratchpad_entries injected as memory context at step 4d


════════════════════════════════════════════════════════════════════════════════════
AUDIT LOG  (2026-07-15)
════════════════════════════════════════════════════════════════════════════════════

  FIXED ✓
  ─────────────────────────────────────────────────────────────────────────────
  Nova chat UI was a Replit placeholder stub since first commit.
    → Built home.tsx: full SSE streaming chat, message bubbles, abort, auto-scroll.

  6 tools in TOOL_RISK map had no runnable implementation in super-nova-tools.mjs:
  brave_search, pinecone_query, pinecone_upsert, github_read, composio_execute,
  composio_connect.
    → All 6 implemented and registered in SAFE_TOOLS.

  A2E AI (A2E_AI_API_KEY) wired in media.ts but absent from /api/capabilities.
    → Added as "Media" category entry; capabilities total is now 18.

  DB tables missing (conversation_turns, scratchpad_entries, work_tree_*).
    → migrate-supernova-db.mjs ran; all 5 tables created. Chat memory now live.

  VERIFIED CORRECT ✓ (no changes needed)
  ─────────────────────────────────────────────────────────────────────────────
  All 20 route files exist and registered in routes/index.ts
  /healthz — render.yaml and health.ts both use /healthz (not /health)
  e2b_run_code registered in SAFE_TOOLS at line 1457
  9 new tools from previous session all registered correctly
  Helicone + 4 DECOMP-Ω roles in super-nova-router.mjs
  GitHub branch 2ea48c4 SHA verified
  Render deploy live (905b5a67 on main)

  STALE MAP CLAIMS (corrected here)
  ─────────────────────────────────────────────────────────────────────────────
  home.tsx listed as a file → was inline stub in App.tsx; now a real file
  nova/src/lib/work-tree-auth.ts + vector-memory.ts → live in api-server/src/lib/
  17 capabilities → now 18 (A2E added)


════════════════════════════════════════════════════════════════════════════════════
DEPLOYMENT STATUS
════════════════════════════════════════════════════════════════════════════════════

  Replit  (dev)   8/10 workflows running
  Render  (prod)  nova-luis  srv-d99ifi0k1i2s73e79pq0
                  main HEAD 905b5a67 "Merge 2026-07-14/…"
  GitHub          branch 2026-07-14/playwright-e2e-render-deploy-composio-fix
                  HEAD: updated with audit fixes
  Fly.io          fly.toml present (standby / backup target)
```
