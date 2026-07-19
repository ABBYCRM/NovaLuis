---
name: tool-orchestration-accuracy
description: Select, discover, call, verify, retry, and compose NOVA tools and connected apps with schema-level precision and minimal risk.
metadata: {"openclaw":{"emoji":"🛠️"}}
---
<!-- tags: tools, orchestration, schemas, retries, connected-apps, accuracy -->

# Tool Orchestration Accuracy

Use whenever a mission requires one or more tools, APIs, connected apps, browser actions, code execution, files, search, email, calendar, social media, or deployment.

## Tool selection sequence

1. Define the exact state to observe or change.
2. Prefer a direct first-party API or repository tool.
3. Use connected-app discovery when OAuth/account context is required.
4. Use browser automation only when no reliable API exists or UI validation is required.
5. Use shell/code execution for local inspection, transformation, testing, and reproducible automation.
6. Use a human confirmation gate only for an ambiguous destructive or high-impact action.

Never deny capability before checking the real tool registry, connection state, and required credentials.

## Schema-first calling

Before every call:

- read the tool description and argument schema;
- map each user constraint to a specific argument;
- resolve IDs through search/read calls rather than guessing;
- distinguish message IDs, thread IDs, draft IDs, event IDs, branch names, SHAs, deployment IDs, and account IDs;
- omit unsupported or empty fields;
- choose read-only operations before writes;
- confirm timezone, date range, pagination, and result limits.

If the tool returns a wrapper, inspect the inner result and error fields. Do not treat an HTTP status or outer `ok` alone as proof.

## Connected-app protocol

When NOVA services are relevant, begin with:

```bash
node {baseDir}/../nova-services/nova-services.mjs status
node {baseDir}/../nova-services/nova-services.mjs composio-status
node {baseDir}/../nova-services/nova-services.mjs composio-connections
```

Then search by intended action, not by a guessed slug:

```bash
node {baseDir}/../nova-services/nova-services.mjs composio-search --query 'exact user action and target app'
```

Inspect the returned schemas, choose the minimum tool set, and execute exact arguments. If disconnected, generate the real hosted connection link with `composio-connect`.

## Read → decide → write → verify

For mutations:

1. Read current state.
2. Compare it with the requested state.
3. Apply the smallest mutation.
4. Read the target again.
5. Verify the externally visible effect when relevant.
6. Preserve rollback information.

Examples:

- Email: read thread → draft/update/send → confirm sent state.
- Calendar: read event and availability → create/update → re-read exact event.
- GitHub: read branch/SHA/file → update → inspect commit/diff/status.
- Deployment: resolve app/service → deploy exact revision → wait terminal state → probe live endpoints.
- Social publishing: validate account, public media URL, format, and schedule → publish → require returned platform media/post ID.

## Retry policy

Classify failures before retrying:

- Validation error: correct arguments; do not retry unchanged.
- Authentication/authorization: inspect connection and scopes; do not mislabel as outage.
- Rate limit: honor retry/reset metadata and reduce concurrency.
- Network/transient 5xx: retry with bounded exponential backoff and jitter.
- Conflict/lock: re-read state and decide whether another worker completed the action.
- Unknown tool: refresh tool discovery; do not repeatedly guess names.
- Partial success: reconcile completed items and retry only unresolved items.

Change one variable per diagnostic retry. Cap retries and surface the final observed error.

## Idempotency and duplicate prevention

For writes that may be retried:

- use provider idempotency keys when supported;
- store external IDs and request fingerprints;
- claim jobs with a database lock or lease;
- treat timeouts as unknown outcomes until state is re-read;
- never publish, send, charge, merge, or deploy twice merely because the first response was lost.

## Pagination and completeness

A first page is not “all.” Follow pagination until:

- the requested count is satisfied;
- the provider reports no next page;
- or an explicit bounded limit is reached and reported.

Deduplicate by stable IDs, not display text.

## Browser fallback

Before clicking:

- confirm URL, account, workspace, and environment;
- wait for stable selectors and visible state;
- avoid coordinate-only clicks;
- capture pre-action state for consequential writes;
- verify resulting text, URL, network response, or persisted state;
- run mobile and desktop checks when layout matters.

Never bypass CAPTCHA, MFA, consent, or access controls.

## Accuracy self-check

Before declaring a tool workflow complete:

- Were the exact target and account resolved?
- Were all pages/results inspected?
- Did a write receive independent verification?
- Could a timeout have produced an unknown duplicate?
- Were secrets excluded from logs and outputs?
- Did the workflow use the minimum permissions?
- Does the evidence prove the user’s requested outcome, not merely tool availability?

Use the `evidence-first-execution` verdict rules.

## References

Consult current primary documentation when behavior may have changed, including OpenClaw tool/skill documentation and the provider’s official API reference. For GitHub REST workflows follow GitHub’s official best practices: authenticated calls, redirects, rate-limit handling, conditional requests, restrained concurrency, and explicit error handling.
