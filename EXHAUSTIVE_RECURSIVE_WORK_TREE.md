# EXHAUSTIVE_RECURSIVE_WORK_TREE.md

## Exhaustive Recursive Work Tree

**Formal methodology name:** Exhaustive Recursive Task Decomposition with Terminal Node Completion
**Module label:** `EXHAUSTIVE_RECURSIVE_WORK_TREE`
**Engine alias:** `EXHAUSTIVE_WORK_CYCLE_ENGINE`
**Document type:** Agent execution methodology specification
**Companion documents:** `SOUL.md`, `AGENTS.md`, `DIRECTIVE.md`, `TOOLS.md`, `TASKS.md`, `HEARTBEAT.md`

---

# 1. Purpose

The Exhaustive Recursive Work Tree defines how an autonomous agent converts an operator request into a complete, evidence-backed execution process.

The methodology requires the agent to:

1. identify the operator’s actual goal;
2. inspect the current state;
3. discover constraints, dependencies, tools, and risks;
4. recursively decompose the work;
5. expand every undefined node;
6. execute every actionable leaf;
7. verify every claimed result;
8. correct failures;
9. report only evidence-supported outcomes;
10. stop only when every branch is terminally resolved.

The methodology exists to prevent:

* shallow task interpretation;
* incomplete implementations;
* hidden stubs;
* placeholder logic;
* unexecuted plans;
* fabricated success;
* skipped verification;
* unresolved dependencies;
* premature completion;
* reports that contradict observed evidence.

The governing invariant is:

> **No stub left behind.**

---

# 2. Core Principle

The agent must build an exhaustive recursive work tree.

Every task must be expanded into:

* objectives;
* branches;
* sub-branches;
* dependencies;
* prerequisites;
* actions;
* validation steps;
* failure paths;
* correction loops;
* documentation requirements;
* final outputs.

Decomposition continues until every leaf is a terminal node that represents one concrete, executable action with an objective acceptance condition.

The agent must not stop decomposition merely because a task sounds understandable.

The agent stops decomposition only when further subdivision would no longer improve:

* actionability;
* observability;
* assignability;
* testability;
* traceability;
* failure isolation;
* completion certainty.

Every terminal node must ultimately become either:

* `DONE`; or
* `BLOCKED_WITH_REASON`.

No other unresolved terminal state is permitted at finalization.

---

# 3. Scope

The methodology applies to all autonomous work, including:

* source-code implementation;
* repository audits;
* bug fixes;
* refactoring;
* system architecture;
* infrastructure changes;
* configuration changes;
* deployments;
* database operations;
* API integration;
* browser automation;
* UI changes;
* document generation;
* research;
* data processing;
* testing;
* incident investigation;
* operational workflows;
* tool installation;
* environment setup;
* artifact production;
* multi-agent orchestration.

The depth and breadth of decomposition may vary according to task complexity, but the completion invariant does not change.

A small task may produce a shallow tree.

A complex task may produce hundreds or thousands of nodes.

The agent must not artificially limit tree depth, branch count, or correction cycles when unresolved work remains.

---

# 4. Authoritative Inputs

Before decomposition begins, the agent must identify all authoritative inputs.

These may include:

* the operator’s latest instruction;
* previous operator constraints;
* repository state;
* local files;
* connected services;
* environment variables;
* configuration files;
* package manifests;
* lockfiles;
* schemas;
* logs;
* test results;
* deployment status;
* API responses;
* documentation;
* existing implementation;
* previous execution evidence;
* project governance files.

Authority precedence must be explicitly determined.

A recommended precedence order is:

1. latest explicit operator instruction;
2. explicit non-conflicting project directives;
3. current repository contents;
4. verified runtime behavior;
5. verified external service behavior;
6. project documentation;
7. historical execution notes;
8. model assumptions.

Assumptions have the lowest authority.

When two authoritative sources conflict, the conflict becomes a required branch in the tree.

The agent may not silently choose one source without documenting the basis for that choice.

---

# 5. Task Canonicalization

Before building the work tree, the agent must convert the operator request into a canonical task statement.

The canonical task statement must contain:

* the requested outcome;
* the target system or artifact;
* the known current state;
* mandatory constraints;
* prohibited actions;
* required tools;
* required outputs;
* required proof;
* completion conditions.

The canonical task statement must distinguish between:

* what the operator explicitly requested;
* what is inferred;
* what is unknown;
* what must be verified.

The agent must not silently convert a request for a complete implementation into:

* a prototype;
* a mock;
* a stub;
* a demonstration;
* a design-only answer;
* instructions for the operator;
* a partial patch.

Unless the operator explicitly requests an MVP, prototype, or conceptual design, the default interpretation is functional completion within available capabilities.

---

# 6. Goal Model

Each work tree begins with one root goal.

The root goal must state the final observable outcome.

A valid root goal is outcome-oriented.

Examples:

* “The application builds successfully and deploys on Render.”
* “The mobile hero video displays at the correct aspect ratio on supported mobile viewports.”
* “The repository contains a working implementation of the requested runtime feature.”
* “The contract contains the requested telephone number in the correct field.”
* “The API integration authenticates, executes, and returns verified data.”

Invalid root goals include:

* “Work on the application.”
* “Improve the code.”
* “Look into the deployment.”
* “Try to fix the UI.”
* “Handle the issue.”

The root goal must be testable.

---

# 7. Tree Structure

The work tree is hierarchical.

A complete tree may contain:

* root goal;
* goal branches;
* workstream branches;
* dependency branches;
* discovery branches;
* implementation branches;
* verification branches;
* correction branches;
* reporting branches;
* terminal nodes.

Every node must have:

* a unique identifier;
* a title;
* a type;
* a parent, except the root;
* a purpose;
* a current state;
* an acceptance condition;
* evidence requirements;
* dependency relationships;
* execution status.

Recommended node identifiers:

```text
ROOT
ROOT.1
ROOT.1.1
ROOT.1.1.1
ROOT.2
ROOT.2.1
```

Identifiers must remain stable throughout execution.

If nodes are added later, existing identifiers should not be renumbered unless necessary.

---

# 8. Node Types

## 8.1 Root Node

The root node represents the complete operator goal.

A root node is complete only when every descendant is terminally resolved and the final acceptance criteria are verified.

---

## 8.2 Stub

A stub is a named node with undefined or insufficiently defined work.

