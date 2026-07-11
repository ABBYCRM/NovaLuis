---
name: claude-api
description: Reference skill for building LLM-powered applications with the Claude API and Anthropic SDK. Covers model IDs, pricing, parameters, streaming, tool use, MCP, agents, prompt caching, and token counting. Use when writing code that calls the Anthropic API or SDK.
license: Complete terms in LICENSE.txt
---

Detects the project's language (Python / TypeScript / Java / Go / Ruby / C# / PHP) and
loads matching code examples and SDK patterns. Includes a model-selection decision tree:
single call -> Claude API; needs file/web/terminal access -> Agent SDK; multi-step
orchestration -> API + Tool Use; open-ended agent -> API loop.

Guards against "API drift" (training-time knowledge going stale, e.g. extended thinking
parameter changes) — directs verifying against this skill's own docs before writing code.
Also guards against mixing Anthropic SDK calls into another provider's code.

---
NOTE: Condensed SKILL.md summary compiled from github.com/anthropics/skills (Apache 2.0).
For the full file with language-specific reference docs: git clone https://github.com/anthropics/skills.git
