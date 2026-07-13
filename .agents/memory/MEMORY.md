---

name: ABBYCLAW runtime integration links
description: Verified operational rules for GitHub authentication, Render deployment, cross-platform PostgreSQL, state stripping, SSRF-safe tools, API authorization, and provider-aware model routing.
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# ABBYCLAW Runtime Integration Links

These links record operational findings without converting environment-specific observations into universal platform claims.

Each link defines:

* Corrected architectural truth
* Runtime behavior
* Failure classification
* Required implementation
* Verification criteria
* Prohibited shortcuts

---

# LINK 1 — GitHub PAT Git Push

## Corrected truth

Do not encode the following as a universal rule:

```text
Classic PATs cannot authenticate Git operations through an Authorization header.
```

The observed `http.extraHeader` failure is valid evidence for the specific environment and invocation that produced it, but it does not prove that every GitHub classic-PAT bearer-header flow is universally rejected.

GitHub’s documented HTTPS flow is to provide a personal access token as the Git password. GitHub recommends GitHub CLI or Git Credential Manager for secure credential handling. ([GitHub Docs][1])

---

## Required rule

```text
PAT authentication for Git-over-HTTPS
=
clean repository URL
+ Git credential interface
+ token supplied as password
+ no token persistence
+ verified remote SHA
```

---

## Preferred authentication order

```text
1. GitHub CLI credential helper
2. Git Credential Manager
3. Ephemeral GIT_ASKPASS
4. Token-in-URL only as a prohibited legacy fallback
```

---

## Secure noninteractive push

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_OWNER:?GITHUB_OWNER is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"

git check-ref-format --branch "$TARGET_BRANCH" >/dev/null

REMOTE_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.git"
ASKPASS="$(mktemp)"

cleanup() {
  rm -f "$ASKPASS"
}

trap cleanup EXIT HUP INT TERM
chmod 700 "$ASKPASS"

cat >"$ASKPASS" <<'EOF'
#!/bin/sh

case "$1" in
  *Username*|*username*)
    printf '%s\n' 'x-access-token'
    ;;
  *Password*|*password*)
    printf '%s\n' "${GITHUB_TOKEN:?GITHUB_TOKEN is missing}"
    ;;
  *)
    exit 1
    ;;
esac
EOF

export GIT_ASKPASS="$ASKPASS"
export GIT_TERMINAL_PROMPT=0

set +x

git \
  -c credential.helper= \
  -c core.askPass="$ASKPASS" \
  push \
  "$REMOTE_URL" \
  "HEAD:refs/heads/${TARGET_BRANCH}"
```

---

## Branch rule

Default:

```text
PUSH TO A NEW BRANCH
```

Preferred source ref:

```text
HEAD:refs/heads/<target-branch>
```

Do not assume the checked-out source branch is named `main`.

---

## Divergence rule

When the remote branch already exists:

```text
FETCH
→ COMPARE SHAS
→ REQUIRE FAST-FORWARD
→ ABORT ON DIVERGENCE
```

Never convert a normal push failure into an automatic force push.

---

## Verification

A push is verified only when:

```text
git push exit code = 0
AND
remote branch exists
AND
remote branch SHA = intended local SHA
```

Example:

```bash
LOCAL_SHA="$(git rev-parse HEAD)"

REMOTE_SHA="$(
  git \
    -c credential.helper= \
    -c core.askPass="$ASKPASS" \
    ls-remote \
    "$REMOTE_URL" \
    "refs/heads/${TARGET_BRANCH}" |
  awk '{print $1}'
)"

test "$LOCAL_SHA" = "$REMOTE_SHA"
```

---

## Prohibited behavior

```text
PAT embedded in remote URL
PAT stored in .git/config
PAT printed to logs
PAT exposed through shell tracing
regex redaction used as the primary secret control
automatic force push
push success claimed without remote verification
```

---

# LINK 2 — Render API Service Creation and Deployment

## Corrected truth

Service creation and service deployment are separate operations.

### Create service

```http
POST /v1/services
```

### Deploy existing service

```http
POST /v1/services/{serviceId}/deploys
```

Render documents `402 Payment Required` as a possible response from the service-creation endpoint when payment information is required for that request. This should be treated as a billing prerequisite, not as malformed JSON, invalid authentication, or a transient deployment failure. ([Render API][2])

Do not state that every Render free service universally requires a card. Render also documents free deployment flows that do not require payment information. The correct conclusion is:

```text
This workspace/account received a 402 billing prerequisite
for this API service-creation request.
```

That is an observed account-level condition, not a universal free-plan law. ([Render][3])

---

## Required failure classification

```ts
type RenderCreateFailure =
  | "INVALID_REQUEST"
  | "AUTHENTICATION_FAILED"
  | "BILLING_PREREQUISITE"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_FAILURE";