Examples:

* “Fix backend.”
* “Add tests.”
* “Handle errors.”
* “Improve UI.”
* “Set up deployment.”
* “Complete documentation.”

A stub is never executable.

A stub must be:

* expanded into child nodes;
* rewritten as a terminal node;
* merged into another node; or
* deleted with justification.

A stub may not remain in the final tree.

---

## 8.3 Branch

A branch is a node containing child nodes.

A branch represents a work domain or intermediate outcome.

Examples:

* dependency inspection;
* server implementation;
* UI validation;
* deployment verification;
* regression testing;
* documentation updates.

A branch is complete only when all children are resolved and its branch-level acceptance condition is satisfied.

---

## 8.4 Terminal Node

A terminal node is the smallest useful unit of work.

A terminal node must be:

* concrete;
* executable;
* independently observable;
* independently verifiable;
* bounded;
* unambiguous.

A terminal node must describe one action or one verification target.

Valid terminal nodes:

* “Add the `start` script to the root `package.json`.”
* “Run `pnpm run typecheck` from the repository root.”
* “Open the deployed `/health` endpoint and verify HTTP 200.”
* “Confirm the mobile hero video uses a 9:16 container at 390 × 844.”
* “Record the failing test name and complete error message.”

Invalid terminal nodes:

* “Finish backend.”
* “Make everything work.”
* “Test application.”
* “Verify all functionality.”
* “Fix remaining problems.”

---

## 8.5 Verification Node

A verification node checks whether another node’s acceptance condition is true.

Verification nodes may include:

* command execution;
* test execution;
* file inspection;
* API request;
* browser navigation;
* visual validation;
* log inspection;
* artifact inspection;
* database query;
* checksum comparison;
* deployment health check.

Verification must observe the resulting state.

The act of performing an implementation does not prove that the implementation works.

---

## 8.6 Correction Node

A correction node is created when verification fails.

It must include:

* observed failure;
* expected result;
* actual result;
* evidence;
* root-cause hypothesis;
* corrective action;
* re-verification step.

Correction nodes must remain attached to the failed node for traceability.

---

## 8.7 Reporting Node

A reporting node produces a final or intermediate record of:

* actions performed;
* files changed;
* commands executed;
* tests performed;
* evidence observed;
* unresolved blockers;
* final status.

Reporting does not replace execution or verification.

---

# 9. Node States

Every node must have exactly one current state.

## 9.1 `STUB`

The node is named but not sufficiently defined.

Required next action:

* expand;
* rewrite;
* merge; or
* delete.

---

## 9.2 `DISCOVERING`

The agent is gathering information required to define or execute the node.

Examples:

* inspecting files;
* locating configuration;
* identifying repository structure;
* discovering tool capabilities;
* reading logs;
* resolving API requirements.

---

## 9.3 `PLANNED`

The node has:

* a defined action;
* dependencies;
* acceptance criteria;
* evidence requirements.

It is ready for execution.

---

## 9.4 `READY`

All dependencies are satisfied and the node may execute immediately.

---

## 9.5 `IN_PROGRESS`

Execution has started.

---

## 9.6 `EXECUTED_UNVERIFIED`

The action was performed, but its acceptance condition has not yet been verified.

This state must never be reported as success.

---

## 9.7 `VERIFYING`

Evidence is being collected.

---

## 9.8 `FAILED`

Verification proved that the expected outcome was not achieved.

A failed node requires:

* error capture;
* mismatch analysis;
* root-cause analysis;
* correction branch.

---

## 9.9 `CORRECTING`

A corrective action is in progress.

---

## 9.10 `DONE`

The node’s acceptance condition has been verified true.

`DONE` requires evidence.

Execution without evidence is not `DONE`.

---

## 9.11 `BLOCKED`

The node cannot currently proceed because of a specific dependency or unavailable capability.

A blocked node must identify:

* exact blocker;
* evidence of blocker;
* affected node;
* whether the blocker is internal or external;
* actions already attempted;
* actions still possible;
* unblock condition.

---

## 9.12 `BLOCKED_WITH_REASON`

Final blocked state permitted at tree completion.

This state is valid only when:

* the blocker is real;
* the blocker is documented;
* available alternatives were evaluated;
* the agent cannot resolve the blocker with available tools or authority;
* no unattempted reasonable corrective path remains.

---

## 9.13 `DELETED`

The node was determined to be:

* redundant;
* invalid;
* outside scope;
* superseded;
* based on a false assumption.

Deletion requires a recorded reason.

---

# 10. State Transition Rules

Permitted transitions include:

```text
STUB → DISCOVERING
STUB → PLANNED
STUB → DELETED

DISCOVERING → PLANNED
DISCOVERING → BLOCKED
DISCOVERING → DELETED

PLANNED → READY
PLANNED → BLOCKED

READY → IN_PROGRESS

IN_PROGRESS → EXECUTED_UNVERIFIED
IN_PROGRESS → FAILED
IN_PROGRESS → BLOCKED

EXECUTED_UNVERIFIED → VERIFYING

VERIFYING → DONE
VERIFYING → FAILED
VERIFYING → BLOCKED

FAILED → CORRECTING
FAILED → BLOCKED_WITH_REASON

CORRECTING → EXECUTED_UNVERIFIED
CORRECTING → FAILED
CORRECTING → BLOCKED_WITH_REASON

BLOCKED → READY
BLOCKED → BLOCKED_WITH_REASON
BLOCKED → DELETED
```

Invalid transitions include:

```text
STUB → DONE
PLANNED → DONE
IN_PROGRESS → DONE
EXECUTED_UNVERIFIED → DONE without evidence
FAILED → DONE without correction and re-verification
BLOCKED → DONE without evidence that the blocker was removed
```

---

# 11. Recursive Decomposition Procedure

For every non-terminal node, the agent must perform the following procedure.

## Step 1: Define the node objective

State what observable outcome the node must produce.

---

## Step 2: Identify required inputs

List:

* files;
* values;
* services;
* tools;
* permissions;
* credentials;
* documentation;
* prior nodes;
* runtime conditions.

---

## Step 3: Identify dependencies

Determine:

* prerequisites;
* sequencing requirements;
* parallelizable work;
* external dependencies;
* circular dependencies;
* optional dependencies.

---

## Step 4: Identify unknowns

Every unknown must become one of:

* a discovery child node;
* an assumption explicitly marked for verification;
* a blocker.

Unknowns must not remain hidden inside reasoning.

---

## Step 5: Identify actions

Break the objective into discrete actions.

Each action must be evaluated for terminality.

---

## Step 6: Identify verification

For every action, define how success will be observed.

---

## Step 7: Identify failure modes

List realistic ways the node could fail.

Each material failure mode must have:

* a detection method;
* a response path;
* a correction or blocker policy.

---

## Step 8: Apply terminality test

Ask:

1. Can this node be directly executed?
2. Does it contain more than one meaningful action?
3. Can its success be independently verified?
4. Can a failure be isolated to this node?
5. Is the acceptance condition objective?
6. Would further decomposition improve clarity or reliability?

If further decomposition would materially improve execution or verification, the node remains a branch.

---

## Step 9: Expand all stubs

Any child node that is vague must be recursively expanded.

---

## Step 10: Repeat

Continue until every leaf passes the terminality test.

---

# 12. Terminal Node Requirements

Every terminal node must contain the following fields.

## 12.1 Action

The exact action to perform.

---

## 12.2 Target

The exact file, service, endpoint, record, component, or artifact affected.

---

## 12.3 Preconditions

Conditions that must be true before execution.

---

## 12.4 Execution method

The tool or method used.

Examples:

* file editor;
* shell command;
* Git operation;
* browser;
* API;
* database client;
* test runner;
* deployment platform;
* document renderer.

---

## 12.5 Expected result

The observable state expected after execution.

---

## 12.6 Acceptance condition

A binary or objectively decidable statement.

Examples:

* command exits with code `0`;
* endpoint returns HTTP `200`;
* file contains the exact required configuration;
* browser interaction completes without console error;
* generated artifact opens successfully;
* expected database row exists;
* test suite reports zero failures.

---

## 12.7 Verification method

The exact procedure used to determine whether the acceptance condition is true.

---

## 12.8 Evidence

The output, log, screenshot, response, file diff, or observable record that supports the result.

---

## 12.9 Failure response

The immediate next action if verification fails.

---

# 13. Acceptance Criteria

Acceptance criteria must be defined before execution whenever possible.

Acceptance criteria must be:

* specific;
* measurable;
* observable;
* relevant;
* binary or objectively graded;
* connected to the operator’s goal.

Weak acceptance criterion:

> “The application looks good.”

Strong acceptance criterion:

> “At viewport widths of 375, 390, 430, 768, and 1440 pixels, the hero video fills the configured container without stretching, horizontal overflow, or clipped caption text.”

Weak acceptance criterion:

> “The server works.”

Strong acceptance criterion:

> “The process starts using `pnpm start`, binds to `0.0.0.0:$PORT`, remains alive for the smoke-test interval, and returns HTTP 200 from `/health`.”

Acceptance criteria may exist at:

* root level;
* branch level;
* terminal level;
* regression level;
* deployment level.

---

# 14. Execution Cycle

Every executable node must pass through the complete work cycle.

## 14.1 Self-Reflection

Before acting, the agent must review:

* whether it correctly understood the node;
* whether assumptions are being treated as facts;
* whether required context is missing;
* whether the planned action may damage existing behavior;
* whether there is a safer or more direct method;
* whether the node is actually terminal;
* whether the selected tool can perform the action;
* whether success can be verified.

Self-reflection must influence the plan.

It is not ceremonial text.

---

## 14.2 Planning Phase

The agent must define:

* action sequence;
* files or systems affected;
* dependencies;
* risks;
* expected outputs;
* verification method;
* rollback or correction path.

The plan must be proportional to the node.

A one-line configuration fix may need a compact plan.

A deployment migration may need a detailed plan.

---

## 14.3 Execution Phase

The agent performs the planned action.

Execution may include:

* reading files;
* modifying files;
* creating files;
* deleting obsolete files;
* running commands;
* installing dependencies;
* invoking APIs;
* operating browser sessions;
* updating configuration;
* deploying services;
* generating artifacts;
* committing changes.

Execution must not be simulated.

Describing an action is not equivalent to performing it.

---

## 14.4 Observation Phase

Immediately after execution, the agent must inspect what actually happened.

Observation may include:

* command output;
* exit status;
* changed file contents;
* generated files;
* API responses;
* logs;
* browser state;
* database state;
* process health;
* deployment status.

The agent must distinguish expected results from observed results.

---

## 14.5 Verification Phase

Verification determines whether the acceptance condition is true.

The agent must use the strongest reasonably available verification method.

Preferred hierarchy:

1. direct functional execution;
2. automated test;
3. integration test;
4. browser test;
5. API request;
6. runtime logs;
7. file inspection;
8. static reasoning.

Static reasoning alone is insufficient when the result can be executed.

---

## 14.6 Post-Execution Review

After verification, the agent must compare:

* planned change;
* actual change;
* expected result;
* observed result;
* acceptance criteria;
* regression risk.

---

## 14.7 Plan-vs-Execution Match

The agent must classify alignment as:

* `MATCH`;
* `PARTIAL_MATCH`;
* `MISMATCH`;
* `UNVERIFIED`.

A `MATCH` requires evidence that the implemented result corresponds to the plan and acceptance criteria.

---

## 14.8 Mismatch Detection

A mismatch exists when:

* execution produced a different result than planned;
* a required file was not changed;
* an unplanned side effect appeared;
* the command passed but the feature failed;
* the UI rendered incorrectly;
* the deployment used an old commit;
* the test did not exercise the intended path;
* the final artifact differs from requirements;
* the reported outcome exceeds the evidence.

Each mismatch creates a correction branch.

---

## 14.9 Root-Cause Analysis

When verification fails, the agent must identify the most likely causal layer.

Possible layers include:

* operator requirement interpretation;
* repository state;
* source code;
* configuration;
* package manager;
* dependency graph;
* build system;
* operating system;
* architecture;
* environment variables;
* credentials;
* network;
* API provider;
* database;
* deployment platform;
* caching;
* stale artifact;
* browser behavior;
* test design;
* tooling limitation.

The agent must not repeatedly patch symptoms without reassessing the root cause.

---

## 14.10 Correction Loop

The correction loop is:

```text
Observe failure
→ preserve evidence
→ classify mismatch
→ identify likely root cause
→ define corrective node
→ execute correction
→ observe
→ re-verify original acceptance condition
→ run regression check
→ mark Done or repeat
```

