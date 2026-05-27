from pathlib import Path

from autonomous_agent.codeops import AutonomyLevel, CodeOpsGovernor, PolicyDecision
from autonomous_agent.codeops.schema_loader import load_codeops_schema


def test_codeops_schema_loads_absolute_rules():
    schema = load_codeops_schema()
    assert schema["protocol"] == "AUTONOMOUS-AI-CODEOPS-GOVERNOR"
    assert schema["absolute_rules"]["no_direct_push_to_main"] is True


def test_level_0_blocks_file_write(tmp_path: Path):
    gov = CodeOpsGovernor(tmp_path, AutonomyLevel.LEVEL_0)
    decision = gov.evaluate_action("write_file", state="PATCH")
    assert decision.decision == PolicyDecision.BLOCK
    assert "file_writes" in decision.reason


def test_ai_branch_allowed_and_main_blocked(tmp_path: Path):
    gov = CodeOpsGovernor(tmp_path, AutonomyLevel.LEVEL_2)
    assert gov.evaluate_branch("ai/bug/fix-123").decision == PolicyDecision.ALLOW
    assert gov.evaluate_branch("main").decision == PolicyDecision.BLOCK


def test_changed_file_secret_blocks(tmp_path: Path):
    secret = tmp_path / "src" / "config.py"
    secret.parent.mkdir()
    secret.write_text("OPENAI_API_KEY='sk-" + "a" * 30 + "'", encoding="utf-8")
    gov = CodeOpsGovernor(tmp_path, AutonomyLevel.LEVEL_1)
    result = gov.evaluate_changed_files(["src/config.py"])
    assert result["decision"] == "BLOCK"
    assert result["files_blocked"]
