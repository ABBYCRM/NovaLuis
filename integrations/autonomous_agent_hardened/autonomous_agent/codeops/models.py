"""Data contracts for governed CodeOps autonomy."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class PolicyDecision(str, Enum):
    ALLOW = "ALLOW"
    BLOCK = "BLOCK"
    REQUIRE_APPROVAL = "REQUIRE_APPROVAL"
    REQUIRE_REVIEW = "REQUIRE_REVIEW"
    REQUIRE_VERIFICATION = "REQUIRE_VERIFICATION"


class AutonomyLevel(str, Enum):
    LEVEL_0 = "level_0_suggest_only"
    LEVEL_1 = "level_1_local_patch"
    LEVEL_2 = "level_2_branch_pr"
    LEVEL_3 = "level_3_ci_observer"
    LEVEL_4 = "level_4_deploy_gate"

    @classmethod
    def coerce(cls, value: str | "AutonomyLevel") -> "AutonomyLevel":
        if isinstance(value, cls):
            return value
        aliases = {
            "level_0": cls.LEVEL_0,
            "level_1": cls.LEVEL_1,
            "level_2": cls.LEVEL_2,
            "level_3": cls.LEVEL_3,
            "level_4": cls.LEVEL_4,
            "suggest": cls.LEVEL_0,
            "local": cls.LEVEL_1,
            "pr": cls.LEVEL_2,
            "ci": cls.LEVEL_3,
            "deploy": cls.LEVEL_4,
        }
        return aliases.get(value, cls(value))


@dataclass(slots=True)
class AutonomyCapabilities:
    can_write_files: bool = False
    can_commit: bool = False
    can_push: bool = False
    can_open_pr: bool = False
    can_monitor_ci: bool = False
    can_deploy: bool = False
    requires_branch: bool = False
    direct_main_push: bool = False
    requires_human_approval: bool = False


CAPABILITIES: dict[AutonomyLevel, AutonomyCapabilities] = {
    AutonomyLevel.LEVEL_0: AutonomyCapabilities(),
    AutonomyLevel.LEVEL_1: AutonomyCapabilities(can_write_files=True),
    AutonomyLevel.LEVEL_2: AutonomyCapabilities(can_write_files=True, can_commit=True, can_push=True, can_open_pr=True, requires_branch=True),
    AutonomyLevel.LEVEL_3: AutonomyCapabilities(can_write_files=True, can_commit=True, can_push=True, can_open_pr=True, can_monitor_ci=True, requires_branch=True),
    AutonomyLevel.LEVEL_4: AutonomyCapabilities(can_write_files=True, can_commit=True, can_push=True, can_open_pr=True, can_monitor_ci=True, can_deploy=False, requires_branch=True, requires_human_approval=True),
}


@dataclass(slots=True)
class CodeOpsDecision:
    decision: PolicyDecision
    reason: str
    risk_level: str = "low"
    evidence: list[str] = field(default_factory=list)
    state: str | None = None
    action: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def allowed(self) -> bool:
        return self.decision in {PolicyDecision.ALLOW, PolicyDecision.REQUIRE_VERIFICATION, PolicyDecision.REQUIRE_REVIEW}

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "reason": self.reason,
            "risk_level": self.risk_level,
            "evidence": self.evidence,
            "state": self.state,
            "action": self.action,
            "metadata": self.metadata,
        }
