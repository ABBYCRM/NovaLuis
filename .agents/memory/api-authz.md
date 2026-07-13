---
name: "api-server authz model"
description: "Nova has no per-user principal; every sensitive HTTP route must be explicitly protected by requireWtAuth."
---

# Nova API Server Authorization Model

## Architectural truth

Nova currently has no per-user session principal, JWT identity, RBAC model, or tenant authorization layer.

The Work Tree PIN gate implemented by `requireWtAuth` is the only HTTP authorization boundary for private Nova API routes.

```text
ROUTE WITHOUT requireWtAuth
=
PUBLIC ROUTE
```

An obscure deployment URL is not an authorization mechanism.

## Public routes

Only routes explicitly classified as public may omit `requireWtAuth`, including:

- health and readiness endpoints
- static assets
- the intentionally public chat proxy
- explicitly public metadata

Public routes must not expose secrets, credentials, private notes, knowledge-base records, leads, transcripts, internal logs, deployment controls, or administrative configuration.

## Protected routes

Any route that reads or mutates sensitive data must execute `requireWtAuth` before the handler.

```ts
router.use("/api/integrations", requireWtAuth, integrationsRouter);
router.use("/api/knowledge", requireWtAuth, knowledgeRouter);
router.use("/api/work-tree", requireWtAuth, workTreeRouter);
```

Do not use pathless authentication middleware in a shared router. It can lock unrelated routes mounted later.

## Fail-closed behavior

Deny access when the cookie is missing, invalid, expired, or unverifiable, or when `SESSION_SECRET` is missing in production.

Expected result:

```text
HTTP 401 or HTTP 403
```

Never install a predictable production fallback secret.

## In-process calls

A trusted server-side function call such as `getKnowledgeContext()` does not cross the HTTP boundary and therefore does not require HTTP middleware. It must still obey internal data-access and least-privilege rules.

## Required tests

- unauthenticated sensitive reads and writes are denied
- valid Work Tree sessions are accepted
- expired and tampered cookies are denied
- missing production signing configuration fails closed
- public chat and health routes remain accessible
- a route audit rejects any private route missing `requireWtAuth`

## Final invariant

```text
PUBLIC
=
explicitly declared public

SENSITIVE
=
requireWtAuth before handler

UNKNOWN
=
deny deployment
```
