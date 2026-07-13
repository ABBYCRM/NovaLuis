---

name: "NOVA internal operating rules"
description: >-
Standing execution, branch, deployment, self-repair, and evidence-verification
rules for every agent working on NOVA or Supernova.
---------------------------------------------------

# NOVA Internal Operating Rules

These rules are mandatory for every agent, subagent, automation, and runtime process working on NOVA or Supernova.

They are execution requirements, not optional guidance.

---

# 1. Global Completion Rule

A task is complete only when its required outcome is supported by real evidence.

```text
CLAIMED
≠
EXECUTED

EXECUTED
≠
VERIFIED

VERIFIED
=
required action executed
+ expected result observed
+ acceptance criteria passed
+ evidence recorded
```

Permitted final verdicts:

```text
VERIFIED
FAILED
UNVERIFIED
VERIFIED_BLOCKED
VERIFIED_OPERATOR_ACTION_REQUIRED
```

The runtime must never convert `UNVERIFIED` into success.

---

# 2. Self-Fix Rule

## Core Rule

Before asking the operator to perform any corrective action, the agent must determine:

```text
Can this be completed using the currently available tools,
credentials, repository access, APIs, browser access, or runtime?
```

When the answer is yes:

```text
FIX
→ VERIFY
→ REPORT
```

Do not ask the operator to perform work the agent can perform itself.

---

## Required Self-Fix Sequence

```text
1. Read the real error.
2. Inspect the current state.
3. Inspect available tools and capabilities.
4. Identify the probable root cause.
5. Apply the smallest valid correction.
6. Execute the relevant verification.
7. Compare the observed result with the expected result.
8. Repeat when necessary and within the correction budget.
```

---

## Knowledge Gap Rule

When the problem cannot be solved from current verified knowledge:

```text
SEARCH OFFICIAL DOCUMENTATION FIRST
```

Preferred source order:

```text
1. Official product documentation
2. Official API documentation
3. Official repository
4. Official release notes
5. Primary technical sources
6. Reputable secondary sources
```

Do not declare a platform limitation based only on model memory.

---

## Blocker Rule

A blocker may be surfaced only when:

* The required capability does not exist
* The required repository or resource is inaccessible
* Required credentials are unavailable
* An external provider rejects the request
* Operator approval is required
* A billing, account, or legal prerequisite exists
* Continuing would require fabrication or unauthorized action

The blocker must include evidence.

Correct:

```text
VERIFIED_OPERATOR_ACTION_REQUIRED

Observed:
Render returned HTTP 402 for service creation.

Required operator action:
Add an accepted payment method to the Render account.
```

Incorrect:

```text
Please try deploying it yourself.
```

---

## Prohibited Behavior

* Asking the operator to run commands the agent can run
* Asking the operator to inspect logs the agent can inspect
* Asking the operator to edit files the agent can edit
* Repeating an unchanged failed attempt
* Guessing an error cause without reading the error
* Declaring failure before capability discovery
* Inventing a blocker without tool evidence
* Claiming a correction worked without verification

---

# 3. Branch and Push Rule

## Required Branch Format

Every change must use a descriptive branch name:

```text
<YYYY-MM-DD>-<what-changed>
```

Valid examples:

```text
2026-07-13-chat-menu-save-to-nova
2026-07-13-global-state-stripper-fix
2026-07-13-model-router-provider-fallback
```

Required validation pattern:

```regex
^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$
```

Invalid:

```text
fix
new-branch
test123
2026-07-13_fix
2026-07-13-
```

---

## Branch Creation Rule

Every new branch must begin from the latest remote `main`.

Required sequence:

```bash
git status --short
git fetch origin --prune
git switch --detach origin/main
git switch -c "<YYYY-MM-DD>-<what-changed>"
```

Equivalent safe sequence:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git switch -c "<YYYY-MM-DD>-<what-changed>"
```

The second sequence may be used only when:

* The local worktree is clean
* Local `main` has no unpushed commits
* `main` can be fast-forwarded

---

## Latest-Project Invariant

Before push, the latest remote `main` must be an ancestor of the branch:

```bash
git fetch origin --prune

