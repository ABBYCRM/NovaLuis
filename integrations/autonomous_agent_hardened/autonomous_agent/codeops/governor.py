"""Autonomous AI CodeOps Governor.

This module enforces repo/GitHub/CI/deploy policy before agentic tools mutate a
workspace or claim success. It is intentionally local and deterministic: live
GitHub calls are delegated to VCS tools, but this layer decides whether an action
is permitted under the current autonomy level and budgets.
"""
from __future__ import annotations

import subprocess
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ..scanners.path_policy import FilePolicyScanner
from ..scanners.private_data_scanner import PrivateDataScanner
from ..scanners.secret_scanner import SecretScanner
from ..scanners.size_scanner import SizeScanner
from ..security.redactor import Redactor
from .models import CAPABILITIES, AutonomyLevel, CodeOpsDecision, PolicyDecision
from .schema_loader import load_codeops_schema
from .state_machine import CODEOPS_STATE_MACHINE

# Re-export for public import compatibility.
__all__ = ["AutonomyLevel", "CodeOpsDecision", "CodeOpsGovernor", "PolicyDecision"]


class CodeOpsGovernor:
    """Policy engine for governed autonomous coding operations."""

    def __init__(self, workspace: Path, autonomy_level: str | AutonomyLevel = AutonomyLevel.LEVEL_1):
        self.workspace = Path(workspace).resolve()
        self.schema = load_codeops_schema()
        self.autonomy_level = AutonomyLevel.coerce(autonomy_level)
        self.capabilities = CAPABILITIES[self.autonomy_level]
        github = self.schema.get("github_governor", {})
        limits = github.get("hard_limits", {})
        file_policy = self.schema.get("file_policy", {})
        regular_git = file_policy.get("large_file_strategy", {}).get("regular_git", {})
        self.max_files = int(limits.get("max_files_per_agent_run", 25))
        self.max_commits = int(limits.get("max_commits_per_agent_run", 3))
        self.max_prs = int(limits.get("max_pull_requests_per_agent_run", 1))
        self.max_workflow_dispatches = int(limits.get("max_workflow_dispatches_per_agent_run", 2))
        self.branch_prefix = str(github.get("branch_policy", {}).get("branch_prefix", "ai/"))
        self.file_scanner = FilePolicyScanner(
            self.workspace,
            list(file_policy.get("forbidden_paths", [])),
            list(file_policy.get("default_allowed_write_paths", [])),
        )
        self.size_scanner = SizeScanner(
            self.workspace,
            warn_mib=int(regular_git.get("review_required_from_mib", 50)),
            block_mib=int(regular_git.get("blocked_at_mib", 100)),
            max_total_mib=int(limits.get("max_total_changed_bytes_per_run_mib", 20)),
        )
        self.secret_scanner = SecretScanner(self.workspace, Redactor())
        self.private_scanner = PrivateDataScanner(self.workspace)

    def state_machine(self) -> tuple[str, ...]:
        return CODEOPS_STATE_MACHINE

    def evaluate_action(self, action: str, *, state: str | None = None, metadata: dict[str, Any] | None = None) -> CodeOpsDecision:
        metadata = metadata or {}
        action = action.lower()
        if action in {"write_file", "replace_in_file", "patch", "delete_file"} and not self.capabilities.can_write_files:
            return self._block("autonomy_level_does_not_allow_file_writes", action, state, "medium")
        if action in {"commit", "commit_batch"} and not self.capabilities.can_commit:
            return self._block("autonomy_level_does_not_allow_commits", action, state, "medium")
        if action in {"push", "push_branch"} and not self.capabilities.can_push:
            return self._block("autonomy_level_does_not_allow_push", action, state, "high")
        if action in {"open_pr", "open_pull_request"} and not self.capabilities.can_open_pr:
            return self._block("autonomy_level_does_not_allow_pr_creation", action, state, "high")
        if action in {"monitor_ci"} and not self.capabilities.can_monitor_ci:
            return self._block("autonomy_level_does_not_allow_ci_monitoring", action, state, "medium")
        if action in {"deploy", "production_deploy"}:
            return CodeOpsDecision(PolicyDecision.REQUIRE_APPROVAL, "deploy_requires_human_approval_green_ci_and_rollback", "high", state=state, action=action, metadata=metadata)
        if action in {"push_main", "direct_push_to_main"}:
            return self._block("direct_push_to_main_forbidden", action, state, "high")
        return CodeOpsDecision(PolicyDecision.ALLOW, "action_allowed_by_autonomy_level", "low", state=state, action=action, metadata=metadata)

    def evaluate_branch(self, branch: str) -> CodeOpsDecision:
        if branch in {"main", "master"}:
            return self._block("main_branch_write_forbidden", "branch", "BRANCH_CREATE", "high", {"branch": branch})
        if not branch.startswith(self.branch_prefix):
            return CodeOpsDecision(PolicyDecision.REQUIRE_REVIEW, "branch_must_use_ai_prefix", "medium", state="BRANCH_CREATE", action="branch", metadata={"branch": branch, "required_prefix": self.branch_prefix})
        return CodeOpsDecision(PolicyDecision.ALLOW, "branch_allowed", "low", state="BRANCH_CREATE", action="branch", metadata={"branch": branch})

    def evaluate_changed_files(self, paths: list[str]) -> dict[str, Any]:
        deduped = sorted(dict.fromkeys(paths))
        allowed, path_findings = self.file_scanner.classify(deduped)
        total_bytes, size_findings = self.size_scanner.scan(deduped)
        secret_findings = self.secret_scanner.scan(deduped)
        private_findings = self.private_scanner.scan(deduped)
        decisions: list[CodeOpsDecision] = []
        if len(deduped) > self.max_files:
            decisions.append(self._block("changed_file_count_budget_exceeded", "file_budget", "DIFF_MANIFEST", "high", {"count": len(deduped), "max": self.max_files}))
        for finding in path_findings:
            decision = PolicyDecision.BLOCK if finding.severity == "block" else PolicyDecision.REQUIRE_REVIEW
            decisions.append(CodeOpsDecision(decision, finding.reason, "high" if decision == PolicyDecision.BLOCK else "medium", [finding.path], "PATH_POLICY_CHECK", "file_policy"))
        for finding in size_findings:
            decision = PolicyDecision.BLOCK if finding.decision == "BLOCK" else PolicyDecision.REQUIRE_REVIEW
            decisions.append(CodeOpsDecision(decision, finding.reason, "high" if decision == PolicyDecision.BLOCK else "medium", [finding.path], "SIZE_SCAN", "size_scan", finding.to_dict()))
        for finding in secret_findings:
            decisions.append(CodeOpsDecision(PolicyDecision.BLOCK, finding.reason, "high", [finding.path], "SECRET_SCAN", "secret_scan"))
        for finding in private_findings:
            decisions.append(CodeOpsDecision(PolicyDecision.BLOCK, finding.reason, "high", [finding.path], "PRIVATE_DATA_SCAN", "private_data_scan", finding.to_dict()))
        final = PolicyDecision.ALLOW
        if any(d.decision == PolicyDecision.BLOCK for d in decisions):
            final = PolicyDecision.BLOCK
        elif any(d.decision in {PolicyDecision.REQUIRE_REVIEW, PolicyDecision.REQUIRE_APPROVAL} for d in decisions):
            final = PolicyDecision.REQUIRE_REVIEW
        return {
            "decision": final.value,
            "files_allowed": allowed,
            "files_blocked": [d.to_dict() for d in decisions if d.decision == PolicyDecision.BLOCK],
            "files_requiring_review": [d.to_dict() for d in decisions if d.decision != PolicyDecision.BLOCK],
            "total_changed_bytes": total_bytes,
            "max_files": self.max_files,
            "evidence": ["path_policy_check", "size_scan", "secret_scan", "private_data_scan"],
        }

    def current_git_branch(self) -> str | None:
        try:
            proc = subprocess.run(["git", "branch", "--show-current"], cwd=self.workspace, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
        except (OSError, subprocess.SubprocessError):
            return None
        branch = proc.stdout.strip()
        return branch or None

    def changed_files_from_git(self) -> list[str]:
        try:
            proc = subprocess.run(["git", "status", "--porcelain=v1"], cwd=self.workspace, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
        except (OSError, subprocess.SubprocessError):
            return []
        files: list[str] = []
        for line in proc.stdout.splitlines():
            if not line.strip():
                continue
            raw = line[3:].strip()
            if " -> " in raw:
                raw = raw.split(" -> ", 1)[1].strip()
            files.append(raw)
        return files

    def preflight(self) -> dict[str, Any]:
        branch = self.current_git_branch()
        branch_decision = self.evaluate_branch(branch) if branch else CodeOpsDecision(PolicyDecision.REQUIRE_REVIEW, "not_a_git_repo_or_detached_head", "medium", state="BRANCH_CREATE", action="branch")
        changed = self.changed_files_from_git()
        file_budget = self.evaluate_changed_files(changed) if changed else {"decision": "ALLOW", "files_allowed": [], "files_blocked": [], "files_requiring_review": [], "total_changed_bytes": 0, "max_files": self.max_files, "evidence": ["no_changed_files"]}
        return {
            "autonomy_level": self.autonomy_level.value,
            "capabilities": asdict(self.capabilities),
            "branch": branch,
            "branch_policy": branch_decision.to_dict(),
            "changed_files": changed,
            "file_budget": file_budget,
            "state_machine": list(CODEOPS_STATE_MACHINE),
        }

    def _block(self, reason: str, action: str, state: str | None, risk: str, metadata: dict[str, Any] | None = None) -> CodeOpsDecision:
        return CodeOpsDecision(PolicyDecision.BLOCK, reason, risk, state=state, action=action, metadata=metadata or {})
