The major fixes are: pin DNS **inside the actual socket lookup**, validate every redirect independently, parse Firecrawl’s current `data.web` response while retaining legacy compatibility, and require more than `SUPER_NOVA_EXEC` alone before exposing arbitrary execution tools. Node supports a custom `lookup` function on HTTP requests, preserves hostname-based TLS SNI when the hostname remains the request target, and exposes response bodies as streams rather than automatically buffering them. ([Node.js][1])

---

name: "Super Nova tool registry"
description: >-
Security, routing, fallback, authentication, and verification rules for
Super Nova's Work Tree tools, including SSRF-safe HTTP retrieval,
multi-provider web search, and dangerous execution-tool authorization.
----------------------------------------------------------------------

# Super Nova Tool Registry

## Scope

The Super Nova tool registry is implemented in:

```text
scripts/super-nova-tools.mjs
```

This skill governs:

* Tool registration
* Tool capability discovery
* SSRF-safe HTTP retrieval
* DNS rebinding protection
* Redirect validation
* Response-size limits
* Multi-provider web search
* Provider failure isolation
* Search-result normalization
* Dangerous execution-tool exposure
* Work Tree authentication
* Brute-force protection
* Tool-call auditing
* Release verification

---

# 1. Global Tool-Layer Invariant

Every tool invocation must be treated as untrusted.

```text
MODEL INPUT
+ USER INPUT
+ WEB CONTENT
+ TOOL ARGUMENTS
=
UNTRUSTED
```

No tool executes unless:

```text
tool exists
AND
input schema passes
AND
mission capability permits it
AND
request scope permits it
AND
security guards pass
AND
resource limits are active
```

Tool visibility is not authorization.

Tool registration is not authorization.

`SUPER_NOVA_EXEC=full_open` is not sufficient authorization by itself.

---

# 2. Tool Classes

```ts
export type SuperNovaToolClass =
  | "NETWORK_READ"
  | "SEARCH"
  | "FILE_READ"
  | "FILE_WRITE"
  | "CODE_EXECUTION"
  | "SHELL_EXECUTION"
  | "STATE_MUTATION";
```

Risk levels:

```ts
export type ToolRisk =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";
```

Required manifest:

```ts
export interface SuperNovaToolManifest {
  name: string;
  version: string;

  toolClass: SuperNovaToolClass;
  risk: ToolRisk;

  inputSchema: object;
  outputSchema: object;

  requiresWorkTreeAuth: boolean;
  requiresExecutionMode: boolean;
  requiredCapabilities: string[];

  timeoutMs: number;
  maximumInputBytes: number;
  maximumOutputBytes: number;

  sideEffects:
    | "NONE"
    | "READ_ONLY"
    | "LOCAL_WRITE"
    | "EXTERNAL_WRITE";
}
```

Unknown input properties must be rejected.

---

# 3. Execution Modes

Supported values:

```text
SUPER_NOVA_EXEC=off
SUPER_NOVA_EXEC=read_only
SUPER_NOVA_EXEC=full_open
```

Default:

```text
off
```

Behavior:

| Mode        | Available sensitive tools                                    |
| ----------- | ------------------------------------------------------------ |
| `off`       | None                                                         |
| `read_only` | Scoped `read_file` only                                      |
| `full_open` | Scoped execution and write tools, subject to all other gates |

Critical rule:

```text
SUPER_NOVA_EXEC
=
CAPABILITY AVAILABILITY SWITCH

SUPER_NOVA_EXEC
≠
AUTHENTICATION
```

Even in `full_open`, every dangerous request still requires:

* Valid Work Tree authentication
* Valid mission and task
* Explicit capability grant
* Workspace scope
* Tool-specific validation
* Resource limits
* Audit logging

---

# 4. Dangerous Tool Inventory

Dangerous tools include:

```text
run_python
run_node
shell
write_file
read_file
```

Risk classification:

| Tool         | Risk     |
| ------------ | -------- |
| `read_file`  | High     |
| `write_file` | Critical |
| `run_python` | Critical |
| `run_node`   | Critical |
| `shell`      | Critical |

`read_file` is dangerous because it can expose:

* Secrets
* Credentials
* Environment files
* Source code
* Private notes
* Database exports
* Other users’ data

It must not be treated as harmless merely because it does not mutate files.

---

# 5. Registry Construction

Dangerous tools should not be registered when their execution mode is disabled.

```js
export function buildToolRegistry(context) {
  const executionMode =
    process.env.SUPER_NOVA_EXEC ?? "off";

  const tools = [
    createHttpFetchTool(context),
    createWebSearchTool(context),
  ];

  if (
    executionMode === "read_only" ||
    executionMode === "full_open"
  ) {
    tools.push(
      createReadFileTool(context),
    );
  }

  if (executionMode === "full_open") {
    tools.push(
      createWriteFileTool(context),
      createRunPythonTool(context),
      createRunNodeTool(context),
      createShellTool(context),
    );
  }

  return tools;
}
```

