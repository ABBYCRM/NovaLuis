---
name: durable-runtime-engineering
description: Design and verify restart-safe autonomous workers, queues, cron systems, leases, idempotency, recovery, cancellation, and long-running agent missions.
metadata: {"openclaw":{"emoji":"♾️"}}
---
<!-- tags: durable, runtime, workers, queues, cron, idempotency, recovery -->

# Durable Runtime Engineering

Use when work must continue after a browser closes, a request disconnects, a process restarts, or a deployment rolls over.

## Core rule

Long-running work must be owned by durable server state, not by the lifetime of an HTTP request, browser tab, mobile app, websocket, or in-memory promise.

A durable mission requires:

- persistent job record;
- explicit lifecycle state;
- independent worker;
- atomic claim/lease;
- idempotent side effects;
- progress heartbeat;
- restart recovery;
- status/read API;
- cancellation path;
- terminal evidence and result storage.

## Lifecycle model

Use explicit states such as:

`pending → claimed → running → verifying → done`

Failure states:

`retryable`, `failed`, `cancelled`, `dead-lettered`, `superseded`.

Every transition must define:

- allowed prior states;
- actor authorized to perform it;
- atomic database condition;
- timestamp and attempt number;
- external side effects;
- retry behavior;
- terminal result or error.

Never overload one status to mean multiple states.

## Claiming and concurrency

Use one of:

- database row lock with `FOR UPDATE SKIP LOCKED`;
- atomic conditional update returning the claimed row;
- advisory lock for a singleton scheduler;
- distributed lease with owner ID and expiration.

A worker must not process a job merely because it read `pending`; it must prove ownership atomically. Renew leases or update progress timestamps during long work.

Assume at-least-once delivery. “Exactly once” requires idempotent effects and reconciliation, not confidence in the queue.

## Idempotency

For each external mutation, persist:

- deterministic operation key or request fingerprint;
- provider/account/target;
- attempt number;
- request state without secrets;
- provider operation ID;
- final result and verification.

Before retrying after timeout or crash, query local and provider state. Never duplicate a social post, email, payment, merge, deployment, or file write because the response was lost.

## Request detachment

Interactive APIs should:

1. validate the request;
2. create the durable job in a transaction;
3. return a job/run ID immediately;
4. allow clients to poll, subscribe, or reconnect;
5. never cancel the worker because the client disconnected.

Normal short conversation may remain streaming. Repository audits, deployments, debug missions, multi-step connected-app work, and explicit background requests should use the durable path.

## Restart and deployment recovery

On worker startup:

- acquire global/scope lock before recovery;
- identify orphaned claimed/running jobs using lease or heartbeat age;
- distinguish live work from abandoned work;
- reset only jobs owned by dead/expired workers;
- resume from persisted checkpoints where possible;
- re-verify external side effects before repeating them.

Deployments must drain or safely terminate workers. A new replica must not race the old replica on the same job.

## Cron and schedulers

A scheduler must be observable and overlap-safe:

- persistent schedule and next-run timestamp;
- timezone documented;
- singleton lock or atomic due-job claims;
- no overlapping tick when a prior tick is active unless intentionally parallel;
- bounded batch size and backpressure;
- missed-run policy after downtime;
- jitter for large fleets;
- runtime status endpoint with last start, finish, success, failure, and error.

Do not rely on browser timers for scheduled actions.

## Heartbeats and stale detection

Update a progress timestamp at meaningful checkpoints. Stale timeout must exceed the longest legitimate no-progress phase and be configurable.

A stale janitor may mark a job failed only when:

- lease/heartbeat has expired;
- no live worker owns it;
- retry or manual intervention policy is known.

Avoid arbitrary short stale windows that kill valid repository or research missions.

## Cancellation

Cancellation must be durable:

- persist `cancel_requested` or terminal `cancelled` state;
- signal the current worker when possible;
- check cancellation between tool calls and long phases;
- stop new side effects;
- preserve partial evidence and rollback instructions;
- never report cancellation as failure or completion.

## Progress and result reconciliation

Clients may close and reopen. Persist result/report server-side and provide:

- `GET /runs/:id` status and result;
- stable run marker in the chat or task record;
- UI polling/reconnect logic;
- terminal replacement of queued messages with verified result;
- error details and retry/cancel options.

Local storage is a display cache, not the authoritative execution state.

## Observability

Record structured events:

- job created and claimed;
- worker/lease owner;
- state transitions;
- tool calls and provider IDs;
- retries and backoff;
- progress checkpoints;
- verification evidence;
- terminal result/error;
- duration and attempt counts.

Expose health separately from business success. A healthy worker can still have failed jobs.

## Testing matrix

Verify:

- client disconnect while work continues;
- process crash and restart recovery;
- duplicate delivery and idempotency;
- two workers racing for one job;
- lease expiry and takeover;
- deployment during execution;
- provider timeout after unknown side effect;
- cancellation during each phase;
- long task beyond normal request timeout;
- UI reopen and result reconciliation;
- cron overlap and missed schedules.

Use real database integration tests for claim semantics.

## NovaLuis invariants

For this repository:

- `work_tree_runs` is authoritative for durable missions;
- `scripts/work-tree-worker.mjs` owns execution when `WORK_TREE_WORKER_ENABLED=1`;
- browser closure must not abort durable repository/debug missions;
- the client receives `[NOVA_RUN_ID:<id>]` and reconciles through `/api/work-tree/runs/:id`;
- social publishing is server-side through embedded/sibling workers;
- DigitalOcean deployment must leave worker, database, public media origin, and live probes operational.

## Final durability gate

Do not report `GO` until a test proves work survives detachment or restart for the affected path, and the exact deployed revision exposes healthy worker/status endpoints.
