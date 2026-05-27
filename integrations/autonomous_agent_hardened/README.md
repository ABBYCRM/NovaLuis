# Autonomous Agent — Hardened Codebase

A production-oriented autonomous code-repair agent skeleton with:

- layered configuration: YAML, environment variables, and CLI overrides
- structured logs with secret redaction
- bounded subprocess execution
- safe patch application inside a declared workspace
- rule-based analysis that never claims unsupported LLM behavior
- reviewer/critic pass with risk flags
- SQLite memory for run records and artifacts
- git/GitHub helpers that are disabled unless explicitly configured
- test runner and CLI commands

## Install for development

```bash
python -m pip install -e .[dev]
```

## Run checks

```bash
python -m pytest
python -m compileall autonomous_agent
```

## CLI

```bash
agent config
agent analyze --target .
agent verify --target .
agent run --target . --dry-run
```

## Security model

The agent is intentionally conservative. It will not write outside the workspace, will not touch forbidden paths such as `.env` or `secrets/`, redacts common token formats from logs, and does not auto-push or open pull requests unless VCS config explicitly enables those actions.

## OpenClaw-like Agentic Runtime

This build adds an OpenClaw-style loop:

```text
context -> plan -> tool execution -> verification -> correction loop -> audit log
```

Run it:

```bash
agent claw --workspace . --task "fix failing tests" --dry-run
```

Core capabilities:

- Multi-AI backend hooks: `openai`, `anthropic`, `mistral`, `router`, `echo`, `disabled`.
- Tool registry: read file, write file, replace text, search files, run sandboxed commands, verify project, git status, git diff.
- BOS_TRINITY governance kernel: COMMIT/DEFER/REJECT gate before tool execution.
- Recursive correction loop bounded by `agent.max_recursion` and `agent.max_iterations`.
- Persistent SQLite audit records for plans, steps, and run results.

Environment examples:

```bash
export AGENT_LLM_BACKEND=openai
export AGENT_LLM_API_KEY=...
agent claw --workspace . --task "inspect and fix the repo" --no-dry-run
```

No provider is called unless explicitly configured. With `disabled`, the runtime falls back to deterministic safe planning.

## CodeOps Governor autonomy layer

This build includes the `AUTONOMOUS-AI-CODEOPS-GOVERNOR` schema as an executable policy layer. It is wired above the OpenClaw-style runtime and below BOS_TRINITY so repo actions are gated before file writes, GitHub actions, CI monitoring, or deployment claims.

### Commands

```bash
agent codeops preflight --workspace . --autonomy level_1_local_patch
agent codeops run --workspace . --task "verify project" --autonomy level_1_local_patch --dry-run
```

### Autonomy levels

- `level_0_suggest_only`: no file writes, commits, pushes, or PRs.
- `level_1_local_patch`: local file writes only; no commits, pushes, or PRs.
- `level_2_branch_pr`: permits branch/commit/push/PR gates, still blocks direct main pushes.
- `level_3_ci_observer`: adds CI monitoring gates.
- `level_4_deploy_gate`: deployment remains approval-gated and cannot auto-deploy by default.

### Enforced checks

The governor performs path policy, changed-file count, total changed bytes, large-file, secret, private-data, branch, autonomy-level, and deploy approval gates. Runtime audit events are written to `.agent_memory/codeops_audit.jsonl`.

## User Understanding Layer

The agent now includes a non-clinical `user_model` layer that encodes the Psych Alphabet / Luis Ops tree as machine-readable response-planning context.

Commands:

```bash
agent user analyze "FIX IT NOW. Read files, patch, run tests, verify. CBT DBT FOO boundaries."
agent user analyze --file ./notes/user_context.txt
agent user reference --format ascii
```

Runtime wiring:

```text
AgenticRuntime
→ UserUnderstandingEngine.analyze(task)
→ planner prompt receives user_understanding
→ trace logs event=user_context
→ memory stores kind=user_understanding
```

Guardrails:

```text
This module does not diagnose the user or third parties.
It converts user-supplied vocabulary into style, evidence, boundary, and safety constraints.
```

## Ethical Answer Analysis Engine

This build adds `ANSWER_ANALYSIS_ENGINE_OS`, a non-coercive claim/evidence analysis module for human answers. It is designed for fact-finding, intake, compliance, journalism, investigation, and intelligence-analysis style workflows where the agent must preserve dignity and uncertainty.

### Commands

```bash
agent answer analyze "I think he knew, but I am not sure. Maria told me he was there." \
  --question "What happened?" \
  --context "Workplace incident review" \
  --risk-level employment \
  --consent-status explicit

agent answer reference
```

### Runtime tools

The OpenClaw-style tool registry now exposes:

- `analyze_answer` — segments an answer into claim units, evidence status, uncertainty, contradictions/tensions, hidden constraints, incentive map, confidence grade, and fair follow-up questions.
- `answer_analysis_reference` — returns the embedded Answer Analysis Engine OS schema/reference.

### Safety rules

- Statements are claims until verified.
- Psychological signals are hypotheses only, never diagnoses.
- Incentives do not prove dishonesty.
- Nervousness, inconsistency, fear, or shame are not treated as guilt.
- The engine blocks coercive/manipulative requests such as forcing admissions, deception, threats, fake evidence, or pressure tactics.
- Unknown is a valid output.
