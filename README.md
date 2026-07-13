# README.md — NOVA

NOVA is the primary personal AI assistant and Work-Tree planner half of a twin architecture. Its operational counter-weight and secondary system is **SUPERNOVA / ABBY** (the multi-agent automation swarm).

* **Live Production (NOVA):** `[https://nova-luis.onrender.com/](https://nova-luis.onrender.com/)` (Fallback: `[https://nova-sszi.onrender.com](https://nova-sszi.onrender.com)`)
* **Live Production (SUPERNOVA):** `[https://supernova-luis.onrender.com/](https://supernova-luis.onrender.com/)` (Fallback: `[https://supernova-ai1.onrender.com](https://supernova-ai1.onrender.com)`)
* **Repository:** `[https://github.com/ABBYCRM/NovaLuis](https://github.com/ABBYCRM/NovaLuis)`
* **Architecture Specification:** [`docs/ARCHITECTURE.md`](https://www.google.com/search?q=docs/ARCHITECTURE.md)

---

## Workspace Layout

This project is managed strictly as a single **pnpm** monorepo workspace:

```
artifacts/nova          Frontend — Vanilla SPA (index.html + public/assets/bob.js)
artifacts/api-server    Express API Server: openai-proxy, voice, knowledge, work-tree
lib/*                   Shared packages (db, api-spec, api-zod, api-client)

```

---

## Twin Orchestration Link

NOVA coordinates deep execution goals with SUPERNOVA via the `SUPERNOVA_BASE_URL` environment variable.

* **Dispatched Workloads:** The Work-Tree planner transfers high-scale agentic operations to the SUPERNOVA swarm endpoint.
* **Frontend Integration:** The "Open Super Nova" button in the SPA interface binds directly to the configured live swarm deployment URL.
* **Authentication & Security:** Inter-system server-to-server validation is enforced strictly via `SUPERNOVA_API_KEY`, paired symmetrically with SUPERNOVA's `OPENCLAW_API_KEY`.

---

## Development & Build Environment

> **System Constraint:** **pnpm** is the exclusive package manager for this codebase. Do not use `npm` or `yarn`. Production secrets are managed solely via the platform deployment dashboard (Render) and must never be committed to source control.

### Installation & System Validation

```bash
# Install exact workspace dependencies
pnpm install

# Run strict monorepo typechecking
pnpm run typecheck

# Build the main backend artifact
pnpm --filter @workspace/api-server run build

```