```

Mapping:

```text
400 → INVALID_REQUEST
401 → AUTHENTICATION_FAILED
402 → BILLING_PREREQUISITE
404 → RESOURCE_NOT_FOUND
409 → CONFLICT
429 → RATE_LIMITED
5xx → PROVIDER_FAILURE
```

A `402` must not trigger repeated payload mutations.

---

## Documented web-service request shape

Render requires top-level `type`, `name`, and `ownerId`. A web service additionally requires `serviceDetails.runtime`. Native runtimes use `envSpecificDetails.buildCommand` and `envSpecificDetails.startCommand`. Render currently supports `free` as a web-service plan value. ([Render API][4])

```json
{
  "type": "web_service",
  "name": "super-nova",
  "ownerId": "tea-WORKSPACE_ID",
  "repo": "https://github.com/OWNER/REPOSITORY",
  "branch": "main",
  "autoDeploy": "no",
  "rootDir": "",
  "envVars": [
    {
      "key": "NODE_ENV",
      "value": "production"
    }
  ],
  "serviceDetails": {
    "runtime": "node",
    "plan": "free",
    "region": "virginia",
    "numInstances": 1,
    "healthCheckPath": "/health",
    "envSpecificDetails": {
      "buildCommand": "npm ci && npm run build",
      "startCommand": "npm run start"
    }
  }
}
```

Do not claim this exact body previously succeeded unless the corresponding HTTP `201` response is preserved in evidence.

---

## Docker service shape

```json
{
  "type": "web_service",
  "name": "super-nova",
  "ownerId": "tea-WORKSPACE_ID",
  "repo": "https://github.com/OWNER/REPOSITORY",
  "branch": "main",
  "autoDeploy": "no",
  "serviceDetails": {
    "runtime": "docker",
    "plan": "free",
    "region": "virginia",
    "healthCheckPath": "/health",
    "envSpecificDetails": {
      "dockerContext": ".",
      "dockerfilePath": "./Dockerfile"
    }
  }
}
```

---

## Existing-service deployment

```http
POST /v1/services/{serviceId}/deploys
Authorization: Bearer <RENDER_API_KEY>
Content-Type: application/json
```

```json
{
  "clearCache": "do_not_clear"
}
```

Optional specific-commit deployment:

```json
{
  "commitId": "FULL_GIT_SHA",
  "clearCache": "do_not_clear"
}
```

Render documents `201` or `202` as accepted deploy responses. Neither response alone proves that the service eventually became live; deploy status must still be polled. ([Render API][5])

---

## Verification state machine

```text
CREATE REQUEST ACCEPTED
≠
DEPLOYMENT LIVE
```

Required verification:

```text
service create HTTP 201
→ service ID captured
→ deploy ID captured
→ deploy status polled
→ terminal status reached
→ service health endpoint checked
```

Accepted terminal success:

```text
deploy.status = live
AND
health endpoint returns expected response
```

Terminal failure examples:

```text
build_failed
update_failed
pre_deploy_failed
canceled
```

---

# LINK 3 — Replit Database External Reachability

## Corrected truth

A Replit Helium development `DATABASE_URL` is app-scoped.

It must not be treated as a conventional public PostgreSQL URL that can be copied into Render, Fly.io, a local database viewer, or another Replit App.

Replit explicitly states that the development `DATABASE_URL` is scoped to the app and cannot be accessed by other apps or external database viewers. Helium runs on Replit infrastructure and the app’s `DATABASE_URL` is automatically updated to use it. ([Replit Docs][6])

---

## Runtime rule

```text
Replit Helium DATABASE_URL
=
Replit-app-local database capability
```

It is not:

```text
portable external PostgreSQL infrastructure
```

---

## Invalid architecture

```text
Render service
→ Replit Helium DATABASE_URL
→ expected external PostgreSQL access
```

Expected result:

```text
DNS failure
network rejection
scope rejection
or unreachable host
```

Do not waste retries changing:

* SSL modes
* PostgreSQL drivers
* Connection-pool settings
* Password encoding
* DNS libraries

when the actual problem is platform reachability.

---

## Required architecture

For shared access across Replit, Render, Fly.io, local workers, or other providers:

```text
Externally reachable PostgreSQL
       ↑
       ├── Render application
       ├── Replit daemon
       ├── Fly.io worker
       └── authorized administration client
```

Suitable architecture:

```text
external managed PostgreSQL
+ TLS
+ scoped credentials
+ network allowlist
+ separate environment variables
```

---

## Environment-variable separation

Inside the main application:

```text
DATABASE_URL
```

For the Replit scratchpad or daemon:

```text
SCRATCHPAD_DATABASE_URL
```

Do not overwrite the Replit application’s platform-managed `DATABASE_URL` merely to make an external daemon work.

Recommended resolution:

```ts
const scratchpadDatabaseUrl =
  process.env.SCRATCHPAD_DATABASE_URL ??
  process.env.DATABASE_URL;
```

Use the fallback only when both processes are intentionally meant to share the same reachable database.

---

## Startup capability check

```ts
function classifyDatabaseUrl(raw: string): {
  provider: "REPLIT_HELIUM" | "NEON" | "RENDER" | "OTHER";
  externallyPortable: boolean;
} {
  const hostname = new URL(raw).hostname.toLowerCase();

  if (hostname.includes("helium") || hostname.includes("heliumdb")) {
    return {
      provider: "REPLIT_HELIUM",
      externallyPortable: false,
    };
  }

  if (hostname.endsWith(".neon.tech")) {
    return {
      provider: "NEON",
      externallyPortable: true,
    };
  }

  if (hostname.includes("render.com")) {
    return {
      provider: "RENDER",
      externallyPortable: true,
    };
  }

  return {
    provider: "OTHER",
    externallyPortable: false,
  };
}
```

This classification is advisory. Actual reachability still requires a real connection test.

---

## Verification

```text
DNS resolution succeeds
AND
TCP/TLS connection succeeds
AND
Postgres authentication succeeds
AND
SELECT 1 succeeds
```

A parsed connection string is not proof of reachability.

---

# LINK 4 — Render Postgres Connectivity

## Corrected truth

Do not encode:

```text
Render Postgres external access defaults to null.
```

Render currently documents that Postgres external access defaults to:

```text
0.0.0.0/0
```

which allows external connections from any IPv4 address when valid credentials are supplied. If all inbound rules are deleted, external traffic is blocked. Therefore, the runtime must inspect the actual database configuration instead of assuming either open or closed access. ([Render][7])

---

## Correct SSL rule

Do not standardize:

```text
sslmode=no-verify
```

as the normal connection mode.

`no-verify` weakens certificate validation and should be limited to a documented compatibility exception.

Required preference:

```text
verify-full
→ require
→ no-verify only as a temporary explicit exception
```

Render recommends using the complete external hostname-based connection URL and TLS-capable clients. Render troubleshooting guidance recommends `sslmode=require` for applicable SSL connection failures. ([Render][7])

---

## Connection selection

### Render service in the same region

Use:

```text
RENDER_INTERNAL_DATABASE_URL
```

Benefits:

* Private network
* Lower latency
* No public egress path
* No external IP allowlist dependency

### Replit, Fly.io, local machine, or external daemon

Use:

```text
RENDER_EXTERNAL_DATABASE_URL
```

The internal Render connection string is not externally routable.

---

## ABBYCLAW environment layout

```text
Render application:
DATABASE_URL=<Render internal connection URL>

