---
name: "GitHub PAT git push"
description: "Securely authenticate Git-over-HTTPS with a personal access token, push to a descriptive branch, and verify the remote commit without exposing credentials."
---

# GitHub PAT Git Push

## Authentication truth

A PAT working for GitHub REST requests does not prove that a specific Git-over-HTTPS header configuration will work.

The observed `http.extraHeader` bearer failure is environment-specific. Do not turn it into a universal GitHub rule.

For Git-over-HTTPS, use the PAT as the credential password with username `x-access-token`.

Preferred methods:

1. GitHub CLI credential helper
2. Git Credential Manager
3. ephemeral `GIT_ASKPASS`
4. token-in-URL only as a temporary compatibility fallback

## Safe noninteractive pattern

```bash
set -Eeuo pipefail
set +x

: "${TOKEN:?TOKEN is required}"
: "${GITHUB_OWNER:?GITHUB_OWNER is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"

git check-ref-format --branch "$TARGET_BRANCH" >/dev/null

REMOTE_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.git"
ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT HUP INT TERM
chmod 700 "$ASKPASS"

cat >"$ASKPASS" <<'SCRIPT'
#!/bin/sh
case "$1" in
  *Username*|*username*) printf '%s\n' 'x-access-token' ;;
  *Password*|*password*) printf '%s\n' "${TOKEN:?TOKEN unavailable}" ;;
  *) exit 1 ;;
esac
SCRIPT

export TOKEN GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0

git -c credential.helper= -c core.askPass="$ASKPASS" \
  push "$REMOTE_URL" "HEAD:refs/heads/${TARGET_BRANCH}"
```

## Branch safety

Default to a new descriptive branch:

```text
YYYY-MM-DD-what-changed
```

Create it from the latest `origin/main`. Before pushing an existing branch, require a fast-forward-safe history check. Never automatically use `--force` or `--force-with-lease`.

## Token-in-URL fallback

This form may work where another credential transport fails:

```bash
git push \
  "https://x-access-token:${TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.git" \
  "HEAD:refs/heads/${TARGET_BRANCH}"
```

It is a last-resort fallback because the token can appear in process arguments, tracing, logs, or monitoring. Never store that URL as a Git remote.

## Verification

A push is verified only when:

```text
push exit code = 0
AND
remote branch exists
AND
remote branch SHA = intended local SHA
```

```bash
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote "$REMOTE_URL" "refs/heads/${TARGET_BRANCH}" | awk '{print $1}')"
test -n "$REMOTE_SHA"
test "$LOCAL_SHA" = "$REMOTE_SHA"
```

## Prohibited behavior

- do not print or persist the token
- do not enable `set -x`
- do not rely on output redaction as the primary secret control
- do not push directly to `main` unless explicitly authorized
- do not claim success without remote SHA verification
- do not repeat an unchanged failed authentication attempt
