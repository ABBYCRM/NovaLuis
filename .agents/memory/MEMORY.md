---
name: "ABBYCLAW runtime integration memory"
description: "Index of durable operational rules for NOVA and Supernova covering authorization, Git, Render, databases, workspace context, model routing, and agent tools."
---

# ABBYCLAW Runtime Integration Memory

This directory contains durable operational rules. Each subject lives in one focused file so updates do not corrupt unrelated runtime state or configuration files.

## Authorization and HTTP routing

- `api-authz.md` — sensitive Nova API routes require `requireWtAuth`
- `express-pathless-middleware-gate.md` — auth middleware in shared routers requires explicit path prefixes

## Git and execution discipline

- `github-pat-push.md` — secure Git-over-HTTPS PAT handling and remote SHA verification
- `internal-rules.md` — self-fix, branch, deploy, verification, and reporting rules

## Nova client behavior

- `global-state-stripper.md` — trailing signature removal without leaks or over-stripping
- `nova-workspace-context.md` — IndexedDB workspace context and versioned system-prompt awareness

## Render and databases

- `render-deploy.md` — Docker service creation, deployment polling, commit matching, and health verification
- `render-postgres-connect.md` — internal/external PostgreSQL URLs, TLS, allowlist inspection, and Nova memory verification
- `render-service-repoint.md` — repoint one service instead of overwriting shared repository code
- `replit-db-external-reachability.md` — reject app-scoped Replit Helium development URLs in external runtimes

## Super Nova runtime

- `super-nova-router.md` — OpenAI-primary role routing with atomic provider/model fallback and 16K+ output budgets
- `super-nova-tools.md` — SSRF-safe fetch, multi-provider search, dangerous-tool gates, and Work Tree authentication

## Storage rules

Runtime data must not be replaced with documentation.

```text
Markdown rules
→ .agents/memory/*.md

Generated asset metadata
→ .agents/agent_assets_metadata.toml

Mutable polling state
→ .nova-data/.poll-state.json at runtime only
→ ignored by Git
```

## Loading rule

When rules conflict:

1. current repository implementation and verified runtime behavior
2. root `AGENTS.md` and active system/runtime policy
3. focused memory file for the relevant subsystem
4. this index

Environment-specific observations must not be promoted into universal platform claims without verification.

## Completion rule

```text
DOCUMENT PRESENT
≠
IMPLEMENTATION PRESENT

IMPLEMENTATION PRESENT
≠
BEHAVIOR VERIFIED

DONE
=
IMPLEMENTED
+
TESTED
+
OBSERVED
+
NO REGRESSION
```
- [Render supernova-db connectivity](render-supernova-db.md) — IP allowlist, deleted DB, pg SSL conflict, missing schema, GOVERNANCE.json fixes.
- [RAG embedding pipeline](rag-embedding-pipeline.md) — Gemini-first embed, batch=1 ingest, embed-missing server job, concurrent fill breaks search queries.
- [Audit schema, routes, and dists](audit-schema-routes.md) — work_tree schema was wrong; lib/db+api-zod dists go stale; skills router wildcard collision; capabilities double-prefix; PIN security.
- [DigitalOcean App Platform deployment](do-deployment.md) — nova-luis live on DO App Platform; same account as Render (intake@abbycrm.com).
