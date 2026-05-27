"""Tools exposing the ethical answer-analysis engine to the agent runtime."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..answer_analysis import AnswerAnalysisEngine, AnswerAnalysisInput, EvidenceItem
from .base import ToolContext, ToolResult, ToolSpec


class AnalyzeAnswerTool:
    spec = ToolSpec(
        name="analyze_answer",
        description=(
            "Ethically analyze a human answer by separating exact words, atomic claims, "
            "claim type, evidence status, uncertainty, contradictions/tensions, hidden constraints, "
            "incentives, and non-leading follow-up questions. Hypotheses only; no diagnosis or coercion."
        ),
        input_schema={
            "type": "object",
            "required": ["subject_answer"],
            "properties": {
                "subject_answer": {"type": "string"},
                "question_asked": {"type": "string"},
                "speaker_role": {"type": "string"},
                "context": {"type": "string"},
                "known_facts": {"type": "array", "items": {"type": "string"}},
                "prior_statements": {"type": "array", "items": {"type": "string"}},
                "timeline": {"type": "array", "items": {"type": "string"}},
                "interview_goal": {"type": "string"},
                "risk_level": {"type": "string"},
                "consent_status": {"type": "string", "enum": ["explicit", "implied", "unclear", "withdrawn", "not_applicable"]},
                "available_evidence": {"type": "array"},
            },
        },
        risk="low",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        evidence = [_evidence_from_mapping(item) for item in args.get("available_evidence", []) if isinstance(item, dict)]
        data = AnswerAnalysisInput(
            subject_answer=ctx.redactor.redact(str(args.get("subject_answer", ""))),
            question_asked=_optional_str(args.get("question_asked"), ctx),
            speaker_role=_optional_str(args.get("speaker_role"), ctx),
            context=_optional_str(args.get("context"), ctx),
            known_facts=[ctx.redactor.redact(str(x)) for x in args.get("known_facts", [])],
            available_evidence=evidence,
            prior_statements=[ctx.redactor.redact(str(x)) for x in args.get("prior_statements", [])],
            timeline=[ctx.redactor.redact(str(x)) for x in args.get("timeline", [])],
            interview_goal=_optional_str(args.get("interview_goal"), ctx),
            risk_level=_optional_str(args.get("risk_level"), ctx),
            consent_status=str(args.get("consent_status", "unclear")),
        )
        engine = AnswerAnalysisEngine()
        report = engine.analyze(data)
        return ToolResult(True, output=_report_to_dict(report), evidence=["answer_analysis:ethical_claim_evidence_report"])


class AnswerAnalysisReferenceTool:
    spec = ToolSpec(
        name="answer_analysis_reference",
        description="Return the embedded Answer Analysis Engine OS schema/reference used for ethical claim/evidence analysis.",
        input_schema={"type": "object", "properties": {"format": {"type": "string", "enum": ["json", "text"]}}},
        risk="low",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        schema_path = Path(__file__).resolve().parents[1] / "schemas" / "answer_analysis_engine_os.schema.json"
        try:
            text = schema_path.read_text(encoding="utf-8")
        except OSError as exc:
            return ToolResult(False, error=f"answer analysis schema unavailable: {exc}")
        if str(args.get("format", "json")).lower() == "text":
            return ToolResult(True, output=text, evidence=["answer_analysis:schema_reference"])
        import json
        try:
            return ToolResult(True, output=json.loads(text), evidence=["answer_analysis:schema_reference"])
        except json.JSONDecodeError:
            return ToolResult(True, output=text, evidence=["answer_analysis:schema_reference_text_fallback"])


def _optional_str(value: Any, ctx: ToolContext) -> str | None:
    if value is None:
        return None
    return ctx.redactor.redact(str(value))


def _evidence_from_mapping(item: dict[str, Any]) -> EvidenceItem:
    return EvidenceItem(
        evidence_id=str(item.get("evidence_id", "EV_UNKNOWN")),
        evidence_type=str(item.get("evidence_type", "unknown")),
        description=str(item.get("description", "")),
        source=str(item["source"]) if item.get("source") is not None else None,
        reliability=str(item["reliability"]) if item.get("reliability") is not None else None,
        supports_claim_ids=[str(x) for x in item.get("supports_claim_ids", [])],
        contradicts_claim_ids=[str(x) for x in item.get("contradicts_claim_ids", [])],
    )


def _report_to_dict(report: Any) -> dict[str, Any]:
    from dataclasses import asdict
    return asdict(report)
