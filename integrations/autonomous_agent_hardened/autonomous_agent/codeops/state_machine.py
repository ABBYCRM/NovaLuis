"""Canonical CodeOps state machine.

The order mirrors the Autonomous AI CodeOps Governor schema. Runtime code can emit
these states as audit events even when a state is skipped because the current
autonomy level does not permit GitHub or deployment actions.
"""
from __future__ import annotations

CODEOPS_STATE_MACHINE: tuple[str, ...] = (
    "INTAKE",
    "TASK_CLASSIFICATION",
    "REPO_INVENTORY",
    "GITHUB_RATE_LIMIT_CHECK",
    "CONTEXT_LOAD",
    "ROOT_CAUSE_ANALYSIS",
    "PLAN",
    "POLICY_GATE",
    "DIFF_MANIFEST",
    "FILE_CLASSIFICATION",
    "SIZE_SCAN",
    "SECRET_SCAN",
    "PRIVATE_DATA_SCAN",
    "PATH_POLICY_CHECK",
    "BRANCH_CREATE",
    "PATCH",
    "VERIFY_LOCAL",
    "AI_REVIEW",
    "CORRECT_IF_NEEDED",
    "COMMIT_BATCH",
    "PUSH_BRANCH",
    "VERIFY_REMOTE_SHA",
    "OPEN_PULL_REQUEST",
    "MONITOR_CI",
    "DEPLOY_GATE",
    "REPORT",
)

READ_STATES = frozenset({"INTAKE", "TASK_CLASSIFICATION", "REPO_INVENTORY", "CONTEXT_LOAD", "PLAN", "REPORT"})
WRITE_STATES = frozenset({"PATCH", "COMMIT_BATCH", "PUSH_BRANCH", "OPEN_PULL_REQUEST"})
GITHUB_STATES = frozenset({"GITHUB_RATE_LIMIT_CHECK", "BRANCH_CREATE", "COMMIT_BATCH", "PUSH_BRANCH", "VERIFY_REMOTE_SHA", "OPEN_PULL_REQUEST", "MONITOR_CI"})
DEPLOY_STATES = frozenset({"DEPLOY_GATE"})
