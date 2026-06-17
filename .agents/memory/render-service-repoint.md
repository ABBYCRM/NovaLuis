---
name: Render service repoint vs shared-repo push
description: Rule for changing what a Render service deploys without breaking other services that share a repo.
---

# Repoint the service, never push into a shared repo

To change what a Render service runs, change **that service's** deploy source:
`PATCH /v1/services/{id}` with `{"repo":"https://github.com/.../X","branch":"…","autoDeploy":"yes"}`
(both `repo` and `branch` are accepted top-level). A service keeps serving its
**last successful build** until a new build replaces it — so a service can show
app A's UI while its config already points at repo B if B never built.

**Why:** multiple Render services can deploy from the *same* repo+branch. Pushing
one app's code into that shared repo redeploys every service on it. Repointing a
single service is isolated; pushing into the shared repo is not.

**How to apply:** when one service is on the wrong repo, repoint only that service
and redeploy it — do not push code into the shared repo to "fix" it.

**Env vars:** use single-key upsert `PUT /v1/services/{id}/env-vars/{KEY}` body
`{"value":"…"}` to add/update one var without wiping the set. The bulk array
`PUT /v1/services/{id}/env-vars` REPLACES all vars — do not use it to add one.

**Deploy sequencing:** repoint + any env-var change can each trigger a deploy
under `autoDeploy:yes`. Finish all config first, then trigger one explicit
`POST /v1/services/{id}/deploys` and poll the deploy to `live`.
