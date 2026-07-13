# NOVA Zero-AI

NOVA Zero-AI is a deterministic reconstruction of NOVA's observable runtime behavior. It deliberately removes model inference, provider keys, hidden prompting, probabilistic planning, and fabricated "agent reasoning."

## What it includes

- OpenAI-compatible `/api/v1/chat/completions` endpoint
- Deterministic chat command router
- Persistent exact-value memory
- Work-Tree DAG planning and execution
- Node statuses, retries, cancellation, verification, and reports
- Direct HTTP fetch with SSRF protections
- DuckDuckGo HTML search parser
- Workspace inspection
- Safe mathematical expression parser
- Optional bounded Python, JavaScript, TypeScript, C, C++, and C# runner; C# requires .NET
- Static HTML/CSS validation
- Browser UI with Chat, Work Tree, Memory, and Code Lab; operational events are exposed through `/api/events`
- Zero npm dependencies

## Run

```bash
cd deterministic-nova
node server.mjs
```

Open `http://localhost:10000`.

## Tests

```bash
node --test server.test.mjs
```

## Optional code execution

Code execution is disabled by default.

```bash
ALLOW_CODE_EXEC=1 CODE_EXEC_TIMEOUT_MS=8000 node server.mjs
```

The runner does not invoke a shell. Each program runs in a temporary directory with a timeout and capped output. It is still intended for a controlled, isolated deployment—not a public unauthenticated internet service.

## Render

- Build command: `node --check deterministic-nova/server.mjs && node --test deterministic-nova/server.test.mjs`
- Start command: `node deterministic-nova/server.mjs`
- Health check: `/healthz`
- Runtime: Node 20+

## Explicit limitations

This system can route known commands, execute declared tools, process structured data, fetch evidence, inspect repositories, calculate, remember exact values, and run deterministic workflows. It cannot replace open-ended model capabilities such as novel prose generation, fuzzy semantic interpretation, broad judgment, or unstated-intent inference. Unknown requests fail honestly or become a capability analysis.
