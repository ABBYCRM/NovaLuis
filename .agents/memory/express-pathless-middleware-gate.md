---

name: "Express pathless middleware gate"
description: >-
Auth middleware must be mounted with explicit path prefixes. Pathless
middleware registered before a sub-router can execute for unrelated routes
mounted later in the same Express router.
-----------------------------------------

# Express Pathless Middleware Gate

## Architectural Truth

In Express, this pattern is not scoped to the routes handled by `subRouter`:

```ts
router.use(requireWtAuth, subRouter);
```

Because no path prefix is supplied, `requireWtAuth` is mounted at the current router root.

For every request reaching that router, Express processes the middleware stack in registration order:

```text
request
→ requireWtAuth
→ subRouter
→ later middleware and routes
```

The sub-router may decline to handle an unrelated path, but the authorization middleware has already executed.

Therefore:

```text
PATHLESS MIDDLEWARE
=
APPLIES TO EVERY REQUEST REACHING THAT STACK POSITION
```

It is not automatically limited to the routes that the following sub-router eventually matches.

---

# Nova Failure Observed

Nova originally protected sensitive routers using a pathless mount:

```ts
router.use(requireWtAuth, integrationsRouter);
router.use(requireWtAuth, knowledgeRouter);
router.use(openaiProxyRouter);
```

This caused `requireWtAuth` to execute before requests reached the public chat proxy.

Production symptom:

```json
{
  "error": "locked",
  "needPin": true
}
```

HTTP status:

```text
401
```

The chat proxy appeared to be PIN-protected even though the proxy route itself was intended to remain public.

The actual cause was middleware scope and registration order, not the chat-proxy implementation.

---

# Mandatory Rule

Authorization middleware must always be mounted against explicit route prefixes.

Correct pattern when the child routers already define their complete paths:

```ts
router.use(
  ["/integrations", "/knowledge"],
  requireWtAuth,
);

router.use(integrationsRouter);
router.use(knowledgeRouter);

router.use(openaiProxyRouter);
```

This limits `requireWtAuth` to requests whose current path begins with:

```text
/integrations
/knowledge
```

The public chat proxy remains outside the authorization gate.

---

# Preferred Explicit Form

For maximum clarity, separate each protected prefix:

```ts
router.use(
  "/integrations",
  requireWtAuth,
);

router.use(
  "/knowledge",
  requireWtAuth,
);

router.use(integrationsRouter);
router.use(knowledgeRouter);

router.use(openaiProxyRouter);
```

This makes the authorization boundary visible during code review.

---

# Child Router Path Requirement

The pattern above assumes that the child routers define their own complete paths.

Example:

```ts
// integrationsRouter.ts

integrationsRouter.get(
  "/integrations",
  listIntegrations,
);

integrationsRouter.post(
  "/integrations/:provider",
  saveIntegration,
);
```

```ts
// knowledgeRouter.ts

knowledgeRouter.get(
  "/knowledge",
  listKnowledge,
);

knowledgeRouter.post(
  "/knowledge",
  createKnowledgeRecord,
);
```

Because the routers contain complete paths, they are mounted without another path prefix:

```ts
router.use(integrationsRouter);
router.use(knowledgeRouter);
```

---

# Alternative Relative-Path Router Pattern

When child routers define relative paths instead:

```ts
// integrationsRouter.ts

integrationsRouter.get(
  "/",
  listIntegrations,
);

integrationsRouter.post(
  "/:provider",
  saveIntegration,
);
```

mount the authorization middleware and router together under the explicit prefix:

```ts
router.use(
  "/integrations",
  requireWtAuth,
  integrationsRouter,
);
```

Likewise:

```ts
router.use(
  "/knowledge",
  requireWtAuth,
  knowledgeRouter,
);
```

Do not mix the complete-path and relative-path mounting models accidentally.

Incorrect duplication:

```ts
// Child already defines /integrations
integrationsRouter.get(
  "/integrations",
  listIntegrations,
);

// Mount adds /integrations again
router.use(
  "/integrations",
  requireWtAuth,
  integrationsRouter,
);
```

Resulting effective route:

```text
/integrations/integrations
```

The router’s internal path convention must be inspected before choosing the mount pattern.

---

# Prefix-Stripping Behavior

When Express processes:

```ts
router.use(
  "/integrations",
  requireWtAuth,
);
```

the mounted prefix may be temporarily removed from `req.url` while the middleware executes.

This is safe for `requireWtAuth` only because the middleware is path-independent.

It should inspect trusted authorization state such as:

```text
request cookie
HMAC signature
expiration
PIN-unlock state
```

It must not depend on receiving the complete unmodified request path.

The original path remains available through:

```ts
req.originalUrl
```

when diagnostic or policy logic needs the full incoming URL.

---

# Middleware Ordering Rule

Express processes middleware in registration order.

The protected prefixes must be registered before their sensitive route handlers:

```ts
router.use(
  ["/integrations", "/knowledge"],
  requireWtAuth,
);

router.use(integrationsRouter);
router.use(knowledgeRouter);
```

The public chat proxy may be mounted before or after the scoped gate because its path does not match the protected prefixes.