Do not merely expose a dangerous tool and return an error after invocation.

Removing unavailable capabilities from discovery reduces accidental and adversarial calls.

---

# 6. `http_fetch` Security Contract

## Risk

```text
CRITICAL
```

Primary threats:

* SSRF
* DNS rebinding
* Cloud metadata access
* Internal service probing
* Redirect-based bypass
* Credential exfiltration
* Oversized response denial of service
* Slow-response resource exhaustion
* Protocol smuggling

---

# 7. Why Preflight DNS Plus Global `fetch()` Is Insufficient

Forbidden flow:

```text
dns.lookup(host)
→ validate address
→ global fetch(url)
→ fetch performs its own connection resolution
```

The validated address and the address used by the socket are not mechanically bound together.

A hostname can potentially return:

```text
first lookup
→ public address

connection lookup
→ private or internal address
```

This is a time-of-check/time-of-use failure.

Required flow:

```text
parse URL
→ execute custom lookup at connection time
→ validate all returned addresses
→ return only approved address to socket
→ verify connected peer
```

Node’s `http.request()` supports a custom `lookup` option, and Node’s HTTP responses are streams that can be bounded while data arrives. ([Node.js][1])

---

# 8. Allowed Schemes

Only:

```text
http:
https:
```

Reject:

```text
file:
ftp:
gopher:
data:
javascript:
ldap:
smb:
nfs:
unix:
ws:
wss:
```

Redirects may not switch into an unsupported protocol.

---

# 9. URL Canonicalization

Before DNS resolution:

1. Parse with `new URL()`.
2. Reject embedded username or password.
3. Lowercase the hostname.
4. Remove one terminal DNS dot for policy comparison.
5. Reject control characters.
6. Reject invalid ports.
7. Reject dotless internal-style hostnames unless explicitly allowlisted.
8. Reject noncanonical numeric IP forms.
9. Reject unsupported schemes.
10. Reject fragments when they are irrelevant to the HTTP request.

The exact canonical URL that passes policy must be the URL used for execution.

---

# 10. Forbidden Network Destinations

Reject addresses classified as:

* Loopback
* Unspecified
* Private
* Link-local
* Carrier-grade NAT
* Multicast
* Reserved
* Documentation-only
* Benchmark
* IPv4-mapped private IPv6
* IPv6 unique-local
* Cloud metadata
* Non-global unicast

Examples include:

```text
0.0.0.0/8
10.0.0.0/8
100.64.0.0/10
127.0.0.0/8
169.254.0.0/16
172.16.0.0/12
192.168.0.0/16
198.18.0.0/15
224.0.0.0/4
240.0.0.0/4

::/128
::1/128
::ffff:0:0/96
fc00::/7
fe80::/10
ff00::/8
```

Also reject internal names such as:

```text
localhost
*.localhost
*.local
*.internal
*.lan
*.home
*.home.arpa
metadata.google.internal
```

Use a maintained IP classification library rather than handwritten string matching alone.

---

# 11. Connect-Time Safe Lookup

```js
import dns from "node:dns";
import net from "node:net";

function createSafeLookup({
  expectedHostname,
  classifyIp,
}) {
  return function safeLookup(
    hostname,
    options,
    callback,
  ) {
    if (
      hostname.toLowerCase() !==
      expectedHostname.toLowerCase()
    ) {
      callback(
        new Error(
          "LOOKUP_HOSTNAME_MISMATCH",
        ),
      );
      return;
    }

    dns.lookup(
      hostname,
      {
        all: true,
        verbatim: true,
      },
      (error, addresses) => {
        if (error) {
          callback(error);
          return;
        }

        if (
          !Array.isArray(addresses) ||
          addresses.length === 0
        ) {
          callback(
            new Error("DNS_EMPTY"),
          );
          return;
        }

        const normalized =
          addresses.map((entry) => ({
            address: entry.address,
            family: entry.family,
          }));

        for (const entry of normalized) {
          if (!net.isIP(entry.address)) {
            callback(
              new Error(
                "DNS_RETURNED_INVALID_IP",
              ),
            );
            return;
          }

          if (
            classifyIp(entry.address) !==
            "PUBLIC"
          ) {
            callback(
              new Error(
                `SSRF_ADDRESS_DENIED:${entry.address}`,
              ),
            );
            return;
          }
        }

        /*
         * Fail closed when any DNS answer is unsafe.
         * Do not silently discard an unsafe answer and
         * continue with a safe answer from the same set.
         */

        if (options?.all) {
          callback(
            null,
            normalized,
          );
          return;
        }

        const selected = normalized[0];

        callback(
          null,
          selected.address,
          selected.family,
        );
      },
    );
  };
}
```

