from pathlib import Path

from autonomous_agent.config import Config
from autonomous_agent.core.agentic_runtime import AgenticRuntime
from autonomous_agent.tools.builtin import build_default_registry


def test_agentic_runtime_echo_executes_verify(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text("[tool.pytest.ini_options]\ntestpaths=['tests']\n", encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_ok.py").write_text("def test_ok():\n    assert True\n", encoding="utf-8")
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path), "dry_run": True, "max_iterations": 2, "max_recursion": 2}, "llm": {"backend": "echo"}})
    result = AgenticRuntime(cfg, registry=build_default_registry()).run("verify project", max_iterations=1)
    assert result.status == "fixed"
    assert result.iterations == 1
    assert any(event["event"] == "governance" for event in result.trace)
