---
name: nova-services
description: Access NOVA's connected apps through Composio, mission-aware vector memory, Gmail, Google Drive, Docs, Sheets, YouTube, Instagram, knowledge, scratchpad, and repository skills through authenticated loopback APIs.
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---

# NOVA Services

Use this skill whenever a mission needs prior runtime memory, an external app, GitHub repository, connected account, or capability exposed by the NOVA backend. The helper returns structured JSON and exits nonzero on failed or unauthorized requests.

Run commands with:

```bash
node {baseDir}/nova-services.mjs <command> [options]
```

## Mandatory mission memory protocol

For non-trivial missions, use the runtime memory as part of the execution loop rather than treating it as a passive document database.

1. Before planning or acting, run `vector-search` with the exact current goal and the current phase.
2. Inspect verification labels literally. `verified` and `observed` evidence outrank `claimed` model text. Never convert a claim into verified evidence without a real check.
3. During correction, search failure memory before repeating an equivalent failed action.
4. Persist high-value observations, failures, decisions, procedures, and evidence with `vector-ingest`. Do not save hidden reasoning, speculative chain-of-thought, or repetitive summaries.
5. After retrieved memories materially contribute to an outcome, call `vector-feedback` with the returned memory ids and the real success/failure result.

```bash
node {baseDir}/nova-services.mjs vector-status
node {baseDir}/nova-services.mjs vector-search --query 'exact mission or current problem' --phase PLAN --intent plan --limit 8 --mission-id <run-id>
node {baseDir}/nova-services.mjs vector-search --query 'current failure and exact error' --phase CORRECT --intent debug --types failure,evidence,code,tool --limit 10 --mission-id <run-id>
node {baseDir}/nova-services.mjs vector-ingest --type failure --scope mission --mission-id <run-id> --verification observed --importance 0.9 --content 'Observed command, error, environment, and failed result'
node {baseDir}/nova-services.mjs vector-ingest --type evidence --scope mission --mission-id <run-id> --verification verified --importance 1 --content 'Exact verification command and observed result'
node {baseDir}/nova-services.mjs vector-feedback --ids 12,19,22 --successful true
```

Use `verified` only for evidence established by an actual test, command, API response, build, deployment check, browser check, or other directly observed proof. A model response, plan, or assertion is `claimed` or at most `inferred`.

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

The legacy `knowledge-*` commands remain available for document/SOP retrieval. Use `vector-*` for agentic runtime memory because it preserves memory type, scope, mission, verification, temporal validity, and utility feedback.

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
2. Never fabricate service data, tool availability, repository contents, memory evidence, or success.
3. Search mission memory before a non-trivial plan and search failure memory before repeating a failed action.
4. Search for the correct Composio tool before executing. Do not guess tool slugs or arguments.
5. Prefer read-only tools for inspection and analysis. Perform writes only when the operator requested the external change.
6. If a connection is missing, call `composio-connect` and return the real Connect Link.
7. Do not print or inspect environment variables. Authentication is injected at runtime and must remain secret.
8. Cite concrete repository names, file paths, SHAs, memory ids, timestamps, counts, tool slugs, log IDs, test outputs, or API errors in the final verification report.