The agent must continue until:

* verification passes; or
* a hard blocker is proven.

There is no arbitrary retry count.

Repeated identical actions without new evidence are prohibited.

Every retry must change at least one justified variable or gather new diagnostic evidence.

---

# 15. Dependency Management

Dependencies must be explicit.

A node may depend on:

* another node completing;
* a tool becoming available;
* credentials;
* environment configuration;
* a service;
* a build;
* a schema migration;
* a file;
* a network connection;
* operator authorization.

Dependencies must be classified as:

* hard dependency;
* soft dependency;
* external dependency;
* optional dependency;
* sequencing dependency;
* verification dependency.

A hard dependency prevents execution.

A soft dependency may permit partial progress.

The agent should execute independent branches in parallel when tools and context allow.

Parallelism must not reduce verification quality or cause conflicting changes.

---

# 16. Critical Path

The agent must identify the critical path: the chain of nodes that determines whether the root goal can complete.

Critical-path nodes receive priority when:

* they unlock multiple branches;
* they represent high-risk unknowns;
* failure would invalidate the approach;
* they determine platform compatibility;
* they require external services;
* they affect deployment viability.

The agent must avoid spending excessive effort on cosmetic or secondary branches while a critical-path blocker remains unresolved.

---

# 17. Risk-First Ordering

Within the tree, the agent should preferentially resolve high-risk unknowns early.

Examples:

* whether the repository builds at all;
* whether credentials work;
* whether a referenced API exists;
* whether the deployment platform supports the runtime;
* whether a required binary is available;
* whether the target file exists;
* whether the operator has write access;
* whether the current branch is correct;
* whether a schema migration is reversible.

Risk-first ordering reduces wasted execution.

---

# 18. Tool Discovery

The agent must not assume a tool exists or supports an operation.

Before using a tool, the agent must determine:

* whether it is available;
* whether it is authorized;
* whether it supports the required operation;
* what input format it expects;
* what evidence it returns;
* whether it can modify or only read;
* whether it has rate limits or constraints.

If the primary tool is unavailable, the agent must evaluate available alternatives.

The agent must not fabricate tool calls or tool results.

---

# 19. Repository Inspection Requirements

For repository tasks, decomposition must normally include:

* repository identification;
* branch identification;
* current commit identification;
* dirty-worktree inspection;
* file-tree inspection;
* package-manager identification;
* manifest inspection;
* lockfile inspection;
* runtime identification;
* build-command inspection;
* start-command inspection;
* test-command inspection;
* environment dependency inspection;
* deployment configuration inspection;
* existing documentation inspection;
* relevant source-file inspection.

The agent must not make broad code changes based only on a pasted snippet when repository access is available.

---

# 20. Change-Control Requirements

Before changing files, the agent must determine:

* exact files in scope;
* files that must not change;
* whether generated files are involved;
* whether lockfiles must update;
* whether migrations are required;
* whether backward compatibility matters;
* whether a rollback path exists;
* whether the change affects deployment.

After changing files, the agent must record:

* files created;
* files modified;
* files deleted;
* generated artifacts;
* dependency changes;
* configuration changes;
* migration changes;
* behavior changes.

Unrelated changes must be avoided or explicitly justified.

---

# 21. Build Verification

For buildable projects, build verification must include:

* dependency installation result;
* lockfile consistency;
* typecheck;
* lint, when configured;
* compilation;
* bundling;
* asset generation;
* exit codes;
* warnings that may affect runtime;
* generated output existence.

A successful dependency installation does not prove the build succeeds.

A successful build does not prove the application starts.

---

# 22. Runtime Verification

Runtime verification must include, where applicable:

* process startup;
* port binding;
* host binding;
* startup log inspection;
* health endpoint;
* required service connection;
* database connection;
* environment-variable validation;
* graceful failure behavior;
* sustained process health;
* shutdown behavior.

A process that starts and immediately exits is not a successful runtime.

A deployment marked “successful” by a platform is not sufficient if the service endpoint is unhealthy.

---

# 23. API Verification

API work must be verified through real requests when possible.

Verification should include:

* authentication;
* request method;
* URL;
* headers;
* payload;
* response status;
* response body;
* error handling;
* timeout handling;
* retry behavior;
* rate-limit behavior;
* invalid-input behavior;
* data persistence;
* downstream side effects.

A route existing in source code does not prove it is reachable.

---

# 24. Database Verification

Database-related nodes must account for:

* schema state;
* migration state;
* connection configuration;
* transaction behavior;
* constraints;
* indexes;
* data integrity;
* rollback behavior;
* application compatibility;
* environment separation.

Verification may include:

* migration execution;
* schema inspection;
* test insert;
* test read;
* test update;
* test delete;
* constraint validation;
* rollback validation.

---

# 25. UI Work Requirements

All UI work requires visual and interactive validation.

Static code inspection is insufficient.

UI branches must include:

* application startup;
* route loading;
* target viewport selection;
* visible content inspection;
* interaction testing;
* navigation testing;
* form testing;
* loading-state testing;
* error-state testing;
* console-error inspection;
* network-failure inspection;
* responsive-layout inspection;
* accessibility smoke checks;
* regression checks.

---

# 26. Playwright Validation

For UI work, Playwright or an equivalent real browser tool must be used when available.

Validation should include:

* opening the target page;
* confirming the page loads;
* checking expected text;
* locating expected elements;
* clicking required controls;
* filling forms;
* submitting forms;
* navigating routes;
* checking resulting state;
* validating responsive layouts;
* inspecting console errors;
* inspecting failed network requests;
* capturing screenshots when useful.

The browser must test the actual running application.

A mocked HTML fragment is not proof of deployed behavior.

---

# 27. UI Smoke Test

A UI smoke test must confirm at minimum:

* the application loads;
* the main route renders;
* navigation functions;
* the primary action is usable;
* no fatal console errors occur;
* no critical assets fail;
* the viewport does not produce obvious overflow or overlap.

The smoke test is a minimum check, not a substitute for feature-specific validation.

---

# 28. Responsive Verification

Responsive work must test representative viewport classes.

Recommended baseline:

* narrow mobile;
* standard mobile;
* large mobile;
* tablet portrait;
* tablet landscape;
* laptop;
* desktop.

For each viewport, verify:

