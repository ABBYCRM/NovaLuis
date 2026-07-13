---

name: "Render API deploy"
description: >-
Create, configure, deploy, poll, and verify a Docker-based Render web
service through the Render REST API without confusing service creation,
deployment acceptance, and verified live status.
------------------------------------------------

# Deploying a Docker Web Service to Render via API

## Scope

This skill governs:

* Render API authentication
* Workspace discovery
* Docker web-service creation
* Account billing gates
* Public Git repository deployment
* Environment-variable handling
* Manual deployment
* Deployment-status polling
* Commit verification
* HTTP health verification
* Failure classification
* Evidence-gated completion

It applies to services built from a repository `Dockerfile`.

It does not cover:

* Prebuilt registry-image deployment
* Render Blueprints
* Static sites
* Private services
* Background workers
* PostgreSQL creation
* Interactive dashboard-only operations

---

# 1. Core Deployment Model

Render service creation and Render deployment are separate runtime concepts.

```text
CREATE SERVICE
≠
TRIGGER DEPLOY
≠
DEPLOY ACCEPTED
≠
DEPLOY LIVE
≠
APPLICATION HEALTHY
```

A successful deployment requires all of the following:

```text
service exists
+ intended configuration exists
+ intended commit was selected
+ deploy reached status live
+ deployed application responds correctly
```

Never report success based only on:

* A valid JSON body
* An HTTP `201` service-creation response
* An HTTP `201` or `202` deploy response
* A queued deployment
* A completed Docker build
* A service URL existing
* An agent-generated summary

---

# 2. Required Environment Variables

```bash
RENDER_API_KEY
RENDER_OWNER_ID
RENDER_SERVICE_NAME
RENDER_REPO_URL
RENDER_BRANCH
RENDER_REGION
RENDER_PLAN
RENDER_DOCKERFILE_PATH
RENDER_DOCKER_CONTEXT
RENDER_HEALTH_PATH
```

Recommended defaults:

```bash
RENDER_BRANCH="${RENDER_BRANCH:-main}"
RENDER_REGION="${RENDER_REGION:-virginia}"
RENDER_PLAN="${RENDER_PLAN:-free}"
RENDER_DOCKERFILE_PATH="${RENDER_DOCKERFILE_PATH:-./Dockerfile}"
RENDER_DOCKER_CONTEXT="${RENDER_DOCKER_CONTEXT:-.}"
RENDER_HEALTH_PATH="${RENDER_HEALTH_PATH:-/health}"
```

The API key must never appear in:

* Source files
* Request-body files committed to Git
* Shell tracing
* Logs
* URLs
* Query strings
* Error messages
* Agent memory
* Screenshots

Disable shell tracing before authenticated API calls:

```bash
set +x
```

---

# 3. Authentication

Render API requests use:

```http
Authorization: Bearer <RENDER_API_KEY>
Accept: application/json
Content-Type: application/json
```

Base API URL:

```text
https://api.render.com/v1
```

Example:

```bash
curl --fail-with-body --silent --show-error \
  --request GET \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  --header "Accept: application/json" \
  "https://api.render.com/v1/owners"
```

Never print the complete curl command when it contains the expanded authorization header.

---

# 4. Verify Authentication Before Mutation

Before creating a service, perform a read-only request:

```bash
curl --fail-with-body --silent --show-error \
  --request GET \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  --header "Accept: application/json" \
  "https://api.render.com/v1/owners"
```

Expected result:

```text
HTTP 200
```

Failure classification:

```text
401
→ RENDER_AUTHENTICATION_FAILED

429
→ RENDER_RATE_LIMITED

500 or 503
→ RENDER_PROVIDER_UNAVAILABLE
```

Do not attempt service creation when authentication has not been verified.

---

# 5. Workspace Discovery

Render now describes owners as **workspaces**, but the API endpoint remains:

```http
GET /v1/owners
```

This endpoint lists the workspaces accessible to the API key. The returned workspace identifier is supplied as `ownerId` when creating a service.

Example:

```bash
WORKSPACES_JSON="$(
  curl --fail-with-body --silent --show-error \
    --request GET \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Accept: application/json" \
    "https://api.render.com/v1/owners"
)"
```

