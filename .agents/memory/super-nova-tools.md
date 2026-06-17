---
name: Super Nova tool registry
description: Durable gotchas for the Work Tree agentic tool layer (SSRF-safe fetch, multi-provider web search).
---

# Super Nova tool registry (scripts/super-nova-tools.mjs)

## SSRF-safe http_fetch must pin DNS at connect time
Do NOT rely on a pre-check + global `fetch()` for SSRF protection: `fetch`
(undici) re-resolves the hostname at connect time, so a domain can pass the
check as public and then rebind to a private/internal IP for the actual socket
(DNS rebinding / TOCTOU).
**How to apply:** build the request on `node:http`/`node:https` `.request()` and
pass a custom `lookup` option that re-validates every resolved address and only
returns the safe ones. The socket connects to exactly the address you validated.
Passing the URL object (hostname) keeps TLS SNI/cert validation intact — never
connect by raw IP, that breaks cert checks. Also stream-cap the response body
(`res.on('data')` → `req.destroy()` at the cap) rather than `await res.text()`,
which buffers an unbounded body before truncating.

## web_search: fall through providers, don't abort on first failure
Trying only the highest-precedence configured provider means one stale/invalid
key (e.g. Tavily returns 401) disables search entirely even when other valid
keys exist.
**How to apply:** iterate configured providers in order (Tavily → Brave →
Firecrawl); on any per-provider exception OR empty result, continue to the next;
only return an error when all configured providers fail. Firecrawl `/v1/search`
returns `{data:[]}` but v2 returns `{data:{web:[]}}` — parse both shapes.

## Dangerous tools gate
`run_python`/`run_node`/`shell`/`write_file`/`read_file` are gated behind
`SUPER_NOVA_EXEC`. With that on (full_open), the worker can run arbitrary code,
so the HTTP surface that feeds it must be authenticated.

The `/api/work-tree` API is PIN-gated (`work-tree-auth.ts`): `POST
/work-tree/unlock {pin}` sets an HMAC-signed (SESSION_SECRET) httpOnly cookie
valid 12h; every other work-tree route requires it via `requireWtAuth`. PIN
defaults to `22` (override `NOVA_WORK_TREE_PIN`) — weak by Robert's explicit
choice, so unlock has a per-IP brute-force lockout (8 fails → 10 min). Auth
fails closed: missing SESSION_SECRET in production refuses to sign/verify (no
predictable fallback secret).
