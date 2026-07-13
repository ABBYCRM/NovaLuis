Use this exact `SKILL.md` content:

---

name: "GitHub PAT git push"
description: >-
Securely push to GitHub over HTTPS with a classic personal access token when
the bearer http.extraHeader method fails in this runtime environment.
---------------------------------------------------------------------

# Pushing to GitHub with a Personal Access Token

## Environment-Specific Finding

In this runtime environment, Git authentication using:

```text
AUTHORIZATION: bearer <PAT>
```

through Git’s `http.extraHeader` configuration failed with:

```text
invalid credentials
Authentication failed
```

The same personal access token successfully authenticated GitHub REST API requests using:

```http
Authorization: Bearer <PAT>
```

This distinction matters:

```text
GitHub REST API authentication
≠
Git-over-HTTPS credential authentication
```

A token working with GitHub’s REST API does not prove that the same header configuration will work for `git push` or `git fetch`.

The failure observed here applies to this runtime and invocation method. It must not be generalized into a claim that GitHub universally rejects all authorization-header-based Git authentication.

---

# Required Git Authentication Model

For Git operations over HTTPS, supply the personal access token through Git’s credential interface as the password.

Use:

```text
username: x-access-token
password: <PAT>
```

The repository URL must remain free of credentials:

```text
https://github.com/<owner>/<repository>.git
```

Preferred authentication methods, in order:

```text
1. GitHub CLI credential helper
2. Git Credential Manager
3. Ephemeral GIT_ASKPASS
4. Token-in-URL only as an observed emergency fallback
```

---

# Preferred Noninteractive Method

Use an ephemeral `GIT_ASKPASS` script so the token does not appear in:

* The Git remote URL
* `.git/config`
* Command-line arguments
* Shell history
* Process listings
* Normal Git output

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

: "${TOKEN:?TOKEN environment variable is required}"
: "${GITHUB_OWNER:?GITHUB_OWNER is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"

git check-ref-format --branch "$TARGET_BRANCH" >/dev/null

REMOTE_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.git"
ASKPASS_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/github-askpass.XXXXXX")"

cleanup() {
  rm -f "$ASKPASS_SCRIPT"
}

trap cleanup EXIT HUP INT TERM
chmod 700 "$ASKPASS_SCRIPT"

cat >"$ASKPASS_SCRIPT" <<'ASKPASS'
#!/bin/sh

case "$1" in
  *Username*|*username*)
    printf '%s\n' "x-access-token"
    ;;

  *Password*|*password*)
    printf '%s\n' "${TOKEN:?TOKEN is unavailable}"
    ;;

  *)
    exit 1
    ;;
esac
ASKPASS

export TOKEN
export GIT_ASKPASS="$ASKPASS_SCRIPT"
export GIT_TERMINAL_PROMPT=0

# Never enable shell tracing while credentials are available.
set +x

git \
  -c credential.helper= \
  -c core.askPass="$ASKPASS_SCRIPT" \
  push \
  "$REMOTE_URL" \
  "HEAD:refs/heads/${TARGET_BRANCH}"
```

---

# Why `HEAD` Is Used

Use:

```text
HEAD:refs/heads/<target-branch>
```

instead of:

```text
main:<target-branch>
```

`HEAD` pushes the currently checked-out commit.

Using `main` assumes:

* A local branch named `main` exists
* `main` contains the intended changes
* The current checkout matches `main`

Those assumptions may be false.

---

# New-Branch Safety Rule

Default behavior:

```text
PUSH TO A NEW BRANCH
```

Recommended branch format:

```text
YYYY-MM-DD/change-summary
```

Example:

```bash
TARGET_BRANCH="2026-07-13/github-pat-auth-fix"
```

This prevents accidental modification of the remote default branch when local and remote histories have diverged.

---

# Existing Branch Rule

Before pushing to an existing remote branch:

```text
FETCH REMOTE BRANCH
→ COMPARE HISTORY
→ REQUIRE FAST-FORWARD
→ ABORT ON DIVERGENCE
```

Never automatically convert a rejected push into:

```bash
git push --force
```

or:

```bash
git push --force-with-lease
```

History replacement requires explicit operator authorization.

---

# Observed Token-in-URL Fallback

The following command worked in this specific environment after the bearer `http.extraHeader` method failed:

```bash
git push \
  "https://x-access-token:${TOKEN}@github.com/<owner>/<repository>.git" \
  "HEAD:refs/heads/<target-branch>"