git merge-base --is-ancestor \
  origin/main \
  HEAD
```

Required result:

```text
exit code 0
```

If the result is nonzero:

```text
BRANCH IS STALE
```

Required correction:

```text
merge or rebase latest origin/main
→ resolve conflicts
→ rerun tests
→ rerun build
→ push only after verification
```

---

## No-Loss-of-Function Rule

A branch must preserve the complete latest project.

Before push, inspect:

```bash
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
```

The agent must detect:

* Unexpected file deletion
* Missing application directories
* Deleted configuration
* Removed routes
* Removed dependencies
* Reverted prior fixes
* Replaced files containing unrelated functionality
* Generated placeholders replacing real code

Unexpected deletion is a hard stop.

---

## Push Rule

Default push target:

```text
NEW REMOTE BRANCH
```

Command pattern:

```bash
git push \
  origin \
  "HEAD:refs/heads/<target-branch>"
```

Do not assume the local source branch is named `main`.

---

## Remote Verification

After pushing:

```bash
LOCAL_SHA="$(git rev-parse HEAD)"

REMOTE_SHA="$(
  git ls-remote \
    origin \
    "refs/heads/<target-branch>" |
  awk '{print $1}'
)"

test "$LOCAL_SHA" = "$REMOTE_SHA"
```

A push is verified only when:

```text
git push exit code = 0
AND
remote branch exists
AND
remote SHA = local intended SHA
```

---

## `main` Handling

A feature push must not automatically modify remote `main`.

Correct lifecycle:

```text
latest origin/main
→ create feature branch
→ implement
→ verify
→ push feature branch
→ review or merge
→ remote main advances through intentional merge
→ fetch latest origin/main before next task
```

After the feature is merged, the next task must begin with:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
```

Do not push the feature branch directly into `main` unless the operator explicitly requested a direct-main workflow.

---

## Force-Push Rule

Forbidden by default:

```bash
git push --force
git push -f
git push +HEAD:refs/heads/<branch>
```

`--force-with-lease` requires explicit operator authorization and a freshly observed expected remote SHA.

A rejected normal push must never trigger automatic force-push behavior.

---

# 4. Deployment Rule

## Required Order

```text
CODE VERIFIED LOCALLY
→ COMMIT CREATED
→ COMMIT PUSHED TO GITHUB
→ REMOTE SHA VERIFIED
→ MANUAL RENDER DEPLOY TRIGGERED
→ DEPLOY STATUS VERIFIED
→ HTTP VERIFIED
→ VISUAL VERIFIED WHEN APPLICABLE
```

Never deploy an unpushed local commit.

---

## Commit Identity Rule

The deployment must target a commit that exists on GitHub.

Required evidence:

```text
expected Git SHA
remote branch SHA
Render deployed Git SHA
```

These values must match.

If Render deploys a different commit:

```text
DEPLOYMENT_MISMATCH
```

Do not report the requested change as live.

---

## Manual Render Deployment

After GitHub verification:

1. Identify the correct Render service.
2. Confirm the service branch or commit configuration.
3. Trigger a manual deployment.
4. Capture the deploy identifier.
5. Poll the deployment status.
6. Wait for a terminal state.
7. Verify the deployed commit.
8. Probe the live application.

Accepted deployment success:

```text
Render status = live
AND
deployed commit = expected commit
AND
health probe passes
```

A deploy request being accepted is not proof that the deployment became live.

---

## Deployment Failure States

Examples:

```text
build_failed
update_failed
pre_deploy_failed
canceled
timed_out
wrong_commit
health_check_failed
```

On failure:

```text
READ REAL LOG
→ IDENTIFY ROOT CAUSE
→ PATCH
→ TEST
→ PUSH
→ REDEPLOY
→ REVERIFY
```

Do not repeatedly deploy the same failing commit without changing a relevant variable.

---

# 5. Render Environment Variable Rule

New environment-variable keys may be declared in:

```text
render.yaml
```

Non-secret value:

```yaml
envVars:
  - key: FEATURE_MODE
    value: "enabled"
```

Secret declaration:

```yaml
envVars:
  - key: PROVIDER_API_KEY
    sync: false
```

`sync: false` means:

```text
DECLARE THE KEY
BUT DO NOT STORE THE SECRET VALUE IN THE REPOSITORY
```

It does not populate the value automatically.

The value must be configured through the Render dashboard or an authorized secret-management API.

---

## Secret Rules

Never place secret values in:

* `render.yaml`
* Git commits
* Source files
* Markdown documentation
* Build logs
* Deployment logs
* Agent messages
* URLs
* Query strings
* Screenshots
* Test fixtures

---

## Secret Verification

The runtime may verify:

```text
secret key exists
service receives the key
integration authenticates successfully
```

The runtime must not print the raw value.

Example safe status:

```json
{
  "key": "PROVIDER_API_KEY",
  "configured": true,
  "value": "[REDACTED]"
}
```

---

# 6. AI_EXECUTION Loop

Every task must follow:

```text
(Goal + Context + Constraints + Tools + Memory)
→ Observe
→ Plan
→ Act
→ Verify
→ Compare
→ Correct
→ Repeat
→ Final
```

Formal rule:

```text
V = TRUE
→ FINAL VERIFIED

V = FALSE
→ CORRECT AND REPEAT

V = UNKNOWN
→ OBSERVE MORE OR REPORT UNVERIFIED
```

---

## 6.1 Observe

Before changing anything, gather:

* Current repository state
* Current branch
* Latest remote state
* Relevant files
* Existing implementation
* Available tools
* Existing tests
* Runtime configuration
* Deployment status
* Real errors and logs

Do not plan from assumptions when the real state can be inspected.

---

## 6.2 Plan

The plan must define:

```text
goal
scope
files expected to change
actions
constraints
acceptance criteria
verification methods
rollback condition
```

Every planned action must contribute directly to the goal or required verification.

---

## 6.3 Alignment Gate

Before executing an action, verify:

```text
action belongs to current plan
AND
action is within scope
AND
required capability exists
AND
action does not violate constraints
AND
action has a defined verification method
```

If an action fails alignment:

```text
ACTION_DENIED
```

Do not allow agents to drift into unrelated cleanup, architecture changes, or destructive modifications.

---

## 6.4 Act

Execute through real tools.

Record:

* Tool used
* Command or operation
* Target
* Start time
* Exit status
* Output summary
* Files changed
* External side effects

A proposed command is not an executed command.

---

## 6.5 Verify

Verification must use external evidence.

Accepted evidence includes:

* Command exit codes
* Test output
* Build output
* Typecheck output
* Lint output
* Git diff
* File hashes
* HTTP responses
* API responses
* Database queries
* Render deployment status
* Deployed commit SHA
* Browser DOM inspection
* Playwright assertions
* Screenshots
* Application logs

Agent-written summaries are not independent evidence.

---

## 6.6 Compare

Compare the observed result against every acceptance criterion.

```text
expected
vs.
observed
=
delta
```

Possible criterion results:

```text
PASS
FAIL
UNKNOWN
```

The task verdict must be computed mechanically:

```text
any FAIL
→ V = FALSE

no FAIL but one or more UNKNOWN
→ V = UNKNOWN

all PASS
→ V = TRUE
```

---

## 6.7 Correct

When verification fails:

1. Read the actual failure.
2. Classify the failure.
3. Identify the root cause.
4. Select one relevant variable to change.
5. Apply the correction.
6. Repeat the failed verification.
7. Rerun dependent verification.
8. Record the new result.

Do not repeat the same attempt unchanged.

---

## 6.8 Bounded Correction Loop

Default maximum:

```text
3 correction cycles per failure class
```

A cycle beyond the limit requires:

* New evidence
* A different root-cause hypothesis
* A different corrective variable
* Or explicit operator authorization

The limit prevents infinite execution loops.

