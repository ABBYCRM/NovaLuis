from pathlib import Path

from autonomous_agent.config import Config
from autonomous_agent.runner.test_runner import TestRunner


def test_runner_executes_command(tmp_path: Path) -> None:
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}, "runner": {"sandbox": False}})
    result = TestRunner(tmp_path, cfg).run_command(["python", "-c", "print('ok')"])
    assert result.passed
    assert "ok" in result.stdout
