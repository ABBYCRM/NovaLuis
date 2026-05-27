"""BOS_TRINITY governance kernel.

This module turns the megalithic ASCII tree into executable guardrails. It is not a
lawyer, court, or source of legal authority; it is a policy kernel for evidence,
jurisdiction, safety, reversibility, and auditability gates.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


BOS_TRINITY_ASCII = r"""
BOS_TRINITY_US_LAW_MASTER_OS_v3.0_ULTRADENSE
├─0.PL: Reality>constraints+feedback; Evidence>claims ranked; Governance>no bypass
├─1.KERNEL: truth,evidence,claim,inference,uncertainty,authority,jurisdiction,remedy,auditability
├─1.4 AH: safety_veto>ethical_redline>evidence_gate>legal_gate>source_gate>jurisdiction_gate>posture_gate>remedy_gate>capacity_gate
├─6.GOV: observe_only|advisory|constrained_execution|restricted_defer
├─7.5 LEGAL: US_grounded|evidence_ranked|jurisdiction_aware|posture_aware|remedy_aware|sanction_averse
├─7.5.7 PIPE: intake>domain_route>source_hierarchy>jurisdiction>posture>claim_elements>evidence>precedent>remedy>leverage>simulate>tri_state_gate
├─8.FAIL: false_coherence|confidence_inflation|legal_overreach|source_hierarchy_collapse|jurisdiction_confusion|posture_blindness
├─9.REDTEAM: deceptive_input|partial_truth|conflicting_evidence|urgency_pressure|wrong_jurisdiction|wrong_authority_priority
├─10.RUNTIME: 30S|3M|15M|DEEP|EMERG
└─15.OUTFMT: decision=COMMIT|DEFER|REJECT, confidence=0..1, risk_profile, evidence_class, reversibility, safeguards, arbitration_trace, audit_ready
""".strip()


class Decision(str, Enum):
    COMMIT = "COMMIT"
    DEFER = "DEFER"
    REJECT = "REJECT"


class Authority(str, Enum):
    OBSERVE_ONLY = "observe_only"
    ADVISORY = "advisory"
    CONSTRAINED_EXECUTION = "constrained_execution"
    RESTRICTED_DEFER = "restricted_defer"


@dataclass(slots=True)
class GovernanceInput:
    action_type: str
    evidence: list[str] = field(default_factory=list)
    authority: Authority = Authority.CONSTRAINED_EXECUTION
    jurisdiction: str | None = None
    posture: str | None = None
    remedy: str | None = None
    destructive: bool = False
    external_effect: bool = False
    legal_domain: bool = False
    confidence: float = 0.0
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class GovernanceDecision:
    decision: Decision
    confidence: float
    risk_profile: str
    reasoning_summary: str
    evidence_class: str
    reversibility: str
    safeguards: list[str] = field(default_factory=list)
    arbitration_trace: list[str] = field(default_factory=list)
    audit_ready: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "confidence": self.confidence,
            "risk_profile": self.risk_profile,
            "reasoning_summary": self.reasoning_summary,
            "evidence_class": self.evidence_class,
            "reversibility": self.reversibility,
            "safeguards": self.safeguards,
            "arbitration_trace": self.arbitration_trace,
            "audit_ready": self.audit_ready,
        }


class BOSTrinityKernel:
    """Tri-state arbitration kernel: COMMIT, DEFER, or REJECT."""

    def __init__(self, allow_destructive: bool = False, allow_external_effects: bool = False):
        self.allow_destructive = allow_destructive
        self.allow_external_effects = allow_external_effects

    def decide(self, request: GovernanceInput) -> GovernanceDecision:
        trace: list[str] = ["reality_gate", "evidence_gate", "authority_gate"]
        safeguards: list[str] = ["append_only_audit", "secret_redaction", "workspace_containment"]

        if request.authority in {Authority.OBSERVE_ONLY, Authority.RESTRICTED_DEFER}:
            return GovernanceDecision(
                decision=Decision.DEFER,
                confidence=min(request.confidence, 0.5),
                risk_profile="medium",
                reasoning_summary="authority scope does not permit execution",
                evidence_class=self._evidence_class(request.evidence),
                reversibility="high",
                safeguards=safeguards + ["human_review_required"],
                arbitration_trace=trace + ["capacity_gate:defer"],
            )

        if request.destructive and not self.allow_destructive:
            return GovernanceDecision(
                decision=Decision.REJECT,
                confidence=0.95,
                risk_profile="high",
                reasoning_summary="destructive operation blocked by governance policy",
                evidence_class=self._evidence_class(request.evidence),
                reversibility="low",
                safeguards=safeguards + ["destructive_ops_disabled"],
                arbitration_trace=trace + ["reversibility_gate:reject"],
            )

        if request.external_effect and not self.allow_external_effects:
            return GovernanceDecision(
                decision=Decision.DEFER,
                confidence=0.8,
                risk_profile="medium",
                reasoning_summary="external-effect operation requires explicit approval/configuration",
                evidence_class=self._evidence_class(request.evidence),
                reversibility="medium",
                safeguards=safeguards + ["external_effect_approval_required"],
                arbitration_trace=trace + ["legal_gate:defer"],
            )

        if request.legal_domain:
            trace.extend(["source_gate", "jurisdiction_gate", "posture_gate", "remedy_gate"])
            missing = []
            if not request.jurisdiction:
                missing.append("jurisdiction")
            if not request.posture:
                missing.append("posture")
            if not request.remedy:
                missing.append("remedy")
            if missing:
                return GovernanceDecision(
                    decision=Decision.DEFER,
                    confidence=min(request.confidence, 0.6),
                    risk_profile="medium",
                    reasoning_summary="legal shell missing required gates: " + ", ".join(missing),
                    evidence_class=self._evidence_class(request.evidence),
                    reversibility="high",
                    safeguards=safeguards + ["no_legal_conclusion_without_required_gates"],
                    arbitration_trace=trace + ["legal_shell:defer"],
                )

        if request.confidence < 0.25 and request.action_type not in {"read", "search", "verify"}:
            return GovernanceDecision(
                decision=Decision.DEFER,
                confidence=request.confidence,
                risk_profile="medium",
                reasoning_summary="confidence too low for non-read action",
                evidence_class=self._evidence_class(request.evidence),
                reversibility="high",
                safeguards=safeguards + ["increase_evidence_density"],
                arbitration_trace=trace + ["uncertainty_gate:defer"],
            )

        return GovernanceDecision(
            decision=Decision.COMMIT,
            confidence=max(request.confidence, 0.5),
            risk_profile="low" if not request.destructive else "medium",
            reasoning_summary="operation allowed within configured authority and safeguards",
            evidence_class=self._evidence_class(request.evidence),
            reversibility="high" if request.action_type in {"read", "search", "verify"} else "medium",
            safeguards=safeguards,
            arbitration_trace=trace + ["tri_state_gate:commit"],
        )

    @staticmethod
    def _evidence_class(evidence: list[str]) -> str:
        if not evidence:
            return "inferred"
        text = " ".join(evidence).lower()
        if any(word in text for word in ("pytest", "test", "compile", "git diff", "stdout", "stderr")):
            return "observed"
        if any(word in text for word in ("primary", "statute", "record", "document")):
            return "reported"
        return "inferred"