Failing when any returned address is forbidden prevents a mixed public/private answer set from being used as a rebinding channel.

---

# 12. TLS Hostname Preservation

The request target must remain the original hostname:

```js
https.request({
  protocol: url.protocol,
  hostname: url.hostname,
  servername: url.hostname,
  lookup: safeLookup,
});
```

Do not replace `hostname` with the approved IP address.

Using the hostname preserves:

* TLS Server Name Indication
* Certificate hostname validation
* Correct `Host` header behavior

Node does not automatically set SNI when the request target is specified as a raw IP, whereas hostname-based requests retain hostname SNI behavior. ([Node.js][2])

---

# 13. Peer-IP Verification

After connection:

```js
request.on("socket", (socket) => {
  socket.once(
    url.protocol === "https:"
      ? "secureConnect"
      : "connect",
    () => {
      const remoteAddress =
        socket.remoteAddress;

      if (!remoteAddress) {
        request.destroy(
          new Error(
            "REMOTE_ADDRESS_UNAVAILABLE",
          ),
        );
        return;
      }

      if (
        classifyIp(remoteAddress) !==
        "PUBLIC"
      ) {
        request.destroy(
          new Error(
            "CONNECTED_TO_FORBIDDEN_ADDRESS",
          ),
        );
      }
    },
  );
});
```

The peer check is defense in depth.

The connect-time lookup remains the primary binding mechanism.

---

# 14. Safe Request Implementation

```js
import http from "node:http";
import https from "node:https";

const DEFAULT_MAX_BODY_BYTES =
  10 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS =
  30_000;

export async function secureHttpFetch(
  rawUrl,
  {
    maximumBodyBytes =
      DEFAULT_MAX_BODY_BYTES,

    timeoutMs =
      DEFAULT_TIMEOUT_MS,

    redirectDepth = 0,

    maximumRedirects = 5,

    classifyIp,
  },
) {
  const url =
    canonicalizeAndValidateUrl(rawUrl);

  if (
    redirectDepth >
    maximumRedirects
  ) {
    throw new Error(
      "MAXIMUM_REDIRECTS_EXCEEDED",
    );
  }

  const transport =
    url.protocol === "https:"
      ? https
      : http;

  const safeLookup =
    createSafeLookup({
      expectedHostname:
        url.hostname,

      classifyIp,
    });

  return await new Promise(
    (resolve, reject) => {
      const request =
        transport.request(
          {
            protocol:
              url.protocol,

            hostname:
              url.hostname,

            servername:
              url.hostname,

            port:
              url.port || undefined,

            method: "GET",

            path:
              `${url.pathname}${url.search}`,

            lookup:
              safeLookup,

            rejectUnauthorized:
              true,

            maxHeaderSize:
              32 * 1024,

            headers: {
              Accept:
                "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",

              /*
               * Avoid automatic compressed-body ambiguity.
               * Add bounded decompression separately if needed.
               */
              "Accept-Encoding":
                "identity",

              "User-Agent":
                "Super-Nova-Tool/1.0",
            },
          },

          async (response) => {
            const status =
              response.statusCode ?? 0;

            if (
              status >= 300 &&
              status < 400
            ) {
              const location =
                response.headers.location;

              response.resume();

              if (!location) {
                reject(
                  new Error(
                    "REDIRECT_WITHOUT_LOCATION",
                  ),
                );
                return;
              }

              let redirectedUrl;

              try {
                redirectedUrl =
                  new URL(location, url);
              } catch {
                reject(
                  new Error(
                    "INVALID_REDIRECT_LOCATION",
                  ),
                );
                return;
              }

              try {
                const result =
                  await secureHttpFetch(
                    redirectedUrl.toString(),
                    {
                      maximumBodyBytes,
                      timeoutMs,
                      redirectDepth:
                        redirectDepth + 1,
                      maximumRedirects,
                      classifyIp,
                    },
                  );

                resolve(result);
              } catch (error) {
                reject(error);
              }

              return;
            }

            const declaredLength =
              Number(
                response.headers[
                  "content-length"
                ],
              );

            if (
              Number.isFinite(
                declaredLength,
              ) &&
              declaredLength >
                maximumBodyBytes
            ) {
              request.destroy(
                new Error(
                  "RESPONSE_BODY_LIMIT_EXCEEDED",
                ),
              );
              return;
            }

            const chunks = [];
            let receivedBytes = 0;

            response.on(
              "data",
              (chunk) => {
                const buffer =
                  Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk);

                receivedBytes +=
                  buffer.length;

                if (
                  receivedBytes >
                  maximumBodyBytes
                ) {
                  request.destroy(
                    new Error(
                      "RESPONSE_BODY_LIMIT_EXCEEDED",
                    ),
                  );
                  return;
                }

                chunks.push(buffer);
              },
            );

            response.once(
              "end",
              () => {
                resolve({
                  url:
                    url.toString(),

                  status,

                  headers:
                    sanitizeResponseHeaders(
                      response.headers,
                    ),

                  body:
                    Buffer.concat(
                      chunks,
                    ),
                });
              },
            );

            response.once(
              "error",
              reject,
            );
          },
        );

      request.setTimeout(
        timeoutMs,
        () => {
          request.destroy(
            new Error(
              "HTTP_FETCH_TIMEOUT",
            ),
          );
        },
      );

      request.once(
        "error",
        reject,
      );

      request.end();
    },
  );
}
```