Replit daemon:
SCRATCHPAD_DATABASE_URL=<Render external connection URL>
```

The Replit daemon must not receive the Render internal URL.

---

## IP access policy

Before external connection:

```text
GET CURRENT DATABASE NETWORK POLICY
→ IDENTIFY CALLER EGRESS IP
→ ADD MINIMUM REQUIRED CIDR
→ TEST CONNECTION
→ REMOVE TEMPORARY BROAD RULES
```

Preferred rule:

```text
<STATIC_EGRESS_IPV4>/32
```

Temporary diagnostic rule:

```text
0.0.0.0/0
```

A global rule must not remain enabled merely because it fixed connectivity.

Render’s inbound rules currently use IPv4 CIDR notation. ([Render][8])

---

## Connection verification

```bash
psql "$SCRATCHPAD_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -c 'SELECT 1 AS connected;'
```

Verified only when:

```text
DNS succeeds
TLS succeeds
authentication succeeds
query succeeds
```

---

## Failure classification

```text
could not translate host name
→ DNS_OR_WRONG_CONNECTION_CLASS

connection timed out
→ NETWORK_OR_ALLOWLIST

no pg_hba.conf entry
→ ACCESS_POLICY_OR_TLS

password authentication failed
→ CREDENTIAL_FAILURE

no SNI information found
→ HOSTNAME_OR_CONNECTION_URL_MISUSE

certificate verification failed
→ TLS_TRUST_CONFIGURATION
```

Do not rotate credentials when the evidence indicates DNS or allowlist failure.

---

# LINK 5 — `GLOBAL_STATE` Stripper

## Risk

The stripper has two competing failure modes:

```text
UNDER-STRIP
→ hidden state leaks into model or user output

OVER-STRIP
→ legitimate content is deleted
```

The implementation must distinguish storage mutation from outbound redaction.

---

## Marker contract

Approved markers:

```text
<!-- GLOBAL_STATE:BEGIN -->
<!-- GLOBAL_STATE:END -->
```

Markers must:

* Appear at the start of a line
* Occupy the complete logical line
* Be matched case-sensitively
* Permit horizontal whitespace only
* Never match inline prose
* Never trigger from an end marker alone

---

## Correct regular expressions

```ts
const GLOBAL_STATE_OPEN =
  /^[ \t]*<!-- GLOBAL_STATE:BEGIN -->[ \t]*$/m;

const GLOBAL_STATE_CLOSE =
  /^[ \t]*<!-- GLOBAL_STATE:END -->[ \t]*$/m;
```

Do not use an unanchored pattern such as:

```ts
/GLOBAL_STATE:BEGIN/
```

That can match:

* Documentation
* Quoted examples
* JSON strings
* Source code
* User discussions
* Inline comments

---

## Safe algorithm

```ts
export interface StripGlobalStateResult {
  output: string;
  removed: boolean;
  malformed: boolean;
  reason?:
    | "NO_OPEN_MARKER"
    | "CLOSE_WITHOUT_OPEN"
    | "OPEN_WITHOUT_CLOSE"
    | "NESTED_OPEN"
    | "VALID_BLOCK_REMOVED";
}

