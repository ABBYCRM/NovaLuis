The critical correction is to distinguish **Replit’s current development database** from its **production database**. The current development `DATABASE_URL` is app-scoped and cannot be used by other apps or external database viewers; Replit production databases are separate and currently run on Neon. ([Replit Docs][1])

---

name: "Replit DB external reachability"
description: >-
Prevent external deployments from reusing Replit's app-scoped development
DATABASE_URL, require an externally reachable PostgreSQL target, and verify
that database-backed features persist instead of silently degrading.
--------------------------------------------------------------------

# Replit Database External Reachability

## Scope

This rule applies when a Replit application is also deployed to:

* Render
* Fly.io
* Railway
* Kubernetes
* A VPS
* A local daemon
* CI or migration infrastructure
* Any runtime outside the originating Replit App

It governs:

* Development-database URL classification
* External database selection
* Environment-variable wiring
* Startup database verification
* Drizzle and PostgreSQL failure handling
* Data migration
* Health checks
* Nova scratchpad persistence
* Degraded-mode prevention

---

# 1. Architectural Truth

Replit’s current development database is hosted on Replit’s Helium infrastructure.

Its `DATABASE_URL` is scoped to the originating Replit App.

Replit explicitly states that this development URL:

* Can be used only by the originating app
* Cannot be used by other Replit Apps
* Cannot be used by external database viewers
* Is not publicly exposed
* Is automatically updated to point to Helium after the database upgrade

Replit’s documentation identifies current development URLs by values containing `helium/heliumdb`. ([Replit Docs][1])

Required rule:

```text
REPLIT DEVELOPMENT DATABASE_URL
=
APP-SCOPED REPLIT CAPABILITY
```

It is not:

```text
PORTABLE EXTERNAL POSTGRESQL INFRASTRUCTURE
```

---

# 2. Development Versus Production Database

Do not generalize this rule to every database managed through Replit.

## Replit Development Database

```text
Infrastructure:
Replit Helium

Scope:
Originating Replit App

External portability:
No
```

## Replit Production Database

Replit production databases are separate from development databases and currently use Neon-hosted PostgreSQL infrastructure. They have different connection behavior and are created for published production applications. ([Replit Docs][2])

Therefore:

```text
REPLIT DEVELOPMENT DATABASE_URL
≠
REPLIT PRODUCTION DATABASE URL
```

This skill primarily concerns the current **development** `DATABASE_URL`.

---

# 3. Invalid External Deployment Architecture

The following is invalid:

```text
Replit App
DATABASE_URL=postgresql://...@helium/heliumdb
        │
        └── copied unchanged to Render, Fly.io, or Railway
```

Expected external result:

```text
DNS resolution failure
OR
host unreachable
OR
platform-scope rejection
OR
database connection failure
```

Changing only these values will not make an app-scoped Helium URL externally reachable:

* SSL mode
* Connection timeout
* Pool size
* PostgreSQL driver
* ORM version
* Password encoding
* Retry delay
* DNS library

The failure is the database’s network and application scope, not ordinary PostgreSQL configuration.

---

# 4. Correct External Architecture

An externally deployed application requires an externally reachable PostgreSQL database.

```text
Externally reachable PostgreSQL
             │
             ├── Render application
             ├── Fly.io worker
             ├── Railway service
             ├── Replit daemon
             └── authorized migration client
```

Valid targets include properly configured:

* Render PostgreSQL external connection
* Neon PostgreSQL
* Railway PostgreSQL public connection
* Supabase PostgreSQL
* Another managed PostgreSQL service
* A securely exposed self-managed PostgreSQL instance

The target must support connections from the actual deployment environment.

---

# 5. Environment-Variable Rule

Environment-variable names describe application roles. They do not make an inaccessible URL portable.

## Inside the Replit Development App

```text
DATABASE_URL
=
Replit-provided Helium development URL
```

## External Production Application

```text
DATABASE_URL
=
externally reachable production PostgreSQL URL
```

## External Nova Scratchpad Daemon

```text
SCRATCHPAD_DATABASE_URL
=
externally reachable PostgreSQL URL used by Nova memory
```

Do not copy the Replit development value into external environment variables.

---

# 6. Database Target Separation

Recommended layout:

```text
Replit development:
DATABASE_URL=<Replit Helium development URL>

Render production:
DATABASE_URL=<Render internal or external production URL>

External distillation daemon:
SCRATCHPAD_DATABASE_URL=<externally reachable production URL>
```

When the Render application and daemon are intended to share Nova memory:

```text
Render DATABASE_URL
and
daemon SCRATCHPAD_DATABASE_URL
```

must resolve to the same logical production database.

They may use different connection endpoints, such as:

```text
Render app:
internal database hostname

External daemon:
external database hostname
```

---

# 7. URL Classification Guard

The runtime must inspect the database target without printing credentials.

```ts
export type DatabaseTargetClass =
  | "REPLIT_DEVELOPMENT"
  | "NEON"
  | "RENDER"
  | "RAILWAY"
  | "OTHER_EXTERNAL"
  | "INVALID";

export interface DatabaseTargetSummary {
  classification: DatabaseTargetClass;
  hostname: string;
  database: string;
  externallyPortable: boolean;
}

export function classifyDatabaseUrl(
  rawDatabaseUrl: string,
): DatabaseTargetSummary {
  let url: URL;

  try {
    url = new URL(rawDatabaseUrl);
  } catch {
    return {
      classification: "INVALID",
      hostname: "",
      database: "",
      externallyPortable: false,
    };
  }

  const hostname = url.hostname.toLowerCase();
  const database = url.pathname
    .replace(/^\/+/, "")
    .toLowerCase();

  const isReplitDevelopment =
    hostname === "helium" ||
    hostname.includes("helium") ||
    database === "heliumdb";

  if (isReplitDevelopment) {
    return {
      classification: "REPLIT_DEVELOPMENT",
      hostname,
      database,
      externallyPortable: false,
    };
  }

  if (
    hostname.endsWith(".neon.tech") ||
    hostname.endsWith(".neon.tech.")
  ) {
    return {
      classification: "NEON",
      hostname,
      database,
      externallyPortable: true,
    };
  }

  if (hostname.includes("render.com")) {
    return {
      classification: "RENDER",
      hostname,
      database,
      externallyPortable: true,
    };
  }

  if (
    hostname.includes("railway") ||
    hostname.includes("rlwy.net")
  ) {
    return {
      classification: "RAILWAY",
      hostname,
      database,
      externallyPortable: true,
    };
  }

  return {
    classification: "OTHER_EXTERNAL",
    hostname,
    database,
    externallyPortable: false,
  };
}
```

`OTHER_EXTERNAL` must undergo a real connectivity test before being accepted.

Classification alone is not proof of reachability.

---

# 8. External Runtime Hard Gate

The application must reject a Replit development database URL when running outside Replit.

```ts
export function assertDatabaseTargetAllowed(
  rawDatabaseUrl: string,
  runtimePlatform: string,
): void {
  const target = classifyDatabaseUrl(rawDatabaseUrl);

  if (target.classification === "INVALID") {
    throw new Error("DATABASE_URL_INVALID");
  }

  const runningOutsideReplit =
    runtimePlatform !== "replit";

  if (
    runningOutsideReplit &&
    target.classification === "REPLIT_DEVELOPMENT"
  ) {
    throw new Error(
      "REPLIT_DEVELOPMENT_DATABASE_NOT_EXTERNALLY_REACHABLE",
    );
  }
}
```

The runtime platform should be declared explicitly:

```text
RUNTIME_PLATFORM=replit
RUNTIME_PLATFORM=render
RUNTIME_PLATFORM=fly
RUNTIME_PLATFORM=railway
```

Do not rely exclusively on guessed platform environment variables.

---

# 9. Nova Daemon Database Resolution

The external scratchpad daemon must not silently fall back to Replit’s `DATABASE_URL`.

Correct:

```js
const databaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "SCRATCHPAD_DATABASE_URL_REQUIRED",
  );
}
```

Incorrect:

```js
const databaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL ||
  process.env.DATABASE_URL;
```

That fallback can accidentally select:

* Replit Helium
* A development database
* A Render internal hostname
* An old Neon database
* The wrong environment

A compatibility fallback may exist only when explicitly enabled:

```js
const databaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL ??
  (
    process.env.ALLOW_DATABASE_URL_FALLBACK === "true"
      ? process.env.DATABASE_URL
      : undefined
  );

if (!databaseUrl) {
  throw new Error(
    "SCRATCHPAD_DATABASE_URL_REQUIRED",
  );
}
```