Inspect only non-secret fields:

```bash
printf '%s' "$WORKSPACES_JSON" |
  jq 'map({
    id: .owner.id,
    name: .owner.name,
    type: .owner.type
  })'
```

The exact response wrapper must be inspected before extracting the ID.

Do not guess `ownerId`.

Required result:

```text
exact intended workspace identified
+ workspace ID captured
```

Workspace IDs commonly begin with:

```text
tea-
```

---

# 6. Billing Gate

The Render create-service endpoint documents HTTP `402` as:

```text
You must enter payment information to perform this request.
```

This means the specific request is blocked by an account or workspace billing prerequisite.

## Correct conclusion

```text
THIS ACCOUNT OR WORKSPACE RECEIVED HTTP 402
FOR THIS SERVICE-CREATION REQUEST
```

## Do not overgeneralize

Do not encode this as:

```text
Every Render free service always requires a card.
```

The API documentation confirms that `402` can occur. It does not establish a universal rule that every free-plan creation attempt on every account requires payment information.

## Required runtime behavior

```text
POST /v1/services
→ HTTP 402
→ classify BILLING_PREREQUISITE
→ stop retries
→ preserve response evidence
→ request account-level billing resolution
```

Do not respond to `402` by repeatedly changing:

* `plan`
* `region`
* `runtime`
* Dockerfile path
* Repository URL
* Environment variables
* Request formatting
* Authentication header

unless the response contains separate evidence that one of those fields is invalid.

## Operator-only action

When `402` is observed:

```text
VERIFIED_OPERATOR_ACTION_REQUIRED
```

Required action:

```text
Add acceptable payment information to the Render account or workspace,
then repeat service creation.
```

There is no legitimate payload mutation that bypasses an explicit payment-information requirement.

---

# 7. Repository Requirements

Required repository properties:

```text
valid HTTPS Git URL
+ requested branch exists
+ Dockerfile exists at configured path
+ Docker build context contains required files
```

Example repository URL:

```text
https://github.com/<owner>/<repository>
```

Do not include the branch in the repository URL.

Use the separate `branch` field.

Render supports creating web services from public Git repository URLs without relying on Git-provider credentials. Render’s public-repository flow has feature limitations, so do not assume provider-linked auto-deploy or pull-request-preview behavior.

Private repositories require an authorized repository connection or supported credential mechanism.

---

# 8. Preflight Repository Verification

Before calling Render:

```bash
git ls-remote \
  "${RENDER_REPO_URL}" \
  "refs/heads/${RENDER_BRANCH}"
```

Required result:

```text
remote branch exists
+ commit SHA returned
```

Capture the intended commit:

```bash
EXPECTED_COMMIT_SHA="$(
  git ls-remote \
    "${RENDER_REPO_URL}" \
    "refs/heads/${RENDER_BRANCH}" |
  awk '{print $1}'
)"
```

Reject an empty SHA:

```bash
if [[ -z "$EXPECTED_COMMIT_SHA" ]]; then
  printf 'ERROR: Remote branch does not exist or is inaccessible.\n' >&2
  exit 1
fi
```

Do not deploy an unpushed local commit.

---

# 9. Dockerfile Preflight

Verify locally when repository access exists:

```bash
test -f "${RENDER_DOCKERFILE_PATH}"
```

Build:

```bash
docker build \
  --file "${RENDER_DOCKERFILE_PATH}" \
  "${RENDER_DOCKER_CONTEXT}"
```

A local Docker build is strong pre-deployment evidence, but it does not prove Render’s build environment will succeed.

The Dockerfile must:

* Use a valid base image
* Copy all required source files
* Install production dependencies
* Define a valid runtime command
* Avoid depending on local-only files
* Respect `.dockerignore`
* Avoid embedding secrets
* Bind the application to `0.0.0.0`
* Use Render’s `PORT` value at runtime

Render supports building a service image from a repository Dockerfile and allows configuring the Dockerfile path and Docker context.

---

# 10. Port Binding

Render web services must bind their public HTTP server to:

```text
0.0.0.0
```

