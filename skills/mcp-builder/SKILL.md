---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).
license: Complete terms in LICENSE.txt
---

Quality of an MCP server is measured by how well it lets an LLM accomplish real-world
tasks. Four-phase workflow:
1. Deep research & planning — API coverage vs. workflow-tool balance, tool naming
   discoverability, context management, actionable error messages
2. Implementation — project structure, shared infrastructure (API client, error
   handling, pagination), tool implementation (input/output schema, annotations)
3. Review & testing — code quality review, build verification, MCP Inspector testing
4. Evaluation — create 10 complex evaluation questions verifying LLMs can effectively
   use the server

Recommends TypeScript + Streamable HTTP (stateless JSON) for remote servers, stdio for
local servers. Emphasizes tool annotations (readOnlyHint, destructiveHint, idempotentHint).
Includes reference docs: mcp_best_practices.md, python_mcp_server.md, node_mcp_server.md,
evaluation.md, plus links to fetch the official Python/TypeScript MCP SDK READMEs.

---
NOTE: Condensed SKILL.md summary compiled from github.com/anthropics/skills (Apache 2.0).
For the full file with reference/ folder: git clone https://github.com/anthropics/skills.git
