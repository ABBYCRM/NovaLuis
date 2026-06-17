---
name: Render Postgres connect
description: Connecting to a Render managed Postgres externally (SSL + IP allowlist) and the daemon wiring for Nova memory.
---

# Render managed Postgres

- Create via `POST /v1/postgres` (`plan: free` works once billing card is on the
  account). Free tier **expires ~30 days** after creation — upgrade the plan to
  make it permanent.
- `GET /v1/postgres/{id}/connection-info` returns both
  `internalConnectionString` (same-Render-network, no SSL/allowlist hassle) and
  `externalConnectionString`.
- **Same-network services should use the INTERNAL string** — set the web
  service's `DATABASE_URL` to it. No IP allowlist needed for internal.

## External connections (e.g. pushing schema or a daemon from outside Render)

- **IP allowlist defaults to `null` = blocks ALL external.** Symptom: TCP
  connects, then the SSL handshake is "Connection terminated unexpectedly".
  Fix: `PATCH /v1/postgres/{id}` with
  `ipAllowList: [{cidrBlock:"0.0.0.0/0",description:"..."}]`. Must stay open for
  any persistent external client (protected by password + SSL).
- **SSL is required** (`ssl=false` → error 28000 "SSL/TLS required").
- Newer `pg`/`pg-connection-string` treats `sslmode=require` as `verify-full`,
  which rejects Render's cert → terminated handshake. **Use
  `?sslmode=no-verify`** in the connection string (node-postgres honors it,
  sets `rejectUnauthorized:false`). drizzle-kit push and a plain `pg.Pool`
  both connect fine with `sslmode=no-verify` in the URL.

## Nova memory loop on Render

- Render app proxy reads/writes its own Render DB via INTERNAL `DATABASE_URL`
  (capture + `getMemoryDigest` injection, which reads ONLY `scratchpad_entries`).
- Distillation daemon runs on Replit (Render free tier has no background
  workers). It points at the live Render DB via `SCRATCHPAD_DATABASE_URL`
  (= Render EXTERNAL string + `?sslmode=no-verify`), which overrides
  `DATABASE_URL` in `scripts/scratchpad-daemon.mjs`. Requires the allowlist open.

**Why:** the allowlist-null + sslmode-verify-full combo silently kills external
connections and cost ~4 failed attempts to diagnose.
