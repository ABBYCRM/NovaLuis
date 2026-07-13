Key corrections:

* Render’s external Postgres access currently defaults to `0.0.0.0/0`, **not `null`**. An empty allowlist blocks external access; `null` should be treated as unknown state, not automatically “deny all.” ([Render][1])
* Free Render Postgres expires **30 days after creation**, followed by a **14-day paid-upgrade grace period** before deletion. ([Render][2])
* Current `pg-connection-string` treats `sslmode=require`, `prefer`, and `verify-ca` as aliases for `verify-full` unless libpq compatibility is enabled. `sslmode=no-verify` disables certificate validation and must be an explicit fallback, not the default. ([GitHub][3])

---

name: "Render Postgres connect"
description: >-
Create and connect to Render managed PostgreSQL using internal and external
connection strings, controlled external access, verified TLS, and correct
Nova memory-daemon environment wiring.
--------------------------------------

# Render Managed PostgreSQL

## Scope

This skill governs:

* Creating Render Postgres through the REST API
* Monitoring database provisioning
* Retrieving connection information securely
* Selecting internal versus external connection strings
* Configuring external inbound IP rules
* Enforcing TLS correctly
* Wiring Nova’s application and scratchpad daemon
* Verifying schema, reads, writes, capture, digest injection, and distillation
* Handling free-database expiration
* Preventing credentials from entering logs or source control

---

# 1. Core Architecture

Render supplies separate connection classes:

```text
INTERNAL CONNECTION STRING
→ Render services in the same account and region

EXTERNAL CONNECTION STRING
→ Replit, local machines, Fly.io, CI, database tools,
  and any process outside the applicable Render private network
```

Required rule:

```text
SAME-REGION RENDER APPLICATION
→ internalConnectionString

EXTERNAL DAEMON OR ADMINISTRATION CLIENT
→ externalConnectionString
```

Never provide a Render internal hostname to an external process.

Render documents that the internal URL is intended for Render services in the same account and region, while everything else must use the external URL. ([Render][1])

---

# 2. Free Database Lifecycle

A Render Postgres database on the Free instance type:

* Has a fixed 1 GB storage limit
* Expires 30 days after creation
* Becomes inaccessible when expired
* Has a 14-day grace period for upgrading
* Is deleted with its data after the grace period
* Does not include managed backups
* Does not include managed connection pooling

Therefore:

```text
FREE POSTGRES
=
TEMPORARY DEVELOPMENT DATABASE
```

It must not be treated as permanent production storage.

Required lifecycle fields:

```ts
interface DatabaseLifecycle {
  createdAt: string;
  expiresAt?: string;
  plan: string;
  status: string;
}
```

Required production rule:

```text
IF database stores irreplaceable Nova memory
AND plan = free
→ upgrade before expiresAt
```

Create alerts at:

```text
14 days before expiration
7 days before expiration
3 days before expiration
1 day before expiration
```

Render currently documents a 30-day lifetime and a 14-day post-expiration upgrade grace period for Free Postgres. ([Render][2])

---

# 3. Creating PostgreSQL Through the API

Endpoint:

```http
POST /v1/postgres
```

Authentication:

```http
Authorization: Bearer <RENDER_API_KEY>
Content-Type: application/json
Accept: application/json
```

Required fields include:

```text
name
ownerId
plan
version
```

Supported plans currently include:

```text
free
starter
standard
pro
pro_plus
custom
```

along with current flexible-instance plan identifiers.

Render’s API currently lists `free` as a valid Postgres plan. ([Render API][4])

---

## Example Creation Body

```json
{
  "name": "nova-memory",
  "ownerId": "tea-REPLACE_WITH_WORKSPACE_ID",
  "plan": "free",
  "region": "virginia",
  "version": "16",
  "ipAllowList": [
    {
      "cidrBlock": "203.0.113.10/32",
      "description": "Authorized external daemon"
    }
  ]
}
```

Use an actual caller egress address rather than the documentation address above.

Do not include:

* Database passwords
* Connection strings
* Application API keys
* Secrets unrelated to database creation

---

## Billing Rule

Do not encode this as a universal platform claim:

```text
A payment card is always required to create Free Render Postgres.
```

The current Postgres-create API reference documents `201`, `400`, `401`, `404`, `429`, `500`, and `503`; it does not currently list `402` for this endpoint. ([Render API][4])

If the actual account returns:

```text
HTTP 402
Payment information is required
```

