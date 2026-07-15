---
name: "Render supernova-db connectivity"
description: "Root causes and fixes for connecting Replit daemons to Render PostgreSQL: IP allowlist, deleted DB, pg SSL conflict, missing schema, GOVERNANCE.json."
---

# Render supernova-db Connectivity

## DB identity
- supernova-db ID: `dpg-d94pgbnaqgkc73e7u8hg-a` (Basic 256MB, Oregon, PostgreSQL 16)
- External host: `dpg-d94pgbnaqgkc73e7u8hg-a.oregon-postgres.render.com:5432`
- DB: `supernova_db_q5bt`, user: `supernova`
- Credentials endpoint: `GET /v1/postgres/{id}/connection-info` (returns external + internal URLs including password)

## Root cause 1 — Old DB deleted
The previous `SCRATCHPAD_DATABASE_URL` pointed to `dpg-d8dmksf7f7vs73cd3ic0-a` which no longer exists.
TCP connected but PG auth terminated immediately — classic sign of a deleted/replaced DB still reachable via Render's proxy.

**Fix:** Use `GET /v1/postgres/{id}/connection-info` to get the live external URL. Update `SCRATCHPAD_DATABASE_URL` in Replit `setEnvVars({ environment: "shared" })` and on the Render service via `PUT /v1/services/{id}/env-vars`.

## Root cause 2 — IP allowlist blocked external connections
`ipAllowList: null` on a Basic-plan Render DB blocks all external IPs. TLS handshake succeeds (Render's proxy accepts it) but PostgreSQL startup message is silently dropped.

**Fix:** `PATCH /v1/postgres/{id}` with `{"ipAllowList":[{"cidrBlock":"0.0.0.0/0","description":"open"}]}`.
**Note:** `PUT` returns 405 on this endpoint — only `PATCH` works.
**Invariant:** Keep allowlist at `0.0.0.0/0` whenever external daemons need access (replit.md requirement).

## Root cause 3 — pg SSL object + URL sslmode conflict
Passing both `connectionString` (with `sslmode=...`) AND an explicit `ssl:` object to `new Pool()` causes "Connection terminated unexpectedly" at the PostgreSQL auth layer. The URL param overrides the object internally.

**Fix:** Ensure `SCRATCHPAD_DATABASE_URL` has no `?sslmode=` or `?ssl*` params; rely solely on the explicit `ssl: { rejectUnauthorized: false }` object in the Pool config.

## Root cause 4 — Missing schema tables
supernova-db had no Nova daemon tables. Schema source of truth: `lib/db/src/schema/`.
Tables needed: `conversation_turns`, `scratchpad_entries`, `work_tree_runs`, `work_tree_nodes`, `work_tree_governance`.

**Fix:** `scripts/migrate-supernova-db.mjs` — idempotent `CREATE TABLE IF NOT EXISTS`. Rerun after any DB recreation.

## Root cause 5 — GOVERNANCE.json missing
work-tree-worker reads `GOVERNANCE.json` at startup and fails closed (`autonomyEnabled=false`) when absent.
The file must live at the workspace root (`path.resolve(__dirname, "..", "GOVERNANCE.json")`).

**Fix:** `{"autonomyEnabled":true,"dailyAutonomousRunCap":50}`

## Render API cheat-sheet
| Action | Endpoint |
|---|---|
| List DBs | `GET /v1/postgres` |
| Get connection strings + password | `GET /v1/postgres/{id}/connection-info` |
| List DB users | `GET /v1/postgres/{id}/credentials` |
| Update IP allowlist | `PATCH /v1/postgres/{id}` |
| Bulk-replace service env vars | `PUT /v1/services/{id}/env-vars` |

## Log flood fix
Workers had 2 s retry intervals that flooded logs on DB failure.
Fixed with exponential backoff (max 60 s for work-tree-worker, 120 s for scratchpad-daemon).
