#!/usr/bin/env node

// Backward-compatible daemon entrypoint. The audited implementation is split
// across bos-omega-worktree-store/model/engine/worker modules.
await import("./bos-omega-worktree-worker.mjs");