Node’s HTTP API deliberately exposes streaming request and response handling rather than automatically buffering entire messages, allowing the application to enforce its own body limits. ([Node.js][1])

---

# 15. Redirect Security

Every redirect is a new security decision.

For each hop:

```text
resolve Location
→ canonicalize URL
→ validate protocol
→ validate hostname
→ perform new connect-time DNS validation
→ validate every returned IP
→ create new socket
→ verify peer address
```

Requirements:

```text
automatic redirect following = forbidden
maximum redirects = 5
redirect loops = rejected
HTTPS to HTTP downgrade = rejected by default
```

Sensitive headers must not be forwarded to a different origin.

The generic fetch tool must not accept agent-controlled:

```text
Authorization
Cookie
Proxy-Authorization
Host
Forwarded
X-Forwarded-For
```

---

# 16. Proxy Controls

The HTTP fetch tool must not silently inherit:

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
NO_PROXY
```

A proxy can bypass direct destination validation by becoming the actual network destination.

Proxy use requires a separate reviewed configuration and must apply destination enforcement at the proxy boundary.

---

# 17. `http_fetch` Resource Limits

Required defaults:

```text
total timeout:          30 seconds
maximum redirects:      5
maximum response body:  10 MB
maximum header bytes:   32 KB
methods:                 GET and HEAD
ports:                   80 and 443
```

Nonstandard ports require an explicit capability grant.

Generic `http_fetch` must not provide arbitrary `POST`, `PUT`, `PATCH`, or `DELETE`.

External mutations belong in destination-specific tools with independent authorization and idempotency controls.

---

# 18. `web_search` Provider Chain

Default provider order:

```text
1. Tavily
2. Brave Search
3. Firecrawl
```

The provider order may be overridden through configuration, but all providers must return one normalized result contract.

A configured provider failing must not disable all search when another usable provider exists.

---

# 19. Provider Credentials

Read API keys per request.

Do not capture them only at module import.

```js
const SEARCH_PROVIDERS = {
  tavily: {
    keyEnv:
      "TAVILY_API_KEY",
  },

  brave: {
    keyEnv:
      "BRAVE_SEARCH_API_KEY",
  },

  firecrawl: {
    keyEnv:
      "FIRECRAWL_API_KEY",
  },
};

function providerKey(
  providerName,
) {
  const envName =
    SEARCH_PROVIDERS[
      providerName
    ]?.keyEnv;

  return envName
    ? process.env[envName]
        ?.trim()
    : "";
}
```

This permits runtime secret updates to affect the next request.

---

# 20. Canonical Search Request

```ts
export interface CanonicalSearchRequest {
  query: string;
  maximumResults: number;

  includeDomains?: string[];
  excludeDomains?: string[];

  freshness?: string;
  country?: string;
  language?: string;
}
```

Validate before provider iteration:

```text
query nonempty
query within configured length
maximumResults bounded
domains canonicalized
include and exclude rules compatible
```

A globally invalid canonical request must fail before contacting any provider.

---

# 21. Normalized Search Result

```ts
export interface NormalizedSearchResult {
  title: string;
  url: string;
  description: string;

  provider:
    | "tavily"
    | "brave"
    | "firecrawl";

  publishedAt?: string;
  score?: number;
  rawContent?: string;
}
```

Every result must preserve provider provenance.

---

# 22. Search Outcome Classes

```ts
export type SearchAttemptStatus =
  | "SUCCESS"
  | "EMPTY"
  | "UNCONFIGURED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "INVALID_PROVIDER_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "POLICY_DENIED";
