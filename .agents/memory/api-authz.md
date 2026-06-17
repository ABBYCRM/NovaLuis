---
name: api-server authz model
description: There is no per-user auth on the Nova api-server; the Work Tree PIN gate is the only authz, so new sensitive routes must opt into it.
---

# Nova api-server has no per-user auth

The Nova chat proxy (`/api/v1`) is intentionally open (personal app, obscure URL).
There is **no session/JWT principal** — the only access control is the Work Tree
PIN gate (`requireWtAuth`, HMAC cookie issued by `/api/work-tree/unlock`).

**Rule:** any new HTTP route that exposes secrets, credentials, or private data
(notes, KB, leads, transcripts) MUST be mounted behind `requireWtAuth`. Public by
default is the trap here — the framework gives you no implicit principal check.

**Why:** a code review caught the integrations credential store + knowledge base
routes shipping fully public on Render prod — anyone could read/overwrite Robert's
API tokens or poison/exfiltrate the KB.

**How to apply:** the unlock cookie is scoped to `path=/api`, so one PIN unlock
covers `/api/work-tree/*`, `/api/integrations/*`, `/api/knowledge/*`. Gate at the
`router.use(requireWtAuth, xRouter)` level in `routes/index.ts`. In-process calls
(e.g. chat proxy injecting KB context via `getKnowledgeContext`) bypass the HTTP
gate, which is fine — they never cross the network boundary.
