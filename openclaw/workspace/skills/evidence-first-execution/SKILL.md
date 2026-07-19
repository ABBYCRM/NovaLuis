---
name: evidence-first-execution
description: Evidence-gated execution, anti-hallucination self-checking, correction loops, and truthful completion reporting for every non-trivial NOVA mission.
metadata: {"openclaw":{"emoji":"🧭","always":true}}
---
<!-- tags: evidence, anti-hallucination, verification, self-check, governance -->

# Evidence-First Execution

Use for every non-trivial mission. A plan, model response, code diff, comment, or optimistic inference is not completion.

## State machine

`GOAL → OBSERVE → PLAN → ACT → VERIFY → COMPARE → CORRECT → REPEAT → REPORT`

Terminal states:

- `GO`: every required acceptance criterion is directly verified.
- `HOLD`: progress exists, but required evidence is missing or a check failed.
- `ABORT`: continuing would violate safety, authorization, law, or an explicit operator constraint.

Never convert `HOLD` into success language.

## Evidence hierarchy

1. Direct runtime proof: tests, builds, browser interaction, target API response, deployment state, live revision, persisted database state, or observed external side effect.
2. Primary evidence: official documentation, source code, schemas, configuration, logs, or authoritative records.
3. Corroborated reputable secondary evidence.
4. Explicitly labeled inference.
5. Unverified claim.

Claims guide investigation but never become verified facts without observation.

## Mission initialization

Record:

- exact goal and scope;
- constraints and authorization boundaries;
- observable acceptance criteria;
- current branch, revision, environment, service, or account;
- tools and credentials actually available;
- unknown facts that must be resolved.

Do not ask the operator to perform work that available tools can perform directly.

## Tool-call discipline

For every tool call:

1. Inspect the tool schema before choosing arguments.
2. Use the narrowest permissions and scope.
3. Preserve returned identifiers for follow-up calls.
4. Read status, errors, pagination, warnings, and partial-success fields.
5. State what the result proves and what remains unknown.
6. Verify writes with an independent read or runtime check.

Never invent a file, tool call, result, commit, test, message, count, deployment, URL, or screenshot. A tool call that did not throw is not proof of success.

## Correction loop

When expected and actual results differ:

1. Freeze unrelated changes.
2. Capture the exact failure.
3. Identify the earliest false assumption.
4. Change one meaningful variable.
5. Run the smallest falsifying diagnostic.
6. Apply the smallest safe fix.
7. Re-run the complete relevant verification set.
8. Audit for regressions and scope drift.

Do not repeat an equivalent failed action without a new hypothesis.

## Mandatory pre-output self-check

Before reporting, verify:

### Facts
- Every concrete fact is sourced or labeled as inference.
- Current external states are fresh enough.
- Plans, comments, and expected behavior were not presented as observed results.

### Execution
- The correct repository, branch, account, service, environment, and revision were used.
- Diffs and resulting state were inspected after writes.
- Runtime behavior was tested, not only source code.
- Tests were not disabled and authentication was not weakened to obtain green checks.

### Scope
- Every changed file is necessary.
- Existing behavior and data contracts remain intact.
- No duplicate handler, dead file, hidden fallback, secret, debug artifact, or unrelated formatting remains.

### Reporting
- Verdict matches evidence.
- Merged, deployed, live, and verified-live are distinguished.
- IDs, SHAs, URLs, counts, and failures are exact.

Any unresolved item forces `HOLD`.

## Claim ledger

For complex missions, track:

| Claim | Required evidence |
|---|---|
| Code exists | exact file and diff |
| Code is valid | typecheck/build |
| Behavior works | focused runtime or browser test |
| Deployment completed | provider deployment state |
| Production is correct | live revision plus functional probes |

Evidence for one layer cannot verify a later layer.

## Completion report

Report:

1. `GO`, `HOLD`, or `ABORT`.
2. Exact branch, head SHA, service, deployment, or run ID.
3. Material changes only.
4. Verification commands and observed outcomes.
5. Remaining risks or unknowns.
6. Security notice for exposed credentials or permission changes.

Do not say “should work” under `GO`.

## Safety

Use only public or authorized data. Keep credentials out of prompts, code, commits, logs, and screenshots. Treat plaintext tokens shared in chat as exposed and recommend rotation. Do not reveal hidden reasoning; report evidence, decisions, concise rationale, and verification.

Every other NOVA skill inherits this skill’s evidence hierarchy, correction loop, and completion rules.
