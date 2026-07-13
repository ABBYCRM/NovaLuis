# Composio Integration Execution Plan

Temporary implementation note for the Composio connection and tool-execution work. This file will be replaced by the completed runbook before final merge.

## Acceptance gates

1. Settings contains a searchable dropdown-style app showcase populated from Composio's live toolkit catalog.
2. A selected app generates a hosted Composio Connect Link and returns to NOVA Settings.
3. Connection state refreshes from Composio and shows connected, pending, expired, or unavailable without exposing credentials.
4. OpenClaw can discover tools by use case and execute selected Composio tools through NOVA's authenticated loopback service bridge.
5. GitHub is included as a featured toolkit and repository-analysis prompts instruct NOVA to use Composio rather than deny access.
6. Frozen install, TypeScript, API build, JSON/Python validation, production Docker build, live container boot, and UI structure checks pass before main is updated.
