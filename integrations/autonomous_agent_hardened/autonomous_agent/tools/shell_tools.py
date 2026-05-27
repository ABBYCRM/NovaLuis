"""Sandboxed shell/verification tools."""
from __future__ import annotations

import shlex
from typing import Any

from ..security.sandbox import Sandbox
from .base import ToolContext, ToolResult, ToolSpec


class RunCommandTool:
    spec = ToolSpec(
        name="run_command",
        description="Run an allow-listed command in the sandboxed workspace. Provide argv, not raw shell.",
        input_schema={"type": "object", "required": ["cmd"], "properties": {"cmd": {"type": "array", "items": {"type": "string"}}, "timeout_seconds": {"type": "integer"}}},
        risk="medium",
    )

    SAFE_EXECUTABLES = {"python", "python3", "pytest", "npm", "npx", "node", "git", "ls", "cat", "grep", "find"}

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        raw = args.get("cmd")
        if isinstance(raw, str):
            cmd = shlex.split(raw)
        else:
            cmd = [str(x) for x in raw]
        if not cmd:
            return ToolResult(False, error="empty command")
        if cmd[0] not in self.SAFE_EXECUTABLES:
            return ToolResult(False, error=f"executable not allowed: {cmd[0]}")
        timeout = int(args.get("timeout_seconds", ctx.config.runner.timeout_seconds))
        sandbox = Sandbox(ctx.workspace, timeout_s=timeout, enabled=ctx.config.runner.sandbox)
        result = sandbox.run(cmd)
        stdout = ctx.redactor.redact(result.stdout[-12000:])
        stderr = ctx.redactor.redact(result.stderr[-12000:])
        return ToolResult(
            ok=result.exit_code == 0 and not result.timed_out,
            output={"cmd": cmd, "exit_code": result.exit_code, "stdout": stdout, "stderr": stderr, "timed_out": result.timed_out},
            error=None if result.exit_code == 0 and not result.timed_out else "command failed",
            evidence=["stdout:" + stdout[:500], "stderr:" + stderr[:500]],
        )


class VerifyTool:
    spec = ToolSpec(
        name="verify_project",
        description="Run the project verification commands detected by TestRunner.",
        input_schema={"type": "object", "properties": {}},
        risk="medium",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        from ..runner.test_runner import TestRunner

        results = TestRunner(ctx.workspace, ctx.config).run_detected()
        payload = [
            {
                "command": item.command,
                "exit_code": item.exit_code,
                "stdout": ctx.redactor.redact(item.stdout[-4000:]),
                "stderr": ctx.redactor.redact(item.stderr[-4000:]),
                "timed_out": item.timed_out,
                "passed": item.passed,
            }
            for item in results
        ]
        ok = all(item["passed"] for item in payload)
        evidence = [f"verify:{item['command']}:{item['exit_code']}" for item in payload]
        return ToolResult(ok, {"results": payload}, None if ok else "verification failed", evidence=evidence)
