"""Tools exposing the user-understanding engine to the agent runtime."""
from __future__ import annotations

from typing import Any

from ..user_model.engine import UserUnderstandingEngine
from ..user_model.psych_alphabet import PSYCH_ALPHABET_ASCII, PSYCH_ALPHABET_TREE
from .base import ToolContext, ToolResult, ToolSpec


class AnalyzeUserContextTool:
    spec = ToolSpec(
        name="analyze_user_context",
        description=(
            "Analyze user message/style into non-clinical response-planning signals. "
            "Never diagnoses; returns preferences, guardrails, safety flags, and response strategy."
        ),
        input_schema={
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": {"type": "string"},
                "task_context": {"type": "string"},
            },
        },
        risk="low",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        text = ctx.redactor.redact(str(args.get("text", "")))
        task_context = ctx.redactor.redact(str(args.get("task_context", ""))) if args.get("task_context") else None
        result = UserUnderstandingEngine().analyze(text, task_context=task_context)
        return ToolResult(True, result.to_dict(), evidence=["user_model:non_clinical_analysis"])


class PsychAlphabetReferenceTool:
    spec = ToolSpec(
        name="psych_alphabet_reference",
        description="Return the machine-readable psych alphabet reference and ASCII tree used for non-clinical user-context adaptation.",
        input_schema={"type": "object", "properties": {"format": {"type": "string", "enum": ["json", "ascii"]}}},
        risk="low",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        fmt = str(args.get("format", "json")).lower()
        output = PSYCH_ALPHABET_ASCII if fmt == "ascii" else PSYCH_ALPHABET_TREE
        return ToolResult(True, output, evidence=["user_model:psych_alphabet_reference"])