The application should use:

```text
process.env.PORT
```

Render’s documented default is port `10000`, but the application should not depend on that value being permanently hardcoded.

Correct Node.js example:

```ts
const port = Number(process.env.PORT ?? 10000);
const host = "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Listening on ${host}:${port}`);
});
```

Incorrect:

```ts
app.listen(3000, "127.0.0.1");
```

Incorrect Dockerfile pattern:

```dockerfile
ENV PORT=3000
```

`EXPOSE` is documentation and image metadata; it does not replace runtime binding:

```dockerfile
EXPOSE 10000
```

The application must still bind to `0.0.0.0:$PORT`.

---

# 11. Service-Creation Endpoint

```http
POST /v1/services
```

Full URL:

```text
https://api.render.com/v1/services
```

Required top-level fields:

```text
type
name
ownerId
```

For a Docker-based web service, `serviceDetails.runtime` must be:

```text
docker
```

The API supports `free` as a web-service plan value. The Docker-specific POST schema supports `dockerContext`, `dockerfilePath`, and an optional `dockerCommand`. The default Dockerfile path is `./Dockerfile`.

---

# 12. Known-Good Docker Service Shape

```json
{
  "type": "web_service",
  "name": "super-nova",
  "ownerId": "tea-REPLACE_WITH_WORKSPACE_ID",
  "repo": "https://github.com/OWNER/REPOSITORY",
  "branch": "main",
  "autoDeploy": "no",
  "envVars": [
    {
      "key": "NODE_ENV",
      "value": "production"
    }
  ],
  "serviceDetails": {
    "runtime": "docker",
    "plan": "free",
    "region": "virginia",
    "numInstances": 1,
    "healthCheckPath": "/health",
    "envSpecificDetails": {
      "dockerContext": ".",
      "dockerfilePath": "./Dockerfile"
    }
  }
}
```

This is a valid operational template.

It must be adapted to the actual:

* Workspace ID
* Service name
* Repository
* Branch
* Region
* Health path
* Environment variables
* Dockerfile location
* Build context

Do not claim this exact body succeeded in a new environment until the create request returns HTTP `201`.

---

# 13. Safe Request-Body Construction

Use `jq` rather than hand-built shell JSON:

```bash
CREATE_BODY="$(
  jq -n \
    --arg name "$RENDER_SERVICE_NAME" \
    --arg ownerId "$RENDER_OWNER_ID" \
    --arg repo "$RENDER_REPO_URL" \
    --arg branch "$RENDER_BRANCH" \
    --arg plan "$RENDER_PLAN" \
    --arg region "$RENDER_REGION" \
    --arg dockerfilePath "$RENDER_DOCKERFILE_PATH" \
    --arg dockerContext "$RENDER_DOCKER_CONTEXT" \
    --arg healthCheckPath "$RENDER_HEALTH_PATH" \
    '{
      type: "web_service",
      name: $name,
      ownerId: $ownerId,
      repo: $repo,
      branch: $branch,
      autoDeploy: "no",
      envVars: [
        {
          key: "NODE_ENV",
          value: "production"
        }
      ],
      serviceDetails: {
        runtime: "docker",
        plan: $plan,
        region: $region,
        numInstances: 1,
        healthCheckPath: $healthCheckPath,
        envSpecificDetails: {
          dockerContext: $dockerContext,
          dockerfilePath: $dockerfilePath
        }
      }
    }'
)"
```

Validate locally:

```bash
printf '%s' "$CREATE_BODY" | jq empty
```

Do not print request bodies containing secret environment-variable values.

---

# 14. Create the Service

```bash
CREATE_RESPONSE_FILE="$(mktemp)"
CREATE_STATUS_FILE="$(mktemp)"

cleanup() {
  rm -f \
    "$CREATE_RESPONSE_FILE" \
    "$CREATE_STATUS_FILE"
}

trap cleanup EXIT HUP INT TERM