It does not authorize false completion.

---

# 7. Runtime Enforcement

Code-level enforcement belongs in:

```text
artifacts/api-server/src/runtime.ts
```

The runtime must implement the following minimum contract.

```ts
export type VerificationVerdict =
  | "TRUE"
  | "FALSE"
  | "UNKNOWN";

export type FinalStatus =
  | "VERIFIED"
  | "FAILED"
  | "UNVERIFIED"
  | "VERIFIED_BLOCKED"
  | "VERIFIED_OPERATOR_ACTION_REQUIRED";

export interface ExecutionEvidence {
  id: string;

  source:
    | "COMMAND"
    | "TEST"
    | "BUILD"
    | "HTTP"
    | "BROWSER"
    | "DEPLOYMENT"
    | "GIT"
    | "DATABASE"
    | "RUNTIME";

  observedAt: string;

  status:
    | "SUCCEEDED"
    | "FAILED"
    | "BLOCKED"
    | "UNAVAILABLE";

  summary: string;

  command?: string;
  exitCode?: number;
  httpStatus?: number;
  artifactPath?: string;
  artifactHash?: string;
  commitSha?: string;
}

export interface AcceptanceCriterionResult {
  criterionId: string;
  verdict: VerificationVerdict;
  reason: string;
  evidenceIds: string[];
}

export interface RuntimePlan {
  id: string;
  goal: string;
  constraints: string[];
  plannedActions: string[];
  acceptanceCriteria: Array<{
    id: string;
    description: string;
  }>;
  maximumCorrections: number;
}

export interface RuntimeVerification {
  verdict: VerificationVerdict;
  criteria: AcceptanceCriterionResult[];
  evidence: ExecutionEvidence[];
  correctionCount: number;
}
```

---

## Alignment Enforcement

```ts
export function assertActionAligned(
  plan: RuntimePlan,
  action: string,
): void {
  const aligned = plan.plannedActions.includes(action);

  if (!aligned) {
    throw new Error(
      `PLAN_ALIGNMENT_FAILED:${action}`,
    );
  }
}
```

Production implementation may support structured action identifiers, but it must not rely only on fuzzy semantic similarity.

---

## Evidence Validation

```ts
export function isValidEvidence(
  evidence: ExecutionEvidence,
): boolean {
  return Boolean(
    evidence.id &&
    evidence.source &&
    evidence.observedAt &&
    evidence.status &&
    evidence.summary,
  );
}
```

Evidence sourced only from model claims must be rejected.

---

## Mechanical Verdict

```ts
export function computeVerificationVerdict(
  results: AcceptanceCriterionResult[],
): VerificationVerdict {
  if (results.length === 0) {
    return "UNKNOWN";
  }

  if (
    results.some(
      (result) => result.verdict === "FALSE",
    )
  ) {
    return "FALSE";
  }

  if (
    results.some(
      (result) => result.verdict === "UNKNOWN",
    )
  ) {
    return "UNKNOWN";
  }

  return "TRUE";
}
```

---

## Completion Guard

```ts
export function assertVerifiedCompletion(
  verification: RuntimeVerification,
): void {
  const computed = computeVerificationVerdict(
    verification.criteria,
  );

  if (computed !== verification.verdict) {
    throw new Error(
      "VERIFICATION_VERDICT_MISMATCH",
    );
  }

  if (computed !== "TRUE") {
    throw new Error(
      `COMPLETION_DENIED:${computed}`,
    );
  }

  const evidenceById = new Map(
    verification.evidence
      .filter(isValidEvidence)
      .map((evidence) => [
        evidence.id,
        evidence,
      ]),
  );

  for (const criterion of verification.criteria) {
    if (criterion.evidenceIds.length === 0) {
      throw new Error(
        `CRITERION_HAS_NO_EVIDENCE:${criterion.criterionId}`,
      );
    }

    for (const evidenceId of criterion.evidenceIds) {
      if (!evidenceById.has(evidenceId)) {
        throw new Error(
          `MISSING_EVIDENCE:${criterion.criterionId}:${evidenceId}`,
        );
      }
    }
  }
}
```

