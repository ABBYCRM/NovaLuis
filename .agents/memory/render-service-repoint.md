The critical corrections are:

* `PATCH /v1/services/{serviceId}` accepts top-level `repo`, `branch`, and `autoDeploy`, but **API configuration updates do not deploy automatically—even when `autoDeploy` is `yes`**. An explicit deploy call is still required. ([Render API][1])
* A shared-repository push affects only services tracking that repository/branch with automatic deployment enabled; it is not literally every service using the repository.
* Single-key environment-variable `PUT` is an upsert. Bulk `PUT /env-vars` replaces the complete directly configured environment-variable set. ([Render API][2])
* Explicit deployments use `POST /v1/services/{serviceId}/deploys`; acceptance is `201` or `202`, not proof that the new version is live. ([Render API][3])

---

name: "Render service repoint vs shared-repo push"
description: >-
Safely change the repository and branch deployed by one Render service
without modifying a shared repository, unintentionally redeploying sibling
services, replacing unrelated environment variables, or reporting an
unverified deployment.
----------------------

# Render Service Repoint Versus Shared-Repository Push

## Scope

This rule applies when:

* A Render service is connected to the wrong repository
* A Render service is connected to the wrong branch
* Multiple Render services use the same repository or branch
* One service must be changed without affecting sibling services
* Environment variables must be added or updated
* A configuration change must be deployed and verified

---

# 1. Core Rule

To change what one Render service deploys:

```text
UPDATE THAT SERVICE'S DEPLOY SOURCE
```

Do not overwrite a shared repository with a different application merely to make one Render service display different code.

Required architecture:

```text
ONE SERVICE IS WRONG
→ CHANGE THAT SERVICE

SHARED REPOSITORY IS CORRECT FOR OTHER SERVICES
→ DO NOT REPLACE ITS CONTENT
```

---

# 2. Why Shared-Repository Pushes Are Dangerous

Multiple Render services can track the same:

```text
repository
+ branch
```

When a commit is pushed to that branch, every connected service with automatic deployment enabled may build and deploy the new commit.

Therefore:

```text
PUSH TO SHARED REPOSITORY
=
POTENTIAL MULTI-SERVICE CHANGE
```

The blast radius depends on each service's configuration.

A push does not necessarily deploy every service using the repository. The affected set is:

```text
services tracking the pushed repository
+ tracking the pushed branch
+ automatic deployment enabled
+ no build filter excluding the change
```

Before pushing to a shared repository, inspect every Render service connected to it.

---

# 3. Repointing Is Service-Scoped

Render supports updating an individual service through:

```http
PATCH /v1/services/{serviceId}
```

The update body may include top-level:

```text
repo
branch
autoDeploy
```

Example:

```json
{
  "repo": "https://github.com/OWNER/NEW-REPOSITORY",
  "branch": "main",
  "autoDeploy": "no"
}
```

This changes only the targeted Render service configuration.

It does not modify:

* The old repository
* The new repository
* Other Render services
* Other branches
* Git history
* Sibling-service environment variables

---

# 4. Correct `autoDeploy` Meaning

`autoDeploy` controls whether future qualifying repository changes can trigger automatic deployments.

Allowed values:

```text
yes
no
```

It does not mean that an API service-configuration update deploys itself.

Required truth:

```text
PATCH SERVICE CONFIGURATION
→ CONFIGURATION UPDATED

PATCH SERVICE CONFIGURATION
≠
NEW VERSION DEPLOYED
```

After changing `repo`, `branch`, or other deployment configuration through the API, trigger an explicit deployment.

---

# 5. Last-Live-Version Rule

A service configuration and its currently running deployment are separate states.

Possible state:

```text
configured repository = repository B
currently live deployment = previous build from repository A
```

This can occur when:

* The service configuration was repointed
* No new deployment was triggered
* A deployment was queued but not completed
* The new repository failed to build
* The new deployment failed before becoming live
* The wrong commit was selected

Therefore:

```text
SERVICE CONFIG POINTS TO B
≠
SERVICE IS RUNNING B
```

Never determine the live application solely from the service configuration.

