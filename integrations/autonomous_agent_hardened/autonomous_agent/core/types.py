"""Domain models used across the agent."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Literal

PatchAction = Literal["write", "replace", "delete"]


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(slots=True)
class Finding:
    code: str
    message: str
    path: str | None = None
    line: int | None = None
    severity: Severity = Severity.MEDIUM
    evidence: str | None = None


@dataclass(slots=True)
class PatchOperation:
    path: str
    action: PatchAction
    content: str | None = None
    expected_old: str | None = None
    replacement: str | None = None
    reason: str = ""


@dataclass(slots=True)
class AnalysisResult:
    findings: list[Finding] = field(default_factory=list)
    patches: list[PatchOperation] = field(default_factory=list)
    confidence: float = 0.0
    source: str = "rule"

    @property
    def has_patch(self) -> bool:
        return bool(self.patches)


@dataclass(slots=True)
class PatchApplyResult:
    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(slots=True)
class ReviewResult:
    approved: bool
    confidence: float
    reasons: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)


@dataclass(slots=True)
class TestResult:
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False

    @property
    def passed(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


@dataclass(slots=True)
class AgentRunResult:
    status: str
    analyses: list[AnalysisResult]
    patches: PatchApplyResult
    reviews: list[ReviewResult]
    tests: list[TestResult]
    workspace: Path
