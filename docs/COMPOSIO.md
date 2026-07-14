# Composio Connected Apps Runbook

NOVA uses Composio as the dynamic connected-app layer for OpenClaw. Composio owns OAuth connection flows and exposes searchable app tools; NOVA exposes those capabilities to OpenClaw through authenticated loopback endpoints and the `nova-services` workspace skill.

## Runtime path

```text
NOVA browser chat
  -> /api/agent/v1/chat/completions
  -> loopback OpenClaw Gateway
  -> nova-services skill
  -> /api/integrations/composio/*
  -> Composio Tool Router API
  -> connected app such as GitHub, Gmail, Slack, Notion or Shopify
```

The raw `/api/v1/*` endpoint remains the internal model-provider proxy used by OpenClaw. Browser chat must use `/api/agent/v1/chat/completions`; otherwise the model receives no executable tool loop.

## Configuration

NOVA accepts either a **project API key** or an **organization access token**.

Preferred direct project configuration:

```text
COMPOSIO_API_KEY=<Composio project API key, typically ak_...>
COMPOSIO_USER_ID=nova-luis
PUBLIC_BASE_URL=https://nova-luis.onrender.com
```

Organization-level configuration:

```text
COMPOSIO_ORG_API_KEY=<Composio organization access token>
COMPOSIO_PROJECT_ID=<optional preferred project id>
COMPOSIO_PROJECT_NAME=<optional preferred project name>
COMPOSIO_USER_ID=nova-luis
PUBLIC_BASE_URL=https://nova-luis.onrender.com
```

Composio's current API contract uses `x-api-key` for project API keys and `x-org-api-key` for organization keys. Organization keys manage projects; NOVA lists/selects the intended project, retrieves its project API key through the organization API, and then uses that project key for Tool Router sessions and app connections.

For compatibility with previously saved configuration, a key placed in `COMPOSIO_API_KEY` or the Settings key field that has the organization-token form is automatically classified as an organization credential instead of being sent incorrectly as `x-api-key`.

The key can also be entered in **Settings → Composio Apps**. When stored through Settings it is kept in the existing server-side integration credential store and is never returned to the browser. Environment credentials and stored credentials are treated as distinct candidates, so one stale credential cannot mask a second valid credential.

Use a stable `COMPOSIO_USER_ID`. It scopes connected accounts and must not be regenerated for every chat.

## Project selection for organization credentials

When an organization token is used, NOVA selects the project in this order:

1. exact `COMPOSIO_PROJECT_ID` / stored `project_id`;
2. exact preferred project name;
3. names matching `nova-luis`, `novaluis`, `nova`, or `production`;
4. the first available project.

The resolved project key is kept only in process memory. The selected project ID and Tool Router session ID may be stored for continuity; the organization token remains the durable credential.

## Settings experience

The Composio panel is injected into the existing Settings modal by `/assets/composio-settings.js` and provides:

- a Composio credential field that can accept a project or organization API key;
- stable user-ID configuration;
- a searchable, dropdown-style toolkit showcase;
- featured GitHub, Gmail, Google Calendar, Drive, Sheets, Slack, Notion, Linear, Shopify, HubSpot, Supabase and Discord shortcuts;
- live toolkit names, descriptions, logos and connection state;
- hosted Connect Links opened in a separate OAuth window;
- automatic connection refresh when the OAuth window closes or returns to NOVA;
- connected-account badges without exposing access or refresh tokens.

The panel shares the existing Work Tree PIN gate. A successful unlock sets the same 12-hour `/api` cookie used for integrations and knowledge.

## Backend API

All routes below are mounted beneath `/api` and protected by the existing integration PIN/peer-auth middleware.

| Route | Purpose |
|---|---|
| `GET /integrations/composio/status` | Configuration, credential state/source, active session and connected toolkit summary |
| `GET /integrations/composio/toolkits` | Search/paginate the live app catalog |
| `GET /integrations/composio/connections` | List connected accounts for the stable user |
| `POST /integrations/composio/connect` | Generate a hosted Connect Link for one toolkit |
| `POST /integrations/composio/search` | Discover tools from a natural-language use case |
| `POST /integrations/composio/execute` | Execute one discovered tool slug with validated arguments |

`GET /integrations/composio/status` is intentionally recoverable. It returns HTTP 200 with `credentialState` values such as `missing`, `ready`, `invalid`, `needs_project`, or `error`, allowing Settings to show the real configuration state without treating a credential problem as an application outage.

The server reuses a stored Tool Router session when possible and creates a new session only when the previous session no longer exists.

## OpenClaw commands

```bash
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-status
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-apps --search github --limit 10
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-connections
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-connect --toolkit github
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-search --query 'Read the default branch and important files in a GitHub repository'
node openclaw/workspace/skills/nova-services/nova-services.mjs composio-execute --tool GITHUB_TOOL_SLUG --arguments-json '{"owner":"ABBYCRM","repo":"NovaLuis"}'
```

## GitHub repository protocol

Public GitHub repository URLs are preflighted directly through GitHub before OpenClaw answers, so public repo analysis does not depend on Composio. For private-account operations, issues/PR actions, or other authenticated GitHub workflows:

1. Run `composio-status` and `composio-connections`.
2. If GitHub is disconnected, run `composio-connect --toolkit github` and return the real Connect Link.
3. Run `composio-search` with the exact use case.
4. Inspect the returned tool slugs and input schemas.
5. Execute only the minimum tools necessary.
6. Base the report on returned evidence. Do not invent files, branches, errors or success.

## Security boundaries

- The browser never receives a Composio project or organization API key after it is saved.
- Connected-app credentials are handled by Composio's hosted authentication flow, not entered into NOVA chat.
- The model sees tool results, not OAuth access or refresh tokens.
- Composio execution endpoints remain behind the PIN cookie or the trusted OpenClaw peer bearer key.
- Tool discovery precedes execution; NOVA must not guess action slugs or argument schemas.
- Repository inspection should use read-only tools unless the operator explicitly requests a write.

## Acceptance checks

```bash
pnpm install --frozen-lockfile --shamefully-hoist
pnpm run typecheck
pnpm run build:api
node --check artifacts/nova/public/assets/composio-settings.js
node --check openclaw/workspace/skills/nova-services/nova-services.mjs
```

Container and credential-compatibility tests must additionally verify:

- `/api/healthz` returns `status=ok`;
- `/api/openclaw/status` returns `status=ready`;
- `/assets/composio-settings.js` returns HTTP 200 and is non-empty;
- the homepage includes the Composio Settings asset;
- malformed agent-chat input reaches `/api/agent/v1/chat/completions` and returns the expected validation error rather than 404;
- an authenticated status request returns `configured=false` when no Composio credential exists;
- a deterministic organization token is sent as `x-org-api-key`;
- the selected project's `ak_...` key is then sent as `x-api-key` to Tool Router;
- status returns `credentialSource=organization` and the selected project ID for that compatibility path.