```

---

# 23. Fallthrough Rules

Continue to the next provider for:

```text
UNCONFIGURED
AUTH_FAILED
RATE_LIMITED
INVALID_PROVIDER_REQUEST
PROVIDER_UNAVAILABLE
TIMEOUT
MALFORMED_RESPONSE
EMPTY
```

Stop globally for:

```text
invalid canonical query
local policy denial
operator cancellation
```

A provider-specific `400` may indicate an adapter mismatch or unsupported provider parameter. Record it and continue to the next provider.

Do not repeat the same failed provider request unchanged.

Tavily documents response classes including `400`, `401`, `429`, and `500`, making provider-level error isolation necessary. ([Tavily Docs][3])

---

# 24. Tavily Adapter

Conceptual request:

```js
async function searchTavily(
  request,
) {
  const key =
    providerKey("tavily");

  if (!key) {
    throw new SearchProviderError(
      "UNCONFIGURED",
    );
  }

  const response =
    await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${key}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          query:
            request.query,

          max_results:
            request.maximumResults,

          include_domains:
            request.includeDomains ?? [],

          exclude_domains:
            request.excludeDomains ?? [],
        }),

        signal:
          AbortSignal.timeout(
            20_000,
          ),
      },
    );

  return normalizeTavilyResponse(
    response,
  );
}
```

Never log the authorization header.

---

# 25. Brave Adapter

Brave Web Search uses the `X-Subscription-Token` request header and returns web results under `web.results`. ([Brave][4])

```js
async function searchBrave(
  request,
) {
  const key =
    providerKey("brave");

  if (!key) {
    throw new SearchProviderError(
      "UNCONFIGURED",
    );
  }

  const url =
    new URL(
      "https://api.search.brave.com/res/v1/web/search",
    );

  url.searchParams.set(
    "q",
    request.query,
  );

  url.searchParams.set(
    "count",
    String(
      Math.min(
        request.maximumResults,
        20,
      ),
    ),
  );

  const response =
    await fetch(
      url,
      {
        headers: {
          "X-Subscription-Token":
            key,

          Accept:
            "application/json",
        },

        signal:
          AbortSignal.timeout(
            20_000,
          ),
      },
    );

  return normalizeBraveResponse(
    response,
  );
}
```

---

# 26. Firecrawl Adapter

Current Firecrawl search uses:

```text
POST /v2/search
```

The current response places web results under:

```text
data.web
```

Firecrawl’s current API documentation shows `data` as an object whose default web-search result array is `data.web`. ([Firecrawl Docs][5])

```js
async function searchFirecrawl(
  request,
) {
  const key =
    providerKey("firecrawl");

  if (!key) {
    throw new SearchProviderError(
      "UNCONFIGURED",
    );
  }

  const response =
    await fetch(
      "https://api.firecrawl.dev/v2/search",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${key}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          query:
            request.query,

          limit:
            request.maximumResults,

          sources: [
            "web",
          ],

          includeDomains:
            request.includeDomains,

          excludeDomains:
            request.excludeDomains,
        }),

        signal:
          AbortSignal.timeout(
            30_000,
          ),
      },
    );

  return normalizeFirecrawlResponse(
    response,
  );
}
```

---

# 27. Firecrawl Compatibility Parser

Support the current v2 response and a legacy observed array shape.

```js
export function extractFirecrawlWebResults(
  payload,
) {
  /*
   * Current v2:
   * {
   *   success: true,
   *   data: {
   *     web: [...]
   *   }
   * }
   */
  if (
    Array.isArray(
      payload?.data?.web,
    )
  ) {
    return payload.data.web;
  }

  /*
   * Legacy compatibility:
   * {
   *   data: [...]
   * }
   */
  if (
    Array.isArray(
      payload?.data,
    )
  ) {
    return payload.data;
  }

  /*
   * Optional compatibility wrapper:
   * {
   *   web: {
   *     results: [...]
   *   }
   * }
   */
  if (
    Array.isArray(
      payload?.web?.results,
    )
  ) {
    return payload.web.results;
  }

  return [];
}
```

The legacy parser exists for compatibility.

It must not be described as Firecrawl’s current documented v2 contract.

---

# 28. Multi-Provider Search Executor

```js
const SEARCH_ORDER = [
  "tavily",
  "brave",
  "firecrawl",
];