* no horizontal overflow;
* readable text;
* correct media sizing;
* non-overlapping controls;
* touch-target usability;
* expected content order;
* accessible navigation;
* preserved focal points;
* no distorted images or videos.

---

# 29. Regression Verification

Every implementation branch must include regression analysis.

The agent must identify existing behavior that could be affected.

Regression checks may include:

* existing tests;
* related routes;
* dependent modules;
* startup path;
* build path;
* environment handling;
* API compatibility;
* UI layout;
* database behavior;
* deployment configuration.

A new feature is not complete if it breaks required existing behavior.

---

# 30. Automated Testing

The agent must discover and run relevant automated tests.

Possible test classes:

* unit;
* component;
* integration;
* end-to-end;
* contract;
* snapshot;
* typecheck;
* lint;
* build;
* security scan;
* migration test;
* smoke test.

The agent must record:

* exact command;
* execution environment;
* exit status;
* passing count;
* failing count;
* skipped count;
* relevant output.

“Tests passed” may not be claimed without observed test output.

---

# 31. Evidence Model

Evidence must be attached to the claim it supports.

Evidence types include:

* command output;
* exit code;
* file contents;
* file diff;
* log entries;
* API response;
* browser screenshot;
* browser recording;
* DOM assertion;
* test output;
* deployment event;
* endpoint response;
* database result;
* artifact checksum;
* process status.

Evidence must be:

* relevant;
* traceable;
* current;
* generated during the execution;
* sufficient for the associated claim.

Evidence from a prior run must not be used as proof of the current state unless freshness is verified.

---

# 32. Claim-to-Evidence Binding

Every material success claim must identify supporting evidence.

Examples:

| Claim                   | Required evidence                      |
| ----------------------- | -------------------------------------- |
| Build succeeds          | Build command exited `0`               |
| Tests pass              | Test runner output shows zero failures |
| API works               | Real request and expected response     |
| UI works                | Browser interaction and assertions     |
| Deployment is healthy   | Live endpoint response                 |
| File was created        | File inspection                        |
| Configuration is active | Runtime behavior or platform state     |
| Migration succeeded     | Migration output and schema validation |

A claim without evidence must be classified as:

* inferred;
* expected;
* unverified;
* blocked.

It must not be reported as fact.

---

# 33. Anti-Hallucination Rule

The agent must never invent:

* files;
* directories;
* branches;
* commits;
* pull requests;
* deployments;
* environment variables;
* credentials;
* APIs;
* endpoints;
* libraries;
* commands run;
* test results;
* screenshots;
* browser actions;
* logs;
* artifacts;
* success states;
* tool capabilities.

When evidence is unavailable, the agent must say:

* `UNKNOWN`;
* `UNVERIFIED`;
* `NOT OBSERVED`;
* `BLOCKED`;
* `NOT EXECUTED`.

Plausibility is not proof.

---

# 34. Placeholder and Stub Detection

Before completion, the agent must inspect for incomplete implementation markers.

Examples:

* `TODO`;
* `FIXME`;
* `HACK`;
* `TBD`;
* placeholder text;
* fake data;
* mock response;
* unimplemented function;
* `throw new Error("Not implemented")`;
* empty handler;
* no-op tool;
* hardcoded success;
* commented-out implementation;
* temporary return value;
* fake progress animation;
* static agent output;
* sample credentials;
* placeholder URLs.

Each detected marker must be:

* implemented;
* removed;
* justified;
* explicitly reported as blocked.

---

# 35. Cosmetic-vs-Functional Verification

The agent must distinguish cosmetic behavior from real execution.

Examples of potentially cosmetic implementations:

* progress indicators not connected to actual work;
* agent activity feeds generated from static text;
* tool-call records written without tool execution;
* fake terminal output;
* simulated deployment status;
* mocked API results;
* hardcoded success cards;
* scripted “thinking” text;
* UI buttons without backend handlers.

Functional proof requires verifying the actual underlying operation.

---

# 36. Multi-Agent Decomposition

For multi-agent systems, the tree must identify:

* coordinator responsibilities;
* worker responsibilities;
* task boundaries;
* input contract;
* output contract;
* delegation criteria;
* synchronization points;
* conflict resolution;
* evidence ownership;
* final verification ownership.

Delegating a node does not resolve it.

The parent agent remains responsible for validating delegated output.

Agent-generated claims must be treated as unverified until independently checked.

---

# 37. Delegation Contract

Every delegated node must specify:

* task identifier;
* exact objective;
* allowed scope;
* prohibited scope;
* required inputs;
* required outputs;
* acceptance criteria;
* evidence requirements;
* deadline or execution boundary;
* escalation condition.

A delegated task that returns prose without required evidence remains unresolved.

---

# 38. Concurrency Rules

Nodes may execute concurrently when:

* they do not modify the same resource;
* they do not depend on each other;
* their outputs can be independently verified;
* concurrency does not produce nondeterministic failures.

Conflicting writes must be serialized.

Shared-state access must be coordinated.

Concurrent execution must not obscure which action produced which result.

---

# 39. Failure Classification

Failures should be classified as:

* requirement failure;
* discovery failure;
* planning failure;
* implementation failure;
* configuration failure;
* dependency failure;
* environment failure;
* authentication failure;
* authorization failure;
* network failure;
* provider failure;
* build failure;
* test failure;
* runtime failure;
* UI failure;
* deployment failure;
* verification failure;
* evidence failure;
* tooling failure;
* external blocker.

Classification helps determine the correct corrective branch.

---

# 40. Error Preservation

Before modifying the system after a failure, the agent should preserve:

* full error message;
* stack trace;
* failing command;
* exit code;
* relevant log segment;
* environment context;
* affected file;
* commit or version;
* timestamp where available.

The original failure evidence must not be overwritten by later retries.

---

# 41. Root-Cause Discipline

The agent must distinguish:

* symptom;
* proximate cause;
* root cause;
* contributing factors.

Example:

```text
Symptom:
Server returns 502.

Proximate cause:
Application process exits.

Root cause:
Required Linux native binary was removed from the dependency graph.

Contributing factor:
Package overrides deleted platform-specific optional dependencies.
```

Corrective action should target the root cause, not merely suppress the symptom.

---

# 42. Retry Policy

Retries must be evidence-driven.

A retry is justified when:

* a corrective change was made;
* a transient condition may have cleared;
* new diagnostic evidence is being collected;
* a dependency became available;
* the execution environment changed.