HTTP_STATUS="$(
  curl --silent --show-error \
    --output "$CREATE_RESPONSE_FILE" \
    --write-out '%{http_code}' \
    --request POST \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    --data "$CREATE_BODY" \
    "https://api.render.com/v1/services"
)"
```

Handle the response mechanically:

```bash
case "$HTTP_STATUS" in
  201)
    printf 'Render service created.\n'
    ;;

  400)
    printf 'ERROR: INVALID_SERVICE_REQUEST\n' >&2
    jq . "$CREATE_RESPONSE_FILE" >&2 || true
    exit 1
    ;;

  401)
    printf 'ERROR: RENDER_AUTHENTICATION_FAILED\n' >&2
    exit 1
    ;;

  402)
    printf 'ERROR: RENDER_BILLING_PREREQUISITE\n' >&2
    jq . "$CREATE_RESPONSE_FILE" >&2 || true
    exit 2
    ;;

  404)
    printf 'ERROR: WORKSPACE_OR_REPOSITORY_RESOURCE_NOT_FOUND\n' >&2
    exit 1
    ;;

  409)
    printf 'ERROR: RENDER_RESOURCE_CONFLICT\n' >&2
    jq . "$CREATE_RESPONSE_FILE" >&2 || true
    exit 1
    ;;

  429)
    printf 'ERROR: RENDER_RATE_LIMITED\n' >&2
    exit 1
    ;;

  500|503)
    printf 'ERROR: RENDER_PROVIDER_UNAVAILABLE\n' >&2
    exit 1
    ;;

  *)
    printf 'ERROR: Unexpected Render status %s\n' "$HTTP_STATUS" >&2
    jq . "$CREATE_RESPONSE_FILE" >&2 || true
    exit 1
    ;;
esac
```

The create-service endpoint returns HTTP `201` on success and documents `400`, `401`, `402`, `404`, `409`, `429`, `500`, and `503` failure responses.

---

# 15. Capture Service and Initial Deploy IDs

The successful create-service schema contains:

```text
service
deployId
```

Extract:

```bash
SERVICE_ID="$(
  jq -r '.service.id // empty' \
    "$CREATE_RESPONSE_FILE"
)"

DEPLOY_ID="$(
  jq -r '.deployId // empty' \
    "$CREATE_RESPONSE_FILE"
)"

SERVICE_URL="$(
  jq -r '.service.serviceDetails.url // .service.url // empty' \
    "$CREATE_RESPONSE_FILE"
)"
```

Validate:

```bash
if [[ -z "$SERVICE_ID" ]]; then
  printf 'ERROR: Render response did not contain a service ID.\n' >&2
  exit 1
fi
```

Do not assume the response path for the URL without inspecting the actual response.

---

# 16. Initial Deploy Versus Manual Deploy

Creating a service generally initiates its first deployment and may return a `deployId`.

If a valid `deployId` is returned:

```text
poll that deploy
```

Do not immediately trigger a duplicate deployment.

If no deploy ID is returned:

1. Query the service’s deploy list.
2. Identify an existing deploy for the expected commit.
3. Trigger a manual deploy only when no suitable deploy exists.

---

# 17. Triggering a Manual Deploy

Endpoint:

```http
POST /v1/services/{serviceId}/deploys
```

Render accepts an optional `commitId` to deploy a specific Git commit. The endpoint returns HTTP `201` when created or `202` when queued.

Recommended body:

```json
{
  "commitId": "FULL_GIT_COMMIT_SHA",
  "clearCache": "do_not_clear"
}
```

Create body:

```bash
DEPLOY_BODY="$(
  jq -n \
    --arg commitId "$EXPECTED_COMMIT_SHA" \
    '{
      commitId: $commitId,
      clearCache: "do_not_clear"
    }'
)"
```

Trigger:

```bash
DEPLOY_RESPONSE_FILE="$(mktemp)"