export async function searchWeb(
  canonicalRequest,
) {
  validateCanonicalSearchRequest(
    canonicalRequest,
  );

  const attempts = [];

  for (
    const providerName
    of SEARCH_ORDER
  ) {
    const startedAt =
      new Date().toISOString();

    if (
      !providerKey(
        providerName,
      )
    ) {
      attempts.push({
        provider:
          providerName,

        status:
          "UNCONFIGURED",

        startedAt,
        completedAt:
          new Date()
            .toISOString(),
      });

      continue;
    }

    try {
      const results =
        await executeSearchProvider(
          providerName,
          canonicalRequest,
        );

      if (
        !Array.isArray(results) ||
        results.length === 0
      ) {
        attempts.push({
          provider:
            providerName,

          status:
            "EMPTY",

          startedAt,
          completedAt:
            new Date()
              .toISOString(),
        });

        continue;
      }

      const normalized =
        normalizeAndDeduplicate(
          results,
          providerName,
        );

      if (
        normalized.length === 0
      ) {
        attempts.push({
          provider:
            providerName,

          status:
            "EMPTY",

          startedAt,
          completedAt:
            new Date()
              .toISOString(),
        });

        continue;
      }

      attempts.push({
        provider:
          providerName,

        status:
          "SUCCESS",

        resultCount:
          normalized.length,

        startedAt,
        completedAt:
          new Date()
            .toISOString(),
      });

      return {
        results:
          normalized,

        selectedProvider:
          providerName,

        attempts,
      };
    } catch (error) {
      const status =
        classifySearchProviderError(
          error,
        );

      attempts.push({
        provider:
          providerName,

        status,

        startedAt,
        completedAt:
          new Date()
            .toISOString(),
      });

      if (
        status ===
        "POLICY_DENIED"
      ) {
        throw new SearchFailure(
          "SEARCH_POLICY_DENIED",
          attempts,
        );
      }
    }
  }

  throw new SearchFailure(
    "ALL_SEARCH_PROVIDERS_EXHAUSTED",
    attempts,
  );
}
```

---

# 29. Empty Result Semantics

An empty result from one provider does not prove:

```text
the query has no results
```

It proves only:

```text
this provider returned no usable results
for this attempt
```

Therefore:

```text
Tavily empty
→ try Brave

Brave empty
→ try Firecrawl

Firecrawl empty
→ return ALL_SEARCH_PROVIDERS_EXHAUSTED
```

---

# 30. Search Deduplication

Normalize URLs before deduplication:

* Lowercase hostname
* Remove fragment
* Remove known tracking parameters
* Normalize default ports
* Preserve meaningful query parameters
* Remove trailing root slash where equivalent

Deduplicate by canonical URL.

Do not merge distinct pages solely because their titles match.

---

# 31. Search Attempt Ledger

Every search call must record:

```ts
export interface SearchAttemptRecord {
  provider:
    | "tavily"
    | "brave"
    | "firecrawl";

  status: SearchAttemptStatus;

  startedAt: string;
  completedAt: string;

