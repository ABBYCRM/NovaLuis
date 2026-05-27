"""Read-only Git tools plus guarded commit helper."""
from __future__ import annotations

from typing import Any

from .base import ToolContext, ToolResult, ToolSpec
from .shell_tools import RunCommandTool


class GitStatusTool:
    spec = ToolSpec(name="git_status", description="Return git status porcelain output.", input_schema={"type": "object", "properties": {}})

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        return RunCommandTool().run({"cmd": ["git", "status", "--porcelain=v1"]}, ctx)


class GitDiffTool:
    spec = ToolSpec(name="git_diff", description="Return current git diff.", input_schema={"type": "object", "properties": {"path": {"type": "string"}}})

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        cmd = ["git", "diff", "--"]
        if args.get("path"):
            ctx.path_policy.resolve(str(args["path"]))
            cmd.append(str(args["path"]))
        return RunCommandTool().run({"cmd": cmd}, ctx)
