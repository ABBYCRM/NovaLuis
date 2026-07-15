#!/usr/bin/env python3
"""
GitHub agentic-runtime scenario generator.

Generates a CSV of 500 unique (trigger, condition, if_action, else_action)
scenarios grounded in authoritative GitHub docs.

Output columns: id, category, trigger, condition, if_action, else_action,
                severity, source_doc

Sources (verified):
  - docs.github.com/actions/reference/workflow-syntax-for-github-actions
  - docs.github.com/actions/reference/workflows-and-actions/contexts
  - docs.github.com/actions/reference/workflow-cancellation-reference
  - docs.github.com/actions/security-guides/using-secrets-in-github-actions
  - docs.github.com/actions/concepts/security/github_token
  - docs.github.com/actions/concepts/security/openid-connect
  - docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api
  - docs.github.com/rest/authentication/authenticating-to-the-rest-api
  - docs.github.com/rest/using-the-rest-api/best-practices-for-using-the-rest-api
  - docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/
        managing-protected-branches/about-protected-branches
  - docs.github.com/en/pull-requests/.../troubleshooting-required-status-checks
  - docs.github.com/en/repositories/.../managing-a-merge-queue
  - docs.github.com/en/pull-requests/.../automatically-merging-a-pull-request
  - docs.github.com/en/pull-requests/.../addressing-merge-conflicts
  - docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
  - docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks
  - docs.github.com/en/code-security/concepts/secret-security/push-protection
  - docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates
  - docs.github.com/en/code-security/reference/supply-chain-security/
        troubleshoot-dependabot/dependabot-errors
  - docs.github.com/en/pages/configuring-github-pages-with-a-custom-domain
  - docs.github.com/en/codespaces/troubleshooting/troubleshooting-prebuilds
  - docs.github.com/en/packages
"""
import csv
import os
import random
from typing import List, Dict, Tuple

OUT_PATH = "/workspace/render_scenarios/github_scenarios.csv"
TARGET_ROWS = 500
random.seed(20260715)

