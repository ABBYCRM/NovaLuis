"""Rule-based non-clinical user-understanding engine."""
from __future__ import annotations

import re
from collections.abc import Iterable

from .models import SignalSource, UserOpsProfile, UserSignal, UserUnderstandingResult
from .psych_alphabet import PSYCH_ALPHABET_TREE

_CRISIS_PATTERNS = [
    re.compile(r"\b(kill myself|suicide|end my life)\b", re.I),
    re.compile(r"\b(i\s+(?:want to|might|will|am going to)\s+self[- ]?harm)\b", re.I),
    re.compile(r"\b(i want to die|can't go on)\b", re.I),
]
_URGENCY_PATTERNS = [re.compile(r"\b(now|right away|asap|immediately|urgent|fix it all)\b", re.I)]
_EXECUTION_PATTERNS = [re.compile(r"\b(read|inspect|patch|run tests|verify|prove it|no fake success|do not hallucinate)\b", re.I)]
_BOUNDARY_PATTERNS = [re.compile(r"\b(boundary|scapegoat|golden child|FOG|family of origin|FOO)\b", re.I)]
_THERAPY_PATTERNS = [re.compile(r"\b(CBT|DBT|ACT|EMDR|ERP|PTSD|C-PTSD|OCD|ADHD|ASD)\b", re.I)]


class UserUnderstandingEngine:
    """Extract response-planning signals from the user's message.

    The output is deliberately about interaction strategy, not diagnosis.
    """

    def __init__(self, reference_tree: dict | None = None) -> None:
        self.reference_tree = reference_tree or PSYCH_ALPHABET_TREE

    def analyze(self, text: str, *, task_context: str | None = None) -> UserUnderstandingResult:
        evidence_text = " ".join(part for part in (text, task_context or "") if part)
        signals: list[UserSignal] = []
        safety_flags: list[str] = []
        response_strategy = [
            "use direct language",
            "separate facts, assumptions, verification, and blockers",
            "prefer executable steps over abstract reflection",
            "do not diagnose; treat psych terms as user-supplied vocabulary",
        ]
        avoid = [
            "do not label the user or family members with disorders as fact",
            "do not offer therapy simulation or clinical treatment",
            "do not give vague reassurance instead of evidence",
        ]

        if self._matches(_CRISIS_PATTERNS, evidence_text):
            safety_flags.append("crisis_language_detected")
            response_strategy.insert(0, "prioritize immediate safety and human support")
            signals.append(self._signal("safety.crisis_language", "possible crisis wording detected", 0.9, SignalSource.SAFETY_GUARDRAIL, evidence_text))

        if self._matches(_URGENCY_PATTERNS, evidence_text) or self._uppercase_ratio(text) > 0.25:
            signals.append(self._signal("style.urgency", "high urgency / intensity", 0.75, SignalSource.CONVERSATION_STYLE, evidence_text))
            response_strategy.append("acknowledge intensity briefly, then move into concrete action")

        if self._matches(_EXECUTION_PATTERNS, evidence_text):
            signals.append(self._signal("preference.execution_first", "wants read/patch/verify behavior", 0.9, SignalSource.EXPLICIT_USER, evidence_text))
            response_strategy.append("report commands run and test evidence before claiming success")

        if self._matches(_BOUNDARY_PATTERNS, evidence_text):
            signals.append(self._signal("context.family_systems", "family-system / boundary vocabulary present", 0.65, SignalSource.EXPLICIT_USER, evidence_text))
            response_strategy.append("use boundary-aware wording without escalating blame")

        if self._matches(_THERAPY_PATTERNS, evidence_text):
            signals.append(self._signal("vocabulary.psych_modalities", "therapy/diagnosis vocabulary present", 0.8, SignalSource.EXPLICIT_USER, evidence_text))
            response_strategy.append("translate therapy vocabulary into non-clinical operating rules")

        profile = UserOpsProfile(
            preferred_style=["direct", "evidence-first", "structured", "execution-oriented"],
            cognitive_tools=["CBT as belief refactor", "DBT as regulation/boundaries", "ACT as values-to-action", "ERP as anti-reassurance-loop guard"],
            stress_markers=["urgency", "uppercase emphasis", "anti-hallucination demands", "proof demands"],
            boundary_needs=["firm boundaries", "no shame", "role-awareness without diagnosis"],
            execution_preferences=["read before answering", "patch when tools allow", "verify before success", "clear blockers"],
            clinical_guardrails=list(self.reference_tree["hard_limits"]),
        )
        confidence = self._confidence(signals)
        return UserUnderstandingResult(profile=profile, signals=signals, response_strategy=self._dedupe(response_strategy), safety_flags=safety_flags, avoid=avoid, confidence=confidence)

    @staticmethod
    def _matches(patterns: Iterable[re.Pattern[str]], text: str) -> bool:
        return any(pattern.search(text) for pattern in patterns)

    @staticmethod
    def _uppercase_ratio(text: str) -> float:
        letters = [ch for ch in text if ch.isalpha()]
        if not letters:
            return 0.0
        return sum(1 for ch in letters if ch.isupper()) / len(letters)

    @staticmethod
    def _signal(key: str, value: str, confidence: float, source: SignalSource, text: str) -> UserSignal:
        snippet = text.strip().replace("\n", " ")[:180]
        return UserSignal(key=key, value=value, confidence=confidence, source=source, evidence=[snippet] if snippet else [])

    @staticmethod
    def _confidence(signals: list[UserSignal]) -> float:
        if not signals:
            return 0.35
        return min(0.95, sum(signal.confidence for signal in signals) / len(signals))

    @staticmethod
    def _dedupe(items: list[str]) -> list[str]:
        return list(dict.fromkeys(items))
