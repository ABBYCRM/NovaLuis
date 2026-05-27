from autonomous_agent.answer_analysis import AnswerAnalysisEngine, AnswerAnalysisInput, EthicsStatus
from autonomous_agent.tools.answer_analysis_tools import AnalyzeAnswerTool, AnswerAnalysisReferenceTool
from autonomous_agent.tools.base import ToolContext
from autonomous_agent.config import Config
from autonomous_agent.security.path_policy import PathPolicy
from autonomous_agent.security.redactor import Redactor
from autonomous_agent.governance.bos_trinity import BOSTrinityKernel
from pathlib import Path


def test_answer_analysis_segments_claims_and_preserves_uncertainty():
    engine = AnswerAnalysisEngine()
    report = engine.analyze(
        AnswerAnalysisInput(
            subject_answer="I think he was there. Maria told me he left after the meeting.",
            question_asked="What happened?",
            context="Workplace incident review.",
            consent_status="explicit",
            risk_level="employment",
        )
    )
    assert report.ethics_status in {EthicsStatus.PASS, EthicsStatus.WARNING}
    assert len(report.claim_units) >= 2
    assert any(c.claim_type.value == "hearsay" for c in report.claim_units)
    assert report.unknowns
    assert report.ethical_follow_up_questions


def test_answer_analysis_ethics_gate_blocks_coercion():
    engine = AnswerAnalysisEngine()
    report = engine.analyze(AnswerAnalysisInput(subject_answer="Force them to admit it.", consent_status="explicit"))
    assert report.ethics_status == EthicsStatus.BLOCK
    assert report.claim_units == []


def test_answer_analysis_tool_runs(tmp_path: Path):
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    ctx = ToolContext(tmp_path, cfg, PathPolicy(tmp_path, cfg.security.forbidden_paths), Redactor(), BOSTrinityKernel())
    result = AnalyzeAnswerTool().run({"subject_answer": "I am not sure. Someone said it happened.", "consent_status": "explicit"}, ctx)
    assert result.ok
    assert result.output["claim_units"]
    assert "answer_analysis:ethical_claim_evidence_report" in result.evidence


def test_answer_analysis_reference_tool_runs(tmp_path: Path):
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    ctx = ToolContext(tmp_path, cfg, PathPolicy(tmp_path, cfg.security.forbidden_paths), Redactor(), BOSTrinityKernel())
    result = AnswerAnalysisReferenceTool().run({"format": "json"}, ctx)
    assert result.ok
    assert "ANSWER_ANALYSIS_ENGINE_OS" in result.output