# ---------------------------------------------------------------------------
# Trigger pool — short, agent-friendly phrasings
# ---------------------------------------------------------------------------
TRIGGERS: List[Tuple[str, str, str]] = [
    # ---------- ACTIONS: WORKFLOW RUN ----------
    ("T-WF", "actions_run", "A workflow run is triggered (push, PR, schedule, dispatch)"),
    ("T-WF", "actions_run", "A scheduled workflow fires (cron)"),
    ("T-WF", "actions_run", "A workflow_dispatch event is received from API/UI"),
    ("T-WF", "actions_run", "A repository_dispatch event is received from API"),
    ("T-WF", "actions_run", "A pull_request is opened against the tracked branch"),
    ("T-WF", "actions_run", "A pull_request is synchronized (new commit pushed to PR branch)"),
    ("T-WF", "actions_run", "A pull_request is reopened after push"),
    ("T-WF", "actions_run", "A pull_request is closed (merged or abandoned)"),
    ("T-WF", "actions_run", "A pull_request is converted to draft"),
    ("T-WF", "actions_run", "A pull_request_review is submitted (approved / changes_requested)"),
    ("T-WF", "actions_run", "A push to a branch is made by the GITHUB_TOKEN"),
    ("T-WF", "actions_run", "A push to a branch is made by a personal access token"),
    ("T-WF", "actions_run", "A push to a branch is made by a GitHub App installation"),
    ("T-WF", "actions_run", "A push to a branch is made from a fork (no secrets)"),
    ("T-WF", "actions_run", "A merge_group event fires (merge queue)"),
    ("T-WF", "actions_run", "A workflow_call event fires (reusable workflow invoked)"),
    ("T-WF", "actions_run", "A workflow is cancelled via API force-cancel"),
    ("T-WF", "actions_run", "A workflow is cancelled via UI button"),
    ("T-WF", "actions_run", "A new tag is pushed"),
    ("T-WF", "actions_run", "A release is published"),
    ("T-WF", "actions_run", "A workflow reaches 360-minute default timeout"),
    ("T-WF", "actions_run", "A job reaches job-level timeout-minutes"),
    ("T-WF", "actions_run", "A step reaches step-level timeout-minutes"),
    ("T-WF", "actions_run", "A matrix leg fails with fail-fast: true (default)"),
    ("T-WF", "actions_run", "A matrix leg fails with fail-fast: false"),
    ("T-WF", "actions_run", "A step uses if: always() and the run is cancelled"),
    ("T-WF", "actions_run", "A step needs needs: [other-job] and that job is skipped"),
    ("T-WF", "actions_run", "A step uses continue-on-error: true and fails"),
    ("T-WF", "actions_run", "A step uses a composite action"),
    ("T-WF", "actions_run", "A step uses a JavaScript action (node20 / node24 runner)"),
    ("T-WF", "actions_run", "A step uses a Docker container action"),
    ("T-WF", "actions_run", "A workflow run consumes more than the repo's Actions minutes quota"),
    ("T-WF", "actions_run", "A self-hosted runner picks up a job from the queue"),
    ("T-WF", "actions_run", "A self-hosted runner is offline when a job targets its label"),
    ("T-WF", "actions_run", "A workflow file has invalid YAML syntax"),
    ("T-WF", "actions_run", "A workflow file references a missing action version"),
    ("T-WF", "actions_run", "A workflow file references a private action without auth"),
    ("T-WF", "actions_run", "A workflow file uses an unknown event name"),
    ("T-WF", "actions_run", "A workflow file uses a deprecated API version (action.yml)"),

    # ---------- ACTIONS: SECRETS & TOKEN ----------
    ("T-SEC", "secrets", "A workflow tries to read secrets.MY_SECRET"),
    ("T-SEC", "secrets", "A workflow tries to read secrets.GITHUB_TOKEN"),
    ("T-SEC", "secrets", "A workflow triggered from a fork tries to read a repo secret"),
    ("T-SEC", "secrets", "A workflow uses an environment secret (requires approval)"),
    ("T-SEC", "secrets", "A workflow prints a secret to stdout (log leak risk)"),
    ("T-SEC", "secrets", "A secret is set at the org level with repository access policy"),
    ("T-SEC", "secrets", "A secret is set at the environment level with required reviewers"),
    ("T-SEC", "secrets", "A required reviewer is offline and environment secret is blocked"),
    ("T-SEC", "secrets", "GITHUB_TOKEN is granted contents: write (default) and workflow is recursive"),
    ("T-SEC", "secrets", "GITHUB_TOKEN expires mid-job (24h cap on self-hosted, 6h hosted)"),
    ("T-SEC", "secrets", "GITHUB_TOKEN is used to push a commit, which does NOT trigger a new push workflow"),
    ("T-SEC", "secrets", "GITHUB_TOKEN is used to push a tag, which does NOT trigger Pages build"),
    ("T-SEC", "secrets", "Workflow exchanges OIDC token with AWS / GCP / Azure"),
    ("T-SEC", "secrets", "Workflow OIDC trust policy is misconfigured at the cloud provider"),
    ("T-SEC", "secrets", "Workflow has permissions: read-all at workflow level"),
    ("T-SEC", "secrets", "Workflow has permissions: write-all at job level (over-restrictive)"),
    ("T-SEC", "secrets", "Org default for GITHUB_TOKEN is set to 'Read repository contents'"),
    ("T-SEC", "secrets", "PAT (classic) is used in workflow; rate limit is 5000/h per user"),
    ("T-SEC", "secrets", "Fine-grained PAT is used; perms and expiration set"),

    # ---------- API: AUTH & RATE LIMIT ----------
    ("T-API", "api", "Agent calls GET /repos/{owner}/{repo} unauthenticated"),
    ("T-API", "api", "Agent calls GET /repos/{owner}/{repo} with fine-grained PAT"),
    ("T-API", "api", "Agent calls GET /repos/{owner}/{repo} with classic PAT"),
    ("T-API", "api", "Agent calls POST /repos/{owner}/{repo}/issues (mutation)"),
    ("T-API", "api", "Agent calls GraphQL endpoint with mutations"),
    ("T-API", "api", "Agent receives 401 Unauthorized (bad credentials)"),
    ("T-API", "api", "Agent receives 403 Forbidden (insufficient permissions)"),
    ("T-API", "api", "Agent receives 403 with 'secondary rate limit' message"),
    ("T-API", "api", "Agent receives 404 (resource not found OR insufficient scope)"),
    ("T-API", "api", "Agent receives 422 (validation error)"),
    ("T-API", "api", "Agent receives 429 with Retry-After header"),
    ("T-API", "api", "Agent receives 5xx (transient)"),
    ("T-API", "api", "x-ratelimit-remaining header drops below threshold"),
    ("T-API", "api", "x-ratelimit-reset header indicates reset time in future"),
    ("T-API", "api", "Agent hits > 100 concurrent requests (secondary limit)"),
    ("T-API", "api", "Agent hits > 900 points/min on REST (secondary limit)"),
    ("T-API", "api", "Agent hits > 2000 points/min on GraphQL (secondary limit)"),
    ("T-API", "api", "Agent hits > 90s CPU per 60s real time (secondary limit)"),
    ("T-API", "api", "Agent makes > 80 content-creation requests/min (secondary limit)"),
    ("T-API", "api", "Agent makes > 500 content-creation requests/hour (secondary limit)"),
    ("T-API", "api", "Agent makes > 2000 OAuth token requests/hour (GitHub App / OAuth)"),
    ("T-API", "api", "GitHub App installation token limit: 5000/h base"),
    ("T-API", "api", "GitHub App installation on org with > 20 repos (scales +50/h per repo)"),
    ("T-API", "api", "GitHub App installation on org with > 20 users (scales +50/h per user, max 12500)"),
    ("T-API", "api", "GITHUB_TOKEN in workflow hits 1000 req/h per repo (1000/h limit)"),
    ("T-API", "api", "Unauthenticated IP hits 60 req/h"),
    ("T-API", "api", "Agent polls an endpoint that hasn't changed (304 not modified)"),
    ("T-API", "api", "Agent uses If-None-Match ETag and gets 304"),

    # ---------- WEBHOOKS ----------
    ("T-WHK", "webhook", "GitHub delivers a push event webhook to receiver"),
    ("T-WHK", "webhook", "GitHub delivers a pull_request event webhook"),
    ("T-WHK", "webhook", "GitHub delivers a ping (test) event on webhook creation"),
    ("T-WHK", "webhook", "GitHub delivers a workflow_run event webhook"),
    ("T-WHK", "webhook", "GitHub delivers a check_run event webhook"),
    ("T-WHK", "webhook", "GitHub delivers a check_suite event webhook"),
    ("T-WHK", "webhook", "GitHub delivers a status event webhook (legacy)"),
    ("T-WHK", "webhook", "Webhook receiver URL returns non-2xx (4xx/5xx)"),
    ("T-WHK", "webhook", "Webhook receiver URL is slow (>10s, GitHub times out)"),
    ("T-WHK", "webhook", "Webhook receiver URL is unreachable (DNS / firewall)"),
    ("T-WHK", "webhook", "Webhook receiver is on localhost / 127.0.0.1 (unreachable)"),
    ("T-WHK", "webhook", "Webhook receiver has self-signed cert (SSL verify fails)"),
    ("T-WHK", "webhook", "Webhook receiver has expired cert (SSL verify fails)"),
    ("T-WHK", "webhook", "Webhook receiver has incomplete cert chain (SSL verify fails)"),
    ("T-WHK", "webhook", "Webhook X-Hub-Signature-256 header is missing (no secret configured)"),
    ("T-WHK", "webhook", "Webhook X-Hub-Signature-256 header fails HMAC verify (wrong secret)"),
    ("T-WHK", "webhook", "Webhook X-Hub-Signature-256 header uses SHA-1 (legacy, deprecated)"),
    ("T-WHK", "webhook", "Webhook payload is URL-encoded but receiver expects JSON (400)"),
    ("T-WHK", "webhook", "Webhook payload is JSON but receiver expects URL-encoded (400)"),
    ("T-WHK", "webhook", "Webhook proxy / load balancer modifies body (HMAC breaks)"),
    ("T-WHK", "webhook", "Webhook is configured with active=false (no events fire)"),
    ("T-WHK", "webhook", "Webhook 'redeliver' button is clicked by user"),
    ("T-WHK", "webhook", "Webhook delivery from new IP (security alert)"),
    ("T-WHK", "webhook", "Webhook receiver processes event idempotently (delivery_id dedup)"),
    ("T-WHK", "webhook", "Webhook receiver is non-idempotent (duplicate event = duplicate side effect)"),
    ("T-WHK", "webhook", "Webhook firewall blocks GitHub's published IP ranges"),
    ("T-WHK", "webhook", "Webhook secret is leaked in logs (rotate immediately)"),
    ("T-WHK", "webhook", "Webhook secret is rotated (overlap window needed)"),
    ("T-WHK", "webhook", "Webhook receiver validates X-GitHub-Delivery GUID"),
    ("T-WHK", "webhook", "Webhook receiver validates X-GitHub-Event header"),
    ("T-WHK", "webhook", "Webhook receiver uses 'Verify -> Enqueue -> ACK' pattern (returns 200 fast)"),

    # ---------- BRANCH PROTECTION / MERGE ----------
    ("T-BP", "branch", "A pull request is opened against a protected branch"),
    ("T-BP", "branch", "A required status check has not yet run on the PR head"),
    ("T-BP", "branch", "A required status check failed"),
    ("T-BP", "branch", "A required status check was skipped (path filter / branch filter)"),
    ("T-BP", "branch", "A required check ran on a different branch than the protected one"),
    ("T-BP", "branch", "A required check has not run on the protected branch in 7+ days"),
    ("T-BP", "branch", "A required review is missing (PR has 0 approvals)"),
    ("T-BP", "branch", "A required review is from PR author (not allowed)"),
    ("T-BP", "branch", "A required review is dismissed (new commit pushed)"),
    ("T-BP", "branch", "PR has unresolved review comments / conversations"),
    ("T-BP", "branch", "PR commits are not signed (when signed commits required)"),
    ("T-BP", "branch", "PR has merge conflict with base branch"),
    ("T-BP", "branch", "PR is not up to date with base branch (strict mode)"),
    ("T-BP", "branch", "PR is up to date with base branch (loose mode passes)"),
    ("T-BP", "branch", "PR has a CODEOWNERS violation"),
    ("T-BP", "branch", "PR has admin bypass attempts (do not allow bypassing)"),
    ("T-BP", "branch", "Force-push is attempted to protected branch (blocked)"),
    ("T-BP", "branch", "Branch deletion is attempted on protected branch (blocked)"),
    ("T-BP", "branch", "Linear history required: PR has merge commit (rejected)"),
    ("T-BP", "branch", "Rebase and merge disabled in repo settings (operator chose squash)"),
    ("T-BP", "branch", "Auto-merge enabled: PR will merge when all requirements met"),
    ("T-BP", "branch", "Auto-merge disabled: new commit pushed by non-write user"),
    ("T-BP", "branch", "Merge queue: PR added to queue, conflicts with group, removed"),
    ("T-BP", "branch", "Merge queue: group is forming, waiting on required checks"),
    ("T-BP", "branch", "Merge queue: group size 1-100, batch formed, merged"),
    ("T-BP", "branch", "Merge queue: workflow does not include merge_group event (status missing)"),
    ("T-BP", "branch", "PR is added to merge queue but repo allows bypass (audit risk)"),
    ("T-BP", "branch", "Required deployment to environment 'production' has not succeeded"),
    ("T-BP", "branch", "Branch is locked (read-only) — pushes blocked"),

    # ---------- SECRET SCANNING & PUSH PROTECTION ----------
    ("T-SS", "secretscan", "git push contains a pattern matched by secret scanning"),
    ("T-SS", "secretscan", "git push is > 50MB on public repo (push protection skipped)"),
    ("T-SS", "secretscan", "git push triggers > 5 new secrets (only first 5 shown)"),
    ("T-SS", "secretscan", "git push has > 1000 existing secrets (push not blocked)"),
    ("T-SS", "secretscan", "Push protection bypassed with skip-secret-scanning:true in commit msg"),
    ("T-SS", "secretscan", "Secret scanning alert raised post-push (after leak)"),
    ("T-SS", "secretscan", "Secret scanning pattern is for legacy/old token (not blocked)"),
    ("T-SS", "secretscan", "Validity check on detected secret: secret is active (must rotate now)"),
    ("T-SS", "secretscan", "Validity check on detected secret: secret is inactive (revoked already)"),
    ("T-SS", "secretscan", "Pair pattern (AWS access + secret) split across files (not detected)"),
    ("T-SS", "secretscan", "Custom pattern added at org/enterprise level"),
    ("T-SS", "secretscan", "Designated bypasser role assigned for secret push protection"),
    ("T-SS", "secretscan", "Secret scanning user alerts visible in Security tab"),
    ("T-SS", "secretscan", "Secret scanning not enabled on private repo (org feature gated)"),
    ("T-SS", "secretscan", "Secret scanning partner alert sent to vendor (AWS, GCP, etc.)"),

    # ---------- DEPENDABOT ----------
    ("T-DB", "dependabot", "Dependabot alert raised for vulnerable dependency"),
    ("T-DB", "dependabot", "Dependabot cannot find a non-vulnerable version (constraint conflict)"),
    ("T-DB", "dependabot", "Dependabot security update is not enabled (alerts have no PR)"),
    ("T-DB", "dependabot", "Alert is for indirect/transitive dep not in manifest (no PR)"),
    ("T-DB", "dependabot", "Dependabot version update PR limit reached (5 PRs)"),
    ("T-DB", "dependabot", "Dependabot security update PR limit reached (10 PRs)"),
    ("T-DB", "dependabot", ".github/dependabot.yml missing (no version updates at all)"),
    ("T-DB", "dependabot", ".github/dependabot.yml has wrong package-ecosystem (e.g. 'node' vs 'npm')"),
    ("T-DB", "dependabot", ".github/dependabot.yml has wrong directory (manifest not found)"),
    ("T-DB", "dependabot", "Dependabot job fails: lockfile missing or unreadable"),
    ("T-DB", "dependabot", "Dependabot job fails: registry auth required (private feed)"),
    ("T-DB", "dependabot", "Dependabot runs into @dependabot ignore condition (no update)"),
    ("T-DB", "dependabot", "Dependabot update PR has failing CI (merge blocked)"),
    ("T-DB", "dependabot", "Dependabot PR is grouped (groups: { devDeps: { ... } })"),
    ("T-DB", "dependabot", "Dependabot auto-merge is enabled for patch/minor updates"),
    ("T-DB", "dependabot", "@dependabot recreate comment is used to rebuild group"),
    ("T-DB", "dependabot", "Dependabot schedule is weekly on Monday 9am"),
    ("T-DB", "dependabot", "Dependabot target-branch is non-default (PRs go to feature branch)"),
    ("T-DB", "dependabot", "Dependabot rebase strategy is configured"),
    ("T-DB", "dependabot", "Dependabot reviewer is assigned to PR"),

    # ---------- PAGES ----------
    ("T-PG", "pages", "GitHub Pages build is triggered by push to configured source branch"),
    ("T-PG", "pages", "GitHub Pages build is triggered by workflow (jekyll etc.)"),
    ("T-PG", "pages", "GitHub Pages build fails: Jekyll dependency error"),
    ("T-PG", "pages", "GitHub Pages build fails: theme gem not found"),
    ("T-PG", "pages", "GitHub Pages build fails: 404.html missing"),
    ("T-PG", "pages", "GitHub Pages custom domain CNAME file missing"),
    ("T-PG", "pages", "GitHub Pages custom domain DNS A record wrong"),
    ("T-PG", "pages", "GitHub Pages custom domain DNS CNAME wrong"),
    ("T-PG", "pages", "GitHub Pages HTTPS provisioning pending (Let's Encrypt)"),
    ("T-PG", "pages", "GitHub Pages HTTPS provisioning fails (CAA blocks LE)"),
    ("T-PG", "pages", "GitHub Pages HTTPS cert auto-renewal fails"),
    ("T-PG", "pages", "GitHub Pages served over HTTP after custom domain (Enforce HTTPS off)"),
    ("T-PG", "pages", "GitHub Pages build is slow (>10 min, soft cap)"),
    ("T-PG", "pages", "GitHub Pages repo is private on Free plan (not allowed)"),
    ("T-PG", "pages", "GitHub Pages uses unsupported plugin (build skipped)"),
    ("T-PG", "pages", "GitHub Pages commit pushed by GITHUB_TOKEN does NOT trigger build"),
    ("T-PG", "pages", "GitHub Pages static site has broken internal links (no runtime check)"),

    # ---------- CODESPACES / PREBUILDS ----------
    ("T-CS", "codespaces", "A codespace is created for a prebuild-enabled branch"),
    ("T-CS", "codespaces", "Prebuild workflow run is triggered (push to prebuild branch)"),
    ("T-CS", "codespaces", "Prebuild workflow fails (dev container config change)"),
    ("T-CS", "codespaces", "Prebuild workflow fails (spending limit reached)"),
    ("T-CS", "codespaces", "Prebuild workflow fails (permissions not authorized)"),
    ("T-CS", "codespaces", "Prebuild is not available for the user's region"),
    ("T-CS", "codespaces", "Codespace creation exceeds machine-type quota"),
    ("T-CS", "codespaces", "Codespace creation uses a previous prebuild (prebuild optimization)"),
    ("T-CS", "codespaces", "Prebuild optimization is disabled (always rebuild on failure)"),
    ("T-CS", "codespaces", "Codespace dotfiles repo is private and unreadable"),
    ("T-CS", "codespaces", "Codespace machine type is unavailable (capacity)"),
    ("T-CS", "codespaces", "Codespace idle timeout triggers auto-stop (default 30 min)"),

    # ---------- ISSUES / PRs / COMMENTS ----------
    ("T-IS", "issues", "A new issue is opened"),
    ("T-IS", "issues", "An issue is labeled with 'security' (private repo)"),
    ("T-IS", "issues", "A PR is labeled with 'do-not-merge'"),
    ("T-IS", "issues", "A bot comments on a PR (e.g. dependabot, renovate)"),
    ("T-IS", "issues", "A user @mentions a team (notification fan-out)"),
    ("T-IS", "issues", "An issue is assigned to a user (no write access to repo)"),

    # ---------- RELEASES & TAGS ----------
    ("T-RL", "release", "A git tag is pushed matching release pattern v*"),
    ("T-RL", "release", "A GitHub Release is published (draft / pre-release)"),
    ("T-RL", "release", "A GitHub Release is edited (description updated)"),
    ("T-RL", "release", "A workflow is triggered by release event (published / released / prereleased)"),
    ("T-RL", "release", "A signed release is required but tag is unsigned"),

    # ---------- GIT OPERATIONS ----------
    ("T-GIT", "git", "git push to a branch is rejected (non-fast-forward)"),
    ("T-GIT", "git", "git push to a protected branch is rejected (no review)"),
    ("T-GIT", "git", "git push of large files (>100MB) is rejected (file size limit)"),
    ("T-GIT", "git", "git push of files > 50MB triggers LFS pointer (not LFS)"),
    ("T-GIT", "git", "git push of files > 2GB rejected (absolute file size cap)"),
    ("T-GIT", "git", "Repo size exceeds 5GB soft cap (warning)"),
    ("T-GIT", "git", "Repo size exceeds GitHub Free plan limit (push blocked)"),
    ("T-GIT", "git", "git LFS bandwidth quota exceeded"),
    ("T-GIT", "git", "git submodule reference points to non-existent commit"),
    ("T-GIT", "git", "git submodule needs credentials and none provided"),
    ("T-GIT", "git", "git filter-repo / BFG on history (rewrite of remote)"),
    ("T-GIT", "git", "Repository transfer to new owner (audit log fired)"),
    ("T-GIT", "git", "Repository archived (read-only)"),
    ("T-GIT", "git", "Repository made public (private data now visible)"),
    ("T-GIT", "git", "Repository deleted (cannot restore after grace period)"),
    ("T-GIT", "git", "Branch deleted while PR still references it"),

    # ---------- PACKAGES (ghcr.io / npm / maven / nuget / docker) ----------
    ("T-PKG", "packages", "Agent pushes a Docker image to ghcr.io/org/app:tag"),
    ("T-PKG", "packages", "Agent publishes an npm package to npm.pkg.github.com"),
    ("T-PKG", "packages", "Agent publishes a Maven package to maven.pkg.github.com"),
    ("T-PKG", "packages", "Package has same name as existing (cannot overwrite)"),
    ("T-PKG", "packages", "Package visibility: public (good) / private (orgs only)"),
    ("T-PKG", "packages", "Package download hits unauthenticated limit (bandwidth/IP)"),
    ("T-PKG", "packages", "Package retention policy deletes old/unused version"),
    ("T-PKG", "packages", "Container image vulnerability scan (Dependabot) finds CVE"),
    ("T-PKG", "packages", "Container image linked package digest (immutable) - rebuild for changes"),

    # ---------- AUDIT & SECURITY ----------
    ("T-AU", "security", "Audit log streaming endpoint returns 2xx (events delivered)"),
    ("T-AU", "security", "Audit log streaming endpoint returns 5xx (events queued / lost)"),
    ("T-AU", "security", "SSO enforced: user without SSO cannot access repo"),
    ("T-AU", "security", "IP allow list enforced: request from non-allowlisted IP blocked"),
    ("T-AU", "security", "2FA enforced: user without 2FA cannot push"),
    ("T-AU", "security", "PAT (classic) without 'workflow' scope cannot edit workflows"),
    ("T-AU", "security", "Fine-grained PAT expired (request returns 401)"),
    ("T-AU", "security", "GitHub App installation removed (token no longer works)"),
    ("T-AU", "security", "Org owner added/removed (audit log entry)"),
    ("T-AU", "security", "Repository visibility changed (audit log entry)"),

    # ---------- DISPATCH (API EVENTS) ----------
    ("T-DSP", "dispatch", "Agent sends repository_dispatch event with event_type"),
    ("T-DSP", "dispatch", "Agent sends workflow_dispatch event with inputs"),
    ("T-DSP", "dispatch", "Workflow_dispatch inputs fail validation (wrong type)"),
    ("T-DSP", "dispatch", "Repository_dispatch client_payload is malformed JSON"),

    # ---------- ENVIRONMENTS & DEPLOYMENTS ----------
    ("T-ENV", "environments", "A workflow deploys to environment 'production'"),
    ("T-ENV", "environments", "Environment has required reviewers, none approved"),
    ("T-ENV", "environments", "Environment has wait timer (e.g. 5 min) - job waiting"),
    ("T-ENV", "environments", "Environment has deployment branches policy (only main)"),
    ("T-ENV", "environments", "Environment URL is set (links to deployment)"),
    ("T-ENV", "environments", "Environment is in 'in_progress' / 'success' / 'failure' / 'cancelled' state"),
    ("T-ENV", "environments", "Concurrent deploys to same environment are blocked (concurrency rule)"),

    # ---------- MATRIX & REUSABLE WORKFLOWS ----------
    ("T-MX", "matrix", "Matrix expand fails because a label has no runner (no match)"),
    ("T-MX", "matrix", "Matrix runs out of GitHub-hosted runner minutes mid-build"),
    ("T-MX", "matrix", "Matrix max-parallel cap is reached (jobs queued)"),
    ("T-MX", "matrix", "Reusable workflow called from caller (workflow_call)"),
    ("T-MX", "matrix", "Reusable workflow secrets: inherit / pass explicitly"),
    ("T-MX", "matrix", "Composite action used (action.yml in repo)"),
    ("T-MX", "matrix", "Composite action step fails (composite runs as a step)"),
    ("T-MX", "matrix", "Docker container action pulls image but registry auth fails"),
    ("T-MX", "matrix", "JavaScript action uses node20 (deprecated Nov 2025)"),
    ("T-MX", "matrix", "JavaScript action uses node24 (current LTS)"),
    ("T-MX", "matrix", "Action pinned to SHA (good) vs tag (mutable, risk)"),

    # ---------- ENTERPRISE / ORG ----------
    ("T-OR", "org", "Org billing/spending limit reached (Actions / Packages / Codespaces)"),
    ("T-OR", "org", "Org member removed (still appears on PRs as stale collaborator)"),
    ("T-OR", "org", "Org policy: only admins can create repos (agent is member, blocked)"),
    ("T-OR", "org", "Org SAML/SSO: external collaborator needs to re-auth"),
    ("T-OR", "org", "Org IP allow list: agent CI runner is not in allowlist"),
    ("T-OR", "org", "Org ruleset: applies to many repos, agent must respect"),
    ("T-OR", "org", "Org actions permissions: only allowed actions from org marketplace"),
    ("T-OR", "org", "Org workflow permissions: read-only repo contents default"),
    ("T-OR", "org", "GHES: instance admin enforces custom rate limits"),
    ("T-OR", "org", "GHEC: enterprise account policies (audit log streaming)"),
    ("T-OR", "org", "GHEC: data residency in EU (latency vs global)"),
]