Verify the actual deployment and live HTTP response.

---

# 6. Required Preflight

Before changing a service, retrieve and record its current state.

Required information:

```text
service ID
service name
service type
current repository
current branch
current autoDeploy setting
current root directory
current Dockerfile or runtime configuration
current live deploy ID
current live commit SHA
current service URL
```

Also identify sibling services sharing the current repository and branch.

Required question:

```text
Which services could be affected if this repository branch changes?
```

---

# 7. Shared-Source Impact Inventory

Before any repository push, build an impact table:

| Service   | Repository  | Branch  | Auto deploy | Build filter | Intended application |
| --------- | ----------- | ------- | ----------- | ------------ | -------------------- |
| Service A | Shared repo | main    | yes         | none         | Application A        |
| Service B | Shared repo | main    | yes         | none         | Application B        |
| Service C | Shared repo | staging | no          | none         | Staging              |

If Service A and Service B point to the same repository and branch but are expected to run different applications, the deployment architecture is unsafe unless each service uses a correct isolated root directory or build configuration.

---

# 8. Repoint Decision Rule

Use service repointing when:

* The intended application already exists in another repository
* Only one service is connected to the wrong source
* Other services depend on the current repository
* Replacing shared repository content would change unrelated applications
* The service should have an independent deployment lifecycle

Use a repository push only when:

* The pushed code genuinely belongs in that repository
* The change is valid for all affected services
* The impact inventory is complete
* Relevant tests pass
* The affected services are intentionally being deployed

---

# 9. Safe Repoint Sequence

Required sequence:

```text
1. Retrieve current service configuration.
2. Record the current live deployment.
3. Identify shared-repository consumers.
4. Verify the new repository and branch exist.
5. Verify the intended commit exists remotely.
6. Set autoDeploy to no during migration.
7. PATCH repo and branch.
8. Verify the stored configuration.
9. Apply required environment-variable changes.
10. Verify environment-variable presence without exposing values.
11. Trigger one explicit deployment.
12. Poll the deployment to a terminal state.
13. Verify the deployed commit.
14. Verify HTTP health.
15. Verify the application visually when applicable.
16. Re-enable autoDeploy only if intended.
```

---

# 10. Why Disable Automatic Deployment During Repointing

Recommended migration configuration:

```json
{
  "repo": "https://github.com/OWNER/NEW-REPOSITORY",
  "branch": "main",
  "autoDeploy": "no"
}
```

Although API configuration updates require an explicit deployment, temporarily setting `autoDeploy` to `no` prevents an unrelated repository commit from triggering a deployment while configuration and environment changes are still being assembled.

After verification, optionally enable:

```json
{
  "autoDeploy": "yes"
}
```

Enable it only when future commits to the selected branch should deploy automatically.

---

# 11. Repository and Branch Verification

Before repointing:

```bash
git ls-remote \
  "https://github.com/OWNER/NEW-REPOSITORY.git" \
  "refs/heads/${TARGET_BRANCH}"
```

Required result:

```text
remote branch exists
+ commit SHA returned
```

Capture:

```bash
EXPECTED_COMMIT_SHA="$(
  git ls-remote \
    "https://github.com/OWNER/NEW-REPOSITORY.git" \
    "refs/heads/${TARGET_BRANCH}" |
  awk '{print $1}'
)"
```

An empty result means:

```text
BRANCH_NOT_FOUND_OR_UNAUTHORIZED
```

Do not repoint to an unverified branch.

---

# 12. Service Patch Request

```bash
PATCH_BODY="$(
  jq -n \
    --arg repo "$TARGET_REPO" \
    --arg branch "$TARGET_BRANCH" \
    '{
      repo: $repo,
      branch: $branch,
      autoDeploy: "no"
    }'
)"
```

Execute:

```bash
curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --data "$PATCH_BODY" \
  "https://api.render.com/v1/services/${SERVICE_ID}"
```

Expected success:

```text
HTTP 200
```

A successful PATCH verifies that Render accepted the configuration update.

It does not verify that the new application is deployed.

---

# 13. Configuration Read-Back

After the PATCH, retrieve the service again.

Verify:

```text
observed repo = intended repo
observed branch = intended branch
observed autoDeploy = no
```

Mechanical rule:

```text
REQUESTED CONFIGURATION
MUST EQUAL
OBSERVED STORED CONFIGURATION
```

If any field differs:

```text
SERVICE_REPOINT_UNVERIFIED
```

Do not deploy until the mismatch is resolved.

---

# 14. Environment-Variable Safety

Render provides two materially different environment-variable operations.

## Single-Key Upsert

```http
PUT /v1/services/{serviceId}/env-vars/{envVarKey}
```

Body:

```json
{
  "value": "VALUE"
}
```

Behavior:

```text
key missing
→ add it

key exists
→ update it

unrelated keys
→ preserve them
```

Use this endpoint to add or change one variable.

---

## Bulk Replacement

```http
PUT /v1/services/{serviceId}/env-vars
```

Body:

```json
[
  {
    "key": "KEY_A",
    "value": "VALUE_A"
  },
  {
    "key": "KEY_B",
    "value": "VALUE_B"
  }
]
```

Behavior:

```text
REPLACE ALL DIRECTLY CONFIGURED SERVICE ENVIRONMENT VARIABLES
WITH THE PROVIDED LIST
```

Any directly configured variable omitted from the request is removed.

Therefore:

```text
BULK PUT
≠
MERGE
```

---

# 15. Mandatory Environment-Variable Rule

To add or update one environment variable:

```text
USE SINGLE-KEY PUT
```

Do not use bulk replacement unless:

* The complete existing variable set has been retrieved
* All required keys are intentionally included
* Deletions are intentional
* The resulting complete set has been reviewed
* Secret values can be handled without disclosure

---

# 16. Single-Key Upsert Example

```bash
ENV_KEY="DATABASE_URL"

ENV_BODY="$(
  jq -n \
    --arg value "$DATABASE_URL_VALUE" \
    '{
      value: $value
    }'
)"

set +x

curl --fail-with-body --silent --show-error \
  --request PUT \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --data "$ENV_BODY" \
  "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${ENV_KEY}"
```

Never print:

* `ENV_BODY`
* Secret values
* Full API responses containing secret values
* The complete environment-variable collection

---

# 17. Environment-Variable Read-Back

After an upsert, retrieve the specific key:

```http
GET /v1/services/{serviceId}/env-vars/{envVarKey}
```

Verify only:

```text
key exists
+ request succeeded
+ returned value is present or masked as expected
```

Safe report:

```json
{
  "key": "DATABASE_URL",
  "configured": true,
  "value": "[REDACTED]"
}
```

Do not expose the actual value.

---

# 18. Configuration Changes and Deployment Sequencing

Do not assume that every configuration API mutation automatically triggers a deployment.

Required deterministic sequence:

```text
PATCH SERVICE SOURCE
→ VERIFY CONFIGURATION

UPSERT ENVIRONMENT VARIABLES
→ VERIFY KEYS

TRIGGER ONE EXPLICIT DEPLOYMENT
→ VERIFY LIVE RESULT
```

This provides one known deployment after all intended configuration is ready.

If unexpected deployments appear during the migration:

1. Record their deploy IDs.
2. Determine which configuration or repository event created them.
3. Do not assume the newest deploy represents the intended final state.
4. Explicitly deploy the intended commit after configuration is complete.

---

# 19. Explicit Deployment

Endpoint:

```http
POST /v1/services/{serviceId}/deploys
```

Recommended commit-specific body:

```json
{
  "commitId": "FULL_COMMIT_SHA",
  "clearCache": "do_not_clear"
}
```

Do not include `deployMode` when using `commitId` or `clearCache`.

Trigger:

```bash
DEPLOY_BODY="$(
  jq -n \
    --arg commitId "$EXPECTED_COMMIT_SHA" \
    '{
      commitId: $commitId,
      clearCache: "do_not_clear"
    }'
)"

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --data "$DEPLOY_BODY" \
  "https://api.render.com/v1/services/${SERVICE_ID}/deploys"
```

Accepted responses:

```text
HTTP 201
HTTP 202
```

These mean:

```text
DEPLOY CREATED OR QUEUED
```

They do not mean:

```text
DEPLOY LIVE
```

---

# 20. Deployment Polling

Poll:

```http
GET /v1/services/{serviceId}/deploys/{deployId}
```

Nonterminal states include:

```text
created
queued
build_in_progress
pre_deploy_in_progress
update_in_progress
```

Successful terminal state:

```text
live
```

Failure states include:

```text
build_failed
pre_deploy_failed
update_failed
canceled
```

Unknown states must be treated as:

```text
UNVERIFIED
```

---

# 21. Commit Verification

When deployment reaches `live`, compare:

```text
expected Git commit SHA
observed Render deploy commit SHA
```

Required:

```text
EXPECTED_COMMIT_SHA
=
DEPLOY_COMMIT_SHA
```

A service can be live while running the wrong commit.

Therefore:

```text
STATUS LIVE
WITHOUT COMMIT MATCH
=
WRONG_DEPLOYMENT
```

---

# 22. HTTP Verification

After the deployment reaches `live`, probe:

```text
health endpoint
representative API endpoint
or application root
```

Required evidence:

```text
DNS success
TLS success
expected HTTP status
expected response content
```

A generic HTTP `200` may still be the wrong application.

Verify application identity using a stable identifier such as:

```text
application name
version endpoint
build SHA
expected page title
expected API field
expected DOM element
```

---

# 23. Visual Verification

When the service exposes a web interface, browser verification is mandatory.

Verify:

```text
correct application loaded
expected page title
expected branding
expected primary component
no previous application's interface
no fatal browser-console errors
desktop layout
mobile layout when affected
```

The original problem can persist visually even when the service configuration appears correct.

---

# 24. Auto-Deploy Re-Enablement

After the explicit deployment is verified, decide whether automatic deployment should be enabled.

Enable:

```json
{
  "autoDeploy": "yes"
}
```

only when:

* The new repository is authoritative for that service
* The selected branch is correct
* Future commits should deploy automatically
* Shared-repository effects are understood
* Build filters are correct
* No migration activity remains

Leave disabled when deployments must remain manually controlled.

---

# 25. Rollback Data

Before repointing, preserve:

```text
previous repository
previous branch
previous autoDeploy setting
previous root directory
previous Dockerfile or runtime settings
previous live deploy ID
previous live commit SHA
previous environment-variable key inventory
```

Do not store secret values in the rollback record.

---

# 26. Configuration Rollback

When the new source cannot be deployed:

```text
PATCH previous repo and branch
→ restore previous autoDeploy setting
→ trigger explicit deploy of previous known-good commit
→ poll to live
→ verify HTTP and UI
```

Do not assume that reverting configuration alone restores the previous running application.

Configuration rollback also requires deployment verification.

---

# 27. Failure Classification

```text
PATCH returns 400
→ INVALID_SERVICE_CONFIGURATION

PATCH returns 401
→ RENDER_AUTHENTICATION_FAILED

PATCH returns 402
→ RENDER_BILLING_PREREQUISITE

PATCH returns 403
→ RENDER_AUTHORIZATION_FAILED

PATCH returns 404
→ SERVICE_NOT_FOUND

PATCH returns 409
→ SERVICE_STATE_CONFLICT

repo or branch read-back mismatch
→ SERVICE_REPOINT_UNVERIFIED

deploy build_failed
→ NEW_SOURCE_BUILD_FAILED

deploy update_failed
→ SERVICE_UPDATE_FAILED

deploy live with wrong commit
→ DEPLOYMENT_COMMIT_MISMATCH

health returns old application
→ LIVE_ARTIFACT_MISMATCH

public service unavailable
→ LIVE_HEALTH_FAILED
```

---

# 28. Required Tests

## Shared-Repository Protection Test

Verify that no commit is pushed into the old shared repository as part of the repoint operation.

## Service Isolation Test

Verify only the intended service's `repo` and `branch` fields changed.

## Environment Preservation Test

Before and after a single-key upsert:

```text
existing unrelated keys remain present
```

## Bulk-Replacement Guard Test

Any use of:

```http
PUT /v1/services/{serviceId}/env-vars
```

must fail internal policy unless the operation declares:

```text
replaceAllEnvironmentVariables = true
```

## Deployment Test

Verify:

```text
explicit deploy created
→ deploy reaches live
→ commit SHA matches
```

## Live Identity Test

Verify the service responds with an identifier unique to the intended application.

## Sibling-Service Test

Probe sibling services and confirm they remain on their expected applications.

---

# 29. Automated Guardrails

Recommended policy:

```ts
interface ServiceRepointPlan {
  serviceId: string;

  previousRepo: string;
  previousBranch: string;

  targetRepo: string;
  targetBranch: string;
  targetCommitSha: string;

  sharedRepoConsumers: string[];

  envUpserts: string[];

  explicitDeployRequired: true;
  bulkEnvReplacementAuthorized: boolean;
}
```

Validation:

```ts
function validateRepointPlan(
  plan: ServiceRepointPlan,
): void {
  if (!plan.serviceId) {
    throw new Error("SERVICE_ID_REQUIRED");
  }

  if (!plan.targetRepo || !plan.targetBranch) {
    throw new Error("TARGET_SOURCE_REQUIRED");
  }

  if (!plan.targetCommitSha) {
    throw new Error(
      "TARGET_COMMIT_NOT_VERIFIED",
    );
  }

  if (!plan.explicitDeployRequired) {
    throw new Error(
      "EXPLICIT_DEPLOY_REQUIRED",
    );
  }
}
```

---

# 30. Prohibited Behavior

```text
Do not push one application's code into a shared repository merely to change
one Render service.

Do not assume every service connected to a repository will redeploy; inspect
branch, autoDeploy, root directory, and build filters.

Do not assume PATCH service configuration deploys the change.

Do not assume autoDeploy=yes causes API configuration updates to deploy.

Do not trigger deployment before all intended configuration is ready.

Do not use the bulk environment-variable endpoint to add one key.

Do not omit existing keys from a bulk replacement unintentionally.

Do not expose environment-variable values.

Do not report HTTP 200 from PATCH as proof the new application is live.

Do not report deploy HTTP 201 or 202 as proof of success.

Do not report status live without commit verification.

Do not report commit verification without HTTP application verification.

Do not leave autoDeploy enabled during a sensitive repoint migration unless
the resulting deployment behavior is intentional.

Do not forget to verify sibling services.
```

---

# 31. Completion Gate

The operation is complete only when:

```text
TARGET SERVICE CONFIGURATION VERIFIED
AND
TARGET ENVIRONMENT KEYS VERIFIED
AND
EXPLICIT DEPLOYMENT REACHED LIVE
AND
DEPLOYED COMMIT MATCHES EXPECTED COMMIT
AND
LIVE APPLICATION IDENTITY IS CORRECT
AND
SIBLING SERVICES REMAIN CORRECT
```

Possible verdicts:

```text
VERIFIED
FAILED
UNVERIFIED
VERIFIED_OPERATOR_ACTION_REQUIRED
```

---

# 32. Final Invariant

```text
ONE SERVICE ON WRONG SOURCE
→ REPOINT THAT SERVICE

SHARED REPOSITORY USED BY OTHER SERVICES
→ DO NOT REPLACE ITS APPLICATION CODE

SERVICE PATCH
→ CONFIGURATION ONLY

CONFIGURATION COMPLETE
→ ONE EXPLICIT DEPLOY

ONE ENV KEY
→ SINGLE-KEY UPSERT

ALL ENV KEYS
→ BULK REPLACEMENT ONLY WITH EXPLICIT AUTHORIZATION

DONE
→ CORRECT CONFIG
+ CORRECT COMMIT
+ LIVE DEPLOY
+ CORRECT HTTP/UI
+ UNAFFECTED SIBLING SERVICES
```

**END OF SPEC**

[1]: https://api-docs.render.com/reference/update-service "Update service"
[2]: https://api-docs.render.com/v1.0/openapi/render-public-api-1.json "api-docs.render.com"
[3]: https://api-docs.render.com/reference/create-deploy "Trigger deploy"
