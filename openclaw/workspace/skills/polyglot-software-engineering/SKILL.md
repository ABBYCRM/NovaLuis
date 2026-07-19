---
name: polyglot-software-engineering
description: Professional-grade design, implementation, debugging, testing, and review across TypeScript, JavaScript, Python, C, C++, C#, Rust, SQL, HTML, and CSS.
metadata: {"openclaw":{"emoji":"💻"}}
---
<!-- tags: coding, engineering, typescript, python, cpp, testing, architecture -->

# Polyglot Software Engineering

Use for repository implementation, debugging, refactoring, runtime design, performance work, and code review.

## Engineering sequence

1. Read repository instructions, package manifests, build files, entrypoints, deployment files, schemas, and tests.
2. Map the actual runtime path before editing.
3. Reproduce the defect or define an executable acceptance test.
4. Choose the smallest coherent design that preserves existing contracts.
5. Implement with language-native idioms and explicit error handling.
6. Run formatter/linter only where already established.
7. Typecheck, compile, test, and exercise the real runtime path.
8. Inspect the final diff for accidental deletion, duplication, dead code, secrets, and scope drift.

Do not rewrite an established subsystem merely because another language or framework is preferred.

## Cross-language design rules

- Keep interfaces explicit: input schema, output schema, errors, side effects, concurrency, and ownership.
- Validate at system boundaries; keep internal types strong.
- Separate pure logic from I/O for testability.
- Make retries, timeouts, cancellation, and idempotency visible.
- Preserve backward compatibility unless a migration is intentionally designed and verified.
- Prefer deterministic behavior over hidden magic.
- Avoid global mutable state unless lifecycle and synchronization are explicit.
- Treat logs as evidence: structured, bounded, and free of secrets.

## TypeScript and JavaScript

- Use strict typing; avoid `any` unless isolated at an untyped boundary and immediately narrowed.
- Distinguish `unknown` from trusted values.
- Validate request bodies and external JSON with a schema.
- Preserve ESM/CJS and workspace conventions already used by the repository.
- Await consequential promises or intentionally mark fire-and-forget work with durable error handling.
- Handle stream closure, abort signals, backpressure, and partial responses.
- Test DOM behavior in a real browser when event ordering, mobile layout, PWA, or storage is involved.

Verification: `tsc`, build tool, unit/integration tests, and browser tests where applicable.

## Python

- Use type hints on public functions and data boundaries.
- Prefer dataclasses, enums, protocols, and explicit exceptions over loosely shaped dictionaries.
- Use context managers for files, locks, transactions, and resources.
- Keep async code consistently async; never block an event loop with synchronous I/O.
- Use `pytest` with focused fixtures and deterministic tests.
- Validate packaging, import paths, virtual environment assumptions, and supported Python versions.

Verification: type checker if configured, tests, package build, and direct invocation of the affected path.

## C and C++

- Define ownership and lifetime before writing code.
- Prefer RAII, value semantics, standard containers, smart pointers, and scoped locks in C++.
- Avoid raw owning pointers, unchecked casts, undefined behavior, unbounded buffers, and data races.
- Use `const`, references, spans/views, and explicit error/result types appropriately.
- In C, pair every allocation with a clear owner and cleanup path; check all lengths and return values.
- Preserve ABI, compiler, architecture, and build-system constraints.

Verification should include warnings-as-errors when compatible, unit tests, sanitizers for memory/UB/thread defects, and representative release builds.

## C# and .NET

- Honor nullable reference types and cancellation tokens.
- Dispose `IDisposable`/`IAsyncDisposable` resources correctly.
- Avoid sync-over-async and hidden thread-pool blocking.
- Use dependency injection and options patterns only when consistent with the existing application.
- Validate serialization and database mappings.

Verification: restore, build, test, analyzer output, and affected service execution.

## Rust

- Model invalid states out of the type system where practical.
- Avoid `unsafe`; when unavoidable, document and test the safety invariant.
- Propagate errors with context and use explicit cancellation/timeouts for async work.
- Keep lock scopes short and do not hold synchronous locks across `await`.

Verification: `cargo fmt --check`, `cargo clippy`, tests, and release build where applicable.

## SQL and persistence

- Treat schema changes as migrations, not ad hoc runtime assumptions.
- Use transactions for multi-step invariants.
- Add indexes only with query evidence.
- Prevent duplicate work with unique constraints, locks, leases, or idempotency records.
- Test rollback, restart recovery, and concurrent workers.
- Never interpolate untrusted values into SQL.

## Web UI, HTML, and CSS

- Preserve semantic structure, accessibility, keyboard behavior, touch targets, and responsive layout.
- Avoid duplicate IDs and competing event handlers.
- Prefer additive scoped CSS over global resets in mature interfaces.
- Validate 360/390 mobile, tablet, and desktop widths when the UI is responsive.
- Check overflow, safe areas, keyboard display, focus, modal stacking, and installed-PWA behavior.

## Debugging protocol

- Capture the exact symptom and environment.
- Trace from user action to handler, API, worker, database, provider, and rendered response.
- Find the first incorrect state transition, not the last visible error.
- Add a regression test that fails for the confirmed cause.
- Fix the cause, then test adjacent paths and failure recovery.

## Code review gate

Reject completion when any of the following remains:

- placeholder or stub in a required path;
- swallowed error that hides failure;
- unbounded retry or loop;
- race, duplicate worker, or missing idempotency;
- disabled test or weakened security;
- source passes while runtime path is untested;
- generated or vendored changes unrelated to the mission;
- undocumented breaking API/schema change.

Apply `evidence-first-execution` for the final verdict.

## Primary references

Use current official language documentation and the repository’s pinned toolchain. For C++ follow the ISO C++ Core Guidelines where compatible; for Python use the Python documentation and configured typing/testing tools; for TypeScript use the official TypeScript Handbook and the project’s strict compiler settings.
