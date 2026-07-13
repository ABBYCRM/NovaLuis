---
name: "Render Postgres connect"
description: "Use Render PostgreSQL internal and external URLs correctly, enforce explicit TLS policy, control external access, and verify the complete Nova memory loop."
---

# Render Managed PostgreSQL

## Connection classes

```text
SAME-REGION RENDER SERVICE
→ internalConnectionString

EXTERNAL CLIENT OR DAEMON
→ externalConnectionString
```

The Render application should use the internal URL when it and the database share the applicable private network. External clients must use the external URL.

## Free database lifecycle

Treat a free Render Postgres instance as temporary development storage. Track its creation and expiration dates, alert before expiration, and upgrade before irreplaceable data is lost.

Do not represent a free database as permanent or backed up unless independent backups are verified.

## Provisioning

```text
POST /v1/postgres
→ capture database ID
→ poll GET /v1/postgres/{id}
→ require status available
→ retrieve connection information
→ execute a real query
```

Creation acceptance is not connection readiness.

## External access

Inspect the database's actual `ipAllowList`; do not infer it from a generic handshake failure.

```text
specific CIDR
→ only matching external source addresses

[]
→ external access blocked

0.0.0.0/0
→ all external IPv4 sources allowed

null or omitted
→ unknown; inspect current resource state
```

Prefer a stable `/32` egress address. Use `0.0.0.0/0` only as a documented temporary exception or when the client cannot provide stable egress.

## TLS

External connections require TLS and the complete external hostname. Do not replace the hostname with a resolved IP because TLS SNI and hostname validation depend on it.

Default policy:

```text
PG_TLS_MODE=verify-full
```

`sslmode=no-verify` or `rejectUnauthorized: false` disables endpoint certificate verification. Permit it only behind an explicit exception after the exact certificate error, hostname, runtime CA store, and connection-string parsing have been inspected.

Never use:

```text
NODE_TLS_REJECT_UNAUTHORIZED=0
```

When supplying an explicit `pg` SSL object, remove `ssl`, `sslmode`, `sslcert`, `sslkey`, and `sslrootcert` URL parameters first so connection-string parsing does not replace the intended object.

## Nova wiring

Render API server:

```text
DATABASE_URL=<internal Render URL>
```

External scratchpad daemon:

```text
SCRATCHPAD_DATABASE_URL=<external Render URL>
```

The daemon must require `SCRATCHPAD_DATABASE_URL` and must not silently fall back to an unrelated `DATABASE_URL` unless an explicit compatibility flag authorizes it.

## Verification

Connectivity requires:

```text
URL parses
+
DNS resolves
+
TCP/TLS succeeds
+
authentication succeeds
+
SELECT 1 succeeds
```

Nova memory requires more:

1. submit a synthetic chat turn
2. verify one `scratchpad_entries` record
3. verify `getMemoryDigest` reads the intended data
4. run one distillation cycle
5. verify distilled output persists once
6. rerun and confirm idempotency

## Error classification

- internal hostname used externally → `WRONG_CONNECTION_CLASS`
- DNS or timeout → inspect target class, allowlist, firewall, and provider state
- explicit password rejection → `DATABASE_CREDENTIALS_REJECTED`
- certificate error → inspect hostname, CA trust, and SSL parser behavior before any no-verify exception
- missing tables or permissions after connection → `DATABASE_SCHEMA_OR_QUERY_FAILED`

## Final invariant

```text
RENDER APP
→ INTERNAL URL

EXTERNAL DAEMON
→ EXTERNAL URL

DONE
=
REAL CONNECTION
+
SCHEMA
+
WRITE
+
READ
+
DIGEST
+
DISTILLATION
+
IDEMPOTENCY
```