Default:

```text
ALLOW_DATABASE_URL_FALLBACK=false
```

---

# 10. Silent Degradation Is Forbidden

The application must not silently ignore database failure when persistence is a required feature.

Problematic behavior:

```ts
try {
  await recordTurn(turn);
} catch {
  // Ignore failure.
}
```

This creates a false-success state:

```text
application responds
BUT
memory is not persisted
```

Correct behavior:

```ts
try {
  await recordTurn(turn);
} catch (error) {
  logger.error(
    {
      error: sanitizeDatabaseError(error),
      operation: "recordTurn",
    },
    "NOVA_MEMORY_WRITE_FAILED",
  );

  throw new Error(
    "NOVA_MEMORY_PERSISTENCE_FAILED",
  );
}
```

If the product intentionally supports degraded operation, it must be explicit.

```text
DATABASE_MODE=required
DATABASE_MODE=optional
```

Production default:

```text
DATABASE_MODE=required
```

---

# 11. Required Versus Optional Database Mode

```ts
type DatabaseMode =
  | "required"
  | "optional";

const databaseMode =
  (process.env.DATABASE_MODE ??
    "required") as DatabaseMode;

if (
  databaseMode !== "required" &&
  databaseMode !== "optional"
) {
  throw new Error(
    `INVALID_DATABASE_MODE:${databaseMode}`,
  );
}
```

When `required`:

```text
database unavailable
→ readiness fails
→ DB-dependent request fails honestly
→ deployment is not considered healthy
```

When `optional`:

```text
database unavailable
→ explicit DEGRADED status
→ persistence-disabled response metadata
→ error telemetry emitted
```

Never represent degraded mode as full success.

---

# 12. Startup Connectivity Probe

A parseable URL is not sufficient.

Required startup sequence:

```text
parse URL
→ classify target
→ reject invalid runtime-target combination
→ resolve DNS
→ establish TCP/TLS
→ authenticate
→ execute SELECT 1
```

Example:

```ts
import { Pool } from "pg";

export async function verifyDatabase(
  connectionString: string,
): Promise<void> {
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    application_name: "nova-database-probe",
  });

  try {
    const result = await pool.query(
      "SELECT 1 AS connected",
    );

    if (result.rows[0]?.connected !== 1) {
      throw new Error(
        "DATABASE_PROBE_UNEXPECTED_RESULT",
      );
    }
  } finally {
    await pool.end();
  }
}
```

Do not log the connection string.

---

# 13. Readiness and Liveness

Separate process liveness from database readiness.

## Liveness

```http
GET /health/live
```

Verifies:

```text
process is running
event loop responds
```

## Readiness

```http
GET /health/ready
```

Verifies:

```text
database target is valid
+ database connection succeeds
+ required query succeeds
+ required dependencies are available
```

Example readiness result:

```json
{
  "status": "ready",
  "database": {
    "required": true,
    "connected": true,
    "targetClass": "RENDER"
  }
}
```

Failure:

```json
{
  "status": "not_ready",
  "database": {
    "required": true,
    "connected": false,
    "errorCode": "DATABASE_HOST_UNREACHABLE"
  }
}
```

Never expose:

* Database password
* Username
* Complete hostname when considered sensitive
* Full connection string

---

# 14. Drizzle Failure Handling

A Drizzle error is a wrapper and may not identify the actual network failure.

Inspect the underlying cause.

```ts
export function classifyDatabaseError(
  error: unknown,
): string {
  const candidate = error as {
    code?: string;
    cause?: {
      code?: string;
      message?: string;
    };
    message?: string;
  };

  const code =
    candidate.cause?.code ??
    candidate.code;

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DATABASE_DNS_FAILED";

    case "ECONNREFUSED":
      return "DATABASE_CONNECTION_REFUSED";

    case "ETIMEDOUT":
      return "DATABASE_CONNECTION_TIMED_OUT";

    case "28P01":
      return "DATABASE_AUTHENTICATION_FAILED";

    case "3D000":
      return "DATABASE_NOT_FOUND";

    default:
      return "DATABASE_QUERY_OR_CONNECTION_FAILED";
  }
}
```

Do not report only:

```text
DrizzleQueryError
```