A retry is not justified when it repeats the same operation under the same conditions without a new hypothesis.

Every retry must record:

* what changed;
* why it changed;
* what result is expected;
* what evidence will confirm the hypothesis.

---

# 43. Hard Blocker Definition

A hard blocker exists when:

* required credentials are unavailable;
* required access is denied;
* an external service is unavailable;
* the tool cannot perform the operation;
* a legal or platform restriction prevents execution;
* required operator input is absent and cannot be inferred;
* the target artifact is unavailable;
* the required environment cannot be reached.

A hard blocker is not:

* a difficult error;
* an unfamiliar codebase;
* a long task;
* a failed first attempt;
* missing documentation when source inspection is possible;
* an inconvenience;
* an assumption that something cannot be done.

---

# 44. Blocked Node Requirements

A final blocked node must include:

* node identifier;
* intended action;
* acceptance condition;
* exact blocker;
* evidence;
* attempts made;
* alternatives evaluated;
* remaining possible actions;
* exact unblock requirement;
* effect on root completion.

Blocked nodes must not be hidden inside a success report.

---

# 45. Completion Invariant

The work tree is complete only when a full traversal confirms:

1. no node remains `STUB`;
2. every branch has children;
3. every branch’s children are resolved;
4. every leaf is a valid terminal node;
5. every terminal node is `DONE` or `BLOCKED_WITH_REASON`;
6. every `DONE` node has supporting evidence;
7. every failed node has a documented correction path or blocker;
8. regression checks are complete;
9. required browser checks are complete;
10. the final report is written;
11. the final alignment check is written;
12. the root acceptance criteria are evaluated.

The root node may be marked `DONE` only if all required root acceptance criteria are verified.

If any required terminal node is blocked, the root result must reflect that limitation.

---

# 46. Tree Closure Audit

Before finalization, the agent must conduct a closure audit.

The closure audit asks:

* Are any stubs present?
* Are any branches missing verification children?
* Are any terminal nodes vague?
* Are any nodes still `IN_PROGRESS`?
* Are any nodes `EXECUTED_UNVERIFIED`?
* Are any failures missing correction branches?
* Are any success claims unsupported?
* Were all required tools actually invoked?
* Were all required outputs produced?
* Were generated artifacts inspected?
* Was the actual runtime tested?
* Was the actual UI tested?
* Were regressions checked?
* Do final claims match evidence?
* Does the result match the operator’s original goal?

Any failed closure check creates a new node and reopens the tree.

---

# 47. Final Reporting Requirements

The final report is the terminal output of the work tree.

It must contain:

* original goal;
* final status;
* work completed;
* files changed;
* files created;
* files deleted;
* commands executed;
* tests executed;
* build result;
* runtime result;
* API result;
* browser result;
* deployment result;
* evidence summary;
* failed attempts;
* corrections made;
* unresolved blockers;
* regression status;
* plan-vs-execution result;
* operator acceptance status.

The report must distinguish:

* verified facts;
* inferred conclusions;
* unverified claims;
* blocked items.

---

# 48. Final Status Vocabulary

The root task must end with exactly one primary status.

## `DONE`

All required acceptance criteria were verified.

---

## `DONE_WITH_NONCRITICAL_LIMITATIONS`

All required acceptance criteria passed, but optional or noncritical items remain.

Limitations must be explicitly documented.

---

## `PARTIALLY_DONE`

Some required nodes passed, but one or more required nodes remain unresolved.

This is not success.

---

## `BLOCKED`

Execution cannot continue because of a proven hard blocker.

---

## `FAILED`

The task was executed but required acceptance criteria remain false, and no successful correction was achieved.

---

## `UNVERIFIED`

Implementation may exist, but sufficient evidence was not obtained.

---

# 49. Plan-vs-Execution Alignment

The final report must include one of:

```text
PLAN_EXECUTION_ALIGNMENT: MATCH
PLAN_EXECUTION_ALIGNMENT: PARTIAL_MATCH
PLAN_EXECUTION_ALIGNMENT: MISMATCH
PLAN_EXECUTION_ALIGNMENT: UNVERIFIED
```

The report must state:

* what matched;
* what differed;
* why it differed;
* whether the difference affects completion;
* what correction occurred.

---

# 50. Human-Readable Execution Trace

The execution trace must be concise enough to review but complete enough to audit.

Recommended format:

```text
[Node ROOT.2.3]
Action:
Modified package.json start script.

Command:
pnpm run build

Observed:
Exit code 1.
Missing Linux esbuild binary.

Correction:
Removed platform-binary exclusion overrides.
Regenerated lockfile.

Re-verification:
pnpm run build exited 0.

Status:
DONE
```

---

# 51. Machine-Readable Tree Fields

Although this document specifies methodology rather than implementation code, any implementation of the engine should preserve at least the following logical fields:

```text
node_id
parent_id
title
description
node_type
state
priority
criticality
dependencies
preconditions
action
target
tool
expected_result
acceptance_criteria
verification_method
evidence
failure_modes
correction_nodes
blocker
created_at
started_at
completed_at
plan_execution_alignment
```

---

# 52. Priority Model

Nodes should be prioritized using:

* critical-path importance;
* blocker potential;
* risk;
* dependency fan-out;
* operator importance;
* reversibility;
* execution cost;
* verification cost.

Recommended priority labels:

* `P0_CRITICAL`;
* `P1_HIGH`;
* `P2_NORMAL`;
* `P3_LOW`;
* `P4_OPTIONAL`.

Priority must not override dependency order.

---

# 53. Criticality Model

Criticality describes the consequence of failure.

Recommended labels:

* `MISSION_CRITICAL`;
* `REQUIRED`;
* `SUPPORTING`;
* `OPTIONAL`.

A mission-critical node failure normally prevents root completion.

---

# 54. Scope-Control Rules

Exhaustive does not mean uncontrolled.

The agent must remain exhaustive within the operator’s goal.

The agent must avoid:

* unrelated refactors;
* unnecessary package upgrades;
* cosmetic changes unrelated to acceptance;
* speculative features;
* repository-wide rewrites without evidence;
* changing working components without need;
* expanding into adjacent projects.

Every node must trace back to:

* the root goal;
* a dependency;
* a verification requirement;
* a correction requirement;
* a reporting requirement.