# ---------------------------------------------------------------------------
# Conditions — boolean checks the runtime can evaluate
# ---------------------------------------------------------------------------
CONDITIONS: Dict[str, List[str]] = {
    "actions_run": [
        "workflow.conclusion == 'success'",
        "workflow.conclusion == 'failure'",
        "workflow.conclusion == 'cancelled'",
        "workflow.run_attempt == 1 AND workflow.conclusion == 'failure'",
        "workflow.run_attempt > 1 AND workflow.conclusion == 'success' (retry succeeded)",
        "workflow.event == 'push' AND workflow.actor is the GITHUB_TOKEN (no recursive run)",
        "workflow.event == 'pull_request' AND sender is from a fork",
        "workflow.event == 'merge_group' (merge queue)",
        "workflow.event == 'workflow_dispatch' AND inputs valid",
        "workflow.event == 'repository_dispatch' AND client_payload valid JSON",
        "workflow.event == 'schedule' AND cron expression valid",
        "workflow.elapsed_seconds > 21600 (360-min default timeout)",
        "job.elapsed_seconds > job.timeout_minutes * 60",
        "step.elapsed_seconds > step.timeout_minutes * 60",
        "matrix.fail_fast == true AND one leg failed (others cancelled)",
        "matrix.fail_fast == false AND one leg failed (others continued)",
        "step.if == 'always()' AND workflow is being cancelled",
        "job.needs includes a job that was skipped (step result = 'skipped')",
        "step.continue_on_error == true AND step exit_code != 0",
        "step uses needs: [other] AND other.conclusion == 'failure'",
        "workflow file has valid YAML (parseable)",
        "workflow file references an action tag that exists (e.g. actions/checkout@v4)",
        "workflow file references a private action in another repo (no auth = 403)",
        "workflow file uses an unknown event name (warning, not error)",
        "self-hosted runner with matching label is online",
        "self-hosted runner with matching label is offline (job queued)",
        "Actions minutes used < plan quota (free 2000, pro 3000, etc.)",
        "workflow file uses permissions: read-all at workflow level",
        "workflow file uses permissions: write-all at job level (overkill)",
        "step has if: failure() AND previous step failed",
        "step has if: success() AND previous step succeeded",
        "step has if: cancelled() AND workflow was cancelled",
        "composite action's action.yml is at .github/actions/<name>/action.yml",
        "JavaScript action uses node20 runtime (deprecated soon)",
        "JavaScript action uses node24 runtime (current)",
        "Docker container action image is on ghcr.io (auth via GITHUB_TOKEN)",
        "Docker container action image is on Docker Hub (no auth for public)",
        "Docker container action image is on private registry (auth required)",
        "workflow file has a syntax error (status: 'expected mapping')",
        "workflow file uses deprecated workflow commands (::set-output)",
        "workflow file uses deprecated save-state / set-env",
        "runner has sufficient disk / memory for job (resourceClass sized)",
        "job uses services: (postgres, redis) - container started",
        "job uses services: AND service image pull fails",
        "job has continue-on-error: ${{ matrix.experimental }} AND matrix value undefined",
        "job has strategy.matrix.exclude that drops all combinations (nothing runs)",
        "job has env: passed at job vs step level (step overrides job)",
    ],
    "secrets": [
        "secrets.MY_SECRET exists at repo level",
        "secrets.MY_SECRET exists at org level with selected repos policy",
        "secrets.MY_SECRET exists at environment level with required reviewers",
        "secrets.GITHUB_TOKEN exists in every job (auto-injected)",
        "workflow.triggered_from_fork == true (secrets NOT passed, except GITHUB_TOKEN as read-only)",
        "env.MY_SECRET (non-secret env var) is at repo/org/environment level",
        "required_reviewer is online AND approves the environment deploy",
        "required_reviewer is offline (job blocked on approval)",
        "permissions block sets GITHUB_TOKEN scope to contents: read",
        "permissions block sets GITHUB_TOKEN scope to id-token: write (OIDC)",
        "permissions block omits a needed scope (workflow job fails with 403 on API call)",
        "secret value accidentally logged to stdout (redaction kicks in)",
        "secret value accidentally logged via 'set-output' (deprecated, leaked)",
        "OIDC trust policy matches repo + branch + workflow path",
        "OIDC trust policy does not match (cloud rejects token)",
        "OIDC token audience (aud) matches cloud provider requirement",
        "GITHUB_TOKEN is read-only on PR from public fork (regardless of permissions block)",
        "GITHUB_TOKEN has elevated scope (write) and pushes commit (no recursive workflow)",
        "GITHUB_TOKEN expires mid-job on self-hosted > 24h (use PAT instead)",
        "Secret rotation in progress (old value still in use for some runners)",
        "Secret deleted but workflow still references it (null/empty string)",
    ],
    "api": [
        "request.authentication == null (unauthenticated, 60 req/h per IP)",
        "request.authentication == classic PAT (5000 req/h per user)",
        "request.authentication == fine-grained PAT (with expiry, scoped perms)",
        "request.authentication == GitHub App user token (5000 req/h per user)",
        "request.authentication == GitHub App installation token (5000/h base, scales with org)",
        "request.authentication == OAuth app user token (5000 req/h per user)",
        "request.method == 'GET' (1 point, primary + secondary counts)",
        "request.method in ['POST','PATCH','PUT','DELETE'] (5 points, secondary counts)",
        "response.status_code == 200",
        "response.status_code == 304 (Not Modified, conditional request)",
        "response.status_code == 401 (auth failed)",
        "response.status_code == 403 with 'rate limit' or 'secondary rate limit' body",
        "response.status_code == 404 (resource not found OR insufficient scope per docs)",
        "response.status_code == 422 (validation error)",
        "response.status_code == 429 with Retry-After header",
        "response.status_code in 5xx (transient, retry-safe)",
        "x-ratelimit-remaining < 100 (close to primary limit)",
        "x-ratelimit-remaining == 0 (primary limit hit)",
        "x-ratelimit-reset > now (wait until reset)",
        "Retry-After header present (seconds to wait)",
        "concurrent_request_count > 100 (secondary limit trigger)",
        "endpoint_points > 900/min (REST secondary limit trigger)",
        "graphql_points > 2000/min (GraphQL secondary limit trigger)",
        "cpu_time_used > 90s in last 60s window (secondary limit)",
        "content_create_count > 80/min (secondary content-creation limit)",
        "content_create_count > 500/hour (secondary content-creation limit)",
        "oauth_token_request_count > 2000/hour (GitHub App / OAuth limit)",
        "If-None-Match ETag matches server state (304 returned, primary limit not consumed)",
        "GITHUB_TOKEN in workflow hit 1000 req/h/repo (Actions-specific limit)",
        "installation on org with > 20 repos (scales +50/h/repo)",
        "installation on org with > 20 users (scales +50/h/user, max 12500/h)",
    ],
    "webhook": [
        "request has X-Hub-Signature-256 header",
        "X-Hub-Signature-256 HMAC matches stored webhook secret (using crypto.timingSafeEqual)",
        "X-Hub-Signature-256 HMAC does NOT match (secret wrong, body modified, encoding)",
        "X-Hub-Signature (legacy SHA-1) is present (deprecated, fall back to SHA-256 verify)",
        "X-GitHub-Event header indicates the event type (push, pull_request, etc.)",
        "X-GitHub-Delivery is a valid GUID (use for idempotency dedup)",
        "X-GitHub-Hook-ID is present (for tracking)",
        "X-GitHub-Hook-Installation-Target-Type is present",
        "request Content-Type is application/json (per webhook config)",
        "request Content-Type is application/x-www-form-urlencoded (alternative)",
        "request body has been modified by a proxy / load balancer (HMAC breaks)",
        "response.status_code is 2xx (GitHub marks delivery as 'delivered')",
        "response.status_code is non-2xx (GitHub marks as 'failed', retries with backoff)",
        "response.time_ms < 10000 (GitHub timeout, must respond fast)",
        "response.time_ms > 10000 (GitHub times out, delivery marked failed)",
        "endpoint is on localhost / 127.0.0.1 (GitHub can't deliver)",
        "endpoint DNS does not resolve (GitHub retries, then marks failed)",
        "endpoint cert is self-signed / expired / incomplete chain (TLS verify fails)",
        "endpoint IP is not in firewall allowlist (GitHub publishes IP ranges via /meta)",
        "webhook is configured with active=false (no events fire)",
        "webhook secret is missing (no signature header sent, must verify via TLS only)",
        "receiver is idempotent (delivery_id dedup works)",
        "receiver is non-idempotent (duplicate = duplicate side effect, e.g. double charge)",
        "receiver uses 'Verify -> Enqueue -> ACK' (returns 200 < 100ms, processes async)",
        "receiver does heavy work synchronously (times out, GitHub retries, event duplicated)",
    ],
    "branch": [
        "branch is in protected branches list (branch protection rules applied)",
        "branch is covered by a ruleset (rulesets supersede branch protection in some orgs)",
        "required_status_check 'CI / build' has conclusion == 'success' on PR head SHA",
        "required_status_check 'CI / build' has conclusion == 'failure'",
        "required_status_check 'CI / build' has conclusion == 'pending' (waiting)",
        "required_status_check 'CI / build' was skipped (path filter excluded file)",
        "required_status_check 'CI / build' ran on PR head but not on base branch (not selectable)",
        "required_status_check 'CI / build' ran successfully on base branch in last 7 days",
        "required_status_check 'CI / build' has not run on base branch in 7+ days (forgotten)",
        "PR has N approvals where N >= required_approvals",
        "PR has N approvals from CODEOWNERS for changed paths",
        "PR has N-1 approvals (one short)",
        "approving review is dismissed (new commit pushed after review)",
        "approving review is from PR author (not allowed)",
        "unresolved conversation threads == 0 (conversation resolution required)",
        "unresolved conversation threads > 0 (merge blocked)",
        "PR head branch commits are all signed (GPG/SSH/Sigstore)",
        "PR head branch has unsigned commit (merge blocked)",
        "PR has merge conflict with base (merge button disabled)",
        "PR is up to date with base (loose: passes, strict: passes)",
        "PR is NOT up to date with base (strict mode: merge blocked)",
        "PR contains merge commit (linear history required: blocked)",
        "PR contains merge commit (linear history NOT required: ok)",
        "rebasing is disabled in repo settings (operator chose squash only)",
        "auto-merge is enabled in repo settings",
        "auto-merge is enabled on this PR AND all requirements met (will merge)",
        "auto-merge is enabled on this PR AND new commit pushed by non-write user (auto-merge disabled)",
        "merge queue is enabled AND PR added to queue",
        "merge queue is enabled AND PR conflicts with merge group (removed from queue)",
        "merge queue is enabled AND merge_group event not in workflow (status missing)",
        "required deployment to environment 'production' has status == 'success'",
        "required deployment to environment 'production' has status in ['failure', 'in_progress']",
        "branch is locked (read-only - all pushes blocked, even admins)",
        "branch has push restrictions: 'Restrict who can push to matching branches' (no role match)",
        "force-push attempted on protected branch (blocked)",
        "branch deletion attempted on protected branch (blocked)",
    ],
    "secretscan": [
        "git push content matches a secret scanning pattern (519 supported patterns)",
        "git push is to a public repo on github.com (push protection on by default for users)",
        "repo has push protection enabled (org-level or repo-level)",
        "push contains > 5 new secrets (only first 5 reported in push protection)",
        "push contains > 1000 existing secrets (push protection does not block)",
        "push size > 50MB on public repo (push protection skipped)",
        "detected secret has a validity check AND is active (CRITICAL - rotate now)",
        "detected secret has a validity check AND is inactive (already revoked)",
        "detected secret is a pair pattern (e.g. AWS access+secret) in same file",
        "pair pattern split across files (not detected, lower false positives)",
        "secret is legacy / old format (push protection may not block, alert may not fire)",
        "user has 'designated bypasser' role for this secret type (can bypass)",
        "bypass request was created and approved",
        "commit message contains 'skip-secret-scanning:true' (bypass on push)",
        "secret scanning not enabled on private repo (GHAS / GHSP not active)",
        "secret scanning user alerts visible in Security tab",
        "secret scanning partner alert (e.g. AWS) sent to vendor for revocation",
        "detected secret is a Copilot-detected generic password (no validity check)",
        "custom secret pattern defined at org/enterprise level",
    ],
    "dependabot": [
        "Dependabot alerts are enabled for repo (Settings -> Code security)",
        "Dependabot security updates are enabled for repo",
        "Dependabot version updates are enabled (.github/dependabot.yml present)",
        ".github/dependabot.yml is at repo root (NOT in .github/workflows)",
        ".github/dependabot.yml has version: 2 and updates: top-level",
        ".github/dependabot.yml has package-ecosystem in supported list (npm, pip, gomod, docker, github-actions, ...)",
        ".github/dependabot.yml has directory: pointing to manifest dir (e.g. / for root)",
        ".github/dependabot.yml uses 'node' or 'yarn' as ecosystem (WRONG - should be 'npm')",
        "manifest has lockfile committed (e.g. package-lock.json)",
        "manifest has no lockfile (security updates target manifest only, less reliable)",
        "vulnerable dep is direct (in manifest) - Dependabot opens PR",
        "vulnerable dep is transitive (in lockfile only, not manifest) - no PR",
        "Dependabot can find a non-vulnerable version (PR opened)",
        "Dependabot cannot find a non-vulnerable version without breaking graph (no PR, error on alert)",
        "open pull-requests-limit (5 for version, 10 for security) reached",
        "Dependabot job fails: registry auth required for private feed",
        "Dependabot job fails: lockfile missing or unreadable",
        "@dependabot ignore condition matches the dep (no update PR)",
        "Dependabot PR has failing required CI (cannot auto-merge)",
        "groups: config bundles multiple updates into one PR",
        "auto-merge: enabled for patch/minor (Dependabot uses it)",
        "reviewers: configured on dependabot.yml (auto-assigned)",
        "target-branch: is non-default (PRs go to feature branch)",
        "schedule.interval: weekly (default), daily, monthly",
        "@dependabot recreate comment rebuilds the group",
        "@dependabot rebase comment rebases the PR",
        "@dependabot merge comment merges if all checks pass",
        "@dependabot close comment closes + suppressions the version",
        "@dependabot show ignore conditions lists ignored deps",
    ],
    "pages": [
        "publishing_source branch exists (main, gh-pages, or /docs)",
        "publishing_source directory exists (root, /docs, or custom workflow output)",
        "Jekyll build succeeds (no liquid errors, theme gem present)",
        "static site build succeeds (no broken internal links checked)",
        "CNAME file exists in publishing source and matches custom domain",
        "DNS A record for custom domain points to GitHub Pages IPs",
        "DNS CNAME for www custom domain points to <org>.github.io",
        "DNS propagated globally (TTL elapsed)",
        "HTTPS enforced (Settings -> Pages -> Enforce HTTPS) - no mixed content",
        "Let's Encrypt cert provisioning pending (<= 1h typically)",
        "CAA record for domain does NOT exclude letsencrypt.org (cert issues)",
        "cert auto-renewal attempted 30 days before expiry",
        "Pages repo is public on Free plan (allowed)",
        "Pages repo is private on Free plan (NOT allowed - need Pro+ for private)",
        "Pages build triggered by workflow (jekyll build step in Actions)",
        "Pages build triggered by push to source branch (auto)",
        "Pages build triggered by GITHUB_TOKEN push (NOT - by design, prevents infinite loops)",
        "site uses unsupported Jekyll plugin (build skipped or warned)",
        "site has 404.html in publishDir (custom 404 served)",
        "site has 10MB file in publishDir (Pages has file size limit)",
    ],
    "codespaces": [
        "prebuild configuration exists for branch (Settings -> Codespaces -> Prebuilds)",
        "prebuild configuration includes user's region (else 'Prebuild Ready' not shown)",
        "devcontainer.json changed recently -> prebuild workflow running (label removed temporarily)",
        "prebuild workflow run succeeded in last push (label visible)",
        "prebuild workflow run failed (label not visible, codespace created without prebuild)",
        "spending limit reached (prebuild workflows fail, codespace creation blocked)",
        "devcontainer.json references other repos requiring permissions (not authorized)",
        "user has access to codespace (org member, repo collaborator)",
        "machine type has capacity available (2-core, 4-core, 8-core, 16-core, 32-core)",
        "codespace idle > 30 min (auto-stop triggered)",
        "codespace retention period exceeded (default 30 days, deleted)",
        "prebuild optimization enabled (use previous prebuild on latest failure)",
        "prebuild optimization disabled (always rebuild on failure)",
        "dotfiles repo is private and unreadable (skip dotfiles)",
        "dotfiles repo is public and contains install.sh (run on creation)",
    ],
    "issues": [
        "issue is opened with title + body",
        "issue has 'security' label (private visibility in private repo)",
        "PR has 'do-not-merge' label (status check considers it blocking if configured)",
        "comment author is a bot (e.g. dependabot[bot], renovate[bot])",
        "comment @mentions a team (notifications fan out to all team members)",
        "issue is assigned to user without write access (assignment fails silently or errors)",
        "issue is closed (stale bot after N days)",
        "issue is reopened (state: open again)",
    ],
    "release": [
        "tag matches release pattern (e.g. v*)",
        "release is published (not draft, not pre-release)",
        "release is draft (only visible to collaborators with write)",
        "release is pre-release (visible to all but flagged)",
        "release assets uploaded (binary tarball, etc.)",
        "release has semantic version (semver) - major.minor.patch",
        "release event matches workflow trigger (published vs released vs prereleased)",
        "tag is signed (GPG/SSH) - required by some workflows",
        "tag is unsigned (some workflows require signed releases)",
    ],
    "git": [
        "git push is fast-forward (allowed on protected branch after review)",
        "git push is non-fast-forward (rejected on protected branch, force required)",
        "git push force is allowed on protected branch (no force-push rule)",
        "file size > 100MB (rejected - use Git LFS)",
        "file size > 50MB triggers LFS pointer recommendation (if LFS enabled)",
        "file size > 2GB (rejected - absolute file size cap on github.com)",
        "repo total size > 5GB (warning on dashboard, soft cap)",
        "repo total size > GitHub Free plan limit (push blocked)",
        "Git LFS bandwidth quota exceeded (additional usage billable)",
        "submodule reference points to non-existent commit (push rejected)",
        "submodule requires credentials and none provided (push rejected)",
        "git filter-repo / BFG rewrite (history rewritten, all SHAs change)",
        "repo transfer initiated (audit log entry, redirects preserved)",
        "repo archived (read-only - pushes blocked)",
        "repo made public (private data now world-visible)",
        "repo deleted (cannot restore after grace period, ~90 days for free)",
        "branch deleted while PR still references it (PR shows 'closed')",
        "large file detected but not in .gitattributes as LFS",
        "LFS not enabled on repo (large file warning but pushed anyway)",
    ],
    "packages": [
        "package name is unique within owner scope",
        "package name conflicts (cannot overwrite - increment version)",
        "package visibility: public (searchable on github.com)",
        "package visibility: private (org members only)",
        "package published to ghcr.io (container registry)",
        "package published to npm.pkg.github.com (npm registry)",
        "package published to maven.pkg.github.com (Maven)",
        "package published to nuget.pkg.github.com (NuGet)",
        "package published to ruby.pkg.github.com (RubyGems)",
        "package digest linked (immutable, content-addressed)",
        "package retention policy: keep N versions, delete older",
        "ghcr.io image vulnerability scan: no CVEs",
        "ghcr.io image vulnerability scan: CVE found (Dependabot alert)",
        "unauthenticated download: rate limit applied per IP",
        "authenticated download: per-token limits",
    ],
    "security": [
        "audit log streaming endpoint returns 2xx (delivered)",
        "audit log streaming endpoint returns 5xx (events buffered, may be lost)",
        "audit log streaming endpoint returns 4xx (auth/format issue)",
        "SSO enforced at org level (user must SSO to access repo)",
        "SSO enforcement + user without SSO (access denied)",
        "IP allow list enforced at org level",
        "request from non-allowlisted IP (access denied)",
        "request from allowlisted IP (access allowed)",
        "2FA required at org level (user without 2FA cannot push)",
        "PAT (classic) missing 'workflow' scope (cannot edit .github/workflows)",
        "PAT (classic) missing 'repo' scope (cannot access private repos)",
        "fine-grained PAT has expired (request returns 401)",
        "fine-grained PAT lacks required permission (request returns 404)",
        "GitHub App installation revoked (token 401)",
        "GitHub App installation transferred (new installation token needed)",
        "org owner added (audit log entry, role = 'owner')",
        "org owner removed (audit log entry, demote others first)",
        "repo visibility changed (audit log entry)",
        "external collaborator added (audit log entry)",
        "sensitive event (member removal, repo transfer) - high-priority audit log",
    ],
    "dispatch": [
        "repository_dispatch event_type is in workflow's on: list (event fires)",
        "repository_dispatch event_type is NOT in workflow's on: list (no fire)",
        "repository_dispatch client_payload is valid JSON",
        "repository_dispatch client_payload is malformed (workflow still fires, payload is empty)",
        "workflow_dispatch inputs match workflow's inputs: schema",
        "workflow_dispatch inputs fail type validation (workflow fails)",
        "workflow_dispatch inputs have required field missing (workflow fails)",
        "caller has repo write access (dispatch allowed)",
        "caller lacks repo write access (dispatch 403/404)",
    ],
    "environments": [
        "environment 'production' exists in repo settings",
        "environment has required reviewers configured",
        "environment has wait timer configured (e.g. 5 min delay)",
        "environment has deployment branches policy (only main can deploy)",
        "environment has deployment branches policy: branches [] (matches none - deploy blocked)",
        "environment URL is set (links to deployment for context)",
        "deployment is in 'in_progress' state (job running, environment locked for that job)",
        "deployment succeeded (job's last step set status: success)",
        "deployment failed (job's last step set status: failure)",
        "deployment cancelled (workflow cancelled)",
        "deployment to same environment is blocked by concurrency rule (job waiting)",
        "deployment uses environment secrets (different scope from repo secrets)",
        "environment is protected (no bypass, even admins need approval)",
    ],
    "matrix": [
        "matrix.combinations > 0 (valid expand)",
        "matrix.combinations == 0 (exclude dropped all - warning)",
        "matrix.max-parallel cap is reached (excess queued)",
        "matrix has 'include' that adds extra combinations",
        "matrix has 'exclude' that drops specific combinations",
        "self-hosted runner label matches matrix.os value (e.g. linux-large)",
        "self-hosted runner label does NOT match (matrix job waits forever or fails)",
        "matrix uses unsupported 'runs-on' (e.g. 'macos-latest' for self-hosted without label)",
        "reusable workflow call inputs match caller inputs (or defaults)",
        "reusable workflow call secrets are passed explicitly (not auto)",
        "reusable workflow returns outputs to caller",
        "composite action has action.yml in correct path",
        "composite action uses 'using: composite' (node-based)",
        "Docker container action image pull succeeds",
        "Docker container action image pull fails (auth/registry/network)",
        "Docker container action uses GITHUB_TOKEN for ghcr.io (works)",
        "Docker container action uses private registry without credentials (fails)",
        "action pinned to SHA (immutable, safe)",
        "action pinned to tag (mutable, supply chain risk)",
        "action pinned to branch (very mutable, risk)",
    ],
    "org": [
        "org billing/spending limit reached (Actions / Packages / Codespaces / Storage)",
        "org member removed (still on open PRs as stale collaborator - cleanup needed)",
        "org policy: 'Members cannot create repos' (member tries to create - blocked)",
        "org SAML/SSO: external collaborator must re-auth periodically",
        "org SAML/SSO: user not on IdP side (access denied)",
        "org IP allow list: CI runner not in allowlist (push/webhook blocked)",
        "org ruleset applies to many repos (inherits branch protection, secrets, etc.)",
        "org 'Allowed Actions' policy: only approved actions from org marketplace (third-party blocked)",
        "org 'Workflow permissions' default: read-only repo contents",
        "GHES instance admin enforces custom rate limits (different from cloud)",
        "GHEC enterprise account: audit log streaming required (compliance)",
        "GHEC enterprise account: data residency in EU (egress to US may be slower)",
    ],
}