export function stripGlobalState(
  input: string,
  mode: "PERSISTED_SOURCE" | "OUTBOUND_REDACTION",
): StripGlobalStateResult {
  const lines = input.split(/\r?\n/);

  const openIndexes: number[] = [];
  const closeIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^[ \t]*<!-- GLOBAL_STATE:BEGIN -->[ \t]*$/.test(line)) {
      openIndexes.push(index);
    }

    if (/^[ \t]*<!-- GLOBAL_STATE:END -->[ \t]*$/.test(line)) {
      closeIndexes.push(index);
    }
  }

  if (openIndexes.length === 0) {
    return {
      output: input,
      removed: false,
      malformed: closeIndexes.length > 0,
      reason:
        closeIndexes.length > 0
          ? "CLOSE_WITHOUT_OPEN"
          : "NO_OPEN_MARKER",
    };
  }

  if (openIndexes.length > 1) {
    return {
      output: input,
      removed: false,
      malformed: true,
      reason: "NESTED_OPEN",
    };
  }

  const open = openIndexes[0];
  const close = closeIndexes.find((index) => index > open);

  if (close === undefined) {
    if (mode === "PERSISTED_SOURCE") {
      return {
        output: input,
        removed: false,
        malformed: true,
        reason: "OPEN_WITHOUT_CLOSE",
      };
    }

    return {
      output: lines.slice(0, open).join("\n"),
      removed: true,
      malformed: true,
      reason: "OPEN_WITHOUT_CLOSE",
    };
  }

  return {
    output: [
      ...lines.slice(0, open),
      ...lines.slice(close + 1),
    ].join("\n"),
    removed: true,
    malformed: false,
    reason: "VALID_BLOCK_REMOVED",
  };
}
```

---

## Required behavior

### Persisted source

An unterminated opener must:

```text
PRESERVE ORIGINAL
+ RETURN ERROR
+ REQUIRE CORRECTION
```

This prevents destructive over-stripping.

### Outbound model or user output

An unterminated opener must:

```text
REDACT FROM OPENER TO END
+ REPORT GLOBAL_STATE_UNTERMINATED
```

This prioritizes leak prevention.

---

## Required tests

```text
valid complete block
inline marker text
quoted marker text
end marker without opener
opener without end marker
multiple openers
multiple complete blocks
Windows line endings
whitespace-prefixed marker
marker embedded in code
marker embedded in JSON
```

---

# LINK 6 — Super Nova Tool Registry

## 6A. SSRF-Safe Fetch

### Correct rule

DNS must be validated before connection and the approved address must be pinned during the actual socket connection.

A preflight lookup followed by an ordinary `fetch(url)` is insufficient because the HTTP client can perform another DNS lookup after validation.

---

## Required connection sequence

```text
parse URL
→ canonicalize hostname
→ resolve all A/AAAA records
→ reject any forbidden address
→ choose approved address
→ inject approved address through node:http lookup
→ retain original hostname for Host and TLS SNI
→ verify connected peer address
→ stream response with hard cap
```

---

## TypeScript pattern

```ts
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function isPublicAddress(address: string): boolean {
  if (!net.isIP(address)) return false;

  // Replace with a maintained IP classification implementation.
  return !isForbiddenIp(address);
}

export async function secureFetch(rawUrl: string): Promise<Buffer> {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("UNSUPPORTED_PROTOCOL");
  }

  const records = await dns.lookup(url.hostname, {
    all: true,
    verbatim: true,
  });

  if (records.length === 0) {
    throw new Error("DNS_EMPTY");
  }

  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("SSRF_DESTINATION_DENIED");
  }

  const approved = records[0];
  const transport = url.protocol === "https:" ? https : http;

  return await new Promise<Buffer>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: {
          Host: url.host,
        },
        lookup: (_hostname, _options, callback) => {
          callback(
            null,
            approved.address,
            approved.family,
          );
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;

        response.on("data", (chunk: Buffer) => {
          total += chunk.length;

          if (total > MAX_RESPONSE_BYTES) {
            request.destroy(
              new Error("RESPONSE_BODY_LIMIT_EXCEEDED"),
            );
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      },
    );

    request.setTimeout(30_000, () => {
      request.destroy(new Error("REQUEST_TIMEOUT"));
    });

    request.on("socket", (socket) => {
      socket.once("connect", () => {
        const remote = socket.remoteAddress;

        if (!remote || remote !== approved.address) {
          request.destroy(
            new Error("CONNECTED_PEER_MISMATCH"),
          );
        }
      });
    });

    request.on("error", reject);
    request.end();
  });
}
```

Node’s HTTP and HTTPS clients support request options and custom connection behavior; response bodies are streams and therefore must be explicitly bounded by the application. ([Node.js][9])

---

## Redirect rule

Redirects must remain manual.

For each redirect:

```text
resolve Location
→ canonicalize
→ rerun SSRF guard
→ rerun DNS validation
→ create a new pinned connection
```

Never reuse the previous destination approval.

---

## 6B. `web_search` Provider Fallthrough

### Correct rule

Search provider failure must be isolated by:

```text
provider
+ API key
+ failure class
```

One failed key must not terminate the entire search when another configured provider is available.

---

## Provider outcome classes

```ts
type SearchProviderOutcome =
  | "SUCCESS"
  | "NO_RESULTS"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TRANSIENT_FAILED"
  | "INVALID_QUERY"
  | "POLICY_DENIED"
  | "PERMANENT_FAILED";
```

---

## Fallthrough policy

Continue to the next provider for:

```text
AUTH_FAILED
RATE_LIMITED
TRANSIENT_FAILED
PERMANENT_FAILED
```

Do not continue automatically for:

```text
INVALID_QUERY
POLICY_DENIED
```

`NO_RESULTS` may fall through when the mission requests broad recall.

---

## Router

```ts
export async function searchWithFallback(
  query: string,
  providers: SearchProvider[],
): Promise<SearchResult> {
  const attempts: ProviderAttempt[] = [];

  for (const provider of providers) {
    if (provider.circuitOpen()) {
      continue;
    }

    try {
      const result = await provider.search(query);

      attempts.push({
        provider: provider.name,
        status: "SUCCESS",
      });

      return {
        ...result,
        attempts,
      };
    } catch (error) {
      const classification =
        provider.classifyFailure(error);

      attempts.push({
        provider: provider.name,
        status: classification,
      });

      provider.recordFailure(classification);

      if (
        classification === "INVALID_QUERY" ||
        classification === "POLICY_DENIED"
      ) {
        throw new SearchFailure(classification, attempts);
      }
    }
  }

  throw new SearchFailure(
    "ALL_PROVIDERS_EXHAUSTED",
    attempts,
  );
}
```

---

## Required controls

```text
per-key cooldown
per-provider circuit breaker
429 retry-after handling
bounded retry count
provider-specific timeout
request ID capture
attempt ledger
result provenance
duplicate-result removal
```

Do not silently report one provider’s failure as “the web is unavailable.”

---

# LINK 7 — API Server Authorization Model

## Current architectural truth

The API server does not have per-user authorization.

The Work Tree PIN gate is the only authorization boundary.

Therefore:

```text
route not behind requireWtAuth
=
public route
```

This must be treated as an explicit security invariant.

---

## Mandatory route rule

Every route that exposes or mutates any of the following must mount behind `requireWtAuth`:

```text
secrets
private configuration
agent memory
mission history
tool output
database records
private files
operator commands
cron configuration
deployment controls
GitHub controls
provider credentials
private logs
internal diagnostics
```

---

## Correct middleware placement

```ts
router.use("/api/private", requireWtAuth);

