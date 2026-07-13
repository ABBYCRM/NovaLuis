#!/usr/bin/env node

import { boundedInt, safeText } from "./bos-omega-core.mjs";
import { engineSummary, processRun } from "./bos-omega-worktree-engine.mjs";
import {
  ADVISORY_LOCK_ID,
  claimPendingRun,
  closeStore,
  ensureTables,
  firstRunningRun,
  governance,
  pool,
  recoverOrphans,
} from "./bos-omega-worktree-store.mjs";
import { routerSummary } from "./super-nova-router.mjs";
import { runtimeSummary } from "./bos-omega-runtime.mjs";

const POLL_MS = boundedInt(process.env.WORK_TREE_POLL_MS, 2_000, 250, 60_000);
let ticking = false;
let stopping = false;

async function tick() {
  if (ticking || stopping) return;
  ticking = true;
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_ID],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return;

    const policy = governance();
    if (!policy.valid || !policy.autonomyEnabled) return;

    const run = (await firstRunningRun()) || (await claimPendingRun(policy.dailyCap));
    if (run) await processRun(run, policy);
  } catch (error) {
    console.error(
      `bos-omega-worktree-worker: tick failed — ${safeText(error?.stack || error?.message || error, 2_000)}`,
    );
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID])
        .catch(() => {});
    }
    client.release();
    ticking = false;
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`bos-omega-worktree-worker: received ${signal}; shutting down`);
  clearInterval(interval);
  const deadline = setTimeout(() => process.exit(1), 5_000);
  deadline.unref();
  await closeStore().catch(() => {});
  clearTimeout(deadline);
  process.exit(0);
}

await ensureTables();
const recovered = await recoverOrphans();
console.log(`bos-omega-worktree-worker: ready — ${routerSummary()}`);
console.log(
  `bos-omega-worktree-worker: recovered=${recovered} poll=${POLL_MS}ms ` +
    `engine=${JSON.stringify(engineSummary())} ` +
    `tools=${runtimeSummary({ authenticated: true, internalWorker: true, approvalGranted: false }).activeTools.length}`,
);
await tick();
const interval = setInterval(() => void tick(), POLL_MS);

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
