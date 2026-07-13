---
name: nova-services
description: Access NOVA's connected apps through Composio, plus Gmail, Google Drive, Docs, Sheets, YouTube, Instagram, knowledge, scratchpad, and repository skills through authenticated loopback APIs.
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---

# NOVA Services

Use this skill whenever a mission needs an external app, GitHub repository, connected account, or capability exposed by the NOVA backend. The helper returns structured JSON and exits nonzero on failed or unauthorized requests.

Run commands with:

```bash
node {baseDir}/nova-services.mjs <command> [options]
```

## Mandatory capability discovery

Before saying GitHub or another app is unavailable, inspect the real bridge:

```bash
node {baseDir}/nova-services.mjs status
node {baseDir}/nova-services.mjs composio-status
node {baseDir}/nova-services.mjs composio-connections
node {baseDir}/nova-services.mjs composio-apps --search github --limit 10
```

If Composio reports the toolkit is not connected, generate the real hosted connection link:

```bash
node {baseDir}/nova-services.mjs composio-connect --toolkit github
```

Return the `redirectUrl` to the operator and explain that execution can continue after connection. Never replace this check with a generic denial.

## Composio tool discovery and execution

Composio provides the dynamic app tool layer. Search by the user's intended action, inspect returned tool slugs and schemas, then execute the selected tool with exact arguments.

```bash
node {baseDir}/nova-services.mjs composio-search --query 'Read the default branch and important files in a GitHub repository without modifying it'
node {baseDir}/nova-services.mjs composio-execute --tool GITHUB_TOOL_SLUG --arguments-json '{"owner":"ABBYCRM","repo":"NovaLuis"}'
```

Use `--account <connected-account-id-or-alias>` when Composio reports multiple accounts.

### GitHub repository protocol

For any GitHub repository URL:

1. Run `composio-status` and `composio-connections`.
2. Run `github-repo --url <repository-url>` or a precise `composio-search` query.
3. Read the returned `primary_tool_slugs`, execution guidance, schemas, and connection status.
4. Execute the minimum read-only GitHub tools required to obtain repository metadata, default branch, tree, important source/config/docs, recent commits, issues, and pull requests.
5. Inspect actual results and report evidence. Do not say the repository is inaccessible unless a real bridge call failed or GitHub is not connected.

Convenience search:

```bash
node {baseDir}/nova-services.mjs github-repo --url https://github.com/ABBYCRM/NovaLuis
```

## Native NOVA connected services

```bash
node {baseDir}/nova-services.mjs integrations
node {baseDir}/nova-services.mjs gmail --max 10 --query 'is:unread newer_than:7d'
node {baseDir}/nova-services.mjs drive --query "name contains 'report'"
node {baseDir}/nova-services.mjs docs --id <google-document-id>
node {baseDir}/nova-services.mjs sheets --id <spreadsheet-id> --range 'Sheet1!A1:Z100'
node {baseDir}/nova-services.mjs youtube --query 'search terms'
node {baseDir}/nova-services.mjs instagram
```

## NOVA knowledge and skill catalog

```bash
node {baseDir}/nova-services.mjs skills
node {baseDir}/nova-services.mjs skills --name <skill-name>
node {baseDir}/nova-services.mjs scratchpad
node {baseDir}/nova-services.mjs knowledge-search --query 'what to retrieve' --limit 5
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --content 'Text to store'
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --file ./path/to/file.md --external-id optional-id
```

## Execution rules

1. Inspect the returned `ok` field and actual payload before using a result.
2. Never fabricate service data, tool availability, repository contents, or success.
3. Search for the correct Composio tool before executing. Do not guess tool slugs or arguments.
4. Prefer read-only tools for inspection and analysis. Perform writes only when the operator requested the external change.
5. If a connection is missing, call `composio-connect` and return the real Connect Link.
6. Do not print or inspect environment variables. Authentication is injected at runtime and must remain secret.
7. Cite concrete repository names, file paths, SHAs, IDs, timestamps, counts, tool slugs, log IDs, or API errors in the final verification report.
