"""Data contracts for non-clinical user-understanding analysis."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class SignalSource(str, Enum):
    EXPLICIT_USER = "explicit_user"
    CONVERSATION_STYLE = "conversation_style"
    TASK_CONTEXT = "task_context"
    SAFETY_GUARDRAIL = "safety_guardrail"
    INFERENCE_LOW_CONFIDENCE = "inference_low_confidence"


@dataclass(slots=True)
class UserSignal:
    key: str
    value: str
    confidence: float
    source: SignalSource
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["source"] = self.source.value
        return payload


@dataclass(slots=True)
class UserOpsProfile:
    """Stable operating profile for adapting agent behavior.

    This is not a medical profile. It is a response-planning profile: what kind
    of answer style, evidence, boundaries, and support the agent should use.
    """

    preferred_style: list[str] = field(default_factory=list)
    cognitive_tools: list[str] = field(default_factory=list)
    stress_markers: list[str] = field(default_factory=list)
    boundary_needs: list[str] = field(default_factory=list)
    execution_preferences: list[str] = field(default_factory=list)
    clinical_guardrails: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class UserUnderstandingResult:
    profile: UserOpsProfile
    signals: list[UserSignal] = field(default_factory=list)
    response_strategy: list[str] = field(default_factory=list)
    safety_flags: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)
    confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "profile": self.profile.to_dict(),
            "signals": [signal.to_dict() for signal in self.signals],
            "response_strategy": self.response_strategy,
            "safety_flags": self.safety_flags,
            "avoid": self.avoid,
            "confidence": self.confidence,
        }