```

This confirms that:

* The token was valid enough for Git authentication
* The repository was reachable
* The token had sufficient access for that push
* The previous failure was associated with the attempted authentication method

It does not prove that token-in-URL authentication is the preferred or safest method.

---

# Token-in-URL Security Warning

A credential-bearing URL can expose the token through:

* Process argument inspection
* Shell tracing
* Agent execution transcripts
* CI logs
* Error serialization
* Debug output
* Command-history capture
* Monitoring agents
* Accidental Git remote persistence

Therefore, token-in-URL authentication must not be the default implementation.

It may be used only when:

```text
the environment is temporary
AND
the token comes from an environment variable
AND
shell tracing is disabled
AND
the URL is never stored as a Git remote
AND
no safer credential helper is available
AND
the token is rotated if exposure is suspected
```

---

# Redaction Warning

This command:

```bash
sed -E 's/[A-Za-z0-9_]{20,}/[REDACTED]/g'
```

is not a reliable credential-security mechanism.

It may:

* Miss tokens containing unexpected characters
* Redact unrelated identifiers
* Run only after another system has captured the raw output
* Fail to sanitize command arguments
* Fail to sanitize process metadata
* Fail to sanitize Git configuration

Redaction is a secondary defense.

The primary defense is:

```text
DO NOT PLACE THE TOKEN IN OBSERVABLE OUTPUT
```

---

# Secure Fallback Command

When the token-in-URL method is absolutely required:

```bash
#!/usr/bin/env bash

set -Eeuo pipefail
set +x

: "${TOKEN:?TOKEN is required}"
: "${GITHUB_OWNER:?GITHUB_OWNER is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"

git check-ref-format --branch "$TARGET_BRANCH" >/dev/null

git push \
  "https://x-access-token:${TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.git" \
  "HEAD:refs/heads/${TARGET_BRANCH}"
```

Do not run:

```bash
git remote add origin \
  "https://x-access-token:${TOKEN}@github.com/<owner>/<repository>.git"
```

Do not run:

```bash
git remote set-url origin \
  "https://x-access-token:${TOKEN}@github.com/<owner>/<repository>.git"
```

Those commands persist the credential in repository configuration.

---

# Authentication Failure Classification

When Git returns:

```text
Authentication failed
Invalid username or password
HTTP 401
HTTP 403
```

classify the result as:

```text
AUTHENTICATION_OR_AUTHORIZATION_FAILED
```

Do not immediately conclude that the token itself is invalid.

Possible causes include:

* Incorrect credential transport
* Expired token
* Revoked token
* Missing repository permission
* Organization policy restrictions
* SAML authorization requirements
* Incorrect repository owner
* Incorrect repository name
* Credential-helper conflict
* Wrong environment variable
* Token type mismatch
* Insufficient classic-PAT scopes

---

# Push Verification

A successful local command attempt is not sufficient proof.

The push is verified only when:

```text
git push exits with code 0
AND
the target branch exists remotely
AND
the remote branch SHA matches the intended local SHA
```

Verification example:

```bash
LOCAL_SHA="$(git rev-parse HEAD)"

REMOTE_SHA="$(
  git \
    -c credential.helper= \
    -c core.askPass="$ASKPASS_SCRIPT" \
    ls-remote \
    "$REMOTE_URL" \
    "refs/heads/${TARGET_BRANCH}" |
  awk '{print $1}'
)"

if [[ -z "$REMOTE_SHA" ]]; then
  printf 'ERROR: Remote branch was not found.\n' >&2
  exit 1
fi

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  printf 'ERROR: Remote SHA does not match local HEAD.\n' >&2
  exit 1
fi

printf 'VERIFIED: Remote branch contains commit %s\n' "$LOCAL_SHA"
```

---

# Required Runtime Behavior

```text
IF bearer http.extraHeader authentication fails
→ do not repeat the same request unchanged

IF GIT_ASKPASS is available
→ use GIT_ASKPASS

IF only token-in-URL works
→ use it as a temporary fallback without persisting the URL

IF the normal push is rejected because histories diverged
→ stop and inspect

IF the remote SHA is not verified
→ do not claim the push succeeded

IF the token or repository is unavailable
→ return UNVERIFIED or VERIFIED_OPERATOR_BLOCKER
```

---

# Prohibited Behavior

```text
Do not print the token.
Do not store the token in .git/config.
Do not store the token in a remote URL.
Do not enable set -x.
Do not dump environment variables.
Do not rely on sed as the main secret control.
Do not automatically force-push.
Do not claim success based only on an attempted command.
Do not claim remote persistence without remote SHA verification.
Do not repeat a failed authentication method without changing a relevant variable.
```

---

# Final Rule

```text
PREFERRED:
clean GitHub HTTPS URL
+ x-access-token username
+ PAT supplied through Git credentials
+ ephemeral GIT_ASKPASS
+ new branch by default
+ no force push
+ remote SHA verification

TEMPORARY FALLBACK:
token-in-URL
+ environment expansion
+ no remote persistence
+ no shell tracing
+ immediate verification
```

**END OF SPEC**
