"""OpenClaw-like plan/tool/verify/correct loop."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from ..analyzer.backends import LLMBackend, build_backend
from ..codeops import CodeOpsGovernor, PolicyDecision
from ..config import Config
from ..exceptions import LLMError, LLMResponseError, SecurityViolation
from ..governance.bos_trinity import Authority, BOSTrinityKernel, Decision, GovernanceInput
from ..memory.store import MemoryStore
from ..runtime.audit_events import AuditEvent, AuditTrail
from ..security.path_policy import PathPolicy
from ..security.redactor import Redactor
from ..tools.base import ToolContext, ToolRegistry, ToolResult
from ..tools.builtin import build_default_registry
from ..user_model.engine import UserUnderstandingEngine
from .agentic_types import AgenticPlan, AgenticRunResult, AgenticStep, StepKind, StepStatus

logger = logging.getLogger(__name__)


class AgenticRuntime:
    """Agent loop: context -> plan -> tool execution -> verify -> correct -> output."""

    def __init__(self, config: Config, registry: ToolRegistry | None = None, backend: LLMBackend | None = None):
        self.config = config
        self.workspace = Path(config.agent.workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.redactor = Redactor()
        self.path_policy = PathPolicy(self.workspace, config.security.forbidden_paths)
        self.codeops = CodeOpsGovernor(self.workspace, getattr(config.agent, "autonomy_level", "level_1_local_patch"))
        self.audit = AuditTrail(self.workspace / config.agent.state_dir / "codeops_audit.jsonl")
        self.governance = BOSTrinityKernel(
            allow_destructive=getattr(config.security, "allow_delete", False),
            allow_external_effects=getattr(config.vcs, "auto_push", False),
        )
        self.registry = registry or build_default_registry()
        self.backend = backend or build_backend(config)
        self.memory = MemoryStore(self.workspace / config.agent.state_dir / "memory.sqlite3")
        self.user_model = UserUnderstandingEngine()

    def run(self, task: str, max_iterations: int | None = None) -> AgenticRunResult:
        limit = min(max_iterations or self.config.agent.max_iterations, self.config.agent.max_iterations)
        recursion_limit = max(1, self.config.agent.max_recursion)
        trace: list[dict[str, Any]] = []
        plans: list[AgenticPlan] = []
        final_message = ""
        status = "partial"
        failure_context = ""

        user_context = self.user_model.analyze(task)
        trace.append({"event": "user_context", "result": user_context.to_dict()})
        self.memory.append("user_understanding", user_context.to_dict())

        preflight = self.codeops.preflight()
        trace.append({"event": "codeops_preflight", "result": preflight})
        self._audit(task, "TASK_RECEIVED", "low", "ALLOW", {"task": task})
        self._audit(task, "REPO_INVENTORIED", "low", preflight.get("file_budget", {}).get("decision", "ALLOW"), preflight)

        for iteration in range(1, limit + 1):
            if iteration > recursion_limit:
                final_message = "recursion limit reached before verification passed"
                trace.append({"event": "limit", "iteration": iteration, "reason": final_message})
                break

            plan = self._plan(task, failure_context=failure_context, iteration=iteration)
            plans.append(plan)
            trace.append({"event": "plan", "iteration": iteration, "plan": plan.to_dict()})
            self._audit(task, "PLAN_CREATED", "low", "ALLOW", {"iteration": iteration, "plan_source": plan.source})
            self.memory.append("agentic_plan", plan.to_dict())

            verify_result: ToolResult | None = None
            for step in plan.steps:
                step.status = StepStatus.RUNNING
                if step.kind == StepKind.THINK:
                    step.status = StepStatus.SUCCEEDED
                    step.result = {"note": step.objective}
                    trace.append({"event": "think", "step": step.to_dict()})
                    continue
                if step.kind == StepKind.FINAL:
                    step.status = StepStatus.SUCCEEDED
                    final_message = step.objective
                    trace.append({"event": "final", "step": step.to_dict()})
                    continue
                tool_name = step.tool or ("verify_project" if step.kind == StepKind.VERIFY else None)
                if not tool_name:
                    step.status = StepStatus.FAILED
                    step.error = "tool step missing tool name"
                    trace.append({"event": "tool_error", "step": step.to_dict()})
                    continue
                result = self._run_tool(tool_name, step.args, trace, task=task)
                step.result = result.to_dict()
                step.status = StepStatus.SUCCEEDED if result.ok else StepStatus.FAILED
                step.error = result.error
                if tool_name == "verify_project":
                    verify_result = result
                trace.append({"event": "tool_result", "step": step.to_dict()})
                self.memory.append("agentic_step", step.to_dict())

            if verify_result is None:
                verify_result = self._run_tool("verify_project", {}, trace, task=task)
                trace.append({"event": "implicit_verify", "result": verify_result.to_dict()})

            if verify_result.ok:
                status = "fixed"
                self._audit(task, "FINAL_REPORT", "low", "ALLOW", {"status": status, "verified": True})
                final_message = final_message or "verification passed"
                break

            failure_context = json.dumps(verify_result.to_dict(), ensure_ascii=False)[: self.config.llm.max_context_chars]
            status = "partial"
            self._audit(task, "TEST_RUN", "medium", "REQUIRE_VERIFICATION", {"iteration": iteration, "verification": verify_result.to_dict()})
            final_message = "verification failed; correction loop exhausted" if iteration == limit else "verification failed; correcting"

        result = AgenticRunResult(status=status, task=task, iterations=len(plans), plans=plans, trace=trace, final_message=final_message)
        self.memory.append("agentic_run", result.to_dict())
        return result

    def _run_tool(self, name: str, args: dict[str, Any], trace: list[dict[str, Any]], task: str = "") -> ToolResult:
        try:
            tool = self.registry.get(name)
        except KeyError as exc:
            return ToolResult(False, error=str(exc))
        codeops_action = self._codeops_action_for_tool(name)
        codeops_decision = self.codeops.evaluate_action(codeops_action, state=self._codeops_state_for_tool(name), metadata={"tool": name})
        trace.append({"event": "codeops_gate", "tool": name, "decision": codeops_decision.to_dict()})
        self._audit(task or "unknown", codeops_decision.state or "POLICY_GATE", codeops_decision.risk_level, codeops_decision.decision.value, codeops_decision.to_dict())
        if codeops_decision.decision in {PolicyDecision.BLOCK, PolicyDecision.REQUIRE_APPROVAL}:
            return ToolResult(False, error=f"codeops blocked tool {name}: {codeops_decision.reason}", evidence=codeops_decision.evidence)

        decision = self.governance.decide(
            GovernanceInput(
                action_type="verify" if name == "verify_project" else ("read" if name in {"read_file", "search_files", "git_status", "git_diff", "analyze_user_context", "psych_alphabet_reference", "codeops_preflight", "codeops_evaluate_action"} else "write"),
                evidence=[name],
                authority=Authority.CONSTRAINED_EXECUTION,
                destructive=tool.spec.destructive,
                external_effect=tool.spec.external_effect,
                confidence=0.7,
            )
        )
        trace.append({"event": "governance", "tool": name, "decision": decision.to_dict()})
        if decision.decision != Decision.COMMIT:
            return ToolResult(False, error=f"governance blocked tool {name}: {decision.reasoning_summary}", evidence=decision.arbitration_trace)
        ctx = ToolContext(self.workspace, self.config, self.path_policy, self.redactor, self.governance)
        try:
            return tool.run(args, ctx)
        except (OSError, UnicodeError, SecurityViolation, ValueError) as exc:
            return ToolResult(False, error=self.redactor.redact(str(exc)))

    def _plan(self, task: str, failure_context: str, iteration: int) -> AgenticPlan:
        prompt = self._build_planner_prompt(task, failure_context, iteration)
        try:
            response = self.backend.complete(prompt)
            plan = self._parse_plan(response.content, task=task, source=response.backend)
            if plan.steps:
                return plan
        except (LLMError, LLMResponseError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            logger.info("falling back to deterministic plan", extra={"reason": str(exc)})
        return self._fallback_plan(task, failure_context, iteration)

    def _build_planner_prompt(self, task: str, failure_context: str, iteration: int) -> str:
        user_context = self.user_model.analyze(task).to_dict()
        payload = {
            "system": "Return strict JSON only. Build an OpenClaw-style plan using available tools.",
            "bos_trinity": "facts>narrative; evidence_gate; source_gate; jurisdiction_gate for legal claims; tri_state COMMIT/DEFER/REJECT",
            "user_understanding": {
                "purpose": "Adapt response and execution style only. Do not diagnose the user or third parties.",
                "analysis": user_context,
                "hard_limits": [
                    "no clinical diagnosis",
                    "no therapy simulation",
                    "no unsupported claims about user psychology",
                    "crisis flags override normal execution",
                ],
            },
            "answer_analysis_engine": {
                "purpose": "Use analyze_answer when a human statement must be separated into exact words, claims, evidence status, uncertainty, contradictions, incentives, hidden constraints, and ethical follow-up questions.",
                "hard_limits": [
                    "statements are claims until verified",
                    "psychological signals are hypotheses only",
                    "never coerce, trap, shame, threaten, or force admissions",
                    "unknown is a valid output",
                    "evidence outranks narrative",
                ],
            },
            "task": task,
            "iteration": iteration,
            "failure_context": failure_context,
            "tools": self.registry.specs(),
            "schema": {
                "confidence": "0..1",
                "steps": [
                    {"id": "s1", "kind": "tool|verify|think|final", "objective": "text", "tool": "tool_name_or_null", "args": {}}
                ],
            },
        }
        return json.dumps(payload, ensure_ascii=False)

    def _parse_plan(self, content: str, task: str, source: str) -> AgenticPlan:
        data = json.loads(content)
        steps = []
        for i, raw in enumerate(data.get("steps", []), 1):
            kind = StepKind(str(raw.get("kind", "tool")))
            steps.append(
                AgenticStep(
                    id=str(raw.get("id", f"s{i}")),
                    kind=kind,
                    objective=str(raw.get("objective", "")),
                    tool=raw.get("tool"),
                    args=dict(raw.get("args", {})),
                )
            )
        return AgenticPlan(task=task, steps=steps, confidence=float(data.get("confidence", 0.0)), source=source)

    def _fallback_plan(self, task: str, failure_context: str, iteration: int) -> AgenticPlan:
        steps: list[AgenticStep] = [
            AgenticStep("s1", StepKind.TOOL, "Inspect repository status", "git_status", {}),
            AgenticStep("s2", StepKind.TOOL, "Search for obvious failure markers", "search_files", {"query": "TODO", "glob": "**/*.py", "max_results": 25}),
            AgenticStep("s3", StepKind.VERIFY, "Run detected project verification", "verify_project", {}),
        ]
        if failure_context:
            steps.insert(0, AgenticStep("c0", StepKind.THINK, "Correction pass using previous verification failure"))
        return AgenticPlan(task=task, steps=steps, confidence=0.45, source="deterministic")


    @staticmethod
    def _codeops_action_for_tool(name: str) -> str:
        if name in {"write_file", "replace_in_file"}:
            return "write_file"
        if name in {"git_commit"}:
            return "commit"
        if name in {"git_push"}:
            return "push"
        if name in {"github_open_pr"}:
            return "open_pr"
        if name == "verify_project":
            return "verify"
        return "read"

    @staticmethod
    def _codeops_state_for_tool(name: str) -> str:
        if name in {"write_file", "replace_in_file"}:
            return "PATCH"
        if name == "verify_project":
            return "VERIFY_LOCAL"
        if name.startswith("git_"):
            return "DIFF_MANIFEST"
        return "CONTEXT_LOAD"

    def _audit(self, task: str, action: str, risk: str, decision: str, evidence: dict[str, Any]) -> None:
        try:
            self.audit.append(
                AuditEvent(
                    task_id=str(abs(hash(task))),
                    repo=str(self.workspace),
                    actor="autonomous_agent",
                    action=action,
                    risk_level=risk,
                    policy_decision=decision,
                    evidence=evidence,
                )
            )
        except OSError:
            logger.warning("failed to append audit event", extra={"action": action})
