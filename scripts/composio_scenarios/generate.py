#!/usr/bin/env python3
"""
Composio agentic-runtime scenario generator.

Generates a CSV of 500 unique (trigger, condition, if_action, else_action)
scenarios grounded in authoritative Composio docs.

Output columns: id, category, trigger, condition, if_action, else_action,
                severity, source_doc

Sources (verified):
  - docs.composio.dev/docs (welcome, what is a session)
  - docs.composio.dev/docs/how-composio-works
  - docs.composio.dev/docs/authentication
  - docs.composio.dev/docs/tools-direct/authenticating-tools
  - docs.composio.dev/docs/tools-direct/executing-tools
  - docs.composio.dev/docs/auth-configuration/connected-accounts
  - docs.composio.dev/docs/auth-configuration/custom-auth-params
  - docs.composio.dev/docs/managing-multiple-connected-accounts
  - docs.composio.dev/docs/triggers
  - docs.composio.dev/docs/setting-up-triggers/creating-triggers
  - docs.composio.dev/docs/setting-up-triggers/subscribing-to-events
  - docs.composio.dev/docs/extending-sessions/proxy-execute
  - docs.composio.dev/reference (API reference index)
  - docs.composio.dev/reference/errors
  - docs.composio.dev/reference/api-reference/connected-accounts
  - docs.composio.dev/reference/api-reference/auth-configs
  - docs.composio.dev/reference/api-reference/webhook-subscriptions
  - docs.composio.dev/reference/changelog
  - docs.composio.dev/docs/troubleshooting/api
  - composio.dev/content/the-guide-to-mcp-i-never-had
  - composio.dev/content/per-user-oauth-for-ai-agents
  - npmjs.com/package/@composio/client
"""
import csv
import os
import random
from typing import List, Dict

OUT_PATH = "/workspace/render_scenarios/composio_scenarios.csv"
TARGET_ROWS = 500
random.seed(20260715)

