"""Workspace-contained file tools."""
from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Any

from .base import ToolContext, ToolResult, ToolSpec


class ReadFileTool:
    spec = ToolSpec(
        name="read_file",
        description="Read a UTF-8 text file inside the workspace.",
        input_schema={"type": "object", "required": ["path"], "properties": {"path": {"type": "string"}, "max_chars": {"type": "integer"}}},
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        path = ctx.path_policy.resolve(str(args["path"]))
        max_chars = int(args.get("max_chars", ctx.config.llm.max_context_chars))
        text = path.read_text(encoding="utf-8", errors="replace")[:max_chars]
        return ToolResult(True, {"path": str(path.relative_to(ctx.workspace)), "content": ctx.redactor.redact(text)}, evidence=[f"read_file:{path}"])


class WriteFileTool:
    spec = ToolSpec(
        name="write_file",
        description="Write UTF-8 text inside the workspace. Dry-run is honored by the agent config.",
        input_schema={"type": "object", "required": ["path", "content"], "properties": {"path": {"type": "string"}, "content": {"type": "string"}}},
        risk="medium",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        path = ctx.path_policy.resolve(str(args["path"]))
        content = str(args["content"])
        if len(content.encode("utf-8")) > ctx.config.security.max_patch_size_bytes:
            return ToolResult(False, error="write exceeds max_patch_size_bytes")
        if not ctx.config.agent.dry_run:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return ToolResult(True, {"path": str(path.relative_to(ctx.workspace)), "dry_run": ctx.config.agent.dry_run}, evidence=[f"write_file:{path}"])


class ReplaceInFileTool:
    spec = ToolSpec(
        name="replace_in_file",
        description="Replace one exact text segment in a workspace file.",
        input_schema={"type": "object", "required": ["path", "expected_old", "replacement"], "properties": {"path": {"type": "string"}, "expected_old": {"type": "string"}, "replacement": {"type": "string"}}},
        risk="medium",
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        path = ctx.path_policy.resolve(str(args["path"]))
        current = path.read_text(encoding="utf-8")
        old = str(args["expected_old"])
        new = str(args["replacement"])
        if old not in current:
            return ToolResult(False, error="expected_old not found")
        if not ctx.config.agent.dry_run:
            path.write_text(current.replace(old, new, 1), encoding="utf-8")
        return ToolResult(True, {"path": str(path.relative_to(ctx.workspace)), "dry_run": ctx.config.agent.dry_run}, evidence=[f"replace_in_file:{path}"])


class SearchFilesTool:
    spec = ToolSpec(
        name="search_files",
        description="Search workspace files by glob and text query.",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}, "glob": {"type": "string"}, "max_results": {"type": "integer"}}},
    )

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = str(args.get("query", ""))
        pattern = str(args.get("glob", "**/*"))
        max_results = int(args.get("max_results", 50))
        matches: list[dict[str, Any]] = []
        excluded = set(ctx.config.poller.excluded_dirs)
        for path in ctx.workspace.rglob("*"):
            if len(matches) >= max_results:
                break
            if not path.is_file():
                continue
            rel = path.relative_to(ctx.workspace).as_posix()
            if any(part in excluded for part in Path(rel).parts):
                continue
            if not fnmatch.fnmatch(rel, pattern):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if query and query not in text and query.lower() not in text.lower() and query not in rel:
                continue
            line = None
            if query:
                for idx, value in enumerate(text.splitlines(), 1):
                    if query.lower() in value.lower():
                        line = idx
                        break
            matches.append({"path": rel, "line": line})
        return ToolResult(True, {"matches": matches}, evidence=[f"search_files:{query or pattern}"])