Record the root cause without exposing credentials.

---

# 15. Failure Classification

## Helium URL Detected Externally

```text
REPLIT_DEVELOPMENT_DATABASE_NOT_EXTERNALLY_REACHABLE
```

Correction:

```text
configure an externally reachable PostgreSQL database
```

## DNS Failure

Examples:

```text
ENOTFOUND
EAI_AGAIN
getaddrinfo failed
```

Classification:

```text
DATABASE_DNS_FAILED
```

When the host is `helium` outside Replit:

```text
WRONG_DATABASE_TARGET_CLASS
```

## Connection Timeout

Classification:

```text
DATABASE_NETWORK_UNREACHABLE
```

Inspect:

* Public accessibility
* IP allowlist
* Firewall
* Provider sleep or suspension state
* Port
* TLS requirements

## Authentication Failure

Examples:

```text
28P01
password authentication failed
```

Classification:

```text
DATABASE_CREDENTIALS_REJECTED
```

Do not misclassify authentication failure as DNS or network scope.

## Query Failure After Connection

Classification:

```text
DATABASE_SCHEMA_OR_QUERY_FAILED
```

Inspect:

* Missing tables
* Migration state
* Role permissions
* Schema search path
* SQL compatibility

---

# 16. Self-Fix Rule

When an external deployment has a Replit development URL:

1. Inspect existing environment-variable references.
2. Inspect available database-provider integrations.
3. Inspect existing Render, Railway, Neon, or other database resources.
4. Retrieve the appropriate external URL through authorized tools.
5. Configure the external runtime.
6. Run a connectivity probe.
7. Run schema verification.
8. Test persistence.

Do not immediately ask the operator for a URL when the runtime can obtain it through an authorized provider API or secret store.

Only return:

```text
VERIFIED_OPERATOR_ACTION_REQUIRED
```

when no authorized external database or credential source is accessible.

---

# 17. Data Migration Requirement

Configuring a new database does not migrate existing data.

If the external deployment must use the same records as Replit development:

```text
schema migration
+
data migration
+
sequence repair
+
verification
```

are required.

Replit’s database tooling supports exporting data for external use. ([Replit Docs][1])

---

# 18. Migration Strategies

## Strategy A — Run Migration Inside Replit

Use when the Replit App can access:

* Its Helium development database
* The new external PostgreSQL target

```text
Replit Helium
→ migration process running inside Replit
→ external PostgreSQL
```

This avoids attempting to connect to Helium from outside Replit.

## Strategy B — Export and Import

```text
export schema and data from Replit
→ securely transfer export
→ import into external PostgreSQL
→ verify counts and constraints
```

## Strategy C — Application-Level Migration

Use bounded reads from the Replit database and idempotent writes to the external database.

Required controls:

* Stable primary keys
* Pagination
* Checkpointing
* Idempotency
* Duplicate prevention
* Row-count comparison
* Hash or aggregate verification

---

# 19. Migration Verification

For every migrated table, record:

```text
source row count
target row count
primary-key minimum and maximum
null constraint violations
foreign-key violations
sequence state
sample record hashes
```

Example:

```sql
SELECT COUNT(*) FROM scratchpad_entries;

SELECT
  MIN(id),
  MAX(id)
FROM scratchpad_entries;
```

Verify sequence state when applicable:

```sql
SELECT setval(
  pg_get_serial_sequence(
    'scratchpad_entries',
    'id'
  ),
  COALESCE(
    (
      SELECT MAX(id)
      FROM scratchpad_entries
    ),
    1
  ),
  true
);
```

Do not delete or abandon the source database until migration verification passes.

---

# 20. Nova Persistence Verification

Database connectivity alone does not prove Nova memory works.

Required end-to-end test:

```text
1. Submit a synthetic Nova chat turn.
2. Capture the expected session identifier.
3. Confirm recordTurn executes.
4. Query scratchpad_entries.
5. Confirm exactly one expected record exists.
6. Restart or issue another request.
7. Execute getMemoryDigest.
8. Confirm persisted context is retrieved.
9. Run the distillation daemon.
10. Confirm distillation output persists once.
```

Completion requires:

```text
CONNECTIVITY_VERIFIED
+
SCHEMA_VERIFIED
+
WRITE_VERIFIED
+
READ_VERIFIED
+
MEMORY_DIGEST_VERIFIED
+
DISTILLATION_VERIFIED
```

