---
name: github-connected-operations
description: Evidence-based GitHub repository inspection, issue and pull-request work, CI repair, branch-safe editing, merging, and deployment handoff through NOVA connected tools.
metadata: {"openclaw":{"emoji":"🐙","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---
<!-- tags: github, repositories, pull-requests, ci, branches, deployment -->

# GitHub Connected Operations

Use for any GitHub repository URL, repository audit, code modification, issue, pull request, workflow, release, merge, or deployment request.

## Capability discovery

Before claiming GitHub is unavailable:

```bash
node {baseDir}/../nova-services/nova-services.mjs status
node {baseDir}/../nova-services/nova-services.mjs composio-status
node {baseDir}/../nova-services/nova-services.mjs composio-connections
node {baseDir}/../nova-services/nova-services.mjs github-repo --url <repository-url>
```

For private repositories or write actions, discover the exact connected GitHub tools and schemas:

```bash
node {baseDir}/../nova-services/nova-services.mjs composio-search --query 'exact GitHub action, repository, and desired result'
```

Never expose tokens or place credentials in repository files, remotes, command history, logs, or reports.

## Repository observation

Before editing, establish:

- owner, repository, visibility, permissions, default branch, and current head SHA;
- branch protection and required checks;
- package/build systems, runtime entrypoints, deployment files, database schemas, tests, and repository instructions;
- open PRs or branches that already address the issue;
- exact production service and revision when deployment is in scope.

Read complete files that govern the runtime path. Do not audit a React scaffold when production serves a separate static HTML bundle, and do not modify generated output when source is authoritative.

## Branch and commit discipline

Follow the operator’s explicit branch rule. Otherwise:

1. Start from the latest verified default-branch SHA.
2. Create one focused branch for the mission.
3. Use small commits with truthful messages.
4. Never force-push, rewrite history, or delete branches unless explicitly authorized.
5. Before each write, use the current file blob SHA to prevent lost updates.
6. Inspect the cumulative diff against the base, not only the latest commit.

If direct-to-main work is explicitly requested, keep commits independently reversible and verify every head before the next write.

## File modification protocol

For every changed file:

- read the whole relevant section and its callers;
- preserve line endings, syntax, and repository conventions;
- change the smallest coherent surface;
- avoid reformatting unrelated code;
- add or update a regression test for confirmed defects;
- record migration, rollback, and deployment implications.

After writing, re-fetch the file or commit and inspect the actual patch.

## Pull requests

A professional PR contains:

- exact problem and confirmed root cause;
- files and subsystems changed;
- explicit non-goals and preserved behavior;
- test/build/browser evidence;
- security and migration notes;
- deployment and rollback procedure;
- remaining unknowns.

Do not mark ready until the exact head has passed required checks. A green workflow for an older SHA does not verify the current PR head.

## CI repair

1. Identify the exact failing run, job, step, head SHA, and full error.
2. Distinguish product defects from stale tests, unavailable secrets, runner drift, and workflow defects.
3. Reproduce locally or add durable failure artifacts when possible.
4. Fix the earliest confirmed cause.
5. Re-run all required workflows on the new exact head.
6. Inspect artifacts and logs; do not rely only on a green badge.

Never disable, skip, soften, or remove a meaningful test merely to make CI green.

## Merge protocol

Merge only when authorized and when:

- PR head SHA is known;
- required reviews/checks are satisfied or the operator explicitly accepts the exception;
- mergeability is current;
- final diff is audited;
- secrets and temporary files are absent.

Use an expected head SHA when the tool supports it. Record the resulting merge commit exactly.

## Deployment handoff

A merge is not a deployment. When deployment is requested:

1. Resolve the exact provider app/service.
2. Trigger deployment from the merged revision.
3. Wait for a terminal provider state.
4. Probe health and feature-specific endpoints.
5. Verify the live revision through a version endpoint or provider metadata.
6. Exercise the changed user path when feasible.
7. Report merged, deployed, live, and verified-live separately.

## GitHub API accuracy

Follow current official GitHub REST guidance:

- authenticate with the appropriate method and least privilege;
- prefer GitHub Apps or the workflow `GITHUB_TOKEN` over broad personal tokens;
- handle redirects, pagination, conditional requests, primary and secondary rate limits;
- avoid unnecessary polling and concurrent mutations;
- pause between dependent writes;
- inspect and report errors instead of ignoring them.

## Final repository audit

Before `GO`, confirm:

- intended files only;
- no accidental deletions or historical-note truncation;
- no secrets, generated junk, or unrelated skill files;
- no duplicate runtime handlers or dead fallback paths;
- typecheck/build/tests/browser checks pass on exact head;
- deployment state matches the reported revision when deployment was requested.

Use `evidence-first-execution` for the final verdict and claim ledger.