# ---------------------------------------------------------------------------
# Trigger pool
# ---------------------------------------------------------------------------
TRIGGERS: List[tuple] = [
    # ---------- SESSION / TOOL ROUTER ----------
    ("T-SES", "session", "Agent calls composio.create(userId) to open a new session"),
    ("T-SES", "session", "Agent opens a session with no toolkit filter (all toolkits)"),
    ("T-SES", "session", "Agent opens a session with toolkits=[github, slack] (filtered)"),
    ("T-SES", "session", "Agent calls session.tools() to enumerate available tools"),
    ("T-SES", "session", "Agent calls session.authorize('github') to start a Connect Link flow"),
    ("T-SES", "session", "Agent calls session.proxyExecute() to call a non-predefined endpoint"),
    ("T-SES", "session", "Agent calls COMPOSIO_MANAGE_CONNECTIONS meta tool"),
    ("T-SES", "session", "Agent calls COMPOSIO_SEARCH_TOOLS meta tool"),
    ("T-SES", "session", "Agent calls COMPOSIO_EXECUTE_TOOL meta tool"),
    ("T-SES", "session", "Agent calls COMPOSIO_SANDBOX meta tool (compute)"),
    ("T-SES", "session", "Agent reads session.workbench files"),
    ("T-SES", "session", "Agent writes to session.workbench files"),
    ("T-SES", "session", "Session has connected account pinned by ID"),
    ("T-SES", "session", "Session has connected account selected by alias"),
    ("T-SES", "session", "Session has multiple connected accounts for the same toolkit (work + personal)"),
    ("T-SES", "session", "Session is opened with a stale or unknown userID"),
    ("T-SES", "session", "Session attempts to use a toolkit that does not exist"),
    ("T-SES", "session", "Session filter includes a toolkit with no tools for the agent"),
    ("T-SES", "session", "Session has tool count > 20 (degraded accuracy per docs)"),
    ("T-SES", "session", "Session MCP endpoint (Tool Router) receives a request"),

    # ---------- AUTH CONFIG ----------
    ("T-AU", "auth", "Operator creates an auth config for a toolkit (OAuth2)"),
    ("T-AU", "auth", "Operator creates an auth config with custom scopes"),
    ("T-AU", "auth", "Operator creates an auth config using Composio's managed OAuth app"),
    ("T-AU", "auth", "Operator creates an auth config with BYO OAuth client (custom)"),
    ("T-AU", "auth", "Operator creates an auth config for API key (Bearer)"),
    ("T-AU", "auth", "Operator creates an auth config for Basic Auth"),
    ("T-AU", "auth", "Operator fetches config parameters (fields the user must supply)"),
    ("T-AU", "auth", "Operator enables an auth config (PATCH status)"),
    ("T-AU", "auth", "Operator disables an auth config (PATCH status)"),
    ("T-AU", "auth", "Operator deletes an auth config (DELETE)"),
    ("T-AU", "auth", "Operator lists auth configs with filters"),
    ("T-AU", "auth", "Auth config credentials are missing in dashboard"),
    ("T-AU", "auth", "Auth config scopes are insufficient for the toolkit action"),
    ("T-AU", "auth", "Auth config callback URL doesn't match OAuth app config"),
    ("T-AU", "auth", "Auth config uses DCR_OAUTH and old POST /connected_accounts endpoint (deprecated)"),

    # ---------- CONNECTED ACCOUNTS ----------
    ("T-CA", "connected", "User opens a Connect Link to authorize a toolkit"),
    ("T-CA", "connected", "User completes the OAuth flow at provider"),
    ("T-CA", "connected", "User denies consent on the provider consent screen"),
    ("T-CA", "connected", "OAuth callback returns an error (invalid code, expired state)"),
    ("T-CA", "connected", "User closes the browser tab mid-flow (Initializing)"),
    ("T-CA", "connected", "User does not complete the flow within 10 minutes (auto-expire)"),
    ("T-CA", "connected", "Operator creates a connected account via API (POST /connected_accounts)"),
    ("T-CA", "connected", "Operator creates a connected account via new endpoint (POST /connected_accounts/link)"),
    ("T-CA", "connected", "Operator lists connected accounts for a userID"),
    ("T-CA", "connected", "Operator gets a connected account by nanoid"),
    ("T-CA", "connected", "Operator updates a connected account (PATCH)"),
    ("T-CA", "connected", "Operator sets connected account status to INACTIVE (pause)"),
    ("T-CA", "connected", "Operator sets connected account status to ACTIVE (resume)"),
    ("T-CA", "connected", "Operator deletes a connected account (permanent)"),
    ("T-CA", "connected", "Operator calls POST /connected_accounts/{id}/refresh to renew tokens"),
    ("T-CA", "connected", "Composio rotates OAuth tokens automatically (background)"),
    ("T-CA", "connected", "Connected account transitions to EXPIRED (refresh failed N times)"),
    ("T-CA", "connected", "Connected account transitions to FAILED (auth attempt failed)"),
    ("T-CA", "connected", "Connected account is in Initializing / Initiated state"),
    ("T-CA", "connected", "Connected account requires re-auth (user revoked access on provider side)"),
    ("T-CA", "connected", "Connected account is on the wrong userID (cross-tenant leak risk)"),
    ("T-CA", "connected", "Multiple connected accounts for the same toolkit + same user (alias needed)"),
    ("T-CA", "connected", "Connected account alias updated / cleared"),
    ("T-CA", "connected", "Connected account custom auth params injected (bypasses Composio refresh)"),
    ("T-CA", "connected", "Connected account secret file presigned URL expires (1h TTL by default)"),

    # ---------- TOOL EXECUTION ----------
    ("T-EX", "execute", "Agent calls tools.execute(slug, params) for a known action"),
    ("T-EX", "execute", "Agent calls a tool slug that does not exist (404)"),
    ("T-EX", "execute", "Agent calls a tool with invalid parameters (schema mismatch)"),
    ("T-EX", "execute", "Agent calls a tool with missing required parameters"),
    ("T-EX", "execute", "Agent calls a tool with extra unknown parameters (some APIs reject)"),
    ("T-EX", "execute", "Tool execution returns 2xx from upstream (success)"),
    ("T-EX", "execute", "Tool execution returns 4xx from upstream (client error)"),
    ("T-EX", "execute", "Tool execution returns 5xx from upstream (server error)"),
    ("T-EX", "execute", "Tool execution times out (default 1 minute)"),
    ("T-EX", "execute", "Tool execution returns 429 from upstream (rate limited)"),
    ("T-EX", "execute", "Tool execution returns 401 from upstream (token expired/revoked)"),
    ("T-EX", "execute", "Tool execution returns 403 from upstream (insufficient scopes)"),
    ("T-EX", "execute", "Tool execution returns 404 from upstream (resource not found)"),
    ("T-EX", "execute", "Tool execution returns 422 from upstream (validation)"),
    ("T-EX", "execute", "Tool execution has no connected account for the user/toolkit"),
    ("T-EX", "execute", "Tool execution runs against a paused (INACTIVE) connected account"),
    ("T-EX", "execute", "Tool execution runs against an EXPIRED connected account"),
    ("T-EX", "execute", "Tool execution runs against a deleted connected account"),
    ("T-EX", "execute", "Tool execution is a non-idempotent write (POST)"),
    ("T-EX", "execute", "Tool execution is an idempotent write (PUT / DELETE)"),
    ("T-EX", "execute", "Tool execution returns a presigned file URL (default 1h TTL)"),
    ("T-EX", "execute", "Tool execution returns structured error with data.status_code and data.message"),
    ("T-EX", "execute", "Tool execution is retried automatically by SDK (maxRetries=2 default)"),
    ("T-EX", "execute", "Tool execution runs in background (async webhook for long tasks)"),
    ("T-EX", "execute", "Proxy execute sets Authorization header manually (overrides - 401)"),
    ("T-EX", "execute", "Proxy execute uses cross-domain absolute URL (rejected)"),
    ("T-EX", "execute", "Proxy execute returns upstream status verbatim (Composio doesn't retry)"),

    # ---------- API / RATE LIMIT / ERRORS ----------
    ("T-API", "api", "Agent calls Composio REST API with x-api-key header"),
    ("T-API", "api", "Agent calls Composio REST API with x-org-api-key header"),
    ("T-API", "api", "Agent calls Composio API endpoint with project API key"),
    ("T-API", "api", "Agent receives 400 BadRequestError from API"),
    ("T-API", "api", "Agent receives 401 AuthenticationError (bad key)"),
    ("T-API", "api", "Agent receives 403 PermissionDeniedError"),
    ("T-API", "api", "Agent receives 404 NotFoundError"),
    ("T-API", "api", "Agent receives 422 UnprocessableEntityError"),
    ("T-API", "api", "Agent receives 429 RateLimitError (composio plan)"),
    ("T-API", "api", "Agent receives 5xx InternalServerError"),
    ("T-API", "api", "Agent receives APIConnectionError (network / DNS / TLS)"),
    ("T-API", "api", "Agent receives APIConnectionTimeoutError (default 1 min)"),
    ("T-API", "api", "Agent request times out (configurable per-request)"),
    ("T-API", "api", "Agent hits 408 Request Timeout (auto-retried)"),
    ("T-API", "api", "Agent hits 409 Conflict (auto-retried)"),
    ("T-API", "api", "Agent hits upstream 429 from provider (Composio doesn't auto-retry)"),
    ("T-API", "api", "Agent SDK auto-retries 2 times by default (configurable maxRetries)"),
    ("T-API", "api", "Agent SDK exponential backoff between retries"),
    ("T-API", "api", "Agent response includes x-request-id header (for support)"),

    # ---------- TRIGGERS (WEBHOOKS FROM CONNECTED APPS) ----------
    ("T-TR", "triggers", "Operator enables a trigger (e.g. GITHUB_COMMIT_EVENT) for a user"),
    ("T-TR", "triggers", "Trigger instance is created with default toolkit version 'latest'"),
    ("T-TR", "triggers", "Trigger is pinned to a specific toolkit version (SDK init)"),
    ("T-TR", "triggers", "Trigger fires an event (new email, new issue, new Slack message)"),
    ("T-TR", "triggers", "Trigger payload arrives in V3 envelope (metadata + data)"),
    ("T-TR", "triggers", "Trigger payload arrives in V1/V2 envelope (legacy)"),
    ("T-TR", "triggers", "Trigger event has type composio.trigger.message"),
    ("T-TR", "triggers", "Trigger event has type composio.connected_account.expired (lifecycle)"),
    ("T-TR", "triggers", "Multiple triggers fire for the same event (deduplication needed)"),
    ("T-TR", "triggers", "Trigger instance is disabled by operator (no events delivered)"),
    ("T-TR", "triggers", "Trigger instance is deleted by operator"),
    ("T-TR", "triggers", "Trigger has no connected account (events not delivered)"),
    ("T-TR", "triggers", "Trigger has multiple connected accounts; first active is used"),
    ("T-TR", "triggers", "Trigger payload type unknown (handler must route on triggerSlug)"),
    ("T-TR", "triggers", "Trigger payload too large for downstream system"),
    ("T-TR", "triggers", "Trigger event is a duplicate of a previous event (idempotency needed)"),

    # ---------- WEBHOOK SUBSCRIPTION (INBOUND FROM COMPOSIO) ----------
    ("T-WS", "webhook", "Operator creates a webhook subscription with webhook_url"),
    ("T-WS", "webhook", "Operator lists available event types via /webhook_subscriptions/event_types"),
    ("T-WS", "webhook", "Operator scopes subscription to enabled_events (filter)"),
    ("T-WS", "webhook", "Operator rotates the webhook signing secret (COMPOSIO_WEBHOOK_SECRET)"),
    ("T-WS", "webhook", "Webhook URL is not publicly reachable (Composio can't POST)"),
    ("T-WS", "webhook", "Webhook URL is on localhost / 127.0.0.1 (cannot deliver)"),
    ("T-WS", "webhook", "Webhook URL is behind IP allowlist (Composio's outbound IPs are dynamic)"),
    ("T-WS", "webhook", "Webhook URL returns non-2xx (retry with backoff)"),
    ("T-WS", "webhook", "Webhook URL returns 5xx (transient, retry)"),
    ("T-WS", "webhook", "Webhook URL returns 410 Gone (stop delivering)"),
    ("T-WS", "webhook", "Webhook URL is slow (>10s) - Composio may time out and retry"),
    ("T-WS", "webhook", "Webhook payload arrives with webhook-id, webhook-timestamp, webhook-signature headers"),
    ("T-WS", "webhook", "Webhook signature verification fails (secret mismatch)"),
    ("T-WS", "webhook", "Webhook secret is leaked (rotate immediately)"),
    ("T-WS", "webhook", "Webhook handler is non-idempotent (duplicate event = duplicate side effect)"),
    ("T-WS", "webhook", "Webhook handler does heavy work synchronously (blocks, times out)"),
    ("T-WS", "webhook", "Webhook handler uses parse(verifySecret=...) to verify + parse in one call"),
    ("T-WS", "webhook", "Webhook handler uses subscribe() over WebSocket (dev only)"),

    # ---------- TOOLKITS & TOOLS ----------
    ("T-TK", "toolkits", "Agent lists all available toolkits"),
    ("T-TK", "toolkits", "Agent searches tools by use case (natural language)"),
    ("T-TK", "toolkits", "Agent filters tools by toolkit slug"),
    ("T-TK", "toolkits", "Agent filters tools by tag"),
    ("T-TK", "toolkits", "Agent retrieves a single tool by slug (case-sensitive SCREAMING_SNAKE_CASE)"),
    ("T-TK", "toolkits", "Agent enables a toolkit in a session"),
    ("T-TK", "toolkits", "Agent disables a toolkit in a session"),
    ("T-TK", "toolkits", "Tool input schema does not match what the model produced"),
    ("T-TK", "toolkits", "Tool input schema has $ref / oneOf / anyOf (LLM gets confused)"),
    ("T-TK", "toolkits", "Tool schema is too large (context window pressure)"),
    ("T-TK", "toolkits", "Custom tool is registered with session (local in-process)"),
    ("T-TK", "toolkits", "Custom toolkit is registered with session"),
    ("T-TK", "toolkits", "Tool version is pinned to a specific toolkit version"),

    # ---------- MCP (MODEL CONTEXT PROTOCOL) ----------
    ("T-MCP", "mcp", "MCP client initializes against Composio Tool Router MCP server"),
    ("T-MCP", "mcp", "MCP list_tools returns > 100 tools (token blow-up)"),
    ("T-MCP", "mcp", "MCP call_tool returns a presigned file URL (1h TTL)"),
    ("T-MCP", "mcp", "MCP call_tool times out (long-running upstream)"),
    ("T-MCP", "mcp", "MCP server sends SSE events to client"),
    ("T-MCP", "mcp", "MCP server version negotiation fails"),
    ("T-MCP", "mcp", "MCP server SSE connection leaks (long-lived)"),
    ("T-MCP", "mcp", "MCP tool schema includes a complex nested object (LLM flaky)"),
    ("T-MCP", "mcp", "MCP client doesn't release resources on disconnect"),

    # ---------- PROXY EXECUTE ----------
    ("T-PX", "proxy", "Agent calls session.proxyExecute() with relative endpoint"),
    ("T-PX", "proxy", "Agent calls session.proxyExecute() with cross-subdomain URL (allowed if same registrable domain)"),
    ("T-PX", "proxy", "Agent calls session.proxyExecute() with cross-domain URL (rejected)"),
    ("T-PX", "proxy", "Agent sets Authorization header manually in parameters (overrides - 401)"),
    ("T-PX", "proxy", "Proxy execute returns upstream 4xx verbatim (Composio doesn't transform)"),
    ("T-PX", "proxy", "Proxy execute returns upstream 5xx verbatim"),
    ("T-PX", "proxy", "Proxy execute respects upstream Retry-After (Composio doesn't auto-retry)"),
    ("T-PX", "proxy", "Proxy execute returns non-JSON body (parsed as JSON fails)"),

    # ---------- FILE / WORKBENCH ----------
    ("T-FL", "files", "Tool execution returns a file (presigned URL, 1h TTL)"),
    ("T-FL", "files", "File presigned URL is fetched after TTL (expired - 403)"),
    ("T-FL", "files", "File presigned URL is used in subsequent tool call (input file)"),
    ("T-FL", "files", "Workbench file is written by tool"),
    ("T-FL", "files", "Workbench file is read by tool"),
    ("T-FL", "files", "Workbench file size exceeds limit (rejected)"),
    ("T-FL", "files", "Workbench is cleared on session end (or persists per config)"),

    # ---------- LOGGING / OBSERVABILITY ----------
    ("T-LO", "logs", "Tool execution log_id is returned (for traceability)"),
    ("T-LO", "logs", "Tool execution log is fetched via API"),
    ("T-LO", "logs", "Tool execution log is missing (TTL expired)"),
    ("T-LO", "logs", "Tool execution log shows retries (maxRetries times)"),
    ("T-LO", "logs", "Tool memory persists across sessions (per user)"),
    ("T-LO", "logs", "Tool memory cleared / reset for user"),

    # ---------- PLAN / BILLING ----------
    ("T-BI", "billing", "Free plan rate limit hit (per docs, varies)"),
    ("T-BI", "billing", "Developer plan rate limit hit (5000 req/h typical)"),
    ("T-BI", "billing", "Enterprise plan rate limit hit (custom)"),
    ("T-BI", "billing", "Project-level rate limit (custom per project)"),
    ("T-BI", "billing", "Org-level rate limit (across all projects)"),
    ("T-BI", "billing", "Subscription lapsed (API returns 402 / 403)"),
    ("T-BI", "billing", "Add-on purchased (rate limit increases)"),
    ("T-BI", "billing", "API quota warning approaching limit (header)"),
    ("T-BI", "billing", "Webhook delivery quota exceeded (backoff or drop)"),

    # ---------- CHANGELOG / BREAKING CHANGES ----------
    ("T-CL", "changelog", "POST /connected_accounts returns 400 (use /link instead - cutover Jul 3 2026)"),
    ("T-CL", "changelog", "SDK default maxRetries changed (regression risk)"),
    ("T-CL", "changelog", "Default timeout changed (1 min → custom)"),
    ("T-CL", "changelog", "Tool response includes new data.status_code / data.message fields"),
    ("T-CL", "changelog", "Presigned file URL TTL changed (was unset, now 1h default)"),
    ("T-CL", "changelog", "Initializing/Initiated connections auto-expire after 10 min"),
    ("T-CL", "changelog", "Non-idempotent writes no longer auto-retried (was 2x default)"),
    ("T-CL", "changelog", "Bounded timeouts on file transfers and S3 presigned requests"),

    # ---------- AGENT RUNTIME (provider-agnostic) ----------
    ("T-AG", "agent", "Agent LLM hallucinates a non-existent tool slug (e.g. SLACK_PING_PONG)"),
    ("T-AG", "agent", "Agent LLM produces invalid JSON for tool arguments"),
    ("T-AG", "agent", "Agent LLM exceeds its context window mid-conversation (session too long)"),
    ("T-AG", "agent", "Agent LLM streams partial tool calls (parse + validate)"),
    ("T-AG", "agent", "Agent loop iterates without making progress (infinite loop risk)"),
    ("T-AG", "agent", "Agent invokes tool with PII in arguments (need redaction)"),
    ("T-AG", "agent", "Agent invokes tool that returns PII (need redaction in logs)"),
    ("T-AG", "agent", "Agent's tool calls exceed parallelism limit (queue / serialize)"),
    ("T-AG", "agent", "Agent uses wrong userID (cross-tenant) - blocked by userID scoping"),
    ("T-AG", "agent", "Agent uses session from previous user (token swapped, no leakage)"),
    ("T-AG", "agent", "Agent retries same tool call after timeout (non-idempotent)"),
    ("T-AG", "agent", "Agent drops a tool result due to length (truncation)"),
    ("T-AG", "agent", "Agent interprets tool error as success (need clear error contract)"),
    ("T-AG", "agent", "Agent picks tool with too-broad scope (privilege creep)"),

    # ---------- SECURITY / COMPLIANCE ----------
    ("T-SC", "security", "UserID is PII (email) - pseudonymize before passing to Composio"),
    ("T-SC", "security", "UserID is not stable (changes per request) - account isolation breaks"),
    ("T-SC", "security", "API key is committed to git (rotate, audit)"),
    ("T-SC", "security", "API key is in client-side code (must be server-side only)"),
    ("T-SC", "security", "OAuth client secret is in dashboard (encrypted at rest)"),
    ("T-SC", "security", "Tool execution has access to a high-scope connected account (admin/owner)"),
    ("T-SC", "security", "Tool execution crosses org boundary (cross-tenant attempt)"),
    ("T-SC", "security", "User requests redaction of their connected account (GDPR / CCPA)"),
    ("T-SC", "security", "Audit log entry created for every tool execution"),
    ("T-SC", "security", "Audit log streamed to SIEM (per workspace config)"),
    ("T-SC", "security", "Connected account accessed after user offboarded (deny by userID check)"),
    ("T-SC", "security", "Tool input is logged (PII risk) - use redaction at log layer"),
    ("T-SC", "security", "Tool output is logged (PII risk) - use redaction"),
    ("T-SC", "security", "OAuth state parameter is missing (CSRF risk on callback)"),
    ("T-SC", "security", "OAuth redirect_uri mismatch (provider rejects)"),
    ("T-SC", "security", "Refresh token is in URL (should be in header or body)"),
    ("T-SC", "security", "Provider scopes downgraded (existing connection still has old scopes)"),
    ("T-SC", "security", "Provider scopes upgraded (existing connection may not have new scopes)"),
]

# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------
CONDITIONS: Dict[str, List[str]] = {
    "session": [
        "composio_create_response.status == 200 AND session_id returned",
        "composio_create_response.status == 401 (bad API key)",
        "session.userID is non-empty and stable",
        "session.userID is empty / null",
        "session.userID is PII (email, phone) - should be hashed",
        "session.toolkits filter is set to non-empty list",
        "session.toolkits filter is empty (= all toolkits available)",
        "session.connected_account_id is set (specific account)",
        "session.connected_account_id is null (auto-select first active)",
        "session.alias is set (named account selection)",
        "session has at least one ACTIVE connected account for the toolkit",
        "session has 0 ACTIVE connected accounts (all INIT / EXPIRED / FAILED)",
        "session has multiple ACTIVE connected accounts (ambiguous - need alias or ID)",
        "session tool count <= 20 (per docs recommendation)",
        "session tool count > 20 (degraded accuracy per docs)",
        "session tool count > 50 (severe degradation)",
        "session.workbench has files (compute state present)",
        "session.proxyExecute called with relative endpoint",
        "session.proxyExecute called with cross-domain absolute URL",
        "session.proxyExecute called with same-registrable-domain cross-subdomain",
        "MCP Tool Router endpoint is reachable (HTTPS 200)",
        "MCP Tool Router endpoint is behind a proxy that strips auth",
        "session.authorize() returns a Connect Link (status=INITIATED)",
        "session.authorize() returns an error (auth config missing)",
        "meta tool COMPOSIO_MANAGE_CONNECTIONS is invoked (correct path for auth)",
        "meta tool COMPOSIO_SEARCH_TOOLS is invoked with too-broad query (no results)",
        "meta tool COMPOSIO_EXECUTE_TOOL is invoked with wrong arguments",
        "meta tool COMPOSIO_SANDBOX is invoked (sandbox compute)",
    ],
    "auth": [
        "auth_config.scheme == 'OAUTH2' (managed app used)",
        "auth_config.scheme == 'OAUTH2' with custom (BYO) OAuth client",
        "auth_config.scheme == 'BEARER_TOKEN' (user-supplied long-lived)",
        "auth_config.scheme == 'API_KEY' (header or query param)",
        "auth_config.scheme == 'BASIC_AUTH' (user:pass)",
        "auth_config.scheme == 'DCR_OAUTH' (deprecated path - cutover Jul 3 2026)",
        "auth_config.scopes are sufficient for the toolkit's actions",
        "auth_config.scopes are insufficient (tool calls will 403 from upstream)",
        "auth_config.callback_url matches provider app config",
        "auth_config.callback_url mismatches provider app config (OAuth error)",
        "auth_config.credentials are present in dashboard (encrypted at rest)",
        "auth_config.credentials are missing (POST will fail)",
        "auth_config.status == 'ENABLED'",
        "auth_config.status == 'DISABLED' (no new connections allowed)",
        "auth_config uses Composio managed OAuth app (good for dev)",
        "auth_config uses BYO OAuth app (required for prod - branding, custom scopes)",
        "auth_config.fetch_config returns fields the user must supply at connect time",
        "auth_config.delete is called (destructive; existing connections orphaned)",
    ],
    "connected": [
        "connected_account.status == 'ACTIVE' (can execute tools)",
        "connected_account.status == 'INITIALIZING' (OAuth flow started, not complete)",
        "connected_account.status == 'INITIATED' (Connect Link generated, user not yet completed)",
        "connected_account.status == 'FAILED' (auth attempt failed - check status_reason)",
        "connected_account.status == 'EXPIRED' (refresh failed N times - user must re-auth)",
        "connected_account.status == 'INACTIVE' (operator paused; tool calls will fail)",
        "connection is older than 10 min in INITIALIZING/INITIATED (auto-expires per changelog)",
        "connected_account.userID matches the requesting userID (auth isolation)",
        "connected_account.userID does NOT match (cross-tenant attempt - block)",
        "connected_account.alias is set and resolvable",
        "multiple connected accounts exist for same (user, toolkit) - need alias to disambiguate",
        "OAuth refresh token is in the connected account (Composio auto-refreshes)",
        "OAuth refresh attempt failed (1st time) - still ACTIVE (Composio retries)",
        "OAuth refresh attempt failed (N times) - marked EXPIRED",
        "user revoked access on provider side (Google Account > Third-party apps)",
        "OAuth app deleted in provider developer console (Composio can't refresh)",
        "provider revoked tokens (policy change / security event)",
        "test/unverified app has refresh token expiry (e.g. Google test apps)",
        "custom_auth_params passed at execute (bypasses Composio refresh - agent owns it)",
        "custom_auth_params expired (agent is responsible, not Composio)",
        "connected_account has no toolkit access for the requested action",
        "POST /connected_accounts called for OAUTH2/DCR_OAUTH (deprecated - returns 400 after cutover)",
        "POST /connected_accounts/link used (correct new endpoint)",
        "connected_account.delete is permanent (cannot be undone)",
        "connected_account.disable vs delete (disable = reversible pause)",
        "connected_account_id resolution fails (orphan / wrong nanoid)",
        "status_reason field on EXPIRED/FAILED explains why (per docs)",
    ],
    "execute": [
        "tool slug exists in catalog (case-sensitive SCREAMING_SNAKE_CASE)",
        "tool slug does not exist (404 Tool not found)",
        "tool input schema matches the params provided",
        "tool input schema does NOT match (400 / 422)",
        "tool requires parameters the model omitted",
        "tool parameters include extras the API rejects",
        "tool execution upstream returns 2xx (success)",
        "tool execution upstream returns 4xx (client error - check params, scopes)",
        "tool execution upstream returns 5xx (transient - retry per SDK default)",
        "tool execution upstream returns 401 (refresh now, mark EXPIRED if persistent)",
        "tool execution upstream returns 403 (insufficient scopes - re-consent user)",
        "tool execution upstream returns 404 (resource not found - check params)",
        "tool execution upstream returns 422 (validation - check body)",
        "tool execution upstream returns 429 (rate limit - respect Retry-After)",
        "tool execution times out (SDK default 1 min, configurable)",
        "tool execution is non-idempotent write (POST) - SDK no longer retries (per changelog)",
        "tool execution is idempotent write (PUT / DELETE) - SDK auto-retries up to maxRetries",
        "tool execution returns presigned file URL (1h TTL default per changelog)",
        "tool execution returns structured error: data.status_code + data.message",
        "tool execution is retried by SDK (default 2x, configurable maxRetries)",
        "tool execution has no connected account (No connected account error)",
        "tool execution has INACTIVE connected account (will fail)",
        "tool execution has EXPIRED connected account (will fail - re-auth user)",
        "tool execution runs in background (async webhook for long task)",
        "tool execution has request_id in response (for support)",
        "proxy execute sets Authorization header in parameters (overrides - 401)",
        "proxy execute endpoint is relative (preferred)",
        "proxy execute endpoint is cross-domain absolute (rejected)",
        "proxy execute returns upstream status verbatim (no transform)",
    ],
    "api": [
        "x-api-key header is present and valid (project-level key)",
        "x-org-api-key header is present and valid (org-level key)",
        "API key is missing (401 AuthenticationError)",
        "API key is malformed (401)",
        "API key has been revoked (401)",
        "API key has insufficient org scope (403 PermissionDeniedError)",
        "response.status_code == 200 (success)",
        "response.status_code == 400 (BadRequestError - check body schema)",
        "response.status_code == 401 (AuthenticationError)",
        "response.status_code == 403 (PermissionDeniedError)",
        "response.status_code == 404 (NotFoundError)",
        "response.status_code == 422 (UnprocessableEntityError - validation)",
        "response.status_code == 429 (RateLimitError - backoff with jitter)",
        "response.status_code in 5xx (InternalServerError - retry per SDK)",
        "response is APIConnectionError (network, DNS, TLS failure)",
        "response is APIConnectionTimeoutError (default 1 min)",
        "retry-after header is present (seconds to wait)",
        "x-request-id header is present (for support ticket)",
        "SDK auto-retries 408 / 409 / 429 / 5xx / APIConnectionError up to maxRetries (default 2)",
        "SDK exponential backoff between retries (built-in)",
        "configurable maxRetries: 0 to disable (use for non-idempotent)",
        "configurable timeout per-request (overrides 1 min default)",
        "rate limit headers (X-RateLimit-*) indicate quota state",
    ],
    "triggers": [
        "trigger slug exists in catalog (e.g. GITHUB_COMMIT_EVENT)",
        "trigger is created for a user with ACTIVE connected account",
        "trigger is created for a user with 0 connected accounts (no events delivered)",
        "trigger is pinned to a specific toolkit version",
        "trigger is on default 'latest' toolkit version (may break parsing across upgrades)",
        "trigger has multiple connected accounts; first active is used",
        "trigger has connected_account_id override (picks specific account)",
        "trigger fires and produces V3 envelope payload (metadata + data)",
        "trigger fires and produces V1/V2 envelope (legacy org)",
        "trigger event type is composio.trigger.message",
        "trigger event type is composio.connected_account.expired (lifecycle)",
        "trigger handler is idempotent (delivery_id dedup)",
        "trigger handler is non-idempotent (duplicate event = duplicate side effect)",
        "trigger payload size is within downstream system limits",
        "trigger payload size exceeds downstream limits (truncate / reject)",
        "trigger instance is disabled (no events delivered)",
        "trigger instance is deleted (no events delivered)",
        "trigger config matches what the type expects (per get_type / getType)",
        "trigger fires faster than handler can process (backpressure)",
    ],
    "webhook": [
        "webhook_url is publicly reachable (HTTPS)",
        "webhook_url is on localhost (cannot deliver)",
        "webhook_url is behind IP allowlist (Composio's outbound IPs are dynamic)",
        "webhook_url returns 2xx (delivered)",
        "webhook_url returns 4xx (rejected, no retry)",
        "webhook_url returns 5xx (transient, retry with backoff)",
        "webhook_url returns 410 Gone (stop delivering)",
        "webhook_url is slow (>10s, Composio may time out and retry)",
        "webhook payload has webhook-id header (unique delivery id)",
        "webhook payload has webhook-timestamp header (clock for replay defense)",
        "webhook payload has webhook-signature header (HMAC)",
        "webhook signature verification passes (secret matches, payload intact)",
        "webhook signature verification fails (secret wrong / payload modified)",
        "webhook secret is leaked (rotate immediately via subscription update)",
        "webhook secret is rotated (overlap window - validate both old and new)",
        "webhook handler is idempotent (delivery_id dedup via Redis / DB unique)",
        "webhook handler does heavy work synchronously (blocks, times out)",
        "webhook handler uses parse(verifySecret=...) (verify + parse in one call)",
        "webhook subscription enabled_events filter matches the events we want",
        "webhook subscription has 0 events enabled (nothing delivered)",
        "webhook subscription includes composio.connected_account.expired (catch expiries)",
        "webhook subscription includes composio.trigger.message (catch trigger events)",
        "subscribe() over WebSocket used in production (anti-pattern - dev only)",
        "ngrok / cloudflared tunnel used (expose local handler for testing)",
    ],
    "toolkits": [
        "toolkit slug exists in catalog (e.g. 'github', 'gmail', 'slack')",
        "tool slug matches SCREAMING_SNAKE_CASE pattern (e.g. GITHUB_CREATE_ISSUE)",
        "tool slug has wrong case (404 Tool not found per docs)",
        "tool input schema is JSON Schema compliant",
        "tool input schema uses $ref / oneOf / anyOf (LLM may struggle)",
        "tool input schema is too large (context window pressure)",
        "tool filter by toolkit returns <= 20 tools (good for accuracy)",
        "tool filter by toolkit returns > 20 tools (degrade accuracy, split sessions)",
        "tool filter by use case (NL search) returns relevant results",
        "tool filter by use case returns empty (query too narrow)",
        "tool filter by tag returns correct set",
        "toolkit is enabled in session (session.toolkits includes it)",
        "toolkit is disabled in session (tools not discoverable)",
        "tool version is 'latest' (default - may break across upgrades)",
        "tool version is pinned (stable parsing)",
        "custom tool is registered to session (in-process execution)",
        "custom toolkit is registered to session",
        "tool definition is missing parameters (broken schema - report to Composio)",
    ],
    "mcp": [
        "MCP client initializes against Tool Router endpoint (handshake OK)",
        "MCP client initialize fails (version negotiation error)",
        "MCP list_tools returns <= 20 tools (good)",
        "MCP list_tools returns > 100 tools (token blow-up risk)",
        "MCP call_tool executes synchronously and returns in < 1 min",
        "MCP call_tool times out (long-running upstream, may need async pattern)",
        "MCP call_tool returns presigned file URL (1h TTL)",
        "MCP server emits SSE events (long-lived connection)",
        "MCP server SSE connection leaks (no close on client disconnect)",
        "MCP tool schema is simple (LLM-friendly)",
        "MCP tool schema is complex (LLM flaky - simplify or guide with examples)",
        "MCP resources / prompts are exposed (in addition to tools)",
        "MCP client doesn't release resources on disconnect (server memory leak)",
        "MCP request originates from Claude Code / Cursor / VS Code / etc.",
    ],
    "proxy": [
        "proxy endpoint is relative (preferred - resolved against base URL)",
        "proxy endpoint is same-registrable-domain cross-subdomain (allowed)",
        "proxy endpoint is cross-domain (rejected per docs)",
        "proxy endpoint scheme differs from base URL (rejected - http vs https)",
        "proxy endpoint is absolute URL to different domain (rejected)",
        "proxy request includes Authorization header in parameters (overrides - 401)",
        "proxy request does NOT include Authorization (Composio injects correctly)",
        "proxy response.status is 2xx (success)",
        "proxy response.status is 4xx (client error - check endpoint / params)",
        "proxy response.status is 401 (token expired - re-auth)",
        "proxy response.status is 403 (insufficient scopes)",
        "proxy response.status is 429 (upstream rate limit - honor Retry-After)",
        "proxy response.status is 5xx (transient - retry per SDK)",
        "proxy response body is JSON (parsed)",
        "proxy response body is non-JSON (raw string, no parse)",
        "proxy response headers preserved (for client logic)",
        "Composio doesn't auto-retry proxy (per docs)",
    ],
    "files": [
        "tool execution returns a file (presigned URL)",
        "file presigned URL TTL is default 1h (per changelog)",
        "file presigned URL is fetched within TTL (works)",
        "file presigned URL is fetched after TTL (expired - 403)",
        "file presigned URL is shared cross-session (intended or not?)",
        "file is passed as input to another tool call (multipart / URL)",
        "workbench file is written by tool (state persistence)",
        "workbench file is read by tool (state hydration)",
        "workbench file size exceeds limit (rejected by tool)",
        "workbench state cleared on session end (per config)",
        "workbench state persists across sessions (per config)",
        "session file transfer uses bounded connect / read timeout (per changelog)",
        "file presigned URL is from S3 (configurable backend)",
    ],
    "logs": [
        "tool execution returns a log_id (trace through dashboard)",
        "tool execution log is fetched via API (within retention)",
        "tool execution log is missing (retention expired)",
        "log includes retry attempts (maxRetries count)",
        "log includes upstream status code and message",
        "log includes request_id (for support)",
        "tool memory persists across sessions for the same user",
        "tool memory is cleared / reset for the user",
        "audit log is enabled at workspace level (per docs)",
        "audit log is streamed to SIEM (per workspace config)",
        "log redaction is enabled for PII (tool input/output scrubbed)",
    ],
    "billing": [
        "free plan rate limit hit (per docs, plan-specific)",
        "developer plan rate limit hit (typically 5000 req/h)",
        "enterprise plan rate limit hit (custom, higher)",
        "project-level rate limit hit (custom per project)",
        "org-level rate limit hit (shared across all projects)",
        "subscription lapsed (API returns 402 Payment Required or 403)",
        "subscription is active (requests within quota)",
        "add-on purchased (rate limit increases immediately)",
        "quota warning: rate limit headers indicate proximity to limit",
        "webhook delivery quota exceeded (delivery backoff or drop)",
        "agent uses x-org-api-key (different quota than x-api-key)",
    ],
    "changelog": [
        "POST /connected_accounts called for OAUTH2 / DCR_OAUTH (deprecated - cutover Jul 3 2026)",
        "POST /connected_accounts called for API_KEY (still works)",
        "POST /connected_accounts/link used (correct new endpoint)",
        "SDK default maxRetries changed (regression risk for non-idempotent writes)",
        "SDK default timeout changed (1 min -> custom, may need re-config)",
        "tool response now includes data.status_code / data.message (new schema)",
        "tool response missing data.status_code (older contract - parse error.message only)",
        "presigned file URL TTL = 1h (was unset, now default per changelog)",
        "Initializing/Initiated connections auto-expire after 10 min (changelog)",
        "non-idempotent writes no longer auto-retried (changelog - was 2x default)",
        "bounded timeouts on file transfers and S3 presigned (changelog)",
    ],
    "agent": [
        "agent LLM hallucinated a tool slug (e.g. SLACK_PING_PONG) - 404",
        "agent LLM produced invalid JSON for arguments - parse fails",
        "agent LLM produced JSON but wrong shape (schema mismatch) - 422",
        "agent LLM omitted a required field (422)",
        "agent LLM context window exceeded mid-conversation",
        "agent LLM streamed partial tool call (parse + validate needed)",
        "agent LLM loop iterates without progress (infinite loop risk)",
        "agent invoked tool with PII in args (need log redaction)",
        "agent invoked tool that returned PII (need redaction)",
        "agent parallel tool calls exceeded limit (serialize)",
        "agent used wrong userID (cross-tenant - blocked by scoping)",
        "agent used session from previous user (token swapped, no leak)",
        "agent retried same non-idempotent tool call after timeout (duplicate side effect)",
        "agent dropped tool result due to length (truncate with care)",
        "agent interpreted tool error as success (need clear error contract)",
        "agent picked tool with too-broad scope (privilege creep)",
        "agent's tool list is filtered correctly (per session scope)",
        "agent's tool list is too broad (> 20, accuracy drops)",
        "agent's tool call budget is exhausted (back off, summarize)",
        "agent ignores a 429 from upstream (must respect Retry-After)",
        "agent ignores a 401 from upstream (must trigger re-auth flow)",
    ],
    "security": [
        "userID is PII (email, phone) - should be hashed before passing to Composio",
        "userID is not stable (changes per request) - account isolation breaks",
        "userID is unique per user (correct)",
        "API key is committed to git (rotate, audit log, force-rotate other devs)",
        "API key is in client-side code (must be server-side only)",
        "API key is in server env / secrets manager (correct)",
        "API key is shared across team (rotate individually, not one shared key)",
        "OAuth client secret is in dashboard (encrypted at rest, OK)",
        "OAuth client secret is in source (CRITICAL - rotate immediately)",
        "tool execution has access to a high-scope connected account (admin/owner)",
        "tool execution crossed org boundary (cross-tenant - should be blocked)",
        "user requested redaction / deletion of their connected account (GDPR / CCPA)",
        "user offboarded but their connected account still exists (deny by userID check)",
        "tool input contains PII (redact at log layer)",
        "tool output contains PII (redact at log layer)",
        "OAuth state parameter is missing (CSRF risk on callback)",
        "OAuth redirect_uri mismatch (provider rejects)",
        "refresh token leaked in URL (must be in header or body)",
        "provider scopes downgraded but connection has old scopes (still works until refresh)",
        "provider scopes upgraded but connection has old scopes (must re-consent)",
    ],
}

# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
ACTIONS: Dict[str, Dict[str, List[str]]] = {
    "if_action": {
        "session": [
            "Return session_id; pass to subsequent tool calls; userID is the scope",
            "Re-init SDK with valid COMPOSIO_API_KEY; retry session.create",
            "Use hashed/pseudonymized userID; never pass email/phone as userID",
            "Open session with toolkits filter (limit to 5-10 needed toolkits)",
            "Open session with no filter only for agent discovery phase (then narrow)",
            "Pin connected_account_id explicitly (avoid auto-pick ambiguity)",
            "Use alias to select connected account (more stable than ID across re-auth)",
            "Surface 'no connected account' to user with Connect Link (session.authorize())",
            "Disambiguate by prompting user (work vs personal) or domain policy",
            "Keep tool count <= 20 per docs recommendation (split into multiple sessions)",
            "Reduce tool count by 50%+ (filter by use case, tag, recent)",
            "Use multiple sessions with different scopes (one per role / phase)",
            "Use the workbench for state (file storage, intermediate outputs)",
            "Use proxyExecute for any HTTP endpoint not exposed as a tool",
            "Use COMPOSIO_MANAGE_CONNECTIONS to handle auth inside agent loop",
            "Use COMPOSIO_SEARCH_TOOLS for NL discovery (broad queries)",
            "Use COMPOSIO_EXECUTE_TOOL for runtime tool calling (after search)",
            "Return clear error to agent: 'no tool found for query X'",
            "Provide example tool calls in agent prompt (improve schema understanding)",
            "Use Tool Router MCP endpoint (unified surface for Claude Code / Cursor / etc.)",
            "Use a provider for your framework (Vercel AI SDK, OpenAI Agents, LangChain)",
        ],
        "auth": [
            "Use managed OAuth app for dev; switch to BYO for prod (branding, scopes)",
            "Use the right scheme: OAUTH2 / API_KEY / BEARER_TOKEN / BASIC_AUTH",
            "Add custom scopes to auth config; re-consent user to apply",
            "Fix callback_url to match provider app config",
            "Add missing credentials to dashboard (encrypted at rest)",
            "Enable the auth config (PATCH status=ENABLED) before users can connect",
            "Disable auth config to block new connections (preserves existing)",
            "Migrate from POST /connected_accounts to /link for OAUTH2 / DCR_OAUTH (Jul 3 2026)",
            "Use POST /connected_accounts for API_KEY / BEARER (still works)",
            "Call fetch_config to discover fields the user must supply at connect time",
            "Document the auth config flow in your app (Connect Link, callback, etc.)",
            "Avoid deleting auth configs (orphans existing connections)",
        ],
        "connected": [
            "Use the connected account (status ACTIVE) to execute tools",
            "Wait for user to complete OAuth (INITIATING -> ACTIVE); poll or subscribe",
            "Surface 'auth incomplete' to user; provide Connect Link again",
            "If Initializing > 10 min, mark as expired and ask user to retry (per changelog)",
            "Use status_reason field to explain why the connection is FAILED / EXPIRED",
            "Subscribe to composio.connected_account.expired webhook (proactive)",
            "Trigger re-auth flow (POST /connected_accounts/{id}/refresh) on EXPIRED",
            "Generate a fresh Connect Link and surface to user for re-auth",
            "Block tool execution; surface 're-auth required' to agent / user",
            "Rotate credentials at the provider first, then refresh (avoid half-rotated state)",
            "Use INACTIVE for subscription lapse / temporary pause (reversible)",
            "Use DELETE only when user requests GDPR / account removal (permanent)",
            "Always pin connected_account_id or alias (never rely on auto-pick for prod)",
            "Store connected_account_id in your DB (not userID) for fast lookup",
            "Use alias (e.g. 'work', 'personal') to disambiguate multiple accounts",
            "Pass custom_auth_params at execute for bring-your-own-credentials (you own refresh)",
            "Set up retention cleanup: on user offboard, delete their connected accounts",
            "Switch to the new POST /connected_accounts/link endpoint (mandatory after cutover)",
        ],
        "execute": [
            "Mark execution 'success'; return structured data to agent",
            "Retry with backoff (SDK default 2x; configurable)",
            "Capture upstream 4xx; surface 'client error' to agent (do not retry blindly)",
            "Capture upstream 5xx; retry with backoff per SDK policy",
            "Trigger refresh on 401; if refresh fails, mark connection EXPIRED",
            "Surface 'insufficient scopes' to operator; re-consent user with new scopes",
            "Surface 'resource not found' to agent (params wrong, no retry)",
            "Surface 'validation error' to agent (body wrong, no retry)",
            "Honor upstream Retry-After header; backoff accordingly (Composio doesn't auto-retry)",
            "Increase SDK timeout for slow upstream (override per-request)",
            "Use maxRetries=0 for non-idempotent writes (avoid duplicates per changelog)",
            "For non-idempotent writes, use idempotency keys at upstream if supported",
            "Cache presigned URL for use within 1h TTL (default per changelog)",
            "Use structured error contract: data.status_code + data.message",
            "Log request_id from response for support triage",
            "Re-prompt agent with clear error so it can correct and retry",
            "Move long-running tasks to async pattern (use trigger / webhook for completion)",
            "For proxyExecute, do NOT set Authorization header (Composio injects)",
            "Use relative endpoints in proxyExecute (avoid same-domain validation)",
        ],
        "api": [
            "Treat response as success; update local cache; return result",
            "Backoff per Retry-After header; re-queue request",
            "Re-auth (rotate API key) and retry; if still 401, surface to operator",
            "Surface 'permission denied' to operator; check key role / org scope",
            "Surface 404 details to operator (resource vs scope)",
            "Re-validate input; surface 422 details to operator; halt",
            "Retry with exponential backoff (3x max, jittered) on 5xx / 408 / 409 / network",
            "Use maxRetries=0 for non-idempotent operations (avoid duplicates)",
            "Configure timeout per-request (default 1 min) for slow upstream",
            "Include x-request-id in support tickets",
            "Bucket calls to plan-specific rate limit (free / dev / enterprise)",
            "Honor X-RateLimit-* headers (Remaining, Reset)",
            "Use SDK's built-in retry policy (exponential backoff) for transient errors",
        ],
        "triggers": [
            "Enable the trigger for the user (now events flow to subscription/webhook)",
            "Pin toolkit version on SDK init for stable payload parsing",
            "Use connected_account_id override to pick a specific account",
            "Parse V3 envelope (metadata + data) per current docs",
            "Migrate from V1/V2 envelope to V3 (new orgs default to V3)",
            "Route on triggerSlug to handle each event type",
            "Use delivery_id for idempotency (Redis SET with TTL)",
            "Truncate / paginate large payloads before downstream processing",
            "Disable trigger instance (no events delivered) - reversible",
            "Delete trigger instance - permanent",
            "Inspect trigger type schema (get_type / getType) before writing handler",
            "Generate typed stubs (composio CLI) for type-checked handlers",
            "If handler is slow, move work to async worker (don't block webhook response)",
        ],
        "webhook": [
            "Return 2xx fast (Composio marks delivery as 'delivered')",
            "Enqueue payload and ACK within 100ms (Verify -> Enqueue -> ACK pattern)",
            "Return 4xx if signature invalid (Composio won't retry, marks failed)",
            "Return 5xx on transient error (Composio retries with backoff)",
            "Return 410 Gone to stop delivery for permanently invalid URL",
            "Expose endpoint via tunnel (ngrok, cloudflared) for dev only",
            "Production endpoint must be HTTPS with valid cert (no self-signed)",
            "Don't IP-allowlist Composio (outbound IPs are dynamic - verify signature instead)",
            "Verify HMAC with crypto.timingSafeEqual (constant-time)",
            "Store COMPOSIO_WEBHOOK_SECRET securely (env / secrets manager)",
            "Rotate secret via subscription update; support old + new during overlap",
            "If secret leaked: rotate immediately, audit past deliveries",
            "Idempotently process events: dedup by delivery_id",
            "Subscribe to composio.connected_account.expired (proactive re-auth)",
            "Use parse(verifySecret=...) to verify + parse in one call",
            "Use subscribe() over WebSocket only for dev/prototyping (not prod)",
            "Move heavy work to async worker; respond 202 Accepted immediately",
        ],
        "toolkits": [
            "List toolkits; filter by name/slug",
            "Use the canonical SCREAMING_SNAKE_CASE slug (e.g. GITHUB_CREATE_ISSUE)",
            "Fix case in tool slug (lowercase or mixed-case = 404)",
            "Provide clear parameter descriptions to LLM (helps with complex schemas)",
            "Avoid $ref / oneOf / anyOf in tool schemas if possible (LLM accuracy)",
            "Keep tool count <= 20 per session (per docs)",
            "Use use-case search to narrow the agent's tool list",
            "Pin toolkit version in SDK init for stable parsing",
            "Register custom tools with session (in-process) for local logic",
            "Report broken tool schema to Composio support",
        ],
        "mcp": [
            "Initialize MCP client against Tool Router endpoint; discover tools on demand",
            "Keep tool count <= 20 for accuracy; split into multiple servers if needed",
            "Handle async tool calls (long-running -> use webhook pattern)",
            "Fetch presigned file URL within 1h TTL (default per changelog)",
            "Maintain SSE connection lifecycle (close on client disconnect)",
            "Simplify complex tool schemas (split into multiple tools, use examples)",
            "Add examples in tool descriptions to guide LLM usage",
            "Use MCP resources / prompts (in addition to tools) for context",
        ],
        "proxy": [
            "Use relative endpoint (resolved against base URL)",
            "Use same-registrable-domain cross-subdomain URL (allowed)",
            "Use cross-domain URL (rejected - use a different proxy or direct call)",
            "Do NOT set Authorization header in parameters (Composio injects)",
            "Branch on response.status (proxy returns upstream verbatim)",
            "Honor upstream Retry-After (Composio doesn't auto-retry)",
            "Parse JSON body; fallback to raw string for non-JSON",
            "Preserve response headers for client logic (rate limits, etc.)",
        ],
        "files": [
            "Fetch presigned URL within 1h TTL (default per changelog)",
            "Pass URL to next tool call (input file) - use multipart if needed",
            "Write to workbench for state across tool calls in same session",
            "Read from workbench to hydrate tool call inputs",
            "Respect file size limits (toolkit-specific)",
            "Clear workbench on session end if sensitive (per config)",
            "Use bounded connect/read timeouts (per changelog - no hangs)",
        ],
        "logs": [
            "Log log_id + request_id for support triage",
            "Fetch full log via API within retention window",
            "Surface 'log expired' to operator (retention policy)",
            "Inspect retry attempts in log; tune maxRetries",
            "Inspect upstream status + message in log; surface to agent",
            "Use tool memory to persist context across sessions (per user)",
            "Clear tool memory when context should reset",
            "Enable audit log streaming to SIEM for compliance",
            "Redact PII in tool input/output at the log layer (defense in depth)",
        ],
        "billing": [
            "Switch to a higher-tier plan (dev / enterprise)",
            "Purchase add-on for rate limit increase",
            "Bucket API calls under plan quota (queue excess)",
            "Use x-org-api-key for org-level quota (vs x-api-key for project)",
            "Resume after subscription is reactivated",
            "Honor X-RateLimit-* headers (quota proximity warning)",
            "Backoff webhook delivery if quota exceeded (or drop non-critical)",
        ],
        "changelog": [
            "Migrate from POST /connected_accounts to /link for OAUTH2 / DCR_OAUTH (Jul 3 2026)",
            "Set maxRetries=0 for non-idempotent writes (per changelog)",
            "Configure timeout per-request (default changed)",
            "Parse new data.status_code / data.message fields in tool response",
            "Fall back to error.message if data.status_code is missing (legacy)",
            "Use presigned URL within 1h TTL (default per changelog)",
            "Re-init connection if Initializing > 10 min (auto-expire per changelog)",
            "Use bounded timeouts on file transfers (per changelog)",
        ],
        "agent": [
            "Provide tool list (filtered, <= 20) and let agent pick",
            "Provide examples of tool calls in agent prompt",
            "Validate JSON before passing to tools.execute()",
            "Use session.tools() to get the schema, then validate against it",
            "Truncate conversation if context window is at risk (use summary)",
            "Buffer partial tool calls; only call execute() on complete JSON",
            "Track tool call count / step count; halt on runaway loop",
            "Redact PII from tool arguments before logging",
            "Redact PII from tool output before adding to context",
            "Serialize parallel tool calls if upstream rate limits are tight",
            "Block any cross-tenant userID (defense in depth)",
            "Always create a new session per user (no cross-user session reuse)",
            "Use idempotency keys for non-idempotent operations (per changelog)",
            "Always treat tool error.data as a structured error, not success",
            "Force agent to use minimum-privilege tools (filter session.toolkits)",
            "Surface rate limit headers to agent (it should back off)",
        ],
        "security": [
            "Hash / pseudonymize userID before passing to Composio (no PII)",
            "Use a stable, opaque userID (your DB ID, not email)",
            "Rotate API key immediately; audit usage; force-rotate other devs",
            "Move API key to server env / secrets manager (never client-side)",
            "Use per-developer API keys (not shared) for audit trail",
            "Never put OAuth client secret in source / env / logs",
            "Use minimum-scope connected account for high-risk actions",
            "Block cross-tenant access at the userID layer (defense in depth)",
            "On user offboarding: delete all their connected accounts (GDPR / CCPA)",
            "Disable / delete connected account immediately on user offboard",
            "Redact PII at log layer (input + output); never log full payloads",
            "Validate OAuth state parameter (CSRF protection)",
            "Match redirect_uri exactly to provider app config",
            "Re-consent user when scopes upgrade (don't silently expand)",
            "Audit log every tool execution (compliance)",
            "Stream audit log to SIEM (Splunk, Datadog, etc.)",
        ],
    },
    "else_action": {
        "session": [
            "Page on-call; capture session_id; halt dependent tool calls; require human triage",
            "Re-init SDK with correct API key; surface 'invalid key' to operator",
            "Block tool calls; surface 'userID must be stable' to operator",
            "Refuse to open session with empty userID (no fallback - security risk)",
            "Refuse to open session with PII as userID; pseudonymize first",
            "Refuse to open session with tool count > 50; split or filter",
            "Block tool calls; surface 'no ACTIVE connected account' to user with Connect Link",
        ],
        "auth": [
            "Block connection attempts; require operator to fix auth config",
            "Re-consent user with new scopes; surface to operator",
            "Block connection; surface callback URL mismatch to operator",
            "Enable auth config before allowing connections (PATCH status=ENABLED)",
            "Migrate deprecated endpoint before cutover (POST /connected_accounts -> /link)",
        ],
        "connected": [
            "Block tool execution; require user to re-authenticate",
            "Wait (do not call /refresh) if status is INITIALIZING (user still in flow)",
            "Subscribe to webhook for proactive re-auth (don't poll)",
            "Do NOT auto-delete on EXPIRED; require user action",
            "Page on-call if multiple users hit EXPIRED simultaneously (provider incident)",
            "Block tool calls; surface 'cross-tenant userID mismatch' (CRITICAL security)",
        ],
        "execute": [
            "Page on-call; capture request_id; require human triage for non-retryable errors",
            "Do not retry 4xx blindly (likely a code bug, not transient)",
            "Do not retry non-idempotent writes per changelog (use idempotency key instead)",
            "Re-auth user if 401 persists after refresh (token truly revoked)",
            "Surface 'tool not found' to agent (404 - tool slug wrong or deprecated)",
        ],
        "api": [
            "Halt all API activity for this token; require operator review",
            "Page on-call; do not retry 5xx blindly past 3 attempts",
            "Surface 'rate limited' to operator; switch to higher tier or backoff longer",
            "Do not retry 401 / 403 blindly (auth issue, not transient)",
        ],
        "triggers": [
            "Page on-call; capture delivery_id; require human triage for unknown trigger types",
            "Do not process payload with unknown type (log and ack 200 to avoid retry storm)",
            "Do not block webhook response on slow downstream (move to async worker)",
        ],
        "webhook": [
            "Do not process payload with invalid signature (log + return 4xx)",
            "Do not process same delivery twice (idempotency check)",
            "Do not use IP allowlist for Composio (outbound IPs are dynamic)",
            "Page on-call; do not bypass signature check for any reason",
            "Rotate secret immediately if leaked; audit past deliveries",
        ],
        "toolkits": [
            "Page on-call; do not use a tool that returns 404 (slug wrong or deprecated)",
            "Do not pass too-broad tool list to agent (> 20, accuracy drops)",
            "Refuse to execute a tool with ambiguous schema (LLM may misinterpret)",
        ],
        "mcp": [
            "Page on-call; do not silently reconnect SSE if leak is detected",
            "Refuse to load > 100 tools in one MCP server (token blow-up)",
            "Do not block on slow MCP call (use async / streaming pattern)",
        ],
        "proxy": [
            "Page on-call; do not bypass the cross-domain URL check",
            "Do not set Authorization header in parameters (Composio injects)",
            "Do not auto-retry proxy on 4xx (likely code bug, not transient)",
        ],
        "files": [
            "Do not store presigned URL beyond TTL (will expire, leak risk)",
            "Page on-call if file size consistently exceeds limits (workflow bug)",
        ],
        "logs": [
            "Page on-call if log retention is missing (compliance gap)",
            "Do not log full tool output if PII (redact first)",
        ],
        "billing": [
            "Page on-call; require plan upgrade before resuming",
            "Do not bypass rate limits by switching org keys (will get caught)",
        ],
        "changelog": [
            "Block calls to deprecated endpoints after cutover; migrate first",
            "Page on-call; do not roll back maxRetries=2 default (regressions)",
            "Pin SDK version in package.json to avoid surprise behavior changes",
        ],
        "agent": [
            "Block cross-tenant userID at the gate (security)",
            "Do not retry non-idempotent tools after timeout (duplicate side effects)",
            "Page on-call; do not allow agent to make > N tool calls in one turn (runaway)",
            "Refuse to interpret tool error as success (must treat as failure)",
        ],
        "security": [
            "Page on-call; rotate API key immediately if leaked",
            "Block cross-tenant access (do not allow even with valid auth)",
            "Block tool calls if userID is PII (hash first)",
            "Block tool calls if user has been offboarded (delete their connected accounts)",
            "Block re-auth without validating OAuth state (CSRF protection)",
            "Page on-call; rotate OAuth client secret if in source / env / logs",
        ],
    },
}

