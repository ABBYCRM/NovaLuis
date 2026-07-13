---
name: "Render service repoint vs shared-repo push"
description: "Change one Render service's repository or branch without overwriting a shared repository, replacing unrelated environment variables, or reporting an unverified deployment."
---

# Render Service Repoint Versus Shared-Repository Push

## Core rule

When one Render service points at the wrong source, change that service's deploy configuration. Do not push a different application's code into a repository shared by other services merely to change one service.

A repository push can affect services that track the pushed repository and branch with automatic deployment enabled and whose build filters include the change.

## Repoint

Update one service through:

```http
PATCH /v1/services/{serviceId}
```

Example:

```json
{
  "repo": "https://github.com/OWNER/NEW-REPOSITORY",
  "branch": "main",
  "autoDeploy": "no"
}
```

A successful PATCH proves only that configuration was accepted.

```text
CONFIG POINTS TO REPOSITORY B
≠
SERVICE IS RUNNING REPOSITORY B
```

The service can continue serving its previous successful deployment until a new deployment reaches `live`.

## Preflight

Before repointing:

- record current repository, branch, auto-deploy setting, live deploy, commit, and service URL
- inventory sibling services tracking the old repository and branch
- verify the target repository and branch exist
- capture the target branch commit SHA
- preserve rollback information without recording secret values

## Environment variables

Add or update one key through:

```http
PUT /v1/services/{serviceId}/env-vars/{KEY}
```

```json
{"value":"..."}
```

This is a single-key upsert and preserves unrelated keys.

Bulk endpoint:

```http
PUT /v1/services/{serviceId}/env-vars
```

replaces the complete directly configured environment-variable set. Use it only with explicit replace-all intent and a reviewed complete set.

## Deployment sequence

```text
PATCH source with autoDeploy=no
→ read back repo and branch
→ upsert required environment keys
→ verify key presence without exposing values
→ trigger one explicit deploy
→ poll to live
→ compare commit SHA
→ verify HTTP and UI identity
→ verify sibling services remain correct
→ re-enable autoDeploy only if intended
```

API configuration changes do not themselves prove a new version is deployed.

Explicit deploy:

```http
POST /v1/services/{serviceId}/deploys
```

HTTP 201 or 202 means created or queued, not live.

## Completion gate

```text
DONE
=
TARGET CONFIGURATION VERIFIED
+
ENVIRONMENT KEYS PRESERVED
+
EXPLICIT DEPLOY LIVE
+
DEPLOYED SHA MATCHES
+
CORRECT APPLICATION IDENTITY
+
SIBLING SERVICES UNAFFECTED
```