  httpStatus?: number;
  requestId?: string;
  resultCount?: number;
  failureCode?: string;
}
```

Do not record API keys or full authorization headers.

---

# 32. Work Tree HTTP Authentication Boundary

The effective API paths are:

```text
POST /api/work-tree/unlock
/api/work-tree/*
```

The unlock endpoint accepts:

```json
{
  "pin": "..."
}
```

A successful unlock issues an HMAC-authenticated cookie.

Every other Work Tree route must execute:

```ts
requireWtAuth
```

before its handler.

---

# 33. Work Tree Authorization Truth

The Work Tree PIN gate is workspace-level authorization.

It is not:

* Per-user authentication
* RBAC
* Tenant isolation
* Individual identity
* A permission hierarchy

Required invariant:

```text
UNAUTHENTICATED HTTP REQUEST
→ NO WORK TREE ACCESS

AUTHENTICATED WORK TREE REQUEST
→ STILL SUBJECT TO TOOL CAPABILITY POLICY
```

The cookie proves access to the Work Tree interface.

It does not automatically authorize every dangerous tool.

---

# 34. Cookie Contract

Required cookie properties:

```text
HttpOnly
Secure in production
SameSite=Strict
Path=/api
Max-Age=43200
```

Twelve hours:

```text
43,200 seconds
```

The signed payload should include:

```ts
interface WorkTreeSession {
  version: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}
```

The HMAC must cover the entire serialized payload.

Use constant-time signature comparison.

---

# 35. `SESSION_SECRET` Fail-Closed Rule

Production behavior:

```text
SESSION_SECRET missing
→ unlock disabled
→ cookie verification denied
→ server reports configuration error
```

Forbidden:

```text
fallback secret
hardcoded secret
predictable development secret in production
unsigned cookie
```

Development may use an explicit development secret only when:

```text
NODE_ENV !== production
```

and must emit a visible warning.

---

# 36. PIN Policy

The current compatibility PIN may be:

```text
22
```

This is extremely weak and must not be silently activated in production.

Recommended enforcement:

```text
NOVA_WORK_TREE_PIN configured
→ use configured PIN

PIN missing in production
→ fail closed
```

If the weak compatibility PIN must remain by explicit operator decision:

```text
ALLOW_WEAK_WORK_TREE_PIN=true
AND
NOVA_WORK_TREE_PIN=22
```

must both be present.

The runtime must emit:

```text
WEAK_WORK_TREE_PIN_EXPLICITLY_ENABLED
```

Do not store the plaintext PIN in logs.

---

# 37. PIN Verification

Store a password-derived representation rather than a reversible PIN value when practical.

At minimum:

```text
hash configured PIN at startup
→ hash supplied PIN
→ constant-time comparison
```

Do not compare user input with ordinary string equality when a cryptographic comparison is available.

---

# 38. Brute-Force Lockout

Required policy:

```text
8 failed attempts
→ lock source for 10 minutes
```

Track:

```text
attempt count
first failure time
last failure time
locked until
```

A successful unlock resets the failure counter.

---

# 39. Client-IP Trust

Do not trust arbitrary `X-Forwarded-For`.

Behind Render or another trusted reverse proxy:

1. Configure Express `trust proxy` correctly.
2. Use the framework-derived trusted client IP.
3. Reject malformed forwarded chains.
4. Do not let the requester select the lockout identity.

Incorrect proxy trust can allow attackers to rotate fake IP addresses and bypass lockout.

---

# 40. Distributed Lockout

An in-memory lockout store is sufficient only when:

```text
one process
+ one instance
+ no restart requirement
```

For multiple instances or restart persistence, use:

* Redis
* PostgreSQL
* Another shared atomic store

Otherwise:

```text
restart
→ lockout erased

different instance
→ separate failure counter
```

---

# 41. Cross-Site Request Protection

Because Work Tree authorization uses cookies, state-changing routes must also enforce:

```text
SameSite=Strict
+ expected Origin validation
```

For mutating requests:

```ts
function requireTrustedOrigin(
  req,
  res,
  next,
) {
  const origin =
    req.get("origin");

  if (
    !origin ||
    origin !==
      process.env.PUBLIC_APP_ORIGIN
  ) {
    return res.status(403).json({
      error:
        "untrusted_origin",
    });
  }

  next();
}
```

A CSRF token may be added for stronger protection.

---

# 42. Dangerous Route Gate

Before any dangerous tool executes:

```text
requireWtAuth
→ requireTrustedOrigin
→ validate active mission
→ validate task ownership
→ validate execution capability
→ validate SUPER_NOVA_EXEC mode
→ validate tool arguments
→ execute bounded tool
→ record evidence
```

Example:

```ts
router.post(
  "/api/work-tree/tools/:toolName",
  requireWtAuth,
  requireTrustedOrigin,
  requireActiveMission,
  requireToolCapability,
  executeWorkTreeTool,
);
```

---

# 43. Execution Capability Grant

```ts
export interface ToolCapabilityGrant {
  missionId: string;
  taskId: string;

  toolName: string;

  workspaceRoot?: string;
  allowedCommands?: string[];
  allowedPaths?: string[];

  maximumInvocations: number;
  expiresAt: string;
}
```

A Work Tree cookie alone must not create this grant.

The mission runtime issues it.

---

# 44. File Tool Scope

`read_file` and `write_file` must be bound to:

```text
ctx.workspaceRoot
```

Reject:

* Absolute paths
* `..` traversal
* Symlink escape
* Device files
* Sockets
* Named pipes
* Repository metadata unless allowed
* Secrets directories
* Environment files unless explicitly authorized

`write_file` must use atomic replacement and generate before-and-after evidence.

---

# 45. Code and Shell Tool Limits

`run_python`, `run_node`, and `shell` require:

* Dedicated sandbox
* No host secrets
* No unrestricted network
* Bounded CPU
* Bounded memory
* Bounded process count
* Bounded disk
* Bounded output
* Timeout
* Descendant-process cleanup

If the sandbox cannot be verified:

```text
SANDBOX_UNAVAILABLE
→ DO NOT EXECUTE
```

Never fall back to host execution.

---

# 46. Tool Audit Record

```ts
export interface ToolAuditRecord {
  toolCallId: string;

  missionId: string;
  taskId: string;

  toolName: string;
  toolClass: string;
  risk: string;

  authenticated: boolean;
  capabilityGrantId?: string;

  startedAt: string;
  completedAt?: string;

  status:
    | "SUCCEEDED"
    | "FAILED"
    | "DENIED"
    | "TIMED_OUT";

  inputHash: string;
  outputHash?: string;

  failureCode?: string;
}
```

Never include:

* Raw PIN
* Session secret
* API key
* Cookie value
* Complete private file contents

---

# 47. Required SSRF Tests

The HTTP tool must reject:

```text
http://localhost
http://127.0.0.1
http://127.1
http://0.0.0.0
http://169.254.169.254
http://10.0.0.1
http://172.16.0.1
http://192.168.1.1
http://[::1]
http://[fc00::1]
http://[fe80::1]
file:///etc/passwd
gopher://example.com
```

Also test:

* Public DNS first, private DNS second
* Mixed public and private DNS answers
* Redirect to localhost
* Redirect to metadata
* Redirect loop
* HTTPS-to-HTTP downgrade
* Oversized `Content-Length`
* Chunked body over cap
* Slow response timeout
* Unexpected connected peer
* Embedded URL credentials
* Nonstandard port
* Proxy environment variables

---

# 48. Required Search Tests

```text
Tavily succeeds
→ Brave and Firecrawl not called

Tavily 401
→ Brave called

Tavily empty
→ Brave called

Tavily timeout
→ Brave called

Brave 429
→ Firecrawl called

Brave empty
→ Firecrawl called

Firecrawl v2 data.web
→ parsed

Legacy Firecrawl data array
→ parsed

All providers unconfigured
→ ALL_SEARCH_PROVIDERS_EXHAUSTED

All providers fail
→ attempt ledger returned

Canonical query invalid
→ no provider called

Duplicate URLs
→ deduplicated

Every result
→ provider provenance present
```

---

# 49. Required Authentication Tests

```text
unlock with valid PIN
→ signed cookie issued

unlock with invalid PIN
→ denied

8 invalid attempts
→ source locked

locked source with correct PIN
→ denied until lock expires

missing SESSION_SECRET in production
→ unlock unavailable

tampered cookie
→ denied

expired cookie
→ denied

public non-Work-Tree route
→ unaffected

Work Tree route without cookie
→ denied

dangerous tool with cookie but no capability
→ denied

dangerous tool with capability but SUPER_NOVA_EXEC=off
→ denied

dangerous tool with all gates
→ executes in sandbox
```

---

# 50. Required Route Smoke Test

After changing Work Tree middleware:

```text
POST /api/v1/chat/completions
→ must not return Work Tree locked response
```

The Work Tree auth middleware must be scoped explicitly to:

```text
/api/work-tree
```

It must not become pathless catch-all middleware that locks the public chat proxy.

---

# 51. Release Gate

Before deployment:

```text
tool registry tests pass
+ SSRF suite passes
+ redirect tests pass
+ response-cap tests pass
+ Tavily fallback test passes
+ Brave fallback test passes
+ Firecrawl v2 parser passes
+ dangerous-tool registration tests pass
+ Work Tree auth tests pass
+ brute-force lockout tests pass
+ public chat proxy smoke test passes
+ sandbox attestation passes
```

Required command:

```text
pnpm test
```

or the repository’s exact scoped test command.

A successful typecheck alone is insufficient.

---

# 52. Prohibited Regressions

```text
Do not use DNS preflight followed by uncontrolled global fetch.

Do not allow the HTTP client to perform an unvalidated second lookup.

Do not connect using a raw IP as the HTTPS hostname.

Do not follow redirects automatically.

Do not skip SSRF validation on redirects.

Do not buffer an unbounded response before truncating it.

Do not abort web search after one provider fails.

Do not interpret one provider's empty result as global no-results proof.

Do not assume Firecrawl v1 and v2 have the same response shape.

Do not capture provider keys only once at module import.

Do not expose dangerous tools merely because SUPER_NOVA_EXEC is enabled.

Do not treat a Work Tree cookie as authorization for every tool.

Do not permit dangerous HTTP routes without requireWtAuth.

Do not use a predictable SESSION_SECRET fallback.

Do not silently use PIN 22 in production.

Do not trust arbitrary X-Forwarded-For values.

Do not use only an in-memory lockout store across multiple instances.

Do not execute shell or code on the host when sandbox creation fails.

Do not report tool success without execution evidence.
```

---

# 53. Final Invariant

```text
HTTP FETCH
=
CONNECT-TIME DNS VALIDATION
+ SAFE ADDRESS PINNING
+ HOSTNAME TLS
+ REDIRECT REVALIDATION
+ STREAM CAP
+ TIMEOUT

WEB SEARCH
=
TAVILY
→ BRAVE
→ FIRECRAWL
→ ERROR ONLY AFTER ALL USABLE PROVIDERS FAIL

DANGEROUS TOOLS
=
EXECUTION MODE
+ WORK TREE AUTH
+ TRUSTED ORIGIN
+ ACTIVE MISSION
+ CAPABILITY GRANT
+ SANDBOX
+ RESOURCE LIMITS
+ AUDIT EVIDENCE

DONE
=
SECURITY TESTS PASS
+ FALLBACK TESTS PASS
+ AUTH TESTS PASS
+ PUBLIC ROUTES REMAIN PUBLIC
+ REAL TOOL EXECUTION VERIFIED
```

**END OF SPEC**

[1]: https://nodejs.org/api/http.html "HTTP | Node.js v26.5.0 Documentation"
[2]: https://nodejs.org/api/https.html "HTTPS | Node.js v26.5.0 Documentation"
[3]: https://docs.tavily.com/documentation/api-reference/endpoint/search "Tavily Search - Tavily Docs"
[4]: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started "Brave Search - API"
[5]: https://docs.firecrawl.dev/api-reference/endpoint/search "Search - Firecrawl Docs"