router.get(
  "/api/private/secrets/status",
  secretsStatusHandler,
);

router.post(
  "/api/private/missions",
  createMissionHandler,
);
```

Or:

```ts
router.get(
  "/api/secrets/status",
  requireWtAuth,
  secretsStatusHandler,
);
```

Incorrect:

```ts
router.get(
  "/api/secrets/status",
  secretsStatusHandler,
  requireWtAuth,
);
```

Middleware mounted after the handler does not protect the handler.

---

## Fail-closed rule

When authentication configuration is missing:

```text
DENY
```

Do not automatically disable the PIN gate because:

* `WT_PIN_HASH` is absent
* Session storage is unavailable
* Cookie signing failed
* Redis is offline
* Development mode is active

---

## PIN handling

The PIN must not be accepted through:

```text
URL query string
URL path
GET parameter
loggable request metadata
```

Use:

```text
POST body over HTTPS
→ constant-time hash comparison
→ short-lived signed session
→ HttpOnly cookie
→ Secure cookie
→ SameSite protection
```

---

## Route classification

```ts
type RouteSensitivity =
  | "PUBLIC"
  | "AUTHENTICATED_READ"
  | "AUTHENTICATED_WRITE"
  | "SECRET_BEARING"
  | "DESTRUCTIVE";
```

Every route must declare a sensitivity class.

Default:

```text
AUTHENTICATED_READ
```

Public exposure must be explicit.

---

## Startup audit

At startup:

```ts
for (const route of routeRegistry) {
  if (
    route.sensitivity !== "PUBLIC" &&
    !route.middleware.includes("requireWtAuth")
  ) {
    throw new Error(
      `UNPROTECTED_PRIVATE_ROUTE:${route.method}:${route.path}`,
    );
  }
}
```

---

## Required tests

```text
unauthenticated private GET → 401 or 403
unauthenticated private POST → 401 or 403
authenticated private GET → expected response
authenticated private POST → expected response
expired session → denied
tampered cookie → denied
missing PIN configuration → denied
public health route → accessible
secret route never appears outside protected router
```

---

## Architectural warning

A shared PIN gate provides workspace-level access, not user-level authorization.

It does not provide:

* Per-user identity
* Per-user role enforcement
* Individual audit attribution
* User revocation
* Least-privilege roles
* Tenant isolation

Until those controls exist, do not describe the API server as having complete RBAC or multi-user authorization.

---

# LINK 8 — Super Nova Model Router

## Architectural rule

All role-to-model selection must pass through one central router.

Forbidden:

```text
agents independently selecting provider/model pairs
provider-specific model names copied across fallback providers
fallback provider changed without recomputing model
```

---

## Core invariant

```text
provider and model are an atomic route
```

A model identifier is valid only within the provider that supports it.

---

## Failure case

Invalid behavior:

```text
operator override:
provider = NVIDIA
model = meta/llama-3.3-70b-instruct

NVIDIA fails
→ provider changed to Bitdeer
→ NVIDIA-specific model retained
→ Bitdeer request fails
```

Correct behavior:

```text
NVIDIA route fails
→ choose Bitdeer fallback route
→ recompute Bitdeer-compatible model
→ execute fallback
```

---

## Router types

```ts
type AgentRole =
  | "ORCHESTRATOR"
  | "CODE"
  | "WEB"
  | "MEMORY"
  | "AUTOMATION"
  | "VISION";

type ProviderId =
  | "nvidia"
  | "openrouter"
  | "bitdeer"
  | "minimax"
  | "moonshot";

interface ProviderRoute {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  credentialRef: string;
}

interface RouteOverride {
  provider?: ProviderId;
  model?: string;
}
```

---

## Central route table

```ts
const ROLE_ROUTES: Record<
  AgentRole,
  ProviderRoute[]
