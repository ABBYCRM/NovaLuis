---

name: "api-server authz model"
description: >-
The Nova API server has no per-user authentication. The Work Tree PIN gate
is the only authorization boundary, so every new route exposing secrets,
credentials, or private data must be protected by requireWtAuth.
----------------------------------------------------------------

# Nova API Server Authorization Model

## Architectural Truth

The Nova API server has no per-user authentication or authorization model.

There is no:

* User session principal
* JWT principal
* Per-user identity
* Role-based access control
* Tenant-level authorization
* Automatic private-route protection

The only authorization boundary is the **Work Tree PIN gate** implemented through:

```ts
requireWtAuth
```

The gate uses an HMAC-protected cookie issued by:

```text
POST /api/work-tree/unlock
```

---

# Public Chat Proxy

The Nova chat proxy is intentionally exposed at:

```text
/api/v1
```

This route remains public because Nova is currently operated as a personal application behind an obscure deployment URL.

An obscure URL is not a security boundary.

The public chat proxy must not expose:

* API credentials
* Secret values
* Private notes
* Knowledge-base records
* Leads
* Transcripts
* Internal configuration
* Integration settings
* Administrative actions

---

# Mandatory Authorization Rule

Any new HTTP route that reads, creates, updates, deletes, exports, or otherwise exposes sensitive data must be protected by:

```ts
requireWtAuth
```

Protected data includes:

```text
secrets
credentials
API tokens
integration configuration
private notes
knowledge-base content
leads
transcripts
agent memory
mission history
internal logs
private files
deployment controls
administrative configuration
```

The framework does not provide an implicit user or principal check.

Therefore:

```text
ROUTE WITHOUT requireWtAuth
=
PUBLIC ROUTE
```

Public-by-default routing is the primary authorization risk.

---

# Required Router Mounting

Authorization should be applied at the router boundary in:

```text
routes/index.ts
```

Preferred pattern:

```ts
router.use(
  "/api/integrations",
  requireWtAuth,
  integrationsRouter,
);

router.use(
  "/api/knowledge",
  requireWtAuth,
  knowledgeRouter,
);

router.use(
  "/api/work-tree",
  requireWtAuth,
  workTreeRouter,
);
```

Equivalent pattern:

```ts
router.use(
  requireWtAuth,
  integrationsRouter,
);
```

when the child router is already mounted under the correct protected path.

---

# Incorrect Middleware Placement

This does not protect the route:

```ts
router.get(
  "/api/integrations",
  integrationsHandler,
  requireWtAuth,
);
```

The authorization middleware must execute before the route handler:

```ts
router.get(
  "/api/integrations",
  requireWtAuth,
  integrationsHandler,
);
```

Router-level protection is preferred because it reduces the chance that one route is accidentally left public.

---

# Unlock Cookie Scope

The Work Tree unlock cookie is scoped to:

```text
Path=/api
```

A successful PIN unlock can therefore authorize protected routes under:

```text
/api/work-tree/*
/api/integrations/*
/api/knowledge/*
```

The cookie must use:

```text
HttpOnly
Secure
SameSite
signed or HMAC-verified value
bounded expiration
```

The PIN must not be accepted through:

```text
URL query parameters
URL path parameters
GET requests
logs
client-visible configuration
```

---

# In-Process Access

Internal application calls do not require the HTTP middleware when they do not cross the network boundary.

Example:

```ts
getKnowledgeContext(...)
```

The chat proxy may call an internal knowledge function directly to inject relevant context.

This is acceptable because:

* The call remains inside the trusted server process
* No public HTTP knowledge route is invoked
* The private data is not independently exposed over the network
* The HTTP authorization boundary is not being bypassed by an external caller

The distinction is:

```text
IN-PROCESS FUNCTION CALL
≠
PUBLIC HTTP ROUTE
```

---

# Incident That Established This Rule

A code review found that the integrations credential store and knowledge-base routes had been deployed publicly on Render production.

That exposure could have allowed an unauthenticated external caller to:

* Read API tokens
* Replace API tokens
* Delete integration credentials
* Read private knowledge-base content
* Insert malicious knowledge
* Poison retrieval results
* Exfiltrate private records
* Modify application behavior through stored context

The incident demonstrated that route registration alone does not provide authorization.

Every sensitive route must explicitly opt into the Work Tree authorization gate.

---

# Fail-Closed Behavior

Sensitive routes must deny access when:

* The authentication cookie is missing
* The cookie signature is invalid
* The cookie has expired
* The Work Tree PIN configuration is missing
* HMAC verification cannot execute
* Session verification fails
* Authorization state is unknown

Required outcome:

```text
HTTP 401 or HTTP 403
```

The server must not disable authorization automatically in development or production because configuration is missing.

---

# Route Classification

Every HTTP route should declare one of these classifications:

```ts
type RouteSensitivity =
  | "PUBLIC"
  | "AUTHENTICATED_READ"
  | "AUTHENTICATED_WRITE"
  | "SECRET_BEARING"
  | "DESTRUCTIVE";
```

Default classification:

```text
AUTHENTICATED_READ
```

A route may be public only through an explicit declaration.

Recommended public routes:

```text
health checks
public chat proxy
static assets
explicitly public metadata
```

---

# Required Tests

The authorization model must include tests proving:

```text
Unauthenticated sensitive GET request
→ denied

Unauthenticated sensitive POST request
→ denied

Unauthenticated sensitive PATCH request
→ denied

Unauthenticated sensitive DELETE request
→ denied

Valid Work Tree cookie
→ authorized

Expired Work Tree cookie
→ denied

Tampered Work Tree cookie
→ denied

Missing PIN configuration
→ denied

Public health route
→ accessible

Public chat proxy
→ accessible

Sensitive router mounted without requireWtAuth
→ test failure
```

---

# Startup Route Audit

The server should fail startup when a non-public route is registered without the authorization middleware.

```ts
for (const route of routeRegistry) {
  const isPublic = route.sensitivity === "PUBLIC";

  const isProtected =
    route.middleware.includes("requireWtAuth");

  if (!isPublic && !isProtected) {
    throw new Error(
      `UNPROTECTED_PRIVATE_ROUTE:${route.method}:${route.path}`,
    );
  }
}
```

---

# Security Invariant

```text
NO PER-USER PRINCIPAL EXISTS
AND
NO IMPLICIT AUTHORIZATION EXISTS
THEREFORE
EVERY SENSITIVE HTTP ROUTE MUST USE requireWtAuth
```

A route must never be considered private merely because:

* Its URL is obscure
* The application is personal
* The frontend does not link to it
* The route is undocumented
* The data is difficult to guess
* The deployment is not indexed by search engines

---

# Final Rule

```text
PUBLIC ROUTE
=
explicitly classified public

SENSITIVE ROUTE
=
mounted behind requireWtAuth

UNKNOWN ROUTE SENSITIVITY
=
deny deployment
```

**END OF SPEC**
