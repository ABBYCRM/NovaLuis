from pathlib import Path

from autonomous_agent.config import Config
from autonomous_agent.core.agent import AutonomousAgent


def test_agent_run_once_clean_project(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname='x'\nversion='0.0.1'\n", encoding="utf-8"
    )
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "test_ok.py").write_text("def test_ok():\n    assert True\n", encoding="utf-8")
    cfg = Config.load(
        overrides={
            "agent": {"workspace": str(tmp_path), "state_dir": ".agent_memory"},
            "runner": {"python_command": ["python", "-m", "pytest", "-q"], "sandbox": False},
        }
    )
    result = AutonomousAgent(cfg).run_once(tmp_path)
    assert result.status == "fixed"
    assert result.tests and all(t.passed for t in result.tests)