DEPLOY_HTTP_STATUS="$(
  curl --silent --show-error \
    --output "$DEPLOY_RESPONSE_FILE" \
    --write-out '%{http_code}' \
    --request POST \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    --data "$DEPLOY_BODY" \
    "https://api.render.com/v1/services/${SERVICE_ID}/deploys"
)"
```

Accept:

```text
201
202
```

For HTTP `201`, extract:

```bash
DEPLOY_ID="$(
  jq -r '.id // empty' \
    "$DEPLOY_RESPONSE_FILE"
)"
```

An HTTP `202` response might not provide a complete deploy object. When the deploy ID is absent, query the deploy list and match the intended commit.

---

# 18. Do Not Misuse `deployMode`

Render also supports:

```text
deploy_only
build_and_deploy
```

However, the API documents that `deployMode` cannot be combined with:

* `commitId`
* `imageUrl`
* `clearCache`

Therefore, do not send:

```json
{
  "commitId": "abc123",
  "clearCache": "do_not_clear",
  "deployMode": "build_and_deploy"
}
```

That request is invalid.

For a Git-commit deployment, omit `deployMode`.

---

# 19. Deployment Polling

Retrieve a deploy:

```http
GET /v1/services/{serviceId}/deploys/{deployId}
```

The Render API exposes the following deploy statuses:

```text
created
queued
build_in_progress
update_in_progress
pre_deploy_in_progress
live
deactivated
build_failed
update_failed
pre_deploy_failed
canceled
```

---

# 20. Terminal-State Classification

## Success

```text
live
```

## Failure

```text
build_failed
update_failed
pre_deploy_failed
canceled
```

## Nonterminal

```text
created
queued
build_in_progress
pre_deploy_in_progress
update_in_progress
```

## Non-success terminal or special

```text
deactivated
```

Do not treat an unknown future status as success.

Unknown status:

```text
UNVERIFIED_DEPLOY_STATUS
```

---

# 21. Bounded Polling Script

```bash
MAX_POLLS="${MAX_POLLS:-120}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"

for ((attempt = 1; attempt <= MAX_POLLS; attempt += 1)); do
  DEPLOY_JSON="$(
    curl --fail-with-body --silent --show-error \
      --request GET \
      --header "Authorization: Bearer ${RENDER_API_KEY}" \
      --header "Accept: application/json" \
      "https://api.render.com/v1/services/${SERVICE_ID}/deploys/${DEPLOY_ID}"
  )"

  DEPLOY_STATUS="$(
    printf '%s' "$DEPLOY_JSON" |
      jq -r '.status // empty'
  )"

  DEPLOY_COMMIT_SHA="$(
    printf '%s' "$DEPLOY_JSON" |
      jq -r '.commit.id // empty'
  )"

  printf 'Deploy %s status: %s\n' \
    "$DEPLOY_ID" \
    "${DEPLOY_STATUS:-UNKNOWN}"

  case "$DEPLOY_STATUS" in
    live)
      printf 'Render deployment reached live state.\n'
      break
      ;;

    build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
      printf 'ERROR: Render deployment terminated with %s.\n' \
        "$DEPLOY_STATUS" >&2
      exit 1
      ;;

    created|queued|build_in_progress|pre_deploy_in_progress|update_in_progress)
      sleep "$POLL_INTERVAL_SECONDS"
      ;;

    *)
      printf 'ERROR: Unknown deploy status: %s\n' \
        "${DEPLOY_STATUS:-EMPTY}" >&2
      exit 1
      ;;
  esac
done

if [[ "${DEPLOY_STATUS:-}" != "live" ]]; then
  printf 'ERROR: Render deploy polling timed out.\n' >&2
  exit 1
fi
```

Maximum example polling duration:

```text
120 attempts × 10 seconds = 20 minutes
```

The runtime must use a bounded timeout.

---

# 22. Commit Verification

After status becomes `live`:

```bash
if [[ -n "$DEPLOY_COMMIT_SHA" ]] &&
   [[ "$DEPLOY_COMMIT_SHA" != "$EXPECTED_COMMIT_SHA" ]]; then
  printf 'ERROR: Render deployed the wrong commit.\n' >&2
  printf 'Expected: %s\n' "$EXPECTED_COMMIT_SHA" >&2
  printf 'Observed: %s\n' "$DEPLOY_COMMIT_SHA" >&2
  exit 1
fi
```

Required invariant:

```text
GitHub branch SHA
=
requested Render commit
=
Render deploy commit
```

When Render’s response does not expose a commit SHA:

```text
COMMIT VERIFICATION = UNKNOWN
```

Do not fabricate equality.

---

# 23. Health Verification

A `live` deploy does not prove the application is functionally healthy.

Probe:

```bash
HEALTH_URL="${SERVICE_URL%/}${RENDER_HEALTH_PATH}"