However, mounting the public router first can make the intended separation clearer:

```ts
router.use(openaiProxyRouter);

router.use(
  ["/integrations", "/knowledge"],
  requireWtAuth,
);

router.use(integrationsRouter);
router.use(knowledgeRouter);
```

The critical requirement is that no pathless authorization middleware exists before the public route.

---

# Forbidden Pattern

```ts
router.use(
  requireWtAuth,
  integrationsRouter,
);
```

This is forbidden because `requireWtAuth` is registered without a path filter.

Also forbidden:

```ts
router.use(requireWtAuth);
router.use(integrationsRouter);
router.use(knowledgeRouter);
router.use(openaiProxyRouter);
```

This explicitly places every later route behind the gate.

---

# Safe Registration Examples

## Complete paths inside child routers

```ts
router.use(openaiProxyRouter);

router.use(
  ["/integrations", "/knowledge"],
  requireWtAuth,
);

router.use(integrationsRouter);
router.use(knowledgeRouter);
```

## Relative paths inside child routers

```ts
router.use(
  "/integrations",
  requireWtAuth,
  integrationsRouter,
);

router.use(
  "/knowledge",
  requireWtAuth,
  knowledgeRouter,
);

router.use(
  "/v1",
  openaiProxyRouter,
);
```

Both designs are valid.

The project must use one path convention consistently.

---

# Required Tests

Middleware changes must test both protected and unrelated public routes.

## Protected route without unlock cookie

```text
GET /api/integrations
→ 401 or 403
```

## Protected knowledge route without unlock cookie

```text
GET /api/knowledge
→ 401 or 403
```

## Protected route with valid unlock cookie

```text
GET /api/integrations
→ expected successful response
```

## Public chat proxy without unlock cookie

```text
POST /api/v1/chat/completions
→ must not return the Work Tree locked response
```

## Public health route without unlock cookie

```text
GET /api/health
→ expected successful response
```

## Unknown unrelated route

```text
GET /api/unrelated
→ normal 404 behavior
```

It must not return:

```json
{
  "error": "locked",
  "needPin": true
}
```

---

# Regression Test Example

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../app";

describe("Express authorization middleware scope", () => {
  it("blocks integrations without Work Tree authorization", async () => {
    const response = await request(app)
      .get("/api/integrations");

    expect([401, 403]).toContain(response.status);
  });

  it("blocks knowledge routes without Work Tree authorization", async () => {
    const response = await request(app)
      .get("/api/knowledge");

    expect([401, 403]).toContain(response.status);
  });

  it("does not apply the Work Tree gate to the public chat proxy", async () => {
    const response = await request(app)
      .post("/api/v1/chat/completions")
      .send({
        model: "default",
        messages: [
          {
            role: "user",
            content: "test",
          },
        ],
      });

    expect(response.status).not.toBe(401);

    expect(response.body).not.toEqual(
      expect.objectContaining({
        error: "locked",
        needPin: true,
      }),
    );
  });

  it("does not apply the Work Tree gate to unrelated routes", async () => {
    const response = await request(app)
      .get("/api/route-that-does-not-exist");

    expect(response.status).toBe(404);

    expect(response.body).not.toEqual(
      expect.objectContaining({
        error: "locked",
        needPin: true,
      }),
    );
  });
});
```

The chat-proxy test may return another provider, validation, or configuration error. The regression condition is specifically that it must not be rejected by `requireWtAuth`.

---

# Review Checklist

Whenever middleware registration changes:

* Search for pathless `router.use(requireWtAuth, ...)` calls.
* Confirm every protected route has an explicit prefix.
* Confirm public routes do not match protected prefixes.
* Inspect whether child routers use complete or relative paths.
* Confirm middleware executes before protected handlers.
* Test at least one protected route.
* Test at least one public route mounted after the protected routers.
* Test normal `404` behavior.
* Confirm the public route does not return `needPin: true`.

---

# Why Type Checking Does Not Catch This

The following is valid Express syntax:

```ts
router.use(requireWtAuth, integrationsRouter);
```

TypeScript can verify that:

* `requireWtAuth` is valid middleware
* `integrationsRouter` is a valid router
* The arguments satisfy Express types

TypeScript cannot determine that the middleware scope is architecturally wrong.

This defect requires:

```text
route-level integration testing
+
middleware-order review
+
public-route smoke testing
```

---

# Security Invariant

```text
AUTHORIZATION MIDDLEWARE
MUST HAVE
AN EXPLICIT ROUTE SCOPE
```

For Nova:

```text
/integrations/*
→ requireWtAuth

/knowledge/*
→ requireWtAuth

/api/v1/*
→ public unless explicitly changed
```

A sensitive router must not be protected through pathless middleware placed in a shared router stack.

---

# Final Rule

```text
PATHLESS requireWtAuth
=
FORBIDDEN IN SHARED ROUTERS

EXPLICIT PREFIX + requireWtAuth
=
REQUIRED FOR SENSITIVE ROUTES

MIDDLEWARE CHANGE
=
TEST PROTECTED ROUTE
+ TEST UNGATED ROUTE
+ TEST ROUTE MOUNTED AFTER THE GATE
```

**END OF SPEC**
