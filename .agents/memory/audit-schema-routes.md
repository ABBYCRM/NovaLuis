---
name: audit-schema-routes
description: File-by-file audit findings — schema mismatches, stale dists, route wildcard collision, capabilities double-prefix, PIN security.
---

## DB Schema Correctness Rule
Manual DDL (crash-fix) created work_tree_* tables with WRONG types: runs.id was TEXT→must be SERIAL; nodes had TEXT ids and missing 10 columns; governance was a log table→must be daily counter (day TEXT PK, run_count INT).
**Why:** Manual DDL was written from memory, not from the Drizzle schema files.
**How to apply:** After any manual DDL, verify column types vs lib/db/src/schema/*.ts using information_schema.columns.

## lib/db and lib/api-zod Dist Rebuild Requirement
Both have composite:true tsconfigs emitting dist/. Stale dist causes "Module has no exported member" TS errors even though the source exports exist. Rebuild with:
  pnpm --filter @workspace/db exec tsc -p tsconfig.json
  pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json
**Why:** Package.json exports point to ./src for bundlers but TS project references use dist/ declarations.

## pg Version Dedup (Drizzle Duplicate)
Two drizzle-orm instances (pg@8.20 vs pg@8.22 peer) cause SQL<unknown> type incompatibility.
Fix: pg: "8.22.0" override in pnpm-workspace.yaml + lib/db pg dep bumped to ^8.22.0.

## Route Path Double-Prefix Bug
capabilities.ts route was "/api/capabilities" but router is mounted at "/api" → real path was "/api/api/capabilities" (unreachable). All routes inside router files must use paths WITHOUT the /api prefix.

## Skills Router Wildcard Collision
skillsRouter mounted without path prefix → GET /:name caught every unmatched path including /capabilities. Fixed: router.use("/skills", skillsRouter). Named routers with dynamic segments must be mounted at explicit prefixes.

## work-tree-auth PIN Security
CANONICAL_OPERATOR_PIN "22" was always accepted in production. Now dev-only (mirrors SESSION_SECRET policy). Fix: check NODE_ENV !== "production" before including the hardcoded fallback PIN.
