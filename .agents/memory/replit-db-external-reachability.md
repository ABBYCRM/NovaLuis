---
name: "Replit DB external reachability"
description: "Reject Replit app-scoped Helium development database URLs in external runtimes and require real persistence verification against an externally reachable PostgreSQL target."
---

# Replit Database External Reachability

## Architectural truth

A Replit development `DATABASE_URL` containing a Helium host or `heliumdb` database is scoped to the originating Replit application. It is not a portable PostgreSQL endpoint for Render, Fly.io, Railway, a local daemon, or another Replit application.

```text
REPLIT HELIUM DEVELOPMENT URL
=
ORIGINATING REPLIT APP ONLY
```

Do not generalize this rule to every production database exposed through Replit. Classify the actual URL and deployment model.

## Invalid external wiring

```text
Replit DATABASE_URL with host helium
→ copied to external deployment
→ DNS or connectivity failure
→ lazy DB features silently stop persisting
```

Changing SSL mode, pool size, timeout, ORM, or retry delay cannot make an app-scoped hostname externally reachable.

## Correct wiring

Replit development:

```text
DATABASE_URL=<Replit development URL>
```

External application:

```text
DATABASE_URL=<externally reachable production PostgreSQL URL>
```

External Nova daemon:

```text
SCRATCHPAD_DATABASE_URL=<externally reachable production PostgreSQL URL>
```

The application and daemon may use different internal and external endpoints, but they must target the same logical database when they share Nova memory.

## Runtime guard

External runtimes must reject Helium targets before attempting application work.

```ts
function isReplitDevelopmentUrl(raw: string): boolean {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const database = url.pathname.replace(/^\/+/, "").toLowerCase();
  return host === "helium" || host.includes("helium") || database === "heliumdb";
}
```

```text
runtime != replit
+
Replit development URL
→ fail startup or readiness
```

Classification is not proof that another URL is reachable. Execute a real query.

## Silent degradation is forbidden

Do not swallow `recordTurn` or other required persistence failures.

Production default:

```text
DATABASE_MODE=required
```

When the database is required, failed connectivity must fail readiness and DB-dependent operations honestly. Optional mode must expose an explicit degraded status and structured error telemetry.

## Health model

```text
/health/live
→ process responds

/health/ready
→ database target valid
→ connection succeeds
→ required query succeeds
```

Application boot is not database readiness.

## Migration

Selecting a new external database does not migrate Replit data.

Required migration sequence:

```text
export or read source inside Replit
→ apply target schema
→ copy data idempotently
→ repair sequences
→ compare row counts and samples
→ verify Nova persistence
```

## Nova verification

1. submit a synthetic chat turn
2. verify one persisted scratchpad record
3. verify the expected session association
4. execute `getMemoryDigest`
5. verify the persisted context is returned
6. run the daemon against the same logical database
7. verify idempotent distilled output

## Final invariant

```text
EXTERNAL DEPLOYMENT
=
EXTERNALLY REACHABLE DATABASE

PROCESS STARTED
≠
PERSISTENCE WORKING

DONE
=
TARGET VALID
+
SELECT
+
WRITE
+
READ
+
MEMORY LOOP VERIFIED
```
