---
name: "NOVA internal operating rules"
description: "Standing self-repair, branch, deployment, execution-loop, and evidence-verification rules for NOVA and Supernova agents."
---

# NOVA Internal Operating Rules

## 1. Self-fix

Before asking the operator to act, determine whether the current agent can solve the problem with available tools, credentials, repository access, APIs, browser access, or official documentation.

```text
CAN FIX
→ fix
→ verify
→ report

CANNOT FIX
→ gather evidence
→ classify the real blocker
→ request only the operator action that cannot be automated
```

Do not ask the operator to run commands, inspect logs, or edit files that the agent can handle.

## 2. Branch and push

Every change uses a descriptive branch:

```text
YYYY-MM-DD-what-changed
```

Required sequence:

```text
fetch latest origin/main
→ create branch from latest origin/main
→ implement
→ verify
→ push branch
→ verify remote SHA
→ merge intentionally
→ fetch updated main before the next task
```

A feature push must not silently modify remote `main`. Never force-push without explicit authorization.

Before push, verify that `origin/main` is an ancestor of the branch and inspect unexpected deletions or reversions.

## 3. Deploy

```text
local verification
→ Git commit
→ GitHub push
→ remote SHA verification
→ manual Render deploy
→ deploy reaches live
→ deployed SHA matches
→ HTTP verification
→ browser verification when applicable
```

A queued deploy, successful build, or `live` status without the expected commit and application behavior is not completion.

Secrets may be declared in `render.yaml` with `sync: false`, but secret values must never enter the repository.

## 4. AI execution loop

```text
Goal + Context + Constraints + Tools + Memory
→ Observe
→ Plan
→ Act
→ Verify
→ Compare
→ Correct
→ Repeat
```

Mechanical verdict:

```text
all criteria PASS
→ VERIFIED

any criterion FAIL
→ FALSE; correct and repeat

no failures but one or more UNKNOWN
→ UNVERIFIED; observe more or report honestly
```

## 5. Evidence

Accepted evidence includes:

- command exit codes
- tests, builds, lint, and typecheck results
- Git diff and remote SHA
- HTTP responses
- database queries
- Render deployment state and commit
- Playwright or DOM assertions
- screenshots and logs

Agent-generated narration is not independent evidence.

## 6. Correction loop

On failure:

1. read the actual error
2. classify the failure
3. identify the root cause
4. change one relevant variable
5. rerun the failed verification
6. rerun dependent checks

Do not repeat the same failed action unchanged.

Default maximum: three correction cycles per failure class unless new evidence supports another attempt.

## 7. Reporting

Report only observed facts:

```text
status
branch
commit SHA
files changed
commands or API operations executed
tests and builds
push verification
deployment verification
HTTP and browser checks
remaining blockers
```

## Hard prohibitions

- no fabricated file changes, tests, pushes, deploys, or browser checks
- no completion when verification is false or unknown
- no deployment of unpushed code
- no silent loss of existing functionality
- no secret values in source control or logs
- no automatic force push

## Final invariant

```text
DONE
=
REQUESTED RESULT
+
NO REGRESSION
+
REAL EVIDENCE
+
VERDICT TRUE
```