classify it as:

```text
VERIFIED_BILLING_PREREQUISITE
```

Required behavior:

```text
preserve the observed response
→ stop unchanged retries
→ require account billing action
→ retry only after account state changes
```

Do not mutate valid database configuration repeatedly in an attempt to bypass an explicit billing gate.

---

# 4. Provisioning Verification

An HTTP `201` response proves creation was accepted.

It does not prove the database is ready.

Required workflow:

```text
POST /v1/postgres
→ capture database ID
→ poll GET /v1/postgres/{id}
→ wait for status = available
→ retrieve connection information
→ perform database query
```

Known status classes include:

```text
creating
available
unavailable
config_restart
suspended
maintenance_scheduled
maintenance_in_progress
recovery_failed
recovery_in_progress
updating_instance
unknown
```

Only this status is connection-ready:

```text
available
```

Unknown statuses must never be interpreted as success.

---

# 5. Retrieving Connection Information

Endpoint:

```http
GET /v1/postgres/{postgresId}/connection-info
```

The response includes sensitive values such as:

```ts
interface RenderPostgresConnectionInfo {
  password: string;
  internalConnectionString: string;
  externalConnectionString: string;
  internalConnectionPoolString?: string;
  externalConnectionPoolString?: string;
  psqlCommand: string;
}
```

The current Render OpenAPI schema requires both `internalConnectionString` and `externalConnectionString`. ([Render API][5])

---

## Secret Handling

Connection information must never be:

* Printed in complete form
* Written to repository files
* Added to Markdown
* Stored in agent memory
* Included in command transcripts
* Exposed in screenshots
* Returned through public API routes
* Included in exception messages

Safe inspection:

```ts
function summarizeDatabaseUrl(raw: string) {
  const url = new URL(raw);

  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
    usernamePresent: Boolean(url.username),
    passwordPresent: Boolean(url.password),
  };
}
```

Never return `url.password`.

---

# 6. Internal Connection Wiring

Nova’s Render-hosted application should use:

```text
DATABASE_URL=<internalConnectionString>
```

Use the internal connection string when:

* The application runs on Render
* The database runs under the same Render account
* Both resources are in the same region
* The application can access Render’s private network

Benefits:

* Lower latency
* No public Internet path
* No external database allowlist dependency
* Reduced public attack surface

Render recommends using the internal URL wherever possible. ([Render][1])

---

## Internal Application Configuration

```ts
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_REQUIRED");
}

export const appPool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
```

Do not append external-only TLS workarounds automatically to the internal URL.

---

# 7. External Connection Wiring

The Replit scratchpad daemon must use:

```text
SCRATCHPAD_DATABASE_URL=<externalConnectionString>
```

Required daemon precedence:

```ts
const scratchpadDatabaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL;

if (!scratchpadDatabaseUrl) {
  throw new Error(
    "SCRATCHPAD_DATABASE_URL_REQUIRED_FOR_EXTERNAL_DAEMON",
  );
}
```

Do not silently fall back to `DATABASE_URL` in an external runtime.

A silent fallback can accidentally select:

* A Replit Helium URL
* A Render internal hostname
* A development database
* A stale database
* The wrong Nova environment

A fallback may exist only behind an explicit compatibility flag:

```ts
const databaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL ??
  (
    process.env.ALLOW_DATABASE_URL_FALLBACK === "true"
      ? process.env.DATABASE_URL
      : undefined
  );

if (!databaseUrl) {
  throw new Error("SCRATCHPAD_DATABASE_URL_REQUIRED");
}
```

Default:

```text
ALLOW_DATABASE_URL_FALLBACK=false
```

---

# 8. External IP Rules

## Correct Default

Render currently documents that Postgres external access defaults to:

```text
0.0.0.0/0
```

This permits external IPv4 connections from any source that has valid database credentials.

It does not default to `null = deny all`. ([Render][1])

---

## Allowlist State Semantics

```text
ipAllowList contains 0.0.0.0/0
→ all external IPv4 addresses allowed

ipAllowList contains specific CIDRs
→ only matching external addresses allowed

ipAllowList is []
→ external connections blocked

ipAllowList is null or absent
→ UNKNOWN; inspect current resource state and do not guess
```

A `null` response may indicate omitted data, legacy behavior, deserialization behavior, or an incomplete response.

It must not automatically be interpreted as either open or closed.

---

## Preferred Policy

Use the narrowest practical CIDR:

```json
{
  "ipAllowList": [
    {
      "cidrBlock": "198.51.100.27/32",
      "description": "Nova scratchpad daemon"
    }
  ]
}
```

A `/32` permits one IPv4 address.

---

## Broad Access

This configuration permits all external IPv4 sources:

```json
{
  "ipAllowList": [
    {
      "cidrBlock": "0.0.0.0/0",
      "description": "Temporary external connectivity diagnostic"
    }
  ]
}
```

Use it only as:

* A temporary diagnostic measure
* A documented compatibility exception
* A last resort for a client without stable egress IPs

Required controls when broad access remains enabled:

* Strong unique password
* TLS
* Least-privilege database role
* Credential rotation
* Connection monitoring
* Query auditing where available
* No public exposure of the connection string

Password plus TLS does not make universal network exposure equivalent to a narrow allowlist.

---

# 9. Updating External Access

Endpoint:

```http
PATCH /v1/postgres/{postgresId}
```

Example:

```json
{
  "ipAllowList": [
    {
      "cidrBlock": "198.51.100.27/32",
      "description": "Nova distillation daemon"
    }
  ]
}
```

Before changing the rules:

1. Retrieve the current Postgres resource.
2. Save the existing allowlist as evidence.
3. Determine the external client’s actual egress IP.
4. Apply the smallest required CIDR.
5. Retrieve the resource again.
6. Confirm the stored rules match the request.
7. Test a real database connection.
8. Remove temporary broad rules.

Do not assume that a successful PATCH immediately proves connectivity.

---

# 10. TLS Requirements

External Render Postgres connections are encrypted using Render-managed TLS certificates. Clients should connect using the complete external hostname, not a previously resolved IP address, because hostname and SNI information matter. ([Render][1])

Required rule:

```text
EXTERNAL CONNECTION
→ TLS REQUIRED
→ FULL EXTERNAL HOSTNAME REQUIRED
→ CERTIFICATE VERIFICATION PREFERRED
```

Never replace the hostname with its resolved IP.

That can cause:

```text
FATAL: No SNI information found
```

---

# 11. `node-postgres` SSL Semantics

Current `pg-connection-string` behavior is important:

```text
sslmode=prefer
sslmode=require
sslmode=verify-ca
```

are currently treated as aliases for:

```text
sslmode=verify-full
```

unless libpq-compatible mode is explicitly enabled.

The package warns that this behavior is expected to change in the next major version. `sslmode=no-verify` maps to:

```ts
ssl: {
  rejectUnauthorized: false
}
```

([GitHub][3])

Therefore, avoid ambiguous SSL configuration.

---

# 12. Preferred TLS Configuration

## Option A — Explicit URL Mode

Use:

```text
?sslmode=verify-full
```

Example form:

```text
postgresql://USER:PASSWORD@EXTERNAL_HOST:5432/DATABASE?sslmode=verify-full
```

This is the preferred explicit URL mode when the runtime trust store validates Render’s certificate.

---

## Option B — Explicit `pg.Pool` SSL Object

Remove SSL query parameters before supplying an SSL object:

```ts
import { Pool, type PoolConfig } from "pg";

function createVerifiedExternalPool(
  rawConnectionString: string,
): Pool {
  const url = new URL(rawConnectionString);

  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
  ]) {
    url.searchParams.delete(key);
  }

  const config: PoolConfig = {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
    },
    max: 5,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
  };

  return new Pool(config);
}
```

`node-postgres` warns that SSL parameters in a connection string replace an explicitly supplied `ssl` object. Do not combine both configuration methods accidentally. ([node-postgres.com][6])

---

# 13. `sslmode=no-verify` Exception

This mode:

```text
?sslmode=no-verify
```

disables certificate verification.

It encrypts traffic but does not securely authenticate the database endpoint.

It must not be the default configuration.

Use it only when all of the following are true:

```text
full external hostname is being used
AND
DNS resolution succeeds
AND
network access is authorized
AND
the exact certificate-verification error was observed
AND
the runtime CA trust store was inspected
AND
a verified mode cannot currently connect
AND
the exception is explicitly enabled
```

Required flag:

```text
PG_TLS_MODE=no-verify
```

Required warning:

```text
DATABASE_TLS_CERTIFICATE_VERIFICATION_DISABLED
```

Recommended implementation:

```ts
import { Pool } from "pg";

type TlsMode =
  | "verify-full"
  | "no-verify";

function createExternalPool(
  rawConnectionString: string,
): Pool {
  const tlsMode =
    (process.env.PG_TLS_MODE ?? "verify-full") as TlsMode;

  if (
    tlsMode !== "verify-full" &&
    tlsMode !== "no-verify"
  ) {
    throw new Error(
      `INVALID_PG_TLS_MODE:${tlsMode}`,
    );
  }

  const url = new URL(rawConnectionString);

  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
  ]) {
    url.searchParams.delete(key);
  }

  if (tlsMode === "no-verify") {
    console.warn(
      "DATABASE_TLS_CERTIFICATE_VERIFICATION_DISABLED",
    );
  }

  return new Pool({
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized:
        tlsMode === "verify-full",
    },
    max: 5,
    connectionTimeoutMillis: 15_000,
  });
}
```

---

# 14. Do Not Hardcode TLS Workarounds

Forbidden:

```ts
ssl: {
  rejectUnauthorized: false,
}
```

without an explicit compatibility mode.

Also forbidden:

```text
NODE_TLS_REJECT_UNAUTHORIZED=0
```

That environment variable can disable TLS verification beyond PostgreSQL and weaken unrelated HTTPS connections.

---

# 15. Nova Memory Architecture

Required data path:

```text
Nova chat request
→ Render API server
→ DATABASE_URL
→ Render internal Postgres
→ scratchpad_entries capture
```

Digest path:

```text
new Nova chat turn
→ getMemoryDigest(...)
→ query intended memory tables
→ inject bounded memory context
```

Distillation path:

```text
Replit daemon
→ SCRATCHPAD_DATABASE_URL
→ Render external Postgres
→ read eligible scratchpad entries
→ distill
→ write verified distilled state
```

The Render web application and the Replit daemon must point to the same logical database when they are intended to participate in one memory loop.

---

# 16. Table-Scope Invariant

The statement:

```text
getMemoryDigest reads only scratchpad_entries
```

is a project-specific implementation claim.

It must be enforced by code and tests, not documentation alone.

Required test:

```ts
it(
  "getMemoryDigest reads only approved memory tables",
  async () => {
    // Seed scratchpad_entries and an unrelated private table.
    // Execute getMemoryDigest.
    // Verify only approved memory content appears.
  },
);
```

Required database-role rule:

```text
Nova memory reader
→ SELECT only on required memory tables

Nova capture writer
→ INSERT only on required capture tables

Distillation daemon
→ required SELECT/INSERT/UPDATE only
```

Avoid granting the daemon ownership of the complete database when narrower privileges are practical.

---

# 17. Daemon Reliability

A free Render web service is not a reliable always-on background daemon:

* It can spin down after inactivity
* It can restart
* It lacks a free background-worker instance type
* Its local filesystem is ephemeral

The distillation daemon may run externally, but its availability must be monitored.

Required daemon controls:

```text
singleton lock
bounded batch size
idempotency key
processed-state marker
heartbeat
retry budget
graceful shutdown
duplicate-work prevention
last-success timestamp
```

---

# 18. Daemon Connection Code

```js
// scripts/scratchpad-daemon.mjs

import pg from "pg";

const { Pool } = pg;

const rawDatabaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error(
    "SCRATCHPAD_DATABASE_URL_REQUIRED",
  );
}

const tlsMode =
  process.env.PG_TLS_MODE ?? "verify-full";

if (
  tlsMode !== "verify-full" &&
  tlsMode !== "no-verify"
) {
  throw new Error(
    `INVALID_PG_TLS_MODE:${tlsMode}`,
  );
}

const url = new URL(rawDatabaseUrl);

for (const key of [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
]) {
  url.searchParams.delete(key);
}

if (tlsMode === "no-verify") {
  console.warn(
    "DATABASE_TLS_CERTIFICATE_VERIFICATION_DISABLED",
  );
}

const pool = new Pool({
  connectionString: url.toString(),

  ssl: {
    rejectUnauthorized:
      tlsMode === "verify-full",
  },

  max: 3,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
  application_name: "nova-scratchpad-daemon",
});

const client = await pool.connect();

try {
  const result = await client.query(
    "SELECT 1 AS connected",
  );

  if (result.rows[0]?.connected !== 1) {
    throw new Error(
      "DATABASE_CONNECTIVITY_PROBE_FAILED",
    );
  }
} finally {
  client.release();
}
```

Do not log the connection string.

---

# 19. Schema Deployment

Before applying schema changes externally:

```text
verify target hostname
→ verify target database name
→ verify migration environment
→ run read-only connectivity test
→ inspect current schema
→ generate migration plan
→ apply migration
→ inspect resulting schema
```

Do not run destructive schema operations based only on the presence of a variable named `DATABASE_URL`.

Required target summary:

```ts
function databaseTargetSummary(raw: string) {
  const url = new URL(raw);

  return {
    hostname: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
    sslMode:
      url.searchParams.get("sslmode") ??
      process.env.PG_TLS_MODE ??
      "unspecified",
  };
}
```

Require explicit confirmation in automation for destructive migrations.

---

# 20. Connection Verification

A connection string is verified only when:

```text
URL parses
AND
DNS resolves
AND
TCP connects
AND
TLS succeeds
AND
authentication succeeds
AND
SELECT 1 succeeds
```

Verification script:

```js
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.SCRATCHPAD_DATABASE_URL,
});

try {
  const result = await pool.query(
    `
      SELECT
        current_database() AS database,
        current_user AS username,
        inet_server_addr() AS server_address,
        version() AS version
    `,
  );

  console.log({
    database: result.rows[0].database,
    username: result.rows[0].username,
    serverAddressPresent:
      Boolean(result.rows[0].server_address),
    versionPresent:
      Boolean(result.rows[0].version),
  });
} finally {
  await pool.end();
}
```

Do not print credentials.

---

# 21. Read-and-Write Verification

After `SELECT 1`, verify intended mutation behavior inside a transaction:

```sql
BEGIN;

CREATE TEMP TABLE nova_connectivity_probe (
  id integer PRIMARY KEY,
  value text NOT NULL
);

INSERT INTO nova_connectivity_probe (id, value)
VALUES (1, 'verified');

SELECT value
FROM nova_connectivity_probe
WHERE id = 1;

ROLLBACK;
```

This proves:

* Session creation
* SQL execution
* Temporary write ability
* Read-back ability
* Transaction behavior

It does not modify persistent application tables.

---

# 22. Nova End-to-End Memory Verification

Database connectivity alone is insufficient.

Required release verification:

```text
1. Submit a synthetic Nova chat turn.
2. Confirm a new scratchpad_entries record exists.
3. Confirm the record belongs to the correct session or workspace.
4. Execute getMemoryDigest.
5. Confirm the bounded expected memory appears.
6. Run one daemon distillation cycle.
7. Confirm the source record is marked or associated correctly.
8. Confirm the distilled output is persisted once.
9. Rerun the same cycle.
10. Confirm no duplicate distilled record is created.
```

Required verdict:

```text
DATABASE_CONNECTED
+
CAPTURE_VERIFIED
+
DIGEST_VERIFIED
+
DISTILLATION_VERIFIED
+
IDEMPOTENCY_VERIFIED
```

Only then is the Nova memory loop verified.

---

# 23. Failure Classification

## Internal hostname used externally

Examples:

```text
ENOTFOUND
getaddrinfo failed
host not known
```

Classification:

```text
WRONG_CONNECTION_CLASS
```

Correction:

```text
Use externalConnectionString.
```

---

## External network denied

Examples:

```text
connection timed out
connection reset
connection terminated unexpectedly
```

Possible classification:

```text
NETWORK_ACCESS_OR_TLS_FAILURE
```

Required observation:

* Current `ipAllowList`
* Client egress IP
* DNS resolution
* TCP result
* TLS error details

Do not diagnose the allowlist from a generic termination message alone.

---

## Missing TLS

Examples:

```text
SSL/TLS required
server does not support an unencrypted connection
```

Classification:

```text
TLS_REQUIRED
```

Correction:

```text
Enable TLS explicitly.
```

---

## Certificate verification failure

Examples:

```text
SELF_SIGNED_CERT_IN_CHAIN
UNABLE_TO_VERIFY_LEAF_SIGNATURE
CERT_HAS_EXPIRED
ERR_TLS_CERT_ALTNAME_INVALID
```

Classification:

```text
TLS_CERTIFICATE_VALIDATION_FAILED
```

Required correction order:

```text
verify full hostname
→ inspect runtime CA bundle
→ inspect connection-string SSL parameters
→ inspect pg version and parser behavior
→ retry verified TLS
→ use no-verify only as documented exception
```

---

## No SNI information

Classification:

```text
DATABASE_HOSTNAME_OR_SNI_ERROR
```

Correction:

