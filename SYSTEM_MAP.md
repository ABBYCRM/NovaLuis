# NOVA / ABBYCLAW — FULL SYSTEM MAP
> Generated: 2026-07-15 | Branch: 2026-07-14/playwright-e2e-render-deploy-composio-fix

```
NOVA / ABBYCLAW  ═══════════════════════════════════════════════════════════════════
github.com/ABBYCRM/NovaLuis                         Production: Render  nova-luis
════════════════════════════════════════════════════════════════════════════════════

MONOREPO  (pnpm workspaces)
│
├── artifacts/                          ← deployable apps (each binds $PORT)
│   │
│   ├── nova/                           ← React + Vite  — main chat UI
│   │   ├── vite.config.ts              ← dev server, proxy rules
│   │   └── src/
│   │       ├── App.tsx                 ← router: /  /skills  /capabilities
│   │       ├── pages/
│   │       │   ├── home.tsx            ← chat window, voice, work-tree toggle
│   │       │   ├── skills-catalog.tsx  ← Browse / search Nova skills
│   │       │   └── capabilities.tsx   ← live integration status grid (/api/capabilities)
│   │       ├── components/ui/          ← Radix UI primitives (40+ components)
│   │       └── lib/
│   │           ├── work-tree-auth.ts   ← WT session token helper
│   │           └── vector-memory.ts   ← client-side vector search hook
│   │
│   ├── api-server/                     ← Express + TypeScript  — central backend
│   │   └── src/
│   │       ├── app.ts                  ← middleware: pino, cors, body-parser
│   │       ├── index.ts                ← server entry, PORT binding
│   │       ├── social-cron.ts          ← scheduled social-media jobs
│   │       │
│   │       ├── routes/
│   │       │   ├── openai-proxy.ts     ← ALL /api/v1/* — intercepts chat → OpenClaw
│   │       │   ├── agent-chat.ts       ← /api/agent/v1/chat — enrichment + dispatch
│   │       │   ├── work-tree.ts        ← /api/work-tree — run creation + polling
│   │       │   ├── capabilities.ts     ← GET /api/capabilities — 17 integrations live status
│   │       │   ├── composio.ts         ← /api/integrations/composio — sessions, search
│   │       │   ├── composio-scenarios.ts  ← scenario training data endpoints
│   │       │   ├── github.ts           ← /api/github — repo read, file fetch
│   │       │   ├── github-scenarios.ts ← scenario training data endpoints
│   │       │   ├── knowledge.ts        ← /api/knowledge — RAG ingest + query
│   │       │   ├── vector-memory.ts    ← /api/vector-memory — Pinecone ops
│   │       │   ├── voice.ts            ← /api/voice — TTS via OpenAI
│   │       │   ├── skills.ts           ← /api/skills — skill plugin catalog
│   │       │   ├── workspaces.ts       ← /api/workspaces — agent file browser
│   │       │   ├── social-media.ts     ← /api/social — post, fetch feed
│   │       │   ├── favorites.ts        ← /api/favorites — bookmarks
│   │       │   ├── integrations.ts     ← /api/integrations — status hub
│   │       │   ├── media.ts            ← /api/media — image/file handling
│   │       │   ├── nova-config.ts      ← /api/nova/config — runtime config
│   │       │   ├── render-scenarios.ts ← Render deployment scenario data
│   │       │   ├── firecrawl-steel-scenarios.ts
│   │       │   └── health.ts           ← GET /health  GET /openclaw/status
│   │       │
│   │       └── lib/
│   │           ├── vector-memory-fetch-hook.ts  ← RAG inject into OpenClaw turns
│   │           ├── scratchpad.ts       ← conversation memory DB ops
│   │           ├── composio.ts         ← Composio Tool Router client
│   │           ├── github-repo.ts      ← GitHub preflight (trees, files, commits)
│   │           ├── integrations.ts     ← integration key-presence checker
│   │           ├── knowledge.ts        ← RAG pipeline helpers
│   │           ├── google.ts           ← Google API client
│   │           ├── vector-memory.self-test.ts
│   │           ├── work-tree-auth.ts   ← WT token issuance + verification
│   │           └── logger.ts           ← pino structured logger
│   │
│   └── mockup-sandbox/                 ← Vite component preview server (Canvas iframes)
│       ├── mockupPreviewPlugin.ts      ← Vite plugin — serves /preview/* routes
│       └── src/
│           ├── App.tsx                 ← preview host
│           └── components/ui/          ← mirrored Radix UI set for isolated previews
│
├── scripts/                            ← Node.js workers + agent runtime
│   │
│   ├── ── AGENT RUNTIME ──────────────────────────────────────────────────
│   ├── work-tree-worker.mjs            ← DECOMP-Ω ReAct loop (parallel branches)
│   ├── deep-worker.mjs                 ← Responses API: webSearch/codeInterp/shell
│   ├── scratchpad-daemon.mjs           ← distils conversation_turns → scratchpad_entries
│   ├── poll-events.mjs                 ← monitors logs + queues tasks to work-tree
│   ├── social-media-worker.mjs         ← autonomous social posting + monitoring
│   ├── start-openclaw.mjs              ← OpenClaw gateway bootstrap helper
│   │
│   ├── ── LLM LAYER ───────────────────────────────────────────────────────
│   ├── super-nova-router.mjs           ← provider router: 4 roles + Helicone headers
│   │     ├── DECOMP-Ω  → OpenAI gpt-4o (planning + decomposition)
│   │     ├── EXEC-Ω    → OpenAI gpt-4o-mini (tool execution)
│   │     ├── SYNTH-Ω   → OpenAI gpt-4o (synthesis + final answer)
│   │     └── RAPID-Ω   → OpenAI gpt-4o-mini (quick turns)
│   │
│   ├── super-nova-tools.mjs            ← full tool registry (SAFE + DANGEROUS tiers)
│   │     │
│   │     ├── SAFE TOOLS  (no SUPER_NOVA_EXEC required)
│   │     │   ├── openai_retrieval       → OpenAI Vector Store (nova-knowledge)
│   │     │   ├── openai_code_interpreter→ OpenAI Assistants sandbox
│   │     │   ├── openai_hosted_shell    → OpenAI Responses API shell
│   │     │   ├── send_email             → Resend API
│   │     │   ├── screenshot_url         → ScreenshotOne API
│   │     │   ├── exa_search             → Exa AI neural search
│   │     │   ├── tavily_search          → Tavily search + direct answer
│   │     │   ├── scrapingbee_fetch      → ScrapingBee bot-bypass scraper
│   │     │   ├── scrapfly_fetch         → Scrapfly anti-scraping proxy
│   │     │   ├── e2b_run_code           → E2B isolated cloud VM
│   │     │   ├── brave_search           → Brave Search API
│   │     │   ├── firecrawl_scrape       → Firecrawl web scraper
│   │     │   ├── steel_browser          → Steel.dev browser sessions
│   │     │   ├── pinecone_query         → Pinecone vector search
│   │     │   ├── pinecone_upsert        → Pinecone vector write
│   │     │   ├── github_read            → GitHub REST API (trees/files/commits)
│   │     │   ├── composio_execute       → Composio tool execution (300+ apps)
│   │     │   └── composio_connect       → Composio OAuth connect link
│   │     │
│   │     └── DANGEROUS TOOLS  (requires SUPER_NOVA_EXEC=1)
│   │         ├── shell_exec             → local shell (restricted sandbox)
│   │         ├── file_write             → workspace file write
│   │         ├── file_read              → workspace file read
│   │         └── render_deploy          → Render service deploy trigger
│   │
│   ├── tool-catalog.mjs                ← tool schema catalog + OpenAI function defs
│   │
│   ├── ── DATA PIPELINES ──────────────────────────────────────────────────
│   ├── fill-embeddings.mjs             ← Gemini-first embed → Pinecone (batch=1)
│   ├── ingest-composio-scenarios.mjs   ← Composio scenario training data → RAG
│   ├── ingest-firecrawl-steel-scenarios.mjs
│   ├── ingest-github-scenarios.mjs
│   ├── ingest-render-scenarios.mjs
│   │
│   ├── ── DB MIGRATIONS ───────────────────────────────────────────────────
│   ├── migrate-supernova-db.mjs        ← idempotent DDL: all 5 core tables
│   ├── migrate-favorites.mjs
│   ├── migrate-social-media.mjs
│   ├── migrate-workspace-files.mjs
│   │
│   └── ── DEV TOOLS ───────────────────────────────────────────────────────
│       ├── nova-cli.mjs                ← CLI for chat / tool invocation
│       ├── ledger.mjs                  ← append-only activity log
│       ├── repo-audit.mjs              ← repo consistency checker
│       └── secrets-box.mjs             ← secrets management helper
│
├── lib/                                ← shared TypeScript packages
│   ├── api-client-react/               ← React hooks generated from OpenAPI spec
│   ├── api-spec/                       ← OpenAPI spec + Orval codegen config
│   ├── api-zod/                        ← Zod schemas (auto-generated)
│   │   └── src/generated/types/        ← WorkTreeRun, WorkTreeNode, HealthStatus …
│   └── db/                             ← Drizzle ORM + PostgreSQL schema
│       └── src/schema/
│           ├── scratchpad.ts           ← conversation_turns, scratchpad_entries
│           ├── work-tree.ts            ← work_tree_runs, work_tree_nodes, governance
│           ├── knowledge.ts            ← knowledge_chunks (RAG)
│           ├── vector-memory.ts        ← vector_memory_entries
│           ├── workspaces.ts           ← workspace_files
│           ├── social-media.ts         ← social_posts, social_accounts
│           ├── integrations.ts         ← connected_integrations
│           └── favorites.ts            ← favorites
│
├── tools/
│   └── anti-hallucinate/               ← hallucination detection verifier
│       ├── verifier.mjs                ← claim extraction + evidence check
│       ├── corpus.mjs                  ← ground-truth corpus loader
│       ├── guarded.mjs                 ← wrapper: fail on unverified claims
│       ├── cli.mjs                     ← CLI entry
│       └── run-tests.mjs               ← test runner
│
├── .nova-data/                         ← runtime state  (gitignored)
│   ├── identity/
│   │   └── device.json                 ← Ed25519 device key pair + deviceId
│   ├── agents/                         ← per-agent config + personality state
│   ├── jobs/                           ← Work Tree job files (pending/running/done/failed)
│   ├── state/
│   │   └── openclaw.sqlite             ← OpenClaw internal state DB
│   ├── plugin-skills/                  ← loaded skill plugins at runtime
│   └── workspace/                      ← symlinked workspace files exposed to agents
│
├── .github/workflows/
│   ├── openclaw-backend-ci.yml         ← CI: typecheck + unit tests
│   ├── playwright-e2e.yml              ← E2E: browser tests against live server
│   └── repo-verify.yml                 ← repo consistency + doc checks
│
├── render.yaml                         ← Render service definition
├── fly.toml                            ← Fly.io config (backup deploy target)
├── AGENTS.md                           ← agent identity + behavioral rules
├── DIRECTIVE.md                        ← high-level operational directives
├── GOVERNANCE.md                       ← system modification governance rules
└── TASKS.md                            ← active roadmap


════════════════════════════════════════════════════════════════════════════════════
RUNTIME TOPOLOGY
════════════════════════════════════════════════════════════════════════════════════

  USER BROWSER
      │  POST /api/v1/chat/completions (SSE stream)
      ▼
  ┌─────────────────────────────────────────────────────────┐
  │  API SERVER  :8080                                       │
  │                                                          │
  │  openai-proxy.ts                                         │
  │  ┌─────────────────────────────────────────────────┐    │
  │  │  isChat && !isInternalOpenClaw?                  │    │
  │  │    YES → proxyBrowserChatToAgent()               │    │
  │  │    NO  → RAG inject + raw inference passthrough  │    │
  │  └─────────────┬───────────────────────────────────┘    │
  │                │ POST /api/agent/v1/chat/completions      │
  │                ▼                                          │
  │  agent-chat.ts                                           │
  │  ┌─────────────────────────────────────────────────┐    │
  │  │  1. GitHub preflight  (repo URLs in message)     │    │
  │  │  2. Composio preflight (Teams/Slack/Gmail etc.)  │    │
  │  │  3. Inject TOOL_SYSTEM_PROMPT                    │    │
  │  │  4. Forward → OpenClaw Gateway :18789            │    │
  │  └─────────────┬───────────────────────────────────┘    │
  └────────────────┼────────────────────────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────────────────────────┐
  │  OPENCLAW GATEWAY  :18789                                │
  │  (node_modules/.bin/openclaw gateway)                    │
  │                                                          │
  │  Persona: NOVA                                           │
  │  Model:   openclaw/default (gpt-4o-mini via proxy)       │
  │  Tools:   nova-services skill (Composio exec/connect)    │
  │                                                          │
  │  Agent loop:                                             │
  │  ┌────────────────────────────────────────────────┐     │
  │  │  receive message                                │     │
  │  │       ↓                                         │     │
  │  │  call POST /api/v1/chat/completions             │     │
  │  │  (with NOVA_OPENCLAW_PROXY_KEY — bypasses       │     │
  │  │   the reroute, hits raw inference)              │     │
  │  │       ↓                                         │     │
  │  │  tool_calls?  →  execute via nova-services      │     │
  │  │       ↓                                         │     │
  │  │  stream final content back to user              │     │
  │  └────────────────────────────────────────────────┘     │
  └─────────────────────────────────────────────────────────┘
                   │  (parallel, independent)
                   │
  ┌────────────────▼────────────────────────────────────────┐
  │  BACKGROUND WORKERS                                      │
  │                                                          │
  │  work-tree-worker.mjs   DECOMP-Ω parallel ReAct loop    │
  │  ├── receives jobs from /nova-data/jobs/                 │
  │  ├── decomposes goal → sub-nodes                         │
  │  ├── calls super-nova-router for each node               │
  │  └── tool execution via super-nova-tools SAFE/DANGEROUS  │
  │                                                          │
  │  deep-worker.mjs        Responses API heavy lifting      │
  │  ├── job.webSearch   → openai web_search_preview         │
  │  ├── job.codeInterp  → openai code_interpreter           │
  │  └── job.hostedShell → openai computer_use_preview       │
  │                                                          │
  │  scratchpad-daemon.mjs  memory distillation              │
  │  └── conversation_turns → scratchpad_entries (LLM)       │
  │                                                          │
  │  poll-events.mjs        log monitor + task queue         │
  │  └── new errors in openclaw-*.log → queued WT task       │
  │                                                          │
  │  social-media-worker.mjs                                 │
  │  └── scheduled posts + feed monitoring                   │
  └─────────────────────────────────────────────────────────┘


════════════════════════════════════════════════════════════════════════════════════
DATABASE  (PostgreSQL — Render supernova_db)
════════════════════════════════════════════════════════════════════════════════════

  conversation_turns       raw per-turn capture (user + assistant text)
  scratchpad_entries       distilled long-lived memory per conversation
  work_tree_runs           one row per autonomous WT execution
  work_tree_nodes          decomposed sub-tasks within a run
  work_tree_governance     approval gates + policy records
  knowledge_chunks         RAG document chunks
  vector_memory_entries    vector store metadata
  workspace_files          agent-accessible file registry
  social_posts             scheduled + published social content
  social_accounts          connected social accounts
  connected_integrations   Composio + other OAuth state
  favorites                user-bookmarked items


════════════════════════════════════════════════════════════════════════════════════
EXTERNAL SERVICES
════════════════════════════════════════════════════════════════════════════════════

  CATEGORY          SERVICE                  KEY                   STATUS
  ──────────────────────────────────────────────────────────────────────────────
  LLM / AI          OpenAI                   OPENAI_API_KEY        ✓ active
                    Gemini                   GEMINI_API_KEY        ✓ active
                    A2E AI                   A2E_AI_API_KEY        ✓ active

  OBSERVABILITY     Helicone (LLM proxy)     HELICONE_API_KEY      ✓ active
                    Inngest (event bus)      INNGEST_EVENT_KEY     ✓ active

  MEMORY / SEARCH   Pinecone (vectors)       PINECONE_API_KEY      ✓ active
                    Embeddings API           EMBEDDINGS_API_KEY    ✓ active
                    OpenAI Vector Store      (vs_6a57a79032b88191) via OPENAI_API_KEY
                    Exa AI (neural search)   EXA_API_KEY           ✓ active
                    Tavily (search+answer)   TAVILY_API_KEY        ✓ active

  WEB / SCRAPING    Firecrawl                FIRECRAWL_API_KEY     ✓ active
                    ScrapingBee              SCRAPINGBEE_API_KEY   ✓ active
                    Scrapfly                 SCRAPFLY_API_KEY      ✓ active
                    Steel.dev                STEEL_API_KEY         ✓ active
                    ScreenshotOne            SCREENSHOTONE_ACCESS_KEY ✓ active

  CODE EXECUTION    E2B (cloud VM)           E2B_API_KEY           ✓ active
                    OpenAI Code Interpreter  via OPENAI_API_KEY    ✓ active
                    OpenAI Hosted Shell      via OPENAI_API_KEY    ✓ active

  INTEGRATIONS      Composio (300+ apps)     COMPOSIO_API_KEY      ✓ active
                      └── Slack, Teams, Gmail, Notion, Linear,
                          Salesforce, HubSpot, GitHub, Google…

  COMMUNICATIONS    Resend (email)           RESEND_API_KEY        ✓ active
                    Twilio (SMS/voice)       MCP server            ✓ active

  INFRASTRUCTURE    GitHub                   GITHUB_PAT            ✓ active
                    Render (deploy)          RENDER_API_KEY        ✓ active
                    Session                  SESSION_SECRET        ✓ active


════════════════════════════════════════════════════════════════════════════════════
CHAT MESSAGE LIFECYCLE  (full path, single user message)
════════════════════════════════════════════════════════════════════════════════════

  1. User types in Nova frontend (artifacts/nova)
  2. React app  POST /api/v1/chat/completions  →  API Server
  3. openai-proxy.ts detects chat, not internal → proxyBrowserChatToAgent()
  4. agent-chat.ts:
       a. GitHub preflight — extract repo URLs, fetch tree/files from GitHub REST
       b. Composio preflight — detect Teams/Slack/Gmail intent, search Tool Router
       c. Inject TOOL_SYSTEM_PROMPT + evidence system messages
       d. POST to OpenClaw Gateway :18789  (x-openclaw-session-key, x-openclaw-message-channel)
  5. OpenClaw runs agent loop:
       a. POST /api/v1/chat/completions with NOVA_OPENCLAW_PROXY_KEY (raw inference path)
       b. vector-memory-fetch-hook injects RAG memories from Pinecone before call
       c. Model responds — if tool_calls → execute nova-services skill
       d. Tool results appended, loop continues until stopReason=stop
  6. SSE stream piped back through API Server → browser
  7. API Server: recordTurn() → conversation_turns table (async, non-blocking)
  8. scratchpad-daemon picks up unprocessed turns → distils to scratchpad_entries
  9. Next turn: scratchpad_entries injected as memory context (step 4d)


════════════════════════════════════════════════════════════════════════════════════
DEPLOYMENT
════════════════════════════════════════════════════════════════════════════════════

  Replit (dev)      → all workflows running on this workspace
  Render (prod)     → service: nova-luis  (srv-d99ifi0k1i2s73e79pq0)
                      latest deploy: dep-d9bqsr6cjfls73cmun00  (triggered 2026-07-15)
                      branch deployed: main
                      last merged commit: 905b5a67 "Merge 2026-07-14/…"
  Fly.io            → fly.toml present (standby / backup target)
```
