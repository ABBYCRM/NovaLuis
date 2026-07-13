---
name: "Express pathless middleware gate"
description: "Authentication middleware in a shared Express router must be mounted with explicit path prefixes so unrelated routes are not intercepted."
---

# Express Pathless Middleware Gate

## Failure pattern

This is pathless middleware:

```ts
router.use(requireWtAuth, integrationsRouter);
```

`requireWtAuth` executes for every request that reaches that stack position before Express determines whether `integrationsRouter` handles the request. Public routes mounted later can therefore return the Work Tree locked response.

Observed symptom:

```text
public chat proxy
→ HTTP 401
→ {"error":"locked","needPin":true}
```

## Required mounting patterns

When child routers define complete paths:

```ts
router.use(["/integrations", "/knowledge"], requireWtAuth);
router.use(integrationsRouter);
router.use(knowledgeRouter);
router.use(openaiProxyRouter);
```

When child routers define relative paths:

```ts
router.use("/integrations", requireWtAuth, integrationsRouter);
router.use("/knowledge", requireWtAuth, knowledgeRouter);
router.use(openaiProxyRouter);
```

Do not mix both conventions or duplicate prefixes such as `/integrations/integrations`.

## Path stripping

Express strips the matched mount prefix from `req.url` before entering a mounted child router. Use `req.originalUrl` when the original path is needed.

`requireWtAuth` may safely be prefix-mounted when it only reads cookies and session state.

## Forbidden patterns

```ts
router.use(requireWtAuth, protectedRouter);
router.use(requireWtAuth);
```

These patterns are forbidden in any router that also contains public routes.

## Required tests

- protected integrations route without a valid cookie returns 401 or 403
- protected knowledge route without a valid cookie returns 401 or 403
- public chat proxy does not return the Work Tree locked payload
- an unrelated route retains its normal behavior, including normal 404 handling
- route order changes do not widen the authentication boundary

Typechecking cannot prove middleware behavior. Use Supertest or equivalent request-level tests.

## Final invariant

```text
SHARED ROUTER
+
AUTH MIDDLEWARE
=
EXPLICIT PATH PREFIX REQUIRED
```