> = {
  ORCHESTRATOR: [
    {
      provider: "nvidia",
      model: "moonshotai/kimi-k2.6",
      baseUrl: process.env.NVIDIA_BASE_URL!,
      credentialRef: "NVIDIA_API_KEY",
    },
    {
      provider: "openrouter",
      model: "moonshotai/kimi-k2",
      baseUrl: process.env.OPENROUTER_BASE_URL!,
      credentialRef: "OPENROUTER_API_KEY",
    },
    {
      provider: "bitdeer",
      model: "qwen2.5-72b-instruct",
      baseUrl: process.env.BITDEER_BASE_URL!,
      credentialRef: "BITDEER_API_KEY",
    },
  ],

  CODE: [
    {
      provider: "nvidia",
      model: "qwen/qwen3-coder",
      baseUrl: process.env.NVIDIA_BASE_URL!,
      credentialRef: "NVIDIA_API_KEY",
    },
    {
      provider: "bitdeer",
      model: "qwen2.5-coder-32b-instruct",
      baseUrl: process.env.BITDEER_BASE_URL!,
      credentialRef: "BITDEER_API_KEY",
    },
  ],

  WEB: [],
  MEMORY: [],
  AUTOMATION: [],
  VISION: [],
};
```

Model names above are configuration examples and must be replaced with models actually supported by each connected provider.

---

## Provider compatibility registry

```ts
const PROVIDER_MODELS: Record<
  ProviderId,
  Set<string>
> = {
  nvidia: new Set([
    "moonshotai/kimi-k2.6",
    "qwen/qwen3-coder",
  ]),

  openrouter: new Set([
    "moonshotai/kimi-k2",
  ]),

  bitdeer: new Set([
    "qwen2.5-72b-instruct",
    "qwen2.5-coder-32b-instruct",
  ]),

  minimax: new Set([]),
  moonshot: new Set([]),
};
```

---

## Atomic resolver

```ts
export function resolveRoute(
  role: AgentRole,
  override?: RouteOverride,
): ProviderRoute[] {
  const defaults = ROLE_ROUTES[role];

  if (!override?.provider) {
    return defaults;
  }

  const providerDefault = defaults.find(
    (route) => route.provider === override.provider,
  );

  if (!providerDefault) {
    throw new Error(
      `PROVIDER_NOT_CONFIGURED_FOR_ROLE:${role}:${override.provider}`,
    );
  }

  const selectedModel =
    override.model ?? providerDefault.model;

  if (
    !PROVIDER_MODELS[override.provider].has(
      selectedModel,
    )
  ) {
    throw new Error(
      `MODEL_NOT_SUPPORTED_BY_PROVIDER:${override.provider}:${selectedModel}`,
    );
  }

  const primary: ProviderRoute = {
    ...providerDefault,
    model: selectedModel,
  };

  const fallbackRoutes = defaults.filter(
    (route) => route.provider !== override.provider,
  );

  return [
    primary,
    ...fallbackRoutes,
  ];
}
```

Each fallback route carries its own model.

---

## Execution router

```ts
export async function executeModelTask(
  role: AgentRole,
  request: ModelRequest,
  override?: RouteOverride,
): Promise<ModelResponse> {
  const routes = resolveRoute(role, override);
  const attempts: ModelAttempt[] = [];

  for (const route of routes) {
    try {
      const result = await callProvider(
        route,
        request,
      );

      return {
        ...result,
        route,
        attempts,
      };
    } catch (error) {
      const failure = classifyProviderFailure(
        route.provider,
        error,
      );

      attempts.push({
        provider: route.provider,
        model: route.model,
        failure,
      });

      if (
        failure === "INVALID_REQUEST" ||
        failure === "POLICY_DENIED"
      ) {
        throw new ModelRoutingError(
          failure,
          attempts,
        );
      }
    }
  }

  throw new ModelRoutingError(
    "ALL_ROUTES_EXHAUSTED",
    attempts,
  );
}
```

---

## Override semantics

### Provider only

```json
{
  "provider": "bitdeer"
}
```

Result:

```text
Bitdeer selected
+ Bitdeer default model selected
```

### Provider and compatible model

```json
{
  "provider": "bitdeer",
  "model": "qwen2.5-coder-32b-instruct"
}
```

Result:

```text
Bitdeer selected
+ requested compatible model selected
```

### Model without provider

Reject unless the router can prove exactly one provider supports that model.

Ambiguous model-only overrides must not be guessed.

---

## Required tests

```text
default role route selects correct provider and model
provider-only override selects provider default model
valid provider+model override succeeds
unsupported provider+model pair is rejected before request
failed override provider falls back with fallback model
provider-specific model never leaks into another provider
auth failure triggers eligible fallback
rate limit triggers eligible fallback
invalid request does not blindly cascade
all attempts recorded with provider and model
```

---

# Global Integration Invariant

```text
OBSERVED INCIDENT
≠
UNIVERSAL PLATFORM LAW
```

Every integration link must preserve:

```text
what was attempted
what tool executed
what response was observed
what conclusion is directly supported
what remains environment-specific
what corrective action is executable
how the correction is verified
```

No integration rule may claim success based solely on:

* A syntactically valid configuration
* A local command
* A generated request body
* A planned deployment
* A parsed URL
* An agent-written summary
* An unobserved fallback

The final state must be based on external evidence.

---

**END OF SPEC**
The parser is treating the individual link descriptions as YAML keys. They must be placed inside a list and written as quoted or block-scalar values.

```yaml
---
name: "ABBYCLAW runtime integration links"
description: >-
  Operational rules for GitHub authentication, Render deployment,
  cross-platform PostgreSQL connectivity, GLOBAL_STATE stripping,
  SSRF-safe tools, API authorization, and provider-aware model routing.