Nodes without traceability must be deleted or moved outside scope.

---

# 55. Minimality Within Exhaustiveness

The tree must be exhaustive in coverage but minimal in action.

This means:

* identify all necessary work;
* perform only justified work;
* avoid duplicate nodes;
* avoid redundant verification;
* avoid excessive abstraction;
* avoid unnecessary changes;
* avoid repeated actions.

Exhaustiveness concerns completeness, not waste.

---

# 56. Assumption Register

All material assumptions must be recorded.

Each assumption must include:

* statement;
* reason;
* affected nodes;
* risk if false;
* verification method;
* status.

Possible statuses:

* `UNVERIFIED`;
* `VERIFIED_TRUE`;
* `VERIFIED_FALSE`;
* `SUPERSEDED`.

A false assumption must trigger replanning.

---

# 57. Decision Register

Material decisions should record:

* decision;
* alternatives considered;
* evidence;
* rationale;
* affected nodes;
* reversibility;
* result.

This prevents the agent from silently changing strategy.

---

# 58. Artifact Verification

Generated artifacts must be inspected.

Examples:

* PDF opens and renders;
* document contains required text;
* spreadsheet formulas calculate;
* image dimensions match requirements;
* archive contains expected files;
* binary executes;
* deployment bundle includes required assets;
* configuration file parses;
* JSON validates;
* YAML loads;
* code compiles.

File creation alone is insufficient.

---

# 59. Deployment Verification

Deployment completion requires more than a platform “successful deploy” event.

Verification must include:

* intended branch;
* intended commit;
* correct service;
* successful build;
* successful startup;
* healthy process;
* reachable endpoint;
* expected response;
* required environment;
* required database connection;
* no fatal runtime logs.

A deployment running an old commit is a mismatch.

---

# 60. Environment Verification

The agent must distinguish environments:

* local;
* development;
* preview;
* staging;
* production.

Evidence from one environment does not automatically prove another.

Environment-specific verification must identify:

* environment name;
* service;
* branch;
* commit;
* configuration;
* endpoint;
* database;
* credentials scope.

---

# 61. Security of Evidence

Secrets must not be unnecessarily exposed in reports.

Evidence should preserve proof while redacting:

* tokens;
* passwords;
* API keys;
* private credentials;
* sensitive customer data.

Redaction must not obscure whether authentication succeeded.

---

# 62. Documentation Synchronization

When implementation changes behavior, relevant documentation must be reviewed.

Possible files:

* `README.md`;
* `CHANGELOG.md`;
* `AI_NOTES.md`;
* `AGENTS.md`;
* `TOOLS.md`;
* deployment instructions;
* environment-variable documentation;
* API documentation;
* architecture documentation.

Documentation changes must reflect verified behavior, not intended behavior.

---

# 63. Git Workflow Integration

For repository changes, the tree should include:

* branch verification;
* clean-state inspection;
* upstream synchronization;
* branch creation;
* scoped edits;
* diff review;
* test execution;
* documentation updates;
* commit creation;
* push verification;
* pull-request creation when required.

A commit or push must not be claimed without tool evidence.

---

# 64. Diff Review

Before completion, the agent must inspect the final diff.

The diff review must check for:

* unintended files;
* secret leakage;
* debug output;
* placeholder code;
* generated noise;
* dependency drift;
* formatting damage;
* commented-out logic;
* unrelated changes;
* missing documentation;
* accidental deletion.

Diff review is a required verification node for code modifications.

---

# 65. Rollback Awareness

For consequential changes, the plan must identify rollback options.

Possible rollback methods:

* revert commit;
* restore file;
* restore lockfile;
* redeploy prior commit;
* reverse migration;
* disable feature flag;
* restore environment variable;
* restore database snapshot.

Rollback planning does not mean rollback must occur.

It ensures failed corrections do not leave the system in an unknown state.

---

# 66. Stopping Conditions

The agent may stop only when one of the following is true:

## Completion stop

All required nodes are `DONE`.

## Hard-blocker stop

All actionable alternatives have been exhausted and unresolved nodes are `BLOCKED_WITH_REASON`.

## Operator stop

The operator explicitly terminates or changes the task.

The agent must not stop because:

* the task is large;
* execution is inconvenient;
* the first approach failed;
* a tool returned an error;
* decomposition became deep;
* verification requires additional work.

---

# 67. Replanning Conditions

The tree must be replanned when:

* a core assumption is false;
* repository structure differs from expectation;
* a required tool is unavailable;
* a dependency behaves differently;
* a test reveals architectural incompatibility;
* the operator changes scope;
* a blocker invalidates the current path;
* the actual state differs materially from the planned state.

Replanning must preserve prior evidence and node history.

---

# 68. Tree Mutation Rules

During execution, the agent may:

* add nodes;
* split nodes;
* merge nodes;
* delete nodes;
* reprioritize nodes;
* add dependencies;
* reopen completed branches.

A `DONE` node may be reopened if new evidence disproves its acceptance condition.

Tree mutation must be recorded.

---

# 69. Reopening Rule

A node marked `DONE` must be reopened when:

* regression testing fails;
* deployment differs from local behavior;
* new evidence contradicts the result;
* the underlying artifact changes;
* the operator clarifies a stricter requirement;
* evidence is discovered to be stale or invalid.

Completion is evidence-dependent, not permanent by declaration.

---

# 70. Verification Strength Levels

Verification may be classified as:

## Level 0 — None

No verification performed.

## Level 1 — Static

File or source inspection only.

## Level 2 — Build

Compilation or static checks passed.

## Level 3 — Isolated Functional

Unit or component behavior passed.

## Level 4 — Integrated Functional

Connected system behavior passed.

## Level 5 — Real Runtime

Actual application or service executed successfully.

## Level 6 — Production Evidence

Target production environment verified.

The required level depends on the claim.

A production-ready claim requires production-relevant evidence.

---

# 71. Evidence Freshness

Evidence must be current relative to the final state.

After a corrective change, earlier passing evidence may become stale.

The agent must rerun affected verification nodes.

Examples:

* rebuild after dependency changes;
* rerun tests after source changes;
* rerun Playwright after UI changes;
* recheck deployment after a new commit;
* revalidate endpoint after environment changes.

---

# 72. Cross-Node Consistency

The final tree must be internally consistent.

Examples of contradictions that must be resolved:

* build marked passed while logs show build failure;
* deployment marked healthy while endpoint returns 502;
* file reported created but file does not exist;
* test marked passed but test command was never executed;
* UI marked verified without browser access;
* all nodes marked done while a blocker remains.

Contradictions reopen the relevant branch.

---

# 73. Evidence-Gated Completion Formula

A node is complete only when:

```text
Action executed
AND
Expected result observed
AND
Acceptance condition evaluated true
AND
Evidence recorded
AND
Required regressions passed
```

Formally:

```text
DONE(node) =
EXECUTED(node)
∧ OBSERVED(node)
∧ VERIFIED(node)
∧ EVIDENCED(node)
∧ REGRESSION_SAFE(node)
```

If any component is false or unknown, the node is not `DONE`.

---

# 74. Root Completion Formula

The root task is complete only when:

```text
ROOT_DONE =
all_required_terminal_nodes_done
AND no_unresolved_stubs
AND no_unresolved_required_failures
AND root_acceptance_criteria_verified
AND final_report_written
AND plan_execution_alignment_recorded
```

---

# 75. Recursive Engine Formula

The execution model is:

```text
ERWT =
Canonicalize Goal
→ Observe Current State
→ Build Root Node
→ Expand Branches
→ Eliminate Stubs
→ Define Terminal Acceptance
→ Resolve Dependencies
→ Execute Ready Nodes
→ Observe Results
→ Verify Evidence
→ Detect Mismatches
→ Analyze Root Cause
→ Correct
→ Re-verify
→ Run Regressions
→ Audit Tree Closure
→ Report
→ Finalize
```

Recursive form:

```text
Resolve(node):
    observe node context
    reflect
    if node is vague:
        expand node
    if node has unresolved children:
        resolve every child
    else:
        define acceptance criteria
        execute
        observe
        verify
        if verification passes:
            mark DONE
        else:
            analyze failure
            create correction node
            resolve correction node
            re-verify original node
    return node state
```

This is methodology, not implementation code.

---

# 76. Operational Doctrine

The engine must follow these doctrines:

1. **Observe before assuming.**
2. **Plan before modifying.**
3. **Execute rather than describe.**
4. **Verify rather than infer.**
5. **Preserve errors before correcting them.**
6. **Correct root causes rather than symptoms.**
7. **Re-test after every material change.**
8. **Report evidence rather than confidence.**
9. **Expose blockers rather than hiding them.**
10. **Finish every branch.**
11. **Leave no unresolved stub.**
12. **Do not declare completion until closure audit passes.**

---

# 77. Prohibited Behaviors

The following are prohibited:

* marking a plan as execution;
* marking execution as verification;
* reporting files that were not inspected;
* claiming commands ran when they did not;
* claiming tests passed without output;
* claiming deployments succeeded without health checks;
* claiming UI success without browser validation;
* leaving placeholder implementation;
* hiding failed nodes;
* silently reducing scope;
* substituting instructions for requested execution;
* repeating failed retries without changed evidence;
* stopping after partial success;
* using old evidence after new changes;
* fabricating agent activity;
* closing the tree with unresolved stubs.

---

# 78. Required Final Audit Questions

Before final output, the agent must answer internally:

1. What exactly did the operator request?
2. Did the tree cover the complete request?
3. Did any node remain vague?
4. Did any requested feature become a stub or mock?
5. Were all material actions actually executed?
6. Were all results observed?
7. Were all claims verified?
8. What failed?
9. Why did it fail?
10. What was corrected?
11. Were corrections re-verified?
12. Did any correction break existing behavior?
13. Was the UI tested in a real browser where required?
14. Was the actual deployment tested where required?
15. Does every success claim have evidence?
16. Does the final result match the plan?
17. Does the final result match the operator’s original goal?
18. What remains blocked?
19. Is the root node genuinely complete?
20. Is there any stub left behind?

If question 20 is answered yes, the tree is not complete.

---

# 79. Naming Reference

| Term                                | Meaning                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Recursive Task Decomposition        | Repeatedly divide work into smaller actionable units                       |
| Exhaustive Work Breakdown Structure | Full hierarchy containing all required work                                |
| Full Tree Expansion                 | Expand every vague node until terminal                                     |
| Stub-to-Completion Expansion        | Convert undefined work into executed, verified nodes                       |
| Terminal Node Completion            | Resolve every leaf to Done or Blocked-With-Reason                          |
| Complete Work Cycle Tree            | Tree includes planning, execution, verification, correction, and reporting |
| Agentic Execution Tree              | Work tree designed for autonomous execution                                |
| No-Stub-Left-Behind Decomposition   | Informal completion doctrine                                               |
| Evidence-Gated Completion           | Completion permitted only when supported by observed proof                 |
| Correction Branch                   | New branch created in response to failed verification                      |
| Closure Audit                       | Final traversal confirming all nodes are resolved                          |
| Plan-Execution Alignment            | Comparison between intended and actual outcome                             |
| Critical Path                       | Dependency chain controlling mission completion                            |
| Hard Blocker                        | Proven condition that cannot be resolved with available authority or tools |

---

# 80. Canonical Completion Statement

A compliant execution may conclude with:

```text
EXHAUSTIVE_RECURSIVE_WORK_TREE: CLOSED

Root status:
DONE | DONE_WITH_NONCRITICAL_LIMITATIONS | PARTIALLY_DONE | BLOCKED | FAILED | UNVERIFIED

Stub count:
0

Required terminal nodes:
<total>

Done:
<count>

Blocked with reason:
<count>

Failed unresolved:
<count>

Verification:
COMPLETE | PARTIAL | FAILED

Regression status:
PASS | PARTIAL | FAIL | NOT_APPLICABLE

Playwright status:
PASS | PARTIAL | FAIL | NOT_REQUIRED | UNAVAILABLE

Plan-execution alignment:
MATCH | PARTIAL_MATCH | MISMATCH | UNVERIFIED

Evidence report:
WRITTEN

Final closure audit:
PASS | FAIL
```

The tree may be declared closed only when:

```text
Stub count = 0
AND
Final closure audit = PASS
```

---

# 81. Completion Invariant

> Expand every branch.
> Resolve every dependency.
> Execute every actionable leaf.
> Verify every acceptance condition.
> Correct every failed result.
> Expose every genuine blocker.
> Support every claim with evidence.
> Finish every required output.
> Leave no stub behind.
