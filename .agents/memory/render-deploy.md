---
name: "Render API deploy"
description: "Create and verify a Docker-based Render web service without confusing service creation, queued deployment, live deployment, and application health."
---

# Deploying a Docker Web Service to Render

## Core distinction

```text
SERVICE CREATED
≠
DEPLOY LIVE
≠
APPLICATION HEALTHY
```

Completion requires the intended Git commit to be live and the application to pass HTTP verification.

## Authentication and workspace

Use:

```http
Authorization: Bearer <RENDER_API_KEY>
```

Discover the workspace ID through:

```http
GET /v1/owners
```

Do not guess `ownerId`.

## Repository preflight

Before mutation:

- verify the repository and branch exist
- capture the remote branch commit SHA
- verify the Dockerfile path and build context
- build the image locally when possible
- confirm the app binds to `0.0.0.0` and reads `PORT`

Never deploy an unpushed local commit.

## Create service

Endpoint:

```http
POST /v1/services
```

Docker web-service shape:

```json
{
  "type": "web_service",
  "name": "nova",
  "ownerId": "tea-...",
  "repo": "https://github.com/OWNER/REPO",
  "branch": "main",
  "autoDeploy": "no",
  "serviceDetails": {
    "runtime": "docker",
    "plan": "free",
    "region": "virginia",
    "healthCheckPath": "/health",
    "envSpecificDetails": {
      "dockerContext": ".",
      "dockerfilePath": "./Dockerfile"
    }
  }
}
```

Treat HTTP 402 as a verified billing prerequisite for that account and request. Stop unchanged retries. Do not generalize it into a universal free-plan rule.

## Deploy

Service creation may return an initial `deployId`. Poll it instead of immediately creating a duplicate deploy.

Explicit deploy endpoint:

```http
POST /v1/services/{serviceId}/deploys
```

Prefer a commit-specific request when supported:

```json
{
  "commitId": "FULL_COMMIT_SHA",
  "clearCache": "do_not_clear"
}
```

HTTP 201 or 202 means created or queued, not live.

## Polling

Poll:

```http
GET /v1/services/{serviceId}/deploys/{deployId}
```

Success:

```text
live
```

Failure includes:

```text
build_failed
pre_deploy_failed
update_failed
canceled
deactivated
```

Unknown statuses remain unverified. Polling must be bounded.

## Verification

Require:

```text
expected Git SHA
=
requested deploy SHA
=
observed Render deploy SHA
```

Then verify:

- DNS and TLS
- health endpoint status and body
- one representative application route
- UI identity through browser checks when applicable

## Environment variables

Secret values must never enter source control, request logs, screenshots, or error output. `render.yaml` may declare secret keys with `sync: false`; values still require authorized configuration outside the repository.

## Final invariant

```text
DONE
=
SERVICE CONFIGURED
+
EXPECTED COMMIT LIVE
+
HEALTH CHECK PASSED
+
APPLICATION IDENTITY VERIFIED
```
