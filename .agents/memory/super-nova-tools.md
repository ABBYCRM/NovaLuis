---
name: "Super Nova tool registry"
description: "Security and fallback rules for SSRF-safe HTTP fetch, multi-provider web search, dangerous execution tools, and Work Tree authentication."
---

# Super Nova Tool Registry

Registry implementation:

```text
scripts/super-nova-tools.mjs
```

## Global rule

Tool discovery is not authorization. Every invocation requires a registered tool, valid schema, mission capability, security policy, resource limits, and an audit record.

## SSRF-safe `http_fetch`

Do not perform a DNS pre-check followed by uncontrolled global `fetch()`. The HTTP client can resolve the hostname again at socket-connect time, creating a DNS-rebinding TOCTOU gap.

Required flow:

```text
canonicalize URL
→ allow only http/https
→ reject credentials and unsafe ports
→ node:http or node:https request
→ custom connect-time lookup
→ validate every A and AAAA answer
→ fail if any answer is non-public
→ preserve original hostname for Host, SNI, and certificate validation
→ verify connected peer IP
→ stream-cap body
→ enforce timeout
```

Reject loopback, private, link-local, metadata, carrier-grade NAT, multicast, unspecified, reserved, mapped-private IPv6, unique-local IPv6, and internal hostnames.

Every redirect is a new request and must repeat complete URL and DNS validation. Disable automatic redirect following. Reject redirect loops and HTTPS-to-HTTP downgrade by default.

Do not connect by raw IP for HTTPS; this breaks hostname-based TLS behavior.

Body limits must be enforced while streaming:

```text
res.on("data")
→ increment received bytes
→ destroy request when cap is exceeded
```

Do not call `res.text()` before limiting size.

Generic fetch must not accept agent-controlled `Authorization`, `Cookie`, `Host`, `Proxy-Authorization`, or forwarding headers, and must not silently inherit proxy environment variables.

## `web_search` fallthrough

Default order:

```text
Tavily
→ Brave
→ Firecrawl
```

For each configured provider:

- execute with a bounded timeout
- normalize results
- preserve provider provenance
- continue on provider exception
- continue on authentication failure
- continue on rate limit
- continue on malformed response
- continue on empty usable results

Return an error only after every configured provider is exhausted. A globally invalid canonical query or local policy denial stops before provider calls.

Firecrawl parser must support:

```text
current: payload.data.web
legacy:  payload.data
```

when the respective value is an array.

Read provider keys from `process.env` per call rather than capturing them once at module import.

## Dangerous tools

Dangerous tools:

```text
read_file
write_file
run_python
run_node
shell
```

Execution modes:

```text
SUPER_NOVA_EXEC=off
SUPER_NOVA_EXEC=read_only
SUPER_NOVA_EXEC=full_open
```

`SUPER_NOVA_EXEC` controls capability availability. It is not authentication.

Dangerous execution requires all of:

```text
valid Work Tree session
+
trusted request origin
+
active mission and task
+
explicit tool capability grant
+
execution mode
+
workspace/path scope
+
verified sandbox
+
CPU, memory, process, disk, output, and timeout limits
+
audit record
```

If sandbox creation or attestation fails, deny execution. Never fall back to host execution.

File tools must reject absolute paths, parent traversal, symlink escape, devices, sockets, pipes, secret paths, and repository metadata unless explicitly authorized.

## Work Tree authentication

Unlock endpoint:

```text
POST /api/work-tree/unlock
```

All other Work Tree routes require `requireWtAuth`.

Production requires a real `SESSION_SECRET`; missing signing configuration fails closed. Cookies must be HMAC-authenticated, HttpOnly, Secure in production, SameSite=Strict, scoped to `/api`, and bounded to 12 hours.

The compatibility PIN `22` must not activate silently in production. Require explicit configuration and an explicit weak-PIN override if that value is intentionally retained.

Brute-force policy:

```text
8 failures
→ 10-minute lockout
```

Use a trusted proxy-derived client IP. Multi-instance deployments require a shared lockout store.

Cookie-authenticated state-changing routes must validate the expected origin or use an equivalent CSRF control.

## Required tests

SSRF tests:

- loopback, private, link-local, metadata, IPv6 local, and unsupported protocols are denied
- mixed public/private DNS answers fail closed
- DNS rebinding between lookups cannot bypass connect-time validation
- redirects to internal targets are denied
- oversized chunked bodies are terminated
- timeouts and peer-IP mismatch are enforced

Search tests:

- Tavily failure or empty result falls through to Brave
- Brave failure or empty result falls through to Firecrawl
- Firecrawl current and legacy response shapes parse
- all-provider exhaustion returns an attempt ledger

Authorization tests:

- unauthenticated Work Tree routes are denied
- tampered and expired cookies are denied
- missing production secret fails closed
- public chat remains public
- authenticated requests without capability grants cannot execute dangerous tools
- sandbox failure denies execution

## Final invariant

```text
HTTP FETCH
=
CONNECT-TIME DNS PINNING
+
REDIRECT REVALIDATION
+
STREAM LIMITS

WEB SEARCH
=
PROVIDER FALLTHROUGH

DANGEROUS TOOL
=
AUTH
+
CAPABILITY
+
SANDBOX
+
LIMITS
+
EVIDENCE
```
