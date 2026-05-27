"""Project verification runner."""
from __future__ import annotations

from pathlib import Path

from ..config import Config
from ..core.types import TestResult
from ..security.sandbox import Sandbox


class TestRunner:
    __test__ = False

    def __init__(self, workspace: Path, config: Config):
        self.workspace = Path(workspace).resolve()
        self.config = config

    def run_command(self, command: list[str]) -> TestResult:
        sandbox = Sandbox(
            self.workspace,
            timeout_s=self.config.runner.timeout_seconds,
            enabled=self.config.runner.sandbox,
        )
        result = sandbox.run(command)
        return TestResult(
            command=command,
            exit_code=result.exit_code,
            stdout=result.stdout,
            stderr=result.stderr,
            timed_out=result.timed_out,
        )

    def run_detected(self) -> list[TestResult]:
        commands: list[list[str]] = []
        if (self.workspace / "pyproject.toml").exists() or any(self.workspace.glob("**/*.py")):
            commands.append(self.config.runner.python_command)
        if (self.workspace / "package.json").exists():
            commands.append(self.config.runner.js_command)
            if (self.workspace / "tsconfig.json").exists():
                commands.append(self.config.runner.ts_command)
        return [self.run_command(command) for command in commands]