links:
  - id: "github-pat-git-push"
    name: "GitHub PAT Git Push"
    summary: >-
      A classic GitHub personal access token may fail when supplied through
      an incompatible bearer extraheader flow. Use Git's credential interface
      rather than embedding the token directly in the repository URL.
    observed_failure:
      mechanism: "http.extraHeader"
      authorization_scheme: "Bearer"
      result: "Authentication failed"
    required_behavior:
      preferred_methods:
        - "GitHub CLI credential helper"
        - "Git Credential Manager"
        - "Ephemeral GIT_ASKPASS"
      username: "x-access-token"
      password_source: "GITHUB_TOKEN environment variable"
      remote_format: "https://github.com/<owner>/<repository>.git"
      push_refspec: "HEAD:refs/heads/<target-branch>"
    security_rules:
      - "Never store the PAT in .git/config."
      - "Never print the PAT in logs."
      - "Never expose the PAT through shell tracing."
      - "Never rely on regex redaction as the primary secret control."
      - "Never force-push without explicit operator authorization."
    verification:
      - "The git push command exits with status 0."
      - "The remote branch exists."
      - "The remote branch SHA matches the intended local SHA."

  - id: "render-api-deploy"
    name: "Render API Service Creation and Deployment"
    summary: >-
      Render service creation and deployment are separate operations.
      An HTTP 402 response during service creation must be classified as
      a billing prerequisite for that account or request, not automatically
      as malformed JSON, invalid authentication, or a transient provider error.
    endpoints:
      create_service:
        method: "POST"
        path: "/v1/services"
        expected_success_status:
          - 201
      create_deploy:
        method: "POST"
        path: "/v1/services/<service-id>/deploys"
        expected_success_status:
          - 201
          - 202
    failure_mapping:
      "400": "INVALID_REQUEST"
      "401": "AUTHENTICATION_FAILED"
      "402": "BILLING_PREREQUISITE"
      "404": "RESOURCE_NOT_FOUND"
      "409": "CONFLICT"
      "429": "RATE_LIMITED"
      "5xx": "PROVIDER_FAILURE"
    create_service_body:
      type: "web_service"
      name: "<service-name>"
      ownerId: "<workspace-owner-id>"
      repo: "https://github.com/<owner>/<repository>"
      branch: "main"
      autoDeploy: "no"
      serviceDetails:
        runtime: "node"
        plan: "free"
        region: "virginia"
        numInstances: 1
        healthCheckPath: "/health"
        envSpecificDetails:
          buildCommand: "npm ci && npm run build"
          startCommand: "npm run start"
    verification:
      - "The service creation request returns HTTP 201."
      - "The service ID is captured from the response."
      - "A deployment is created."
      - "Deployment status is polled to a terminal state."
      - "The deployment reaches the live state."
      - "The health endpoint returns the expected response."

  - id: "replit-database-external-reachability"
    name: "Replit Database External Reachability"
    summary: >-
      A Replit Helium DATABASE_URL is scoped to the Replit application
      environment and must not be treated as a portable public PostgreSQL
      endpoint for Render, Fly.io, local workers, or external services.
    invalid_architecture:
      source: "Render, Fly.io, or another external host"
      destination: "Replit Helium DATABASE_URL"
      expected_result:
        - "DNS resolution failure"
        - "Network rejection"
        - "Platform-scope rejection"
        - "Unreachable database host"
    required_architecture:
      database: "Externally reachable managed PostgreSQL"
      clients:
        - "Render application"
        - "Replit daemon"
        - "Fly.io worker"
        - "Authorized administration client"
    environment_variables:
      main_application: "DATABASE_URL"
      replit_daemon: "SCRATCHPAD_DATABASE_URL"
    verification:
      - "DNS resolution succeeds."
      - "The TCP and TLS connection succeeds."
      - "PostgreSQL authentication succeeds."
      - "SELECT 1 executes successfully."

  - id: "render-postgres-connectivity"
    name: "Render PostgreSQL Connectivity"
    summary: >-
      Render applications in the same region should use the internal database
      connection string. External systems such as Replit or Fly.io must use the
      external connection string and must satisfy the database's current
      inbound network policy.
    connection_selection:
      render_same_region:
        variable: "DATABASE_URL"
        connection_type: "Render internal PostgreSQL URL"
      external_runtime:
        variable: "SCRATCHPAD_DATABASE_URL"
        connection_type: "Render external PostgreSQL URL"
    tls_policy:
      preferred:
        - "verify-full"
        - "require"
      temporary_exception:
        - "no-verify"
      exception_rule: >-
        Certificate verification may be disabled only as a documented,
        temporary compatibility exception.
    network_policy:
      preferred_rule: "<static-egress-ipv4>/32"
      temporary_diagnostic_rule: "0.0.0.0/0"
      requirement: >-
        Inspect the actual Render inbound rules instead of assuming external
        access is either enabled or disabled.
    verification:
      - "DNS resolution succeeds."
      - "TLS negotiation succeeds."
      - "PostgreSQL authentication succeeds."
      - "SELECT 1 executes successfully."

  - id: "global-state-stripper"
    name: "GLOBAL_STATE Stripper"
    summary: >-
      GLOBAL_STATE markers must be anchored to the beginning of a line.
      Removal must start only after an explicit opening marker is found.
      Persisted-source processing and outbound redaction must use different
      malformed-block behavior.
    markers:
      opener: "<!-- GLOBAL_STATE:BEGIN -->"
      closer: "<!-- GLOBAL_STATE:END -->"
    patterns:
      opener: '^[ \t]*<!-- GLOBAL_STATE:BEGIN -->[ \t]*$'
      closer: '^[ \t]*<!-- GLOBAL_STATE:END -->[ \t]*$'
      flags:
        - "m"
    persisted_source_policy:
      complete_block: "REMOVE_BLOCK"
      opener_without_closer: "PRESERVE_ORIGINAL_AND_RETURN_ERROR"
      closer_without_opener: "PRESERVE_ORIGINAL_AND_RETURN_ERROR"
    outbound_redaction_policy:
      complete_block: "REMOVE_BLOCK"
      opener_without_closer: "REDACT_FROM_OPENER_TO_END"
      closer_without_opener: "PRESERVE_CONTENT_AND_REPORT_MALFORMED_MARKER"
    prohibited_behavior:
      - "Do not use unanchored marker matching."
      - "Do not remove content based only on a closing marker."
      - "Do not match marker examples embedded in prose, JSON, or source code."
      - "Do not silently modify malformed persisted source."

  - id: "super-nova-tool-registry"
    name: "Super Nova Tool Registry"
    summary: >-
      SSRF-safe network access must validate DNS and pin the approved IP during
      the actual socket connection. Search execution must isolate failures by
      provider and credential and continue through eligible fallback providers.
    secure_fetch:
      sequence:
        - "Parse and canonicalize the URL."
        - "Allow only HTTP and HTTPS."
        - "Resolve all A and AAAA records."
        - "Reject the destination if any resolved address is forbidden."
        - "Select an approved address."
        - "Pin the approved address through the HTTP client's lookup callback."
        - "Preserve the original hostname for the Host header and TLS SNI."
        - "Verify the connected peer address."
        - "Stream the response through a hard body-size cap."
      redirect_policy:
        automatic_redirects: false
        maximum_redirects: 5
        per_hop_requirements:
          - "Resolve the Location header."
          - "Canonicalize the redirected URL."
          - "Repeat SSRF validation."
          - "Repeat DNS validation."
          - "Create a new pinned connection."
      resource_limits:
        timeout_ms: 30000
        maximum_response_bytes: 10485760
    web_search_fallback:
      continue_on:
        - "AUTH_FAILED"
        - "RATE_LIMITED"
        - "TRANSIENT_FAILED"
        - "PERMANENT_FAILED"
      stop_on:
        - "INVALID_QUERY"
        - "POLICY_DENIED"
      required_controls:
        - "Per-key cooldown"
        - "Per-provider circuit breaker"
        - "Retry-After handling"
        - "Bounded retry count"
        - "Provider-specific timeout"
        - "Request-ID capture"
        - "Attempt ledger"
        - "Result provenance"
        - "Duplicate-result removal"

  - id: "api-server-authorization"
    name: "API Server Authorization Model"
    summary: >-
      The Work Tree PIN gate is currently the only API authorization boundary.
      Any private, secret-bearing, or state-mutating route must therefore mount
      behind requireWtAuth.
    current_model:
      per_user_authorization: false
      authorization_boundary: "Work Tree PIN gate"
    default_route_classification: "AUTHENTICATED_READ"
    protected_resources:
      - "Secrets"
      - "Private configuration"
      - "Agent memory"
      - "Mission history"
      - "Tool output"
      - "Database records"
      - "Private files"
      - "Operator commands"
      - "Cron configuration"
      - "Deployment controls"
      - "GitHub controls"
      - "Provider credentials"
      - "Private logs"
      - "Internal diagnostics"
    middleware: "requireWtAuth"
    fail_closed_conditions:
      - "Missing PIN configuration"
      - "Unavailable session storage"
      - "Cookie-signing failure"
      - "Invalid session"
      - "Expired session"
      - "Tampered cookie"
    required_tests:
      - "Unauthenticated private GET is denied."
      - "Unauthenticated private POST is denied."
      - "Authenticated private GET succeeds."
      - "Authenticated private POST succeeds."
      - "Expired sessions are denied."
      - "Tampered cookies are denied."
      - "Missing PIN configuration causes denial."
      - "Explicit public health routes remain accessible."

  - id: "super-nova-model-router"
    name: "Super Nova Model Router"
    summary: >-
      Provider and model must be treated as one atomic route. If a provider
      override fails and execution falls back to another provider, the router
      must select that fallback provider's compatible model instead of retaining
      the failed provider's model identifier.
    central_router: true
    route_key: "agent-role"
    atomic_route_fields:
      - "provider"
      - "model"
      - "baseUrl"
      - "credentialRef"
    override_rules:
      provider_only: "USE_PROVIDER_DEFAULT_MODEL"
      provider_and_model: "VALIDATE_MODEL_SUPPORT_BEFORE_EXECUTION"
      model_only: "REJECT_UNLESS_EXACTLY_ONE_PROVIDER_SUPPORTS_MODEL"
    fallback_rule: >-
      Every fallback route must carry its own provider-compatible model.
      Provider-specific model names must never leak into another provider.
    continue_on:
      - "AUTHENTICATION_FAILED"
      - "RATE_LIMITED"
      - "PROVIDER_UNAVAILABLE"
      - "TRANSIENT_FAILED"
    stop_on:
      - "INVALID_REQUEST"
      - "POLICY_DENIED"
    required_tests:
      - "Default role routing selects the correct provider and model."
      - "A provider-only override selects that provider's default model."
      - "A compatible provider-and-model override succeeds."
      - "An unsupported provider-and-model pair is rejected before execution."
      - "A failed override falls back using the fallback provider's model."
      - "A provider-specific model never leaks into another provider."
      - "Every attempt records both provider and model."

global_invariant: >-
  An observed incident is not automatically a universal platform law.
  Every operational conclusion must distinguish the attempted action,
  observed evidence, directly supported conclusion, environment-specific
  behavior, executable correction, and final verification result.
---
```

