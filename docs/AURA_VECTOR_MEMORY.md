# AURA-VECTOR Runtime Memory

AURA-VECTOR is NOVA's mission-aware agentic memory layer. It is not a replacement for the existing document knowledge base. The knowledge base remains appropriate for notes, files, SOPs and transcripts; AURA-VECTOR stores runtime knowledge with explicit execution semantics.

## What is wired end to end

```text
Browser chat / Work Tree mission
        │
        ▼
NOVA API fetch boundary
        │
        ├─ identify OpenClaw /v1/chat/completions dispatch
        ├─ infer execution phase and query intent
        ├─ retrieve dense candidates with pgvector HNSW
        ├─ retrieve exact/lexical candidates with PostgreSQL FTS + GIN
        ├─ merge, mission-score, verification-score and temporally decay
        ├─ remove contradicted/expired/redundant candidates
        └─ inject NOVA_VECTOR_MEMORY_CONTEXT before OpenClaw executes
        │
        ▼
OpenClaw real tool loop
        │
        ├─ nova-services vector-search
        ├─ nova-services vector-ingest
        ├─ nova-services vector-feedback
        └─ nova-services vector-status
        │
        ▼
Runtime memory
        ├─ mission input captured as observed operational state
        ├─ gateway HTTP failures captured as observed failure memory
        └─ returned model payload captured as claimed episodic memory
```

The fetch-boundary hook is installed by `artifacts/api-server/src/app.ts` and implemented in `artifacts/api-server/src/lib/vector-memory-fetch-hook.ts`. This location covers both normal agent chat and Work Tree without duplicating retrieval logic in multiple route handlers.

## Memory classes

- `semantic`: stable facts and architecture knowledge.
- `episodic`: what happened during a prior interaction or mission.
- `procedural`: reusable execution procedures.
- `operational`: current or recent mission/runtime state.
- `evidence`: test, API, command, deployment or other proof material.
- `failure`: failed attempts, errors and conditions that should prevent blind retries.
- `decision`: accepted choices and their context.
- `preference`: durable operator preferences.
- `code`: code-specific knowledge and repair context.
- `tool`: tool capabilities, schemas and execution facts.
- `skill`: reusable agent skill knowledge.

## Verification contract

AURA-VECTOR never promotes a model statement to verified evidence merely because OpenClaw returned it.

| Level | Meaning |
|---|---|
| `verified` | Established by a real check and explicitly stored as verified |
| `observed` | Directly observed input, result, HTTP status, command output or runtime event |
| `inferred` | Derived from evidence but not directly proven |
| `claimed` | Model/user/system assertion without independent verification |
| `contradicted` | Known to conflict with stronger current evidence |
| `failed` | Failure-state marker |

Retrieval weights verified and observed evidence above inferred and claimed text. Contradicted memories are excluded from normal retrieval.

## Storage

The database table is `vector_memories`.

Important fields:

- content and SHA-256 content identity;
- memory type;
- scope and scope key;
- mission and agent IDs;
- verification level;
- confidence, importance and salience;
- nullable 1536-dimension embedding;
- generated PostgreSQL `tsvector` search representation;
- metadata, entities and relationships;
- validity interval and supersession pointer;
- retrieval count and success/failure utility counters.

The schema self-heals at runtime with `CREATE TABLE IF NOT EXISTS`, HNSW vector indexing and a GIN full-text index. The Drizzle schema is also exported from `@workspace/db`.

## Embedding failure behavior

Embedding availability must not disable runtime memory.

- With `OPENAI_API_KEY`, memories use `text-embedding-3-small` and dense pgvector retrieval.
- Without a working embeddings provider, ingestion still succeeds with a null embedding.
- Lexical retrieval remains available through PostgreSQL full-text search.
- Once the same memory is re-ingested while embeddings are available, the upsert fills the missing vector.

This prevents a provider outage from turning memory into a hard dependency that takes OpenClaw down.

## Retrieval algorithm

For each query:

1. infer intent: recall, debug, plan, execute, verify or compare;
2. infer phase: OBSERVE, PLAN, ACT, VERIFY, COMPARE or CORRECT;
3. retrieve up to a bounded candidate pool from dense similarity search;
4. retrieve a second candidate pool from exact/lexical FTS;
5. merge candidates by memory ID;
6. score using semantic similarity, lexical rank, intent compatibility, mission compatibility, verification quality, temporal recency, importance, salience, historical utility and phase/type compatibility;
7. subtract contradiction and stale-operational penalties;
8. apply minimum score;
9. remove near-duplicate results with token-set Jaccard diversity;
10. inject the bounded top results into the OpenClaw turn.

The scoring implementation is `scoreVectorMemoryHit()` in `artifacts/api-server/src/lib/vector-memory.ts`.

## Protected API

All vector-memory routes are protected by the same operator PIN or trusted peer bearer-key gate used for Work Tree and integrations.

### Status

```http
GET /api/vector-memory/status
```

### Ingest

```http
POST /api/vector-memory/ingest
Content-Type: application/json

{
  "content": "Observed test output...",
  "memoryType": "evidence",
  "scope": "mission",
  "scopeKey": "42",
  "missionId": "42",
  "verification": "verified",
  "importance": 1,
  "salience": 1
}
```

### Search

```http
POST /api/vector-memory/search
Content-Type: application/json

{
  "query": "why did the deployment fail?",
  "missionId": "42",
  "phase": "CORRECT",
  "intent": "debug",
  "memoryTypes": ["failure", "evidence", "code", "tool"],
  "limit": 10
}
```

### Retrieval feedback

```http
POST /api/vector-memory/feedback
Content-Type: application/json

{
  "ids": [12, 19, 22],
  "successful": true
}
```

Feedback adjusts future ranking utility. It must reflect the real downstream outcome, not whether a model liked the retrieved text.

## OpenClaw commands

```bash
node {baseDir}/nova-services.mjs vector-status
node {baseDir}/nova-services.mjs vector-search --query 'current mission' --phase PLAN --intent plan --limit 8 --mission-id 42
node {baseDir}/nova-services.mjs vector-ingest --type failure --scope mission --mission-id 42 --verification observed --content 'Exact failure evidence'
node {baseDir}/nova-services.mjs vector-feedback --ids 12,19 --successful true
```

The `nova-services` skill requires non-trivial missions to search memory before planning and to search failure memory before repeating an unchanged failed action.

## Validation

Deterministic pure-algorithm checks live at:

```text
artifacts/api-server/src/lib/vector-memory.self-test.ts
```

Run:

```bash
pnpm run test:vector-memory
pnpm run typecheck
pnpm run build:api
node --check openclaw/workspace/skills/nova-services/nova-services.mjs
```

Production acceptance additionally requires a database-backed smoke test proving:

1. a memory can be ingested;
2. lexical retrieval works without an embedding;
3. dense retrieval works when the embeddings provider is configured;
4. a Work Tree or agent-chat dispatch contains `NOVA_VECTOR_MEMORY_CONTEXT` when relevant memory exists;
5. a failed non-stream OpenClaw dispatch creates a `failure` memory;
6. a returned final model payload is stored as `claimed`, not `verified`.