# ---------------------------------------------------------------------------
# Actions — what the agent does on the IF / ELSE branch
# ---------------------------------------------------------------------------
ACTIONS: Dict[str, Dict[str, List[str]]] = {
    "if_action": {
        "actions_run": [
            "Mark run 'success'; emit 'workflow_ok' event; release concurrency lock",
            "Mark run 'failure'; capture first failed step; if recoverable, re-run with retry logic",
            "Mark run 'cancelled'; emit 'workflow_cancelled' event; log cancellation reason",
            "Re-run the failed jobs (workflow_dispatch with same inputs) and wait for success",
            "Re-run with debug logging enabled (ACTIONS_STEP_DEBUG=true) for next attempt",
            "Inspect 'always()' step - it ran and completed (good)",
            "If 'always()' is set on a step, do NOT mark as cancelled (per docs)",
            "Force-cancel the in-flight run via API (use 'force-cancel-a-workflow-run')",
            "Cancel via UI / API; wait 5 min for graceful; if still running, force-kill",
            "Wait for 360-min default timeout, do not pre-empt",
            "Increase job-level timeout-minutes (e.g. 30 -> 60); re-trigger",
            "Increase step-level timeout-minutes; re-trigger",
            "Disable fail-fast: set strategy.fail-fast: false; let all legs finish",
            "Quarantine the failing leg with continue-on-error; let others complete",
            "Mark the matrix job 'failure' but allow report to continue (matrix_fail = true)",
            "Re-run just the failed leg (matrix index) using gh run rerun --failed",
            "Validate workflow file with 'act' locally before pushing",
            "Pin action to SHA instead of tag (supply chain hardening)",
            "Switch deprecated node20 -> node24; re-run",
            "Use auth token (ghcr.io / private registry) for Docker container action",
            "Cache dependencies (actions/cache) to avoid re-installs",
            "Trigger a self-hosted runner by ensuring label matches and runner is online",
            "Use continue-on-error on flaky test step; track separately",
            "Tag the release (signed) to trigger downstream release workflows",
            "Bump resourceClass to larger runner for memory/CPU heavy jobs",
            "Move heavy work from job to background step (saves minutes)",
            "Skip this workflow run (no-op); notify operator",
            "Approve required review (if user has permission) and continue",
        ],
        "secrets": [
            "Read secret via ${{ secrets.MY_SECRET }}; pass to action / env",
            "Use GITHUB_TOKEN automatically (no config needed)",
            "Pass GITHUB_TOKEN to action via 'with: token: ${{ secrets.GITHUB_TOKEN }}'",
            "Use OIDC: request token from cloud, no long-lived secret needed",
            "Configure OIDC trust on cloud provider (AWS IAM, GCP WIF, Azure federated)",
            "Set permissions: read-all at workflow top (least privilege)",
            "Set permissions: write-all only on jobs that need it (specific scope)",
            "Set permissions: id-token: write for OIDC job; write for protected-branches job",
            "Configure environment required reviewers; wait for approval",
            "Use environment secrets (different from repo secrets, scoped)",
            "Approve required review (if user is in reviewer list)",
            "Trigger approval workflow (notify reviewers in Slack/PagerDuty)",
            "Do not log secret to stdout (GitHub auto-redacts, but avoid any echo)",
            "Switch to OIDC + federated identity; remove long-lived cloud secret",
            "Refuse to log secrets even with redaction (best practice)",
            "Verify secret rotation: old value still works on some runners (overlap window)",
            "Fail the workflow if required secret is missing (clear error)",
            "If GITHUB_TOKEN is read-only on PR from fork, use a separate PAT (write)",
            "For GITHUB_TOKEN push that doesn't recurse: this is expected, no action",
            "For expired GITHUB_TOKEN on long self-hosted job: switch to PAT",
        ],
        "api": [
            "Treat response as success; update local cache; return result",
            "Backoff per Retry-After header; re-queue request",
            "Wait until x-ratelimit-reset; re-queue",
            "Stop requests; alert operator; queue excess in local buffer",
            "Re-auth (rotate PAT) and retry; if still 401, surface to operator",
            "Surface 'insufficient scope' to operator; update PAT scopes",
            "Re-validate input; surface 422 details to operator; halt",
            "Retry with exponential backoff (3x max, jittered)",
            "Use If-None-Match ETag; treat 304 as 'no change' (no primary limit hit)",
            "Switch to authenticated requests (60/h -> 5000/h per user)",
            "Use GitHub App installation token (5000/h base, scales with org size)",
            "Reduce concurrent requests to <= 100 (use a queue)",
            "Reduce endpoint-points to <= 900/min (use a queue, slower cadence)",
            "Reduce GraphQL points to <= 2000/min (use a queue, slower cadence)",
            "Reduce CPU time to <= 90s/60s window (smaller queries, fewer list-all calls)",
            "Reduce content-creation to <= 80/min, <= 500/hour",
            "Move to GraphQL for list operations (single round-trip, less points)",
            "Cache GET responses with ETag (304s don't consume primary limit)",
            "Subscribe to webhooks instead of polling (best practice per docs)",
            "Make POST/PATCH/DELETE serially with >= 1s gap (avoid secondary limits)",
            "Use conditional request (If-None-Match) - 304 doesn't count",
        ],
        "webhook": [
            "Validate X-Hub-Signature-256 with constant-time compare; on match, process",
            "Use X-GitHub-Delivery GUID for idempotency dedup (Redis set with TTL)",
            "Use X-GitHub-Event header to route payload to handler",
            "Enqueue payload and ACK within 100ms (Verify -> Enqueue -> ACK pattern)",
            "Return 200 fast (process async); GitHub won't retry",
            "Return 4xx if signature invalid (GitHub won't retry, mark failed)",
            "Return 5xx on transient error (GitHub retries with backoff)",
            "Log the X-GitHub-Delivery GUID for traceability (no PII / no payload data in logs)",
            "Allow GitHub's published IP ranges through firewall (pulled from /meta periodically)",
            "Add HTTPS endpoint with valid cert (Let's Encrypt recommended)",
            "Expose via tunnel (ngrok, cloudflared) for local dev (not production)",
            "Add X-Hub-Signature-256 + secret (HMAC-SHA256) per docs",
            "Do NOT use plain '==' for HMAC compare (use crypto.timingSafeEqual)",
            "Reject SHA-1 only headers (deprecate X-Hub-Signature in favor of -256)",
            "Rotate webhook secret with overlap (old secret valid for N days)",
            "Idempotently process events; rely on delivery_id dedup",
            "Process events idempotently: if state-change already applied, no-op",
            "Move heavy work to async worker; respond 202 Accepted",
            "Tune timeout to return 2xx in < 10s (GitHub gives up after 10s)",
            "Configure Content-Type: application/json on the webhook",
            "Decode JSON body before HMAC verify (or buffer raw body for HMAC, then parse)",
            "Buffer raw request body (don't let framework parse before HMAC)",
        ],
        "branch": [
            "Merge the PR (squash / rebase / merge-commit per repo policy)",
            "Mark PR as mergeable; show 'Merge' button",
            "Block merge; show 'X approval required' to operator",
            "Block merge; show 'Y check failed' to operator; link to failed check",
            "Block merge; suggest fix for failed check (link to docs)",
            "Suggest enabling auto-merge so PR merges when all requirements met",
            "Enable auto-merge on this PR; will fire when requirements met",
            "Disable auto-merge (new commit from non-write user)",
            "Re-run the failed required check (gh run rerun <run-id>)",
            "Suggest push of new commit to dismiss stale approvals (if needed)",
            "Suggest CODEOWNERS review by triggering @-mention",
            "Suggest rebase onto base branch (Resolve conflicts button)",
            "Mark PR as 'conflicts' - manual resolution needed",
            "Mark PR as 'up to date' - merge can proceed (loose mode)",
            "Add PR to merge queue; will merge when group checks pass",
            "Remove from queue (conflicts with group); show reason in PR timeline",
            "Block merge; show 'merge_group event not in workflow' - add trigger",
            "Suggest rebase or squash on local; force-push to head branch",
            "Suggest operator unblock admin bypass (if allowed) - audit-logged",
            "Suggest signed commits: setup GPG/SSH key for the actor",
            "Mark PR 'ready for review' if draft -> ready",
            "Convert PR to draft (if work-in-progress)",
            "Suggest push of new commit to re-trigger required checks",
        ],
        "secretscan": [
            "Block the push; provide instructions to remove the secret",
            "Remove the secret from code; rotate the credential at the provider",
            "Bypass the push (if user has bypass role); commit with 'skip-secret-scanning:true'",
            "Use environment variable / secret store instead of hardcoding",
            "Use OIDC federated identity instead of long-lived tokens",
            "Rotate the leaked credential at the provider (Cloud, AWS, Stripe, etc.)",
            "Audit provider logs for misuse of the leaked credential",
            "Purge from git history (BFG / git filter-repo); force-push; rotate again",
            "If pair pattern split across files: still consider rotating",
            "If partner pattern: provider notified (e.g. AWS, Stripe) for revocation",
            "If custom pattern: report to org security team (matches org-specific format)",
            "If validity check shows inactive: no action needed (already revoked)",
            "If validity check shows active: URGENT - rotate + purge from history",
            "Enable push protection at org level (if not enabled)",
            "Enable secret scanning at org level (if not enabled - GHAS / GHSP)",
            "Add designated bypasser role for the secret type (if expected false positives)",
            "Limit push protection to high-confidence patterns (reduces false positives)",
        ],
        "dependabot": [
            "Open Dependabot PR with the minimum secure version",
            "Wait for Dependabot to attempt PR; surface alert error if blocked",
            "Enable Dependabot security updates in repo Settings -> Code security",
            "Enable Dependabot version updates by adding .github/dependabot.yml",
            "Fix .github/dependabot.yml (package-ecosystem, directory, version: 2)",
            "Add manifest / lockfile to repo (Dependabot needs to see deps)",
            "Add direct dep to manifest (transitive-only = no PR)",
            "Merge existing Dependabot PRs to free PR slots (version: 5, security: 10)",
            "Use @dependabot recreate to rebuild the group",
            "Use @dependabot rebase to rebase the PR",
            "Use @dependabot merge to merge if all checks pass",
            "Use @dependabot close + suppression to drop a problematic dep",
            "Use @dependabot show ignore conditions to see why dep is ignored",
            "Use groups: in dependabot.yml to bundle multiple updates into one PR",
            "Use auto-merge: for patch/minor (Dependabot uses it if green)",
            "Add reviewers: in dependabot.yml for auto-assignment",
            "Add target-branch: in dependabot.yml (if non-default)",
            "Add schedule: interval in dependabot.yml (daily, weekly, monthly)",
            "Configure registry auth for private feeds (in dependabot.yml)",
            "Use versioning-strategy: increase / widen / pin in dependabot.yml",
        ],
        "pages": [
            "Publish site; verify via <user>.github.io URL",
            "Surface Jekyll build error to operator; suggest fix",
            "Install missing theme gem (Gemfile + bundle install)",
            "Add 404.html to publishDir (custom 404 served)",
            "Add CNAME file with custom domain (one line, no protocol)",
            "Set DNS A record to GitHub Pages IPs (185.199.108.153-156)",
            "Set DNS CNAME www to <org>.github.io",
            "Wait for DNS propagation; poll; alert when propagated",
            "Wait for HTTPS cert provisioning; surface if pending > 1h",
            "Remove CAA record that blocks letsencrypt.org; or add allow",
            "Wait for cert auto-renewal; surface if failed",
            "Enable 'Enforce HTTPS' in Pages settings",
            "Upgrade repo to Pro/Team/Enterprise for private Pages",
            "Configure publishing source (branch + directory)",
            "Replace unsupported plugin with standard alternative",
            "Build with Actions workflow (custom Jekyll build, etc.)",
            "Compress images / files (Pages has 10MB file size limit, 100MB repo soft cap)",
        ],
        "codespaces": [
            "Create codespace from prebuild (fast)",
            "Create codespace without prebuild (slower, rebuild on first run)",
            "Wait for prebuild workflow to complete; then retry codespace creation",
            "Reduce prebuild scope: trigger only on dev container config change",
            "Increase spending limit (Settings -> Codespaces -> Spending limit)",
            "Choose different machine type (smaller, available capacity)",
            "Disable prebuild optimization (always rebuild on failure)",
            "Authorize dev container permissions for the prebuild",
            "Re-create codespace (fresh container, no leftover state)",
            "Idle codespace will auto-stop after 30 min (default)",
            "Re-create codespace after retention expiry (default 30 days)",
            "Make dotfiles repo public or grant access",
        ],
        "issues": [
            "Open issue; assign label; add to project board",
            "Open issue privately in private repo (visible to collaborators only)",
            "Add comment to PR; mark as ready for review",
            "Add bot response (e.g. dependabot, stale bot)",
            "Send @-mention notification (team gets one notification, not per-member)",
            "Assign issue; if user lacks write access, surface to operator",
            "Close issue (stale bot after N days of inactivity)",
            "Reopen issue; clear resolution state",
        ],
        "release": [
            "Publish release; trigger downstream release workflows",
            "Save as draft; do not trigger public events",
            "Mark as pre-release; visible but flagged",
            "Upload release assets (binaries, checksums, signatures)",
            "Use semver tag (v1.2.3); workflows can use tag for version",
            "Sign tag (GPG/SSH) - required for some workflows",
            "Edit release notes (description, assets)",
        ],
        "git": [
            "Allow push (fast-forward)",
            "Reject push (non-fast-forward on protected branch); suggest rebase",
            "Allow force-push (if force-push rule enabled)",
            "Reject large file; suggest Git LFS",
            "Enable Git LFS; 'git lfs track \"*.bin\"'; commit .gitattributes",
            "Split large file or use external storage (S3) + LFS pointer",
            "Reduce repo size (purge old artifacts, remove large binaries from history)",
            "Upgrade plan or split into multiple repos",
            "Buy LFS bandwidth pack; retry push",
            "Fix submodule reference (point to valid commit) or remove submodule",
            "Configure submodule credentials (deploy key or PAT)",
            "Rewrite history (BFG / git filter-repo); force-push; re-sign all commits",
            "Notify team of repo transfer (new owner); redirect CI to new URL",
            "Archive repo (read-only); safe for long-term storage",
            "Confirm public; this is irreversible for private data, do security audit first",
            "Restore from trash within grace period (~90 days for free)",
            "Preserve closed PR's branch reference; use git reflog to find SHA",
            "Move file into LFS before committing (git lfs migrate)",
            "Enable Git LFS at repo level (Settings -> Git LFS)",
        ],
        "packages": [
            "Publish package version; consume from registry URL",
            "Bump version and republish (cannot overwrite same name+version)",
            "Publish as public / private (per org policy)",
            "Auth with GITHUB_TOKEN (auto for Actions; PAT for local)",
            "Set retention policy (keep N versions; delete older)",
            "Scan image for CVEs; rebuild if new base image available",
            "Link package digest for immutability; rebuild on every change",
            "Use digest instead of tag for production (immutable, no surprises)",
        ],
        "security": [
            "Treat audit log event as delivered; do not retry",
            "Buffer events; retry; if endpoint 5xx persists > N min, surface to operator",
            "Validate endpoint auth + payload format (per audit log schema)",
            "Require SSO for new users (Settings -> Authentication security)",
            "Block user without SSO (org enforcement on)",
            "Add CI runner IP to org IP allow list (or use NAT gateway)",
            "Require 2FA for org members (Settings -> Authentication security)",
            "Add 'workflow' scope to PAT (or use fine-grained PAT)",
            "Add 'repo' scope to PAT (for private repos)",
            "Rotate PAT before expiry; update secret store",
            "Re-create GitHub App installation; re-issue installation token",
            "Demote other owners before removing last owner (safety)",
            "Add new owner (multiple owners, no single point of failure)",
            "Send audit log to SIEM (Splunk, Datadog, etc.) for compliance",
        ],
        "dispatch": [
            "Fire workflow on event_type match",
            "Do not fire (event_type not in on: list)",
            "Pass client_payload as JSON; workflow uses github.event.client_payload",
            "Treat malformed client_payload as empty; workflow still fires",
            "Validate inputs against workflow's inputs: schema",
            "Surface validation error to caller; do not fire workflow",
            "Check caller has write access; if not, surface 403",
        ],
        "environments": [
            "Deploy to environment; trigger downstream consumers",
            "Wait for required reviewer approval (do not deploy yet)",
            "Wait for wait timer (e.g. 5 min delay before deploy)",
            "Block deploy (branch not in deployment_branches policy)",
            "Surface 'branch not allowed' to operator; update policy or branch",
            "Show environment URL link in workflow run summary",
            "Lock environment for this job (subsequent jobs wait)",
            "Mark deployment 'success' (last step set status: success)",
            "Mark deployment 'failure' (last step set status: failure)",
            "Mark deployment 'cancelled' (workflow cancelled)",
            "Queue deploy (concurrency rule blocks same-env parallel)",
            "Use environment secrets (different scope from repo secrets)",
            "Add required reviewer; even admins can't bypass if 'no bypass' set",
        ],
        "matrix": [
            "Run all matrix combinations in parallel (within max-parallel cap)",
            "Run sequentially (if concurrency = 1)",
            "Use previous prebuild on latest failure (prebuild optimization)",
            "Always rebuild on failure (prebuild optimization disabled)",
            "Validate matrix.expand has at least one combination",
            "Use 'include' / 'exclude' to drop / add combinations",
            "Switch self-hosted runner label to match matrix value",
            "Stop and surface 'no runner matches' to operator",
            "Pass reusable workflow inputs and secrets explicitly",
            "Receive outputs from reusable workflow in caller",
            "Pin composite action by SHA (immutable)",
            "Pin Docker action by digest (immutable)",
            "Auth ghcr.io with GITHUB_TOKEN; auth private registry with secrets",
        ],
        "org": [
            "Surface spending limit reached; require org owner to increase",
            "Remove stale collaborator from PR (cleanup)",
            "Grant 'repo creator' role to member (if policy allows)",
            "Require re-auth via IdP for external collaborator (SAML SSO)",
            "Add CI runner IP to org IP allow list",
            "Apply org ruleset to all repos in scope (inherit branch protection, etc.)",
            "Allow only approved actions (set in org Allowed Actions policy)",
            "Set default workflow permissions to read-only (least privilege)",
            "Configure GHES custom rate limits per token/user",
            "Configure audit log streaming to SIEM for compliance",
            "Choose data residency region (EU vs US) for GHEC",
        ],
    },
    "else_action": {
        "actions_run": [
            "Page on-call; capture run URL; halt dependent workflows; require human triage",
            "Capture full log + first failed step; require sign-off before re-run",
            "Do not auto-retry on unknown failure; require operator decision",
            "Disable the workflow temporarily (move to .github/workflows-disabled/)",
        ],
        "secrets": [
            "Block workflow; require operator to set missing secret",
            "Block workflow; require operator to re-auth (PAT expired, etc.)",
            "Refuse to log secret values; alert on secret-leak pattern in logs",
        ],
        "api": [
            "Halt all API activity for this token; require operator review",
            "Page on-call; do not retry 5xx blindly past 3 attempts",
            "Fall back to cached state; surface 'API unavailable' to dependent code",
        ],
        "webhook": [
            "Do not process (signature failed); log delivery_id for triage",
            "Do not process (endpoint down); rely on GitHub's retry policy",
            "Page on-call; do not bypass signature check for any reason",
        ],
        "branch": [
            "Do not bypass branch protection; require operator to fix the rule",
            "Page on-call; do not auto-merge a PR that fails required checks",
            "Lock the branch if compromised (force-push detected)",
        ],
        "secretscan": [
            "Refuse to bypass; require operator to remove the secret",
            "Page on-call; require immediate rotation if active validity check",
            "Block all pushes until secret is removed from history",
        ],
        "dependabot": [
            "Page on-call; do not auto-merge Dependabot PRs blindly",
            "Surface 'cannot update' error; require operator to review graph conflict",
        ],
        "pages": [
            "Block deploy; require operator to fix Jekyll / theme / domain config",
            "Page on-call; do not auto-publish if cert provisioning fails",
        ],
        "codespaces": [
            "Surface spending limit; require operator to increase limit or wait",
            "Page on-call; do not auto-create codespace if prebuild fails silently",
        ],
        "issues": [
            "Surface @mention to team; do not auto-close issues without human review",
            "Page on-call if security label applied (potential vuln disclosure)",
        ],
        "release": [
            "Block release publish; require sign-off on version bump",
            "Page on-call; do not auto-publish if tag is unsigned",
        ],
        "git": [
            "Block force-push on protected branch; require operator override",
            "Page on-call; require manual cleanup of large files / LFS",
            "Block repo deletion without confirmation (destructive action)",
        ],
        "packages": [
            "Block publish on name conflict; require version bump",
            "Page on-call if CVE in published image; require rebuild",
        ],
        "security": [
            "Page on-call; require manual investigation of audit log delivery failure",
            "Page on-call on suspicious activity (login from new region, mass deploys)",
            "Revoke compromised token; require user re-auth",
        ],
        "dispatch": [
            "Block dispatch; require operator to fix event_type / inputs",
            "Page on-call; do not fire workflow on malformed payload",
        ],
        "environments": [
            "Block deploy; require operator approval (don't bypass required reviewers)",
            "Page on-call; do not auto-deploy if environment protected + no approval",
        ],
        "matrix": [
            "Halt all matrix legs; require operator to fix the failing combination",
            "Page on-call; do not skip failing legs silently",
        ],
        "org": [
            "Block org-level action; require org owner to override",
            "Page on-call; do not auto-bypass org policy for compliance reasons",
        ],
    },
}

