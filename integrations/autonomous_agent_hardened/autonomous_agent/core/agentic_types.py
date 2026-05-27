"""Data contracts for the OpenClaw-like agent runtime."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class StepKind(str, Enum):
    THINK = "think"
    TOOL = "tool"
    VERIFY = "verify"
    FINAL = "final"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass(slots=True)
class AgenticStep:
    id: str
    kind: StepKind
    objective: str
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    status: StepStatus = StepStatus.PENDING
    result: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "objective": self.objective,
            "tool": self.tool,
            "args": self.args,
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
        }


@dataclass(slots=True)
class AgenticPlan:
    task: str
    steps: list[AgenticStep] = field(default_factory=list)
    confidence: float = 0.0
    source: str = "deterministic"

    def to_dict(self) -> dict[str, Any]:
        return {"task": self.task, "confidence": self.confidence, "source": self.source, "steps": [s.to_dict() for s in self.steps]}


@dataclass(slots=True)
class AgenticRunResult:
    status: str
    task: str
    iterations: int
    plans: list[AgenticPlan]
    trace: list[dict[str, Any]]
    final_message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "task": self.task,
            "iterations": self.iterations,
            "plans": [p.to_dict() for p in self.plans],
            "trace": self.trace,
            "final_message": self.final_message,
        }