HEALTH_STATUS="$(
  curl --silent --show-error \
    --output /tmp/render-health-response.txt \
    --write-out '%{http_code}' \
    --max-time 30 \
    "$HEALTH_URL"
)"
```

Expected:

```text
HTTP 200
```

Validate response content when a contract exists:

```bash
jq -e '
  .status == "ok" or
  .status == "healthy"
' /tmp/render-health-response.txt
```

If the endpoint returns plain text, verify the expected string instead.

---

# 24. HTTP Verification Requirements

At minimum:

```text
DNS resolution succeeds
+ TLS succeeds
+ expected route responds
+ expected status code observed
+ expected content observed
```

For an API service, also test:

```text
GET /health
→ 200

one representative public endpoint
→ expected result

one protected endpoint
→ expected authorization behavior
```

For a UI service, perform browser verification after HTTP verification.

---

# 25. Environment Variables

The service-creation API accepts:

```json
{
  "envVars": [
    {
      "key": "NODE_ENV",
      "value": "production"
    }
  ]
}
```

For secret values:

* Read from environment or an authorized secret broker
* Build request JSON in memory
* Disable shell tracing
* Never print the complete request
* Never write the request to a committed file
* Delete temporary request files
* Redact API responses where appropriate

Render makes configured environment variables available to Docker services at runtime and also translates them into Docker build arguments. Sensitive build values require special care because Docker build layers can preserve them.

Do not place secrets in Dockerfile instructions such as:

```dockerfile
ARG API_KEY
ENV API_KEY=$API_KEY
RUN echo "$API_KEY"
```

---

# 26. Existing-Service Rule

Before creating a service, check whether one already exists.

Use:

```http
GET /v1/services
```

Filter by:

* Workspace
* Exact service name
* Repository
* Service type

If a matching service exists:

```text
DO NOT CREATE A DUPLICATE
```

Instead:

1. Retrieve its current configuration.
2. Confirm the intended repository and branch.
3. Update configuration only when required.
4. Trigger a deployment.
5. Verify the deployed commit and health.

A `409` during creation may indicate a naming or resource-state conflict.

Do not mutate the service name repeatedly without inspecting existing services.

---

# 27. Idempotency Rule

The workflow must persist:

```text
service ID
service name
workspace ID
deploy ID
branch
expected commit SHA
observed deploy commit SHA
service URL
health result
```

Before repeating a failed run:

```text
query existing service
→ query existing deploy
→ reconcile remote state
→ avoid duplicate creation
```

Network timeout after a mutation is an ambiguous result.

Do not assume the request failed.

Reconcile Render state before retrying.

---

# 28. Failure Classification

```text
400
→ INVALID_RENDER_REQUEST

401
→ RENDER_AUTHENTICATION_FAILED

402
→ RENDER_BILLING_PREREQUISITE

403
→ RENDER_AUTHORIZATION_FAILED

404
→ RENDER_RESOURCE_NOT_FOUND

409
→ RENDER_RESOURCE_CONFLICT

410
→ RENDER_RESOURCE_GONE

429
→ RENDER_RATE_LIMITED

500
→ RENDER_INTERNAL_ERROR

503
→ RENDER_SERVICE_UNAVAILABLE
```

Deployment statuses:

```text
build_failed
→ DOCKER_BUILD_FAILED

pre_deploy_failed
→ PRE_DEPLOY_COMMAND_FAILED

update_failed
→ RELEASE_OR_RUNTIME_UPDATE_FAILED

canceled
→ DEPLOY_CANCELED