# ---------------------------------------------------------------------------
# Severity + source mapping
# ---------------------------------------------------------------------------
SEVERITY_BY_CATEGORY = {
    "actions_run":  "high",
    "secrets":      "critical",
    "api":          "medium",
    "webhook":      "high",
    "branch":       "high",
    "secretscan":   "critical",
    "dependabot":   "medium",
    "pages":        "low",
    "codespaces":   "low",
    "issues":       "low",
    "release":      "medium",
    "git":          "high",
    "packages":     "medium",
    "security":     "critical",
    "dispatch":     "medium",
    "environments": "high",
    "matrix":       "medium",
    "org":          "high",
}

SOURCE_DOCS = {
    "actions_run":  "docs.github.com/actions/reference/workflow-syntax-for-github-actions; docs.github.com/actions/reference/workflow-cancellation-reference",
    "secrets":      "docs.github.com/actions/security-guides/using-secrets-in-github-actions; docs.github.com/actions/concepts/security/github_token; docs.github.com/actions/concepts/security/openid-connect",
    "api":          "docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api; docs.github.com/rest/authentication/authenticating-to-the-rest-api; docs.github.com/rest/using-the-rest-api/best-practices-for-using-the-rest-api",
    "webhook":      "docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries; docs.github.com/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks",
    "branch":       "docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches; docs.github.com/en/pull-requests/.../troubleshooting-required-status-checks; docs.github.com/en/repositories/.../managing-a-merge-queue",
    "secretscan":   "docs.github.com/en/code-security/concepts/secret-security/push-protection; docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns",
    "dependabot":   "docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates; docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-errors",
    "pages":        "docs.github.com/en/pages/configuring-github-pages-with-a-custom-domain; docs.github.com/en/pages/getting-started-with-github-pages",
    "codespaces":   "docs.github.com/en/codespaces/troubleshooting/troubleshooting-prebuilds; docs.github.com/en/codespaces/prebuilding-your-codespaces",
    "issues":       "docs.github.com/en/issues",
    "release":      "docs.github.com/en/repositories/releasing-projects-on-github",
    "git":          "docs.github.com/en/repositories/working-with-files/managing-large-files; docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories",
    "packages":     "docs.github.com/en/packages",
    "security":     "docs.github.com/en/organizations/keeping-your-organization-secure; docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs",
    "dispatch":     "docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event; docs.github.com/en/actions/using-workflows/events-that-trigger-workflows",
    "environments": "docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment",
    "matrix":       "docs.github.com/actions/using-jobs/using-a-matrix; docs.github.com/actions/using-workflows/reusing-workflows",
    "org":          "docs.github.com/en/organizations; docs.github.com/en/enterprise-cloud@latest",
}

