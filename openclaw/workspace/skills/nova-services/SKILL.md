---
name: nova-services
description: Access NOVA's existing Gmail, Google Drive, Docs, Sheets, YouTube, Instagram, knowledge base, scratchpad, and repository skill catalog through authenticated loopback APIs.
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---

# NOVA Services

Use this skill whenever a mission needs data or capabilities already exposed by the NOVA backend. The helper returns structured JSON and exits nonzero on any failed or unauthorized request.

Run commands with:

```bash
node {baseDir}/nova-services.mjs <command> [options]
```

## Discovery and health

```bash
node {baseDir}/nova-services.mjs status
node {baseDir}/nova-services.mjs integrations
node {baseDir}/nova-services.mjs skills
node {baseDir}/nova-services.mjs skills --name <skill-name>
node {baseDir}/nova-services.mjs scratchpad
```

## Connected services

```bash
node {baseDir}/nova-services.mjs gmail --max 10 --query 'is:unread newer_than:7d'
node {baseDir}/nova-services.mjs drive --query "name contains 'report'"
node {baseDir}/nova-services.mjs docs --id <google-document-id>
node {baseDir}/nova-services.mjs sheets --id <spreadsheet-id> --range 'Sheet1!A1:Z100'
node {baseDir}/nova-services.mjs youtube --query 'search terms'
node {baseDir}/nova-services.mjs instagram
```

## NOVA knowledge

```bash
node {baseDir}/nova-services.mjs knowledge-search --query 'what to retrieve' --limit 5
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --content 'Text to store'
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --file ./path/to/file.md --external-id optional-id
```

## Execution rules

1. Inspect the returned `ok` field and actual payload before using a result.
2. Never fabricate service data when a command fails, returns an empty set, or reports missing credentials.
3. Use read-only service calls freely when relevant to the mission. Use `knowledge-ingest` only when the goal calls for durable storage or the result is genuinely reusable.
4. Do not print or inspect environment variables. Authentication is injected into the helper at runtime and must remain secret.
5. Cite concrete message IDs, file IDs, titles, ranges, timestamps, counts, or API errors in the final verification report when available.