```text
Use the complete external Render hostname,
not a resolved IP address.
```

---

## Authentication failure

Examples:

```text
password authentication failed
28P01
```

Classification:

```text
DATABASE_CREDENTIALS_REJECTED
```

Do not modify the allowlist when authentication was reached and explicitly rejected.

---

## Expired Free database

Classification:

```text
DATABASE_EXPIRED
```

Correction:

```text
upgrade during grace period
or
restore from an independent export if available
```

Free Render Postgres does not include managed backups, so independent exports are required for recoverability. ([Render][2])

---

# 24. Required Environment Layout

## Render API Server

```text
DATABASE_URL
=
Render internal connection string
```

## Replit Distillation Daemon

```text
SCRATCHPAD_DATABASE_URL
=
Render external connection string
```

Optional explicit TLS control:

```text
PG_TLS_MODE=verify-full
```

Temporary exception:

```text
PG_TLS_MODE=no-verify
```

Never place raw values in:

* `render.yaml`
* `.replit`
* Git-tracked `.env` files
* `README.md`
* `AI_NOTES.md`
* Build scripts
* Test fixtures

---

# 25. Required Tests

Tests must prove:

```text
Render application uses DATABASE_URL.

Scratchpad daemon requires SCRATCHPAD_DATABASE_URL.

Daemon does not silently choose an internal Render hostname.

TLS defaults to verify-full.

No-verify requires an explicit mode.

SSL query parameters do not silently overwrite intended SSL configuration.

Connection errors redact passwords.

getMemoryDigest uses only approved memory data.

Capture inserts the expected scratchpad entry.

Distillation is idempotent.

Missing database variables fail closed.

Free-database expiration is surfaced before loss.
```

---

# 26. Release Gate

Before deployment:

```text
database status = available
+ internal URL configured on Render service
+ external URL configured on daemon
+ external IP policy inspected
+ TLS mode explicit
+ SELECT 1 passes from Render
+ SELECT 1 passes from external daemon
+ schema exists
+ capture test passes
+ digest test passes
+ distillation test passes
+ duplicate prevention passes
```

After deployment:

```text
Render service health passes
+ database capture observed
+ digest injection observed
+ daemon heartbeat observed
+ daemon writes observed
```

---

# 27. Prohibited Behavior

```text
Do not assume ipAllowList defaults to null.

Do not assume null means deny all.

Do not leave 0.0.0.0/0 enabled without documenting the exposure.

Do not use an internal Render URL outside Render.

Do not use the database server IP instead of its hostname.

Do not disable TLS.

Do not use sslmode=no-verify as the default.

Do not use NODE_TLS_REJECT_UNAUTHORIZED=0.

Do not combine sslmode in the URL with an ssl object without understanding
that node-postgres can replace the object.

Do not log connection strings.

Do not silently fall back from SCRATCHPAD_DATABASE_URL to DATABASE_URL.

Do not treat SELECT 1 as proof that the complete Nova memory loop works.

Do not treat a Free database as permanent storage.

Do not report completion without external and application-level verification.
```

---

# 28. Final Invariant

```text
RENDER APPLICATION
→ INTERNAL DATABASE URL

EXTERNAL DAEMON
→ EXTERNAL DATABASE URL

EXTERNAL DATABASE ACCESS
→ ACTUAL ALLOWLIST INSPECTED
+ TLS
+ FULL HOSTNAME
+ SUCCESSFUL QUERY

TLS DEFAULT
→ VERIFY CERTIFICATE

NO-VERIFY
→ EXPLICIT TEMPORARY EXCEPTION

FREE POSTGRES
→ EXPIRES AFTER 30 DAYS

NOVA MEMORY VERIFIED
→ CAPTURE
+ DIGEST
+ DISTILLATION
+ IDEMPOTENCY
+ REAL DATABASE EVIDENCE
```

**END OF SPEC**

[1]: https://render.com/docs/postgresql-creating-connecting "Create and Connect to Render Postgres – Render Docs"
[2]: https://render.com/docs/free "Deploy for Free – Render Docs"
[3]: https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/index.js "node-postgres/packages/pg-connection-string/index.js at master · brianc/node-postgres · GitHub"
[4]: https://api-docs.render.com/reference/create-postgres "Create Postgres instance"
[5]: https://api-docs.render.com/v1.0/openapi/render-public-api-1.json "api-docs.render.com"
[6]: https://node-postgres.com/features/ssl "GitHub"
