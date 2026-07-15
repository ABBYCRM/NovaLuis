---
name: RAG embedding pipeline
description: Embedding provider, ingest batch settings, fill-missing endpoint, and gotcha when fill job and search queries compete for Gemini quota.
---

# RAG Embedding Pipeline

## Embedding provider

**Why:** `OPENAI_API_KEY` returns HTTP 401 (invalid key). Gemini `text-embedding-004` returns 404 at the OpenAI-shim path. `gemini-embedding-2` via native `embedContent` endpoint works and supports `outputDimensionality: 1536` to match the `vector(1536)` column.

**Rule:** `knowledge.ts` uses Gemini-first: if `GEMINI_API_KEY` is set, call `generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent` with `outputDimensionality: 1536` directly — do not waste a round-trip on OpenAI first.

**How to apply:** If OPENAI_API_KEY is ever replaced with a valid key, restore OpenAI-first ordering in `embed()` in `knowledge.ts`.

## Ingest script settings

**Rule:** All four ingest scripts (`ingest-render-scenarios.mjs`, `ingest-github-scenarios.mjs`, `ingest-composio-scenarios.mjs`, `ingest-firecrawl-steel-scenarios.mjs`) must use `BATCH_SIZE=1` and `DELAY_MS=50`. Running with `BATCH_SIZE=5` while four scripts run in parallel caused ~80% of Gemini embed calls to silently fail (caught by `maybeEmbed` → null → row stored without embedding).

**Why:** Gemini `gemini-embedding-2` rate-limits aggressively under concurrent load. Sequential calls (one at a time) stay within limits cleanly.

## embed-missing background job

The API server exposes:
- `POST /api/vector-memory/embed-missing` — starts a background fill job inside the server process; idempotent (no-op if already running)
- `GET  /api/vector-memory/embed-missing` — poll progress: `{running, filled, total, errors, startedAt}`

**Gotcha:** Running the fill job while the server is also handling search queries causes search query embedding to fail intermittently (Gemini quota is saturated by the fill job → `maybeEmbed(query)` returns null → semantic score = 0 → lexical-only scores all fall below minimumScore=0.20 → zero results). Always wait for `running=false` before running the e2e search audit.

**How to apply:** After any bulk re-ingest (new corpus, --force re-run), kick off `POST /embed-missing` and poll until `running=false` before auditing search quality.

## Corpus summary (as of 2026-07-15)

| Corpus | scopeKey | ID prefix | service field |
|---|---|---|---|
| Render | render-scenarios | RS-xxxx | — |
| GitHub | github-scenarios | GH-xxxx | — |
| Composio | composio-scenarios | CO-xxxx | — |
| Firecrawl+Steel | firecrawl-steel-scenarios | FS-xxxx | firecrawl / steel / joint |

Total: 2000 rows, ~1963/2000 embedded (37 permanent Gemini failures on certain rows). All 2000 verified. Semantic scores: RS 0.747, GH 0.670, CO 0.691, FS 0.684.

## Adding future corpora

Pattern (same for every new corpus):
1. Copy CSV + generator to `scripts/<name>/`
2. Write `scripts/ingest-<name>.mjs` (BATCH_SIZE=1, DELAY_MS=50, scopeKey=`<name>`)
3. Create `artifacts/api-server/src/routes/<name>.ts` (POST /search, GET /status)
4. Register in `artifacts/api-server/src/routes/index.ts` (import + requireWtAuth array + router.use)
5. Add `## <NAME> SCENARIOS (RAG)` section to `artifacts/nova/public/assets/bob.js`
6. Build (`pnpm --filter @workspace/api-server run build`), restart API server
7. Run ingest: `node scripts/ingest-<name>.mjs`
8. After ingest: `POST /api/vector-memory/embed-missing` → poll until done → run audit
