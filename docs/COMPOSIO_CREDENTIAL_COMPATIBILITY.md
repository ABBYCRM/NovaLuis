# Composio Credential Compatibility Evidence

This document records the compatibility path required by NOVA's production Composio integration.

## Credential types

- **Project API key** → authenticate Composio project/Tool Router requests with `x-api-key`.
- **Organization access token** → authenticate organization/project-management requests with `x-org-api-key`.

NOVA accepts either credential type. A previously saved organization token in the legacy `api_key` field is auto-classified instead of being sent incorrectly as a project key.

## Organization-token resolution

1. Authenticate project discovery with the organization token.
2. Select `COMPOSIO_PROJECT_ID` when configured; otherwise prefer the configured project name, `nova-luis`, `novaluis`, `nova`, or `production`; otherwise use the first available project.
3. Retrieve the selected project's project API key through the organization API.
4. Use only the resolved project API key for Tool Router session, toolkit, search, execute, and Connect Link requests.
5. Keep the resolved project key in process memory rather than exposing it to the browser.

## Deterministic CI proof

`Composio Credential Compatibility CI` runs a fake Composio API and a real production NOVA container. The test requires:

- `COMPOSIO_API_KEY=oak_ci_org` to be recognized as an organization credential;
- project discovery/detail requests to contain `x-org-api-key: oak_ci_org`;
- the selected project to expose `ak_ci_project`;
- Tool Router requests to contain `x-api-key: ak_ci_project`;
- `/api/integrations/composio/status` to report `ready=true`, `credentialSource=organization`, and `projectId=proj_ci`.

A failure in any header transition fails the workflow.

## Live acceptance gate

After merge and Render deployment:

- `/api/version.commit` must exactly equal GitHub `main`;
- `/api/healthz` must be healthy;
- `/api/openclaw/status` must be ready;
- operator PIN `22` must unlock successfully;
- authenticated `/api/integrations/composio/status` must return HTTP 200 and must no longer follow the previous organization-token-as-project-key rejection path.