deactivated
→ DEPLOY_NOT_ACTIVE
```

---

# 29. Retry Rules

Retry only:

```text
429
500
503
transient network failure
```

Requirements:

* Bounded retries
* Exponential backoff
* Jitter
* `Retry-After` honored when provided
* Remote-state reconciliation before retrying mutations

Do not retry automatically:

```text
400
401
402
403
404
409
410
build_failed
pre_deploy_failed
update_failed
```

These require correction or account action.

---

# 30. Evidence Ledger

A successful run must record:

```text
workspace lookup HTTP status
workspace ID
service-create HTTP status
service ID
initial or manual deploy ID
expected Git commit SHA
observed Render commit SHA
deploy terminal status
service URL
health-check HTTP status
health response assertion
```

Example:

```json
{
  "status": "VERIFIED",
  "workspaceId": "tea-example",
  "serviceId": "srv-example",
  "deployId": "dep-example",
  "expectedCommitSha": "abc123",
  "observedCommitSha": "abc123",
  "deployStatus": "live",
  "healthUrl": "[REDACTED_HOST]/health",
  "healthHttpStatus": 200,
  "healthVerified": true
}
```

---

# 31. Completion Gate

```text
SERVICE_CREATION VERIFIED
=
HTTP 201
+ service ID captured

DEPLOYMENT ACCEPTED
=
HTTP 201 or 202
+ deploy identified

DEPLOYMENT VERIFIED
=
deploy status live
+ intended commit confirmed where observable

APPLICATION VERIFIED
=
health HTTP result passed
+ expected response content passed
```

Final completion:

```text
SERVICE_CREATION VERIFIED
AND
DEPLOYMENT VERIFIED
AND
APPLICATION VERIFIED
```

When any component is unknown:

```text
UNVERIFIED
```

---

# 32. Required Tests Before Deployment

Before Render creation or redeployment:

```text
Dockerfile exists
Docker build succeeds
application binds to 0.0.0.0
application reads PORT
health route exists
health route returns expected result
repository branch exists remotely
expected commit exists remotely
request body passes JSON validation
```

Recommended local sequence:

```bash
docker build \
  --tag nova-render-preflight \
  --file "${RENDER_DOCKERFILE_PATH}" \
  "${RENDER_DOCKER_CONTEXT}"

docker run --rm \
  --publish 10000:10000 \
  --env PORT=10000 \
  nova-render-preflight
```

Then:

```bash
curl --fail \
  "http://127.0.0.1:10000${RENDER_HEALTH_PATH}"
```

---

# 33. Prohibited Behavior

```text
Do not guess the workspace ID.

Do not declare HTTP 402 a malformed-payload error.

Do not universally claim every free-plan account requires a card.

Do not retry HTTP 402 without account-state change.

Do not include the branch in the repo URL.

Do not hardcode the runtime port instead of reading PORT.

Do not bind the application only to localhost.

Do not create duplicate services without checking existing state.

Do not trigger duplicate deploys when service creation already created one.

Do not combine deployMode with commitId or clearCache.

Do not report HTTP 201 or 202 as proof that the deploy is live.

Do not report build success as proof that the service is healthy.

Do not report live status without probing the application.

Do not expose the Render API key.

Do not print secret environment-variable values.

Do not deploy an unpushed local commit.

Do not claim the intended commit was deployed without comparing available SHA evidence.
```

---

# 34. Final Runtime Rule

```text
AUTHENTICATE
→ DISCOVER WORKSPACE
→ CHECK EXISTING SERVICE
→ VERIFY REMOTE REPOSITORY AND COMMIT
→ VALIDATE DOCKER BUILD
→ CREATE OR UPDATE SERVICE
→ HANDLE BILLING GATE HONESTLY
→ CAPTURE SERVICE AND DEPLOY IDS
→ POLL TO TERMINAL STATUS
→ REQUIRE live
→ COMPARE COMMIT SHAS
→ VERIFY HEALTH OVER HTTP
→ REPORT ONLY OBSERVED EVIDENCE
```

```text
HTTP 402
=
VERIFIED BILLING PREREQUISITE FOR THAT REQUEST

HTTP 201 OR 202
=
REQUEST ACCEPTED, NOT DEPLOYMENT VERIFIED

STATUS live
=
DEPLOYMENT ACTIVE, NOT AUTOMATICALLY APPLICATION-HEALTH VERIFIED

DONE
=
EXPECTED COMMIT LIVE
+ HEALTH CHECK PASSED
```

**END OF SPEC**