SEVERITY_BY_CATEGORY = {
    "session":   "medium",
    "auth":      "high",
    "connected": "high",
    "execute":   "high",
    "api":       "medium",
    "triggers":  "high",
    "webhook":   "high",
    "toolkits":  "low",
    "mcp":       "medium",
    "proxy":     "medium",
    "files":     "low",
    "logs":      "low",
    "billing":   "medium",
    "changelog": "medium",
    "agent":     "high",
    "security":  "critical",
}

SOURCE_DOCS = {
    "session":   "docs.composio.dev/docs/how-composio-works; docs.composio.dev/docs; docs.composio.dev/content/the-guide-to-mcp-i-never-had",
    "auth":      "docs.composio.dev/docs/authentication; docs.composio.dev/docs/tools-direct/authenticating-tools; docs.composio.dev/reference/api-reference/auth-configs",
    "connected": "docs.composio.dev/docs/auth-configuration/connected-accounts; docs.composio.dev/docs/managing-multiple-connected-accounts; docs.composio.dev/reference/api-reference/connected-accounts",
    "execute":   "docs.composio.dev/docs/tools-direct/executing-tools; docs.composio.dev/docs/extending-sessions/proxy-execute; docs.composio.dev/reference/errors",
    "api":       "docs.composio.dev/reference; docs.composio.dev/reference/errors; docs.composio.dev/docs/troubleshooting/api; npmjs.com/package/@composio/client",
    "triggers":  "docs.composio.dev/docs/triggers; docs.composio.dev/docs/setting-up-triggers/creating-triggers; docs.composio.dev/docs/setting-up-triggers/subscribing-to-events",
    "webhook":   "docs.composio.dev/docs/setting-up-triggers/subscribing-to-events; docs.composio.dev/reference/api-reference/webhook-subscriptions",
    "toolkits":  "docs.composio.dev/docs; docs.composio.dev/reference; docs.composio.dev/content/the-guide-to-mcp-i-never-had",
    "mcp":       "docs.composio.dev/content/the-guide-to-mcp-i-never-had; docs.composio.dev/docs (MCP / Tool Router)",
    "proxy":     "docs.composio.dev/docs/extending-sessions/proxy-execute",
    "files":     "docs.composio.dev/reference/changelog; docs.composio.dev/docs/how-composio-works (workbench)",
    "logs":      "docs.composio.dev/reference/changelog; docs.composio.dev/docs (observability)",
    "billing":   "docs.composio.dev/reference/errors (rate limit section); docs.composio.dev/docs (plan limits)",
    "changelog": "docs.composio.dev/reference/changelog",
    "agent":     "docs.composio.dev/content/the-guide-to-mcp-i-never-had; docs.composio.dev/docs/how-composio-works; composio.dev/content/per-user-oauth-for-ai-agents",
    "security":  "docs.composio.dev/docs/authentication; composio.dev/content/per-user-oauth-for-ai-agents; docs.composio.dev/docs (encryption at rest)",
}

# ---------------------------------------------------------------------------
# Build rows
# ---------------------------------------------------------------------------

def build_rows(target: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen_keys = set()

    trig_by_cat: Dict[str, List[str]] = {}
    for prefix, cat, text in TRIGGERS:
        trig_by_cat.setdefault(cat, []).append(text)
    cond_by_cat = CONDITIONS
    if_by_cat = ACTIONS["if_action"]
    else_by_cat = ACTIONS["else_action"]

    cat_order = [
        "session", "auth", "connected", "execute", "api", "triggers",
        "webhook", "toolkits", "mcp", "proxy", "files", "logs",
        "billing", "changelog", "agent", "security",
    ]

    capacity = {}
    for cat in cat_order:
        t = len(trig_by_cat.get(cat, []))
        c = len(cond_by_cat.get(cat, []))
        a = len(if_by_cat.get(cat, []))
        e = len(else_by_cat.get(cat, []))
        capacity[cat] = (t, c, a, e, t * c * a * e)

    MIN_PER_CAT = 28
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
    for cat in cat_order:
        quotas[cat] = min(quotas[cat], capacity[cat][4])
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
                    "id": f"CO-{counter:04d}",
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
                            "id": f"CO-{counter:04d}",
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
