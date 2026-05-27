"""CodeOps governor tools exposed to the agentic runtime."""
from __future__ import annotations

from typing import Any

from ..codeops import AutonomyLevel, CodeOpsGovernor
from .base import ToolContext, ToolResult, ToolSpec


class CodeOpsPreflightTool:
    spec = ToolSpec(
        name="codeops_preflight",
        description="Run CodeOps Governor preflight: autonomy, branch, changed files, size, secret, private-data, and path policy checks.",
        input_schema={"type": "object", "properties": {"autonomy_level": {"type": "string"}}},
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        level = args.get("autonomy_level", getattr(ctx.config.agent, "autonomy_level", AutonomyLevel.LEVEL_1.value))
        gov = CodeOpsGovernor(ctx.workspace, level)
        result = gov.preflight()
        blocked = bool(result["file_budget"].get("files_blocked")) or result["branch_policy"].get("decision") == "BLOCK"
        return ToolResult(not blocked, result, None if not blocked else "codeops preflight blocked", evidence=["codeops_preflight"])


class CodeOpsEvaluateActionTool:
    spec = ToolSpec(
        name="codeops_evaluate_action",
        description="Ask the CodeOps Governor whether a repo/GitHub action is allowed for the current autonomy level.",
        input_schema={"type": "object", "required": ["action"], "properties": {"action": {"type": "string"}, "state": {"type": "string"}, "autonomy_level": {"type": "string"}}},
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        level = args.get("autonomy_level", getattr(ctx.config.agent, "autonomy_level", AutonomyLevel.LEVEL_1.value))
        gov = CodeOpsGovernor(ctx.workspace, level)
        decision = gov.evaluate_action(str(args["action"]), state=args.get("state"))
        return ToolResult(decision.allowed, decision.to_dict(), None if decision.allowed else decision.reason, evidence=["codeops_action_gate"])
