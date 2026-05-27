from pathlib import Path

from autonomous_agent.analyzer.rule_analyzer import RuleAnalyzer
from autonomous_agent.config import Config


def test_rule_analyzer_detects_syntax_error(tmp_path: Path) -> None:
    bad = tmp_path / "bad.py"
    bad.write_text("def nope(:\n", encoding="utf-8")
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    result = RuleAnalyzer(cfg).analyze_path(tmp_path)
    assert any(f.code == "PY_SYNTAX_ERROR" for f in result.findings)


def test_rule_analyzer_suggests_nonempty_init(tmp_path: Path) -> None:
    init = tmp_path / "__init__.py"
    init.write_text("", encoding="utf-8")
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    result = RuleAnalyzer(cfg).analyze_path(tmp_path)
    assert result.patches