---

# 21. Guarded Write Rule

If `recordTurn` is intentionally non-blocking, it must still expose failure.

Acceptable pattern:

```ts
void recordTurn(turn).catch((error) => {
  memoryHealth.markFailed(error);

  logger.error(
    {
      errorCode:
        classifyDatabaseError(error),
      sessionId: turn.sessionId,
    },
    "NOVA_RECORD_TURN_FAILED",
  );
});
```

The readiness endpoint must then report degraded or failed memory state.

Unacceptable:

```ts
void recordTurn(turn).catch(() => {});
```

---

# 22. Deployment Verification

Before reporting an external deployment healthy:

```text
DATABASE_URL is not Replit Helium
+ DNS succeeds
+ connection succeeds
+ SELECT 1 succeeds
+ migrations are present
+ synthetic write succeeds
+ synthetic read succeeds
+ readiness endpoint passes
```

Application boot success is insufficient when database access is lazy.

Required distinction:

```text
PROCESS STARTED
≠
DATABASE CONNECTED
≠
PERSISTENCE WORKING
```

---

# 23. Required Tests

## URL Classification

```text
helium hostname
→ REPLIT_DEVELOPMENT

heliumdb database name
→ REPLIT_DEVELOPMENT

Neon hostname
→ NEON

Render hostname
→ RENDER

invalid URL
→ INVALID
```

## External Runtime Guard

```text
runtime=render
+ target=REPLIT_DEVELOPMENT
→ rejected
```

```text
runtime=replit
+ target=REPLIT_DEVELOPMENT
→ permitted
```

## Required Database Mode

```text
DATABASE_MODE=required
+ connection fails
→ readiness fails
```

## Optional Database Mode

```text
DATABASE_MODE=optional
+ connection fails
→ explicit degraded state
```

## Daemon Variable Selection

```text
SCRATCHPAD_DATABASE_URL missing
→ daemon fails closed
```

```text
DATABASE_URL contains Helium
+ daemon runs externally
→ no silent fallback
```

## Persistence

```text
recordTurn called
→ record observed in scratchpad_entries
```

## Error Visibility

```text
recordTurn fails
→ structured error emitted
→ health state changes
```

---

# 24. Release Gate

Before external deployment:

```text
external database selected
+ URL classified
+ Helium rejected for external runtime
+ credentials configured securely
+ connection probe passed
+ schema applied
+ write/read probe passed
+ application tests passed
```

After deployment:

```text
health/live passes
+ health/ready passes
+ synthetic Nova turn persists
+ memory digest reads it
+ daemon reaches same logical database
+ no repeated Drizzle connection errors
```

---

# 25. Prohibited Behavior

```text
Do not reuse Replit's Helium development DATABASE_URL externally.

Do not assume environment-variable names make database URLs portable.

Do not treat application boot as proof of database connectivity.

Do not silently ignore recordTurn failures.

Do not report memory persistence without querying persisted state.

Do not repeatedly change SSL settings when DNS cannot resolve the host.

Do not overwrite Replit's development DATABASE_URL merely to configure an
external production deployment.

Do not silently fall back from SCRATCHPAD_DATABASE_URL to DATABASE_URL.

Do not expose database credentials in logs.

Do not assume creating a new database migrates existing records.

Do not ask the operator for a database URL before checking accessible provider
resources and secret stores.

Do not report completion while database-backed functionality is degraded.
```

---

# 26. Final Invariant

```text
REPLIT DEVELOPMENT DATABASE_URL
=
REPLIT APP ONLY

EXTERNAL DEPLOYMENT
=
EXTERNALLY REACHABLE POSTGRESQL

NEW DATABASE
≠
MIGRATED DATA

APPLICATION BOOT
≠
DATABASE HEALTH

DATABASE CONNECTED
≠
NOVA MEMORY VERIFIED

DONE
=
CORRECT TARGET
+ REAL CONNECTION
+ SCHEMA
+ WRITE
+ READ
+ MEMORY LOOP
+ OBSERVED EVIDENCE
```

**END OF SPEC**

[1]: https://docs.replit.com/references/data-and-storage/sql-database "Replit Docs"
[2]: https://docs.replit.com/references/data-and-storage/production-databases "Replit Docs"
