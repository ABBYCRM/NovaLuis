#!/usr/bin/env node

import { spawn } from "node:child_process";

const children = new Map();
let stopping = false;

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.set(name, child);
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (stopping) return;
    console.error(
      `container-entrypoint: ${name} exited unexpectedly ` +
        `(code=${String(code)} signal=${String(signal)})`,
    );
    void shutdown(code && code !== 0 ? code : 1);
  });
  child.once("error", (error) => {
    console.error(`container-entrypoint: failed to start ${name}: ${error.message}`);
  });
  return child;
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(exitCode || 1);
  }, 5_000);
  deadline.unref();
  await Promise.all(
    [...children.values()].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode != null || child.signalCode != null) resolve();
          else child.once("exit", resolve);
        }),
    ),
  );
  clearTimeout(deadline);
  process.exit(exitCode);
}

start("api-server", "node", ["artifacts/api-server/dist/index.mjs"]);

const workerEnabled =
  process.env.BOS_WORK_TREE_ENABLED !== "0" &&
  Boolean(process.env.DATABASE_URL || process.env.SCRATCHPAD_DATABASE_URL);
if (workerEnabled) {
  start("work-tree-worker", "node", ["scripts/work-tree-worker.mjs"]);
} else {
  console.warn(
    "container-entrypoint: Work Tree worker disabled because BOS_WORK_TREE_ENABLED=0 or DATABASE_URL is missing",
  );
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