# ---------------------------------------------------------------------------
# Build the rows
# ---------------------------------------------------------------------------

def build_rows(target: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen_keys = set()

    # Group triggers by category
    trig_by_cat: Dict[str, List[str]] = {}
    for prefix, cat, text in TRIGGERS:
        trig_by_cat.setdefault(cat, []).append(text)
    cond_by_cat = CONDITIONS
    if_by_cat = ACTIONS["if_action"]
    else_by_cat = ACTIONS["else_action"]

    cat_order = [
        "actions_run", "secrets", "api", "webhook", "branch", "secretscan",
        "dependabot", "pages", "codespaces", "issues", "release", "git",
        "packages", "security", "dispatch", "environments", "matrix", "org",
    ]

    # Capacity per category
    capacity = {}
    for cat in cat_order:
        t = len(trig_by_cat.get(cat, []))
        c = len(cond_by_cat.get(cat, []))
        a = len(if_by_cat.get(cat, []))
        e = len(else_by_cat.get(cat, []))
        capacity[cat] = (t, c, a, e, t * c * a * e)

    # Quota: min 25 per category, then distribute by trigger count
    MIN_PER_CAT = 25
    quotas = {cat: MIN_PER_CAT for cat in cat_order}
    remaining = target - sum(quotas.values())
    total_trig = sum(capacity[c][0] for c in cat_order) or 1
    for cat in cat_order:
        extra = int(round(remaining * capacity[cat][0] / total_trig))
        quotas[cat] += extra
        remaining -= extra
    if remaining:
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += remaining
    # Cap each quota to capacity (loose cap)
    for cat in cat_order:
        quotas[cat] = min(quotas[cat], capacity[cat][4])
    # Rebalance
    total_quota = sum(quotas.values())
    if total_quota < target:
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += (target - total_quota)
    elif total_quota > target:
        biggest = max(cat_order, key=lambda c: quotas[c])
        quotas[biggest] -= (total_quota - target)

    counter = 0
    for cat in cat_order:
        want = quotas[cat]
        triggers = trig_by_cat.get(cat, [])
        conds = cond_by_cat.get(cat, [])
        ifs = if_by_cat.get(cat, [])
        elses = else_by_cat.get(cat, [])
        if not (triggers and conds and ifs and elses):
            continue
        produced = 0
        # First pass: unique (trigger, condition) pairs with varied if/else
        for ti, t in enumerate(triggers):
            for ci, c in enumerate(conds):
                if produced >= want:
                    break
                if_action = ifs[(ti + ci) % len(ifs)]
                else_action = elses[ci % len(elses)]
                key = (t, c, if_action, else_action)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                counter += 1
                produced += 1
                rows.append({
                    "id": f"GH-{counter:04d}",
                    "category": cat,
                    "trigger": t,
                    "condition": c,
                    "if_action": if_action,
                    "else_action": else_action,
                    "severity": SEVERITY_BY_CATEGORY[cat],
                    "source_doc": SOURCE_DOCS[cat],
                })
            if produced >= want:
                break
        # Second pass: vary if/else pair to reach quota
        if produced < want:
            for ti, t in enumerate(triggers):
                for ci, c in enumerate(conds):
                    if produced >= want:
                        break
                    for ai in range(len(ifs)):
                        if produced >= want:
                            break
                        if_action = ifs[(ti + ci + ai) % len(ifs)]
                        else_action = elses[(ci + ai) % len(elses)]
                        key = (t, c, if_action, else_action)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        counter += 1
                        produced += 1
                        rows.append({
                            "id": f"GH-{counter:04d}",
                            "category": cat,
                            "trigger": t,
                            "condition": c,
                            "if_action": if_action,
                            "else_action": else_action,
                            "severity": SEVERITY_BY_CATEGORY[cat],
                            "source_doc": SOURCE_DOCS[cat],
                        })
                    if produced >= want:
                        break
                if produced >= want:
                    break
    return rows

def main() -> None:
    rows = build_rows(TARGET_ROWS)
    assert len(rows) == TARGET_ROWS, f"expected {TARGET_ROWS}, got {len(rows)}"
    seen = set()
    for r in rows:
        key = (r["trigger"], r["condition"], r["if_action"], r["else_action"])
        assert key not in seen, f"duplicate row: {key}"
        seen.add(key)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "category", "trigger", "condition", "if_action", "else_action", "severity", "source_doc"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)
    by_cat = {}
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    by_sev = {}
    for r in rows:
        by_sev[r["severity"]] = by_sev.get(r["severity"], 0) + 1
    print(f"wrote {OUT_PATH} with {len(rows)} rows")
    print("by category:", by_cat)
    print("by severity:", by_sev)

if __name__ == "__main__":
    main()
