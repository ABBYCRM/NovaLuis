"""Tool contracts for OpenClaw-style agent execution."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..config import Config
from ..governance.bos_trinity import BOSTrinityKernel
from ..security.path_policy import PathPolicy
from ..security.redactor import Redactor


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    risk: str = "low"
    destructive: bool = False
    external_effect: bool = False


@dataclass(slots=True)
class ToolResult:
    ok: bool
    output: Any = None
    error: str | None = None
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "output": self.output, "error": self.error, "evidence": self.evidence}


@dataclass(slots=True)
class ToolContext:
    workspace: Path
    config: Config
    path_policy: PathPolicy
    redactor: Redactor
    governance: BOSTrinityKernel


class Tool(Protocol):
    spec: ToolSpec

    def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult: ...


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.spec.name in self._tools:
            raise ValueError(f"duplicate tool registered: {tool.spec.name}")
        self._tools[tool.spec.name] = tool

    def get(self, name: str) -> Tool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise KeyError(f"unknown tool: {name}") from exc

    def names(self) -> list[str]:
        return sorted(self._tools)

    def specs(self) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.spec.name,
                "description": tool.spec.description,
                "input_schema": tool.spec.input_schema,
                "risk": tool.spec.risk,
                "destructive": tool.spec.destructive,
                "external_effect": tool.spec.external_effect,
            }
            for tool in self._tools.values()
        ]