---

## Correction Guard

```ts
export function assertCorrectionAllowed(
  plan: RuntimePlan,
  verification: RuntimeVerification,
): void {
  if (verification.verdict === "TRUE") {
    throw new Error(
      "CORRECTION_NOT_REQUIRED",
    );
  }

  if (
    verification.correctionCount >=
    plan.maximumCorrections
  ) {
    throw new Error(
      "CORRECTION_BUDGET_EXHAUSTED",
    );
  }
}
```

---

# 8. Required Runtime Tests

Create or maintain tests proving:

```text
unplanned action
→ rejected

criterion without evidence
→ completion rejected

criterion with missing evidence ID
→ completion rejected

one failed criterion
→ verdict FALSE

one unknown criterion
→ verdict UNKNOWN

all criteria passed with valid evidence
→ verdict TRUE

declared verdict differs from computed verdict
→ rejected

correction attempted after verified success
→ rejected

correction exceeds budget
→ rejected
```

Example test location:

```text
artifacts/api-server/src/runtime.test.ts
```

---

# 9. Required Verification by Change Type

## Source-Code Change

Run applicable:

```text
typecheck
lint
unit tests
integration tests
build
```

## API Change

Run:

```text
unit or integration tests
build
HTTP request against affected route
authorization checks
negative-path request
```

## UI Change

Run:

```text
build
Playwright or ui-smoke
desktop viewport
mobile viewport
DOM assertion
screenshot evidence
```

## Deployment Change

Run:

```text
configuration validation
build
Render deployment
deploy-status verification
commit-SHA comparison
health probe
```

## Database Change

Run:

```text
migration validation
migration execution
schema inspection
read/write probe
rollback or forward-fix validation
```

---

# 10. Post-Execution Review

Before final reporting, compare:

```text
original goal
planned scope
actual files changed
actual actions executed
acceptance criteria
verification evidence
remaining differences
```

Required question:

```text
Did the execution produce the requested result
without losing existing functionality?
```

If no:

```text
V = FALSE
→ correct
```

If unknown:

```text
V = UNKNOWN
→ observe more or report UNVERIFIED
```

---

# 11. Reporting Contract

The final report must contain only observed facts.

Required fields:

```text
status
branch
commit SHA
files changed
commands executed
tests executed
build result
push verification
deployment result
HTTP verification
browser verification
remaining blockers
```

Example:

```text
Status: VERIFIED

Branch:
2026-07-13-global-state-stripper-fix

Commit:
abc123...

Observed:
- Unit tests passed with exit code 0.
- Production build passed with exit code 0.
- Remote branch SHA matched local HEAD.
- Render deployed commit abc123...
- Health endpoint returned HTTP 200.
- Playwright confirmed the marker was hidden.
- Mid-line GLOBAL_STATE prose remained visible.
```

Do not report an operation that was only planned.

---

# 12. Hard Prohibitions

```text
NO fabricated file changes
NO fabricated commands
NO fabricated test results
NO fabricated build results
NO fabricated Git push
NO fabricated Render deployment
NO fabricated browser verification
NO silent loss of existing functionality
NO automatic force push
NO deployment of unpushed code
NO secret values in the repository
NO completion when V is FALSE
NO completion when V is UNKNOWN
```

---

# 13. Final Invariant

```text
SELF-FIX WHEN CAPABLE

SEARCH OFFICIAL SOURCES WHEN KNOWLEDGE IS MISSING

BRANCH FROM LATEST origin/main

PUSH TO A DESCRIPTIVE NEW BRANCH

DO NOT MODIFY main AUTOMATICALLY

VERIFY REMOTE SHA

PUSH BEFORE DEPLOY

MANUALLY DEPLOY THE VERIFIED COMMIT

VERIFY HTTP AND UI

CORRECT ON FAILURE

REPORT ONLY OBSERVED EVIDENCE

DONE ONLY WHEN V = TRUE
```

**END OF SPEC**
