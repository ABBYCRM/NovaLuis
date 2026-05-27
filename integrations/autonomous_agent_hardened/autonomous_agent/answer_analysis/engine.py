from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
import re
import json
import datetime


# ============================================================
# ANSWER_ANALYSIS_ENGINE_OS
# Ethical, non-manipulative, agentic answer analysis runtime
# ============================================================


class ClaimType(str, Enum):
    FACT = "fact"
    MEMORY = "memory"
    INTERPRETATION = "interpretation"
    EMOTION = "emotion"
    ASSUMPTION = "assumption"
    HEARSAY = "hearsay"
    OPINION = "opinion"
    PREDICTION = "prediction"
    INTENT_CLAIM = "intent_claim"
    MOTIVE_CLAIM = "motive_claim"
    CAUSAL_CLAIM = "causal_claim"
    VALUE_JUDGMENT = "value_judgment"
    IDENTITY_CLAIM = "identity_claim"
    UNCERTAINTY_CLAIM = "uncertainty_claim"
    UNKNOWN = "unknown"


class EvidenceStatus(str, Enum):
    VERIFIED = "verified"
    SUPPORTED = "supported"
    PLAUSIBLE = "plausible"
    UNSUPPORTED = "unsupported"
    CONTRADICTED = "contradicted"
    UNKNOWN = "unknown"


class ConfidenceGrade(str, Enum):
    VERY_LOW = "very_low"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


class EthicsStatus(str, Enum):
    PASS = "pass"
    WARNING = "warning"
    BLOCK = "block"


class FollowUpType(str, Enum):
    CLARIFY = "clarify"
    VERIFY = "verify"
    SOURCE_CHECK = "source_check"
    TIMELINE_CHECK = "timeline_check"
    UNCERTAINTY_CHECK = "uncertainty_check"
    ALTERNATIVE_EXPLANATION = "alternative_explanation"
    CORRECTION_WINDOW = "correction_window"
    CONTEXT_EXPAND = "context_expand"
    CONSTRAINT_CHECK = "constraint_check"
    EVIDENCE_REQUEST = "evidence_request"
    MEANING_CHECK = "meaning_check"


# ============================================================
# DATA MODELS
# ============================================================


@dataclass
class EvidenceItem:
    evidence_id: str
    evidence_type: str
    description: str
    source: Optional[str] = None
    reliability: Optional[str] = None
    supports_claim_ids: List[str] = field(default_factory=list)
    contradicts_claim_ids: List[str] = field(default_factory=list)


@dataclass
class ClaimUnit:
    claim_id: str
    text: str
    claim_type: ClaimType
    evidence_status: EvidenceStatus = EvidenceStatus.UNKNOWN
    supporting_evidence: List[str] = field(default_factory=list)
    contradicting_evidence: List[str] = field(default_factory=list)
    confidence_score: float = 0.0
    confidence_grade: ConfidenceGrade = ConfidenceGrade.VERY_LOW
    notes: List[str] = field(default_factory=list)


@dataclass
class PsychologicalSignal:
    signal: str
    markers: List[str]
    confidence_score: float
    ethical_note: str = "Hypothesis only. Not proof. Do not diagnose."


@dataclass
class HiddenConstraint:
    constraint: str
    markers: List[str]
    confidence_score: float
    ethical_note: str = "Possible pressure, not confirmed unless directly stated or evidenced."


@dataclass
class IncentiveMap:
    possible_gains: List[str] = field(default_factory=list)
    possible_losses: List[str] = field(default_factory=list)
    possible_beneficiaries: List[str] = field(default_factory=list)
    possible_harmed_parties: List[str] = field(default_factory=list)
    apparent_desired_outcomes: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=lambda: [
        "Incentive does not prove dishonesty.",
        "Outcome-seeking does not prove falsehood.",
        "Possible benefit or loss must be treated as context, not proof."
    ])


@dataclass
class ContradictionOrTension:
    tension_type: str
    description: str
    related_claims: List[str]
    clarification_question: str


@dataclass
class EthicalFollowUp:
    question: str
    follow_up_type: FollowUpType
    purpose: str
    safety_note: str = "Non-leading, non-coercive, dignity-preserving."


@dataclass
class AuditNotes:
    manipulation_check: EthicsStatus
    coercion_check: EthicsStatus
    dignity_check: EthicsStatus
    evidence_separation_check: EthicsStatus
    uncertainty_preserved: bool
    blocked_reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class SurfaceStatement:
    exact_words: str
    paraphrase: str
    key_terms: List[str]
    certainty_markers: List[str]
    uncertainty_markers: List[str]
    emotional_markers: List[str]
    temporal_markers: List[str]


@dataclass
class AnswerAnalysisInput:
    subject_answer: str
    question_asked: Optional[str] = None
    speaker_role: Optional[str] = None
    context: Optional[str] = None
    known_facts: List[str] = field(default_factory=list)
    available_evidence: List[EvidenceItem] = field(default_factory=list)
    prior_statements: List[str] = field(default_factory=list)
    timeline: List[str] = field(default_factory=list)
    interview_goal: Optional[str] = None
    risk_level: Optional[str] = None
    consent_status: Optional[str] = "unclear"


@dataclass
class AnswerAnalysisReport:
    engine_version: str
    timestamp_utc: str
    ethics_status: EthicsStatus
    surface_statement: SurfaceStatement
    claim_units: List[ClaimUnit]
    psychological_signal_hypotheses: List[PsychologicalSignal]
    hidden_constraint_hypotheses: List[HiddenConstraint]
    incentive_map: IncentiveMap
    contradictions_or_tensions: List[ContradictionOrTension]
    unknowns: List[str]
    ethical_follow_up_questions: List[EthicalFollowUp]
    overall_confidence_score: float
    overall_confidence_grade: ConfidenceGrade
    audit_notes: AuditNotes


# ============================================================
# ETHICS GATE
# ============================================================


class EthicsGate:
    FORBIDDEN_PATTERNS = [
        r"\btrap\b",
        r"\btrick\b",
        r"\bforce\b",
        r"\bcoerce\b",
        r"\bmake them admit\b",
        r"\bbreak them\b",
        r"\bpressure them\b",
        r"\bmanipulate\b",
        r"\bdeceive\b",
        r"\bfake evidence\b",
        r"\bthreaten\b"
    ]

    SENSITIVE_RISK_LEVELS = {
        "legal",
        "medical",
        "safety",
        "employment",
        "financial",
        "reputational",
        "domestic",
        "criminal",
        "immigration"
    }

    def check(self, data: AnswerAnalysisInput) -> Tuple[EthicsStatus, AuditNotes]:
        blocked_reasons: List[str] = []
        warnings: List[str] = []

        combined = " ".join([
            data.subject_answer or "",
            data.question_asked or "",
            data.context or "",
            data.interview_goal or ""
        ]).lower()

        for pattern in self.FORBIDDEN_PATTERNS:
            if re.search(pattern, combined):
                blocked_reasons.append(f"Forbidden coercive/manipulative pattern detected: {pattern}")

        if data.consent_status in {"withdrawn"}:
            blocked_reasons.append("Consent withdrawn.")

        if data.consent_status in {"unclear", None}:
            warnings.append("Consent status unclear. Use only non-invasive analysis and consent-based follow-up.")

        if data.risk_level in self.SENSITIVE_RISK_LEVELS:
            warnings.append(f"Sensitive risk context detected: {data.risk_level}. Preserve uncertainty and dignity.")

        if blocked_reasons:
            status = EthicsStatus.BLOCK
        elif warnings:
            status = EthicsStatus.WARNING
        else:
            status = EthicsStatus.PASS

        audit = AuditNotes(
            manipulation_check=EthicsStatus.BLOCK if blocked_reasons else EthicsStatus.PASS,
            coercion_check=EthicsStatus.BLOCK if blocked_reasons else EthicsStatus.PASS,
            dignity_check=EthicsStatus.PASS,
            evidence_separation_check=EthicsStatus.PASS,
            uncertainty_preserved=True,
            blocked_reasons=blocked_reasons,
            warnings=warnings
        )

        return status, audit


# ============================================================
# SURFACE STATEMENT CAPTURE
# ============================================================


class SurfaceStatementExtractor:
    CERTAINTY_MARKERS = [
        "definitely", "absolutely", "clearly", "obviously", "without question",
        "i know", "i am sure", "no doubt", "always", "never"
    ]

    UNCERTAINTY_MARKERS = [
        "maybe", "probably", "possibly", "i think", "i guess", "i believe",
        "i'm not sure", "not sure", "i don't remember", "i cannot remember",
        "i might", "it seemed", "as far as i know"
    ]

    EMOTIONAL_MARKERS = [
        "scared", "afraid", "angry", "mad", "sad", "ashamed", "embarrassed",
        "guilty", "confused", "worried", "nervous", "hurt", "betrayed",
        "pressured", "threatened", "unsafe"
    ]

    TEMPORAL_MARKERS = [
        "before", "after", "then", "later", "earlier", "yesterday", "today",
        "tomorrow", "morning", "afternoon", "night", "week", "month", "year",
        "at first", "eventually", "immediately"
    ]

    def extract(self, text: str) -> SurfaceStatement:
        lowered = text.lower()

        certainty = [m for m in self.CERTAINTY_MARKERS if m in lowered]
        uncertainty = [m for m in self.UNCERTAINTY_MARKERS if m in lowered]
        emotional = [m for m in self.EMOTIONAL_MARKERS if m in lowered]
        temporal = [m for m in self.TEMPORAL_MARKERS if m in lowered]

        key_terms = self._extract_key_terms(text)

        return SurfaceStatement(
            exact_words=text,
            paraphrase=text.strip(),
            key_terms=key_terms,
            certainty_markers=certainty,
            uncertainty_markers=uncertainty,
            emotional_markers=emotional,
            temporal_markers=temporal
        )

    def _extract_key_terms(self, text: str) -> List[str]:
        words = re.findall(r"\b[A-Za-z][A-Za-z0-9_-]{2,}\b", text)
        stop = {
            "the", "and", "but", "for", "with", "that", "this", "was", "were",
            "you", "they", "she", "him", "her", "his", "our", "from", "have",
            "has", "had", "not", "did", "does", "what", "when", "where"
        }
        terms = []
        for w in words:
            lw = w.lower()
            if lw not in stop and lw not in terms:
                terms.append(lw)
        return terms[:50]


# ============================================================
# CLAIM SEGMENTATION + CLASSIFICATION
# ============================================================


class ClaimClassifier:
    HEARSAY_MARKERS = [
        "told me", "said that", "i heard", "someone said", "they told",
        "according to", "rumor", "reported that"
    ]

    MEMORY_MARKERS = [
        "i remember", "i recall", "i saw", "i heard", "i noticed",
        "i was there", "from what i remember"
    ]

    EMOTION_MARKERS = [
        "i felt", "i was scared", "i was angry", "i was afraid", "i was embarrassed",
        "i was ashamed", "i felt guilty", "i felt pressured"
    ]

    ASSUMPTION_MARKERS = [
        "i assumed", "i figured", "i guessed", "i thought", "i believed",
        "must have", "probably"
    ]

    INTERPRETATION_MARKERS = [
        "it seemed", "it looked like", "it felt like", "i interpreted",
        "i took it as", "to me that meant"
    ]

    CAUSAL_MARKERS = [
        "because", "caused", "led to", "resulted in", "made me", "therefore",
        "so that", "due to"
    ]

    INTENT_MARKERS = [
        "wanted to", "meant to", "planned to", "intended to", "on purpose",
        "deliberately", "trying to"
    ]

    OPINION_MARKERS = [
        "i think", "in my opinion", "i believe", "good", "bad", "wrong",
        "right", "irresponsible", "unfair", "trustworthy", "dishonest"
    ]

    UNCERTAINTY_MARKERS = [
        "not sure", "maybe", "possibly", "i don't know", "unclear",
        "i cannot remember", "i might be wrong"
    ]

    def segment(self, text: str) -> List[str]:
        raw_segments = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
        segments = [s.strip() for s in raw_segments if s.strip()]

        if len(segments) == 1:
            soft_segments = re.split(r"\s+(?:and then|then|but|however|also)\s+", segments[0], flags=re.I)
            if len(soft_segments) > 1:
                segments = [s.strip() for s in soft_segments if s.strip()]

        return segments

    def classify(self, claim_text: str) -> ClaimType:
        text = claim_text.lower()

        if self._contains_any(text, self.HEARSAY_MARKERS):
            return ClaimType.HEARSAY

        if self._contains_any(text, self.EMOTION_MARKERS):
            return ClaimType.EMOTION

        if self._contains_any(text, self.UNCERTAINTY_MARKERS):
            return ClaimType.UNCERTAINTY_CLAIM

        if self._contains_any(text, self.MEMORY_MARKERS):
            return ClaimType.MEMORY

        if self._contains_any(text, self.INTERPRETATION_MARKERS):
            return ClaimType.INTERPRETATION

        if self._contains_any(text, self.ASSUMPTION_MARKERS):
            return ClaimType.ASSUMPTION

        if self._contains_any(text, self.INTENT_MARKERS):
            return ClaimType.INTENT_CLAIM

        if self._contains_any(text, self.CAUSAL_MARKERS):
            return ClaimType.CAUSAL_CLAIM

        if self._contains_any(text, self.OPINION_MARKERS):
            return ClaimType.OPINION

        if self._looks_like_fact(text):
            return ClaimType.FACT

        return ClaimType.UNKNOWN

    def build_claim_units(self, text: str) -> List[ClaimUnit]:
        segments = self.segment(text)
        claims: List[ClaimUnit] = []

        for idx, segment in enumerate(segments, start=1):
            claim_type = self.classify(segment)
            claim = ClaimUnit(
                claim_id=f"CLAIM_{idx:03d}",
                text=segment,
                claim_type=claim_type
            )
            claims.append(claim)

        return claims

    def _contains_any(self, text: str, markers: List[str]) -> bool:
        return any(marker in text for marker in markers)

    def _looks_like_fact(self, text: str) -> bool:
        has_actor = bool(re.search(r"\b(i|he|she|they|we|it|the|a|an)\b", text))
        has_verb = bool(re.search(r"\b(was|were|is|are|did|went|sent|signed|called|met|paid|received|left|arrived|started|ended)\b", text))
        return has_actor and has_verb


# ============================================================
# EVIDENCE MAPPER
# ============================================================


class EvidenceMapper:
    def map_evidence(self, claims: List[ClaimUnit], evidence: List[EvidenceItem]) -> List[ClaimUnit]:
        evidence_by_support: Dict[str, List[str]] = {}
        evidence_by_contradiction: Dict[str, List[str]] = {}

        for item in evidence:
            for claim_id in item.supports_claim_ids:
                evidence_by_support.setdefault(claim_id, []).append(item.evidence_id)

            for claim_id in item.contradicts_claim_ids:
                evidence_by_contradiction.setdefault(claim_id, []).append(item.evidence_id)

        for claim in claims:
            claim.supporting_evidence = evidence_by_support.get(claim.claim_id, [])
            claim.contradicting_evidence = evidence_by_contradiction.get(claim.claim_id, [])

            if claim.contradicting_evidence:
                claim.evidence_status = EvidenceStatus.CONTRADICTED
            elif claim.supporting_evidence:
                if len(claim.supporting_evidence) >= 2:
                    claim.evidence_status = EvidenceStatus.VERIFIED
                else:
                    claim.evidence_status = EvidenceStatus.SUPPORTED
            else:
                if claim.claim_type in {
                    ClaimType.EMOTION,
                    ClaimType.OPINION,
                    ClaimType.INTERPRETATION,
                    ClaimType.ASSUMPTION,
                    ClaimType.UNCERTAINTY_CLAIM
                }:
                    claim.evidence_status = EvidenceStatus.PLAUSIBLE
                else:
                    claim.evidence_status = EvidenceStatus.UNSUPPORTED

        return claims


# ============================================================
# PSYCHOLOGICAL SIGNAL DETECTOR
# ============================================================


class PsychologicalSignalDetector:
    SIGNAL_MARKERS = {
        "fear": [
            "afraid", "scared", "unsafe", "threatened", "retaliation",
            "worried what would happen", "danger"
        ],
        "shame": [
            "embarrassed", "ashamed", "stupid", "my fault", "humiliated",
            "i should have known"
        ],
        "guilt": [
            "sorry", "regret", "i should not have", "i wish i had not",
            "my responsibility"
        ],
        "anger": [
            "angry", "mad", "furious", "unfair", "violated", "betrayed"
        ],
        "loyalty": [
            "protect", "family", "friend", "team", "i don't want them in trouble",
            "loyal"
        ],
        "avoidance": [
            "i don't want to talk about", "nothing happened", "whatever",
            "it does not matter", "skip", "not important"
        ],
        "control": [
            "only answer", "do not ask", "that's all you need to know",
            "end of story", "obviously"
        ],
        "confusion": [
            "confused", "not sure", "can't remember", "unclear",
            "mixed up", "i don't know"
        ]
    }

    def detect(self, text: str) -> List[PsychologicalSignal]:
        lowered = text.lower()
        results: List[PsychologicalSignal] = []

        for signal, markers in self.SIGNAL_MARKERS.items():
            hits = [m for m in markers if m in lowered]
            if hits:
                score = min(1.0, 0.25 + 0.15 * len(hits))
                results.append(PsychologicalSignal(
                    signal=signal,
                    markers=hits,
                    confidence_score=round(score, 2)
                ))

        return results


# ============================================================
# HIDDEN CONSTRAINT DETECTOR
# ============================================================


class HiddenConstraintDetector:
    CONSTRAINT_MARKERS = {
        "legal_risk": [
            "lawyer", "police", "court", "lawsuit", "liability", "charged",
            "illegal", "compliance", "investigation"
        ],
        "social_risk": [
            "people will think", "judged", "community", "friends",
            "everyone knows", "reputation"
        ],
        "financial_risk": [
            "money", "payment", "debt", "refund", "compensation",
            "benefits", "cost", "lose money"
        ],
        "family_pressure": [
            "family", "mother", "father", "wife", "husband", "child",
            "relative", "home"
        ],
        "job_pressure": [
            "boss", "manager", "hr", "coworker", "fired", "job",
            "work", "promotion", "discipline"
        ],
        "reputation_pressure": [
            "image", "name", "reputation", "embarrassing", "public",
            "career"
        ],
        "safety_risk": [
            "threat", "unsafe", "hurt me", "retaliation", "danger",
            "stalking", "violence"
        ]
    }

    def detect(self, text: str) -> List[HiddenConstraint]:
        lowered = text.lower()
        results: List[HiddenConstraint] = []

        for constraint, markers in self.CONSTRAINT_MARKERS.items():
            hits = [m for m in markers if m in lowered]
            if hits:
                score = min(1.0, 0.20 + 0.12 * len(hits))
                results.append(HiddenConstraint(
                    constraint=constraint,
                    markers=hits,
                    confidence_score=round(score, 2)
                ))

        return results


# ============================================================
# INCENTIVE MAPPER
# ============================================================


class IncentiveMapper:
    def map(self, text: str, claims: List[ClaimUnit], context: Optional[str]) -> IncentiveMap:
        lowered = " ".join([text, context or ""]).lower()
        result = IncentiveMap()

        if any(w in lowered for w in ["job", "boss", "fired", "work", "hr"]):
            result.possible_gains.append("job protection")
            result.possible_losses.append("employment stability")
            result.possible_beneficiaries.append("speaker or employer")
            result.apparent_desired_outcomes.append("avoid workplace consequence")

        if any(w in lowered for w in ["money", "refund", "paid", "debt", "compensation"]):
            result.possible_gains.append("financial advantage or recovery")
            result.possible_losses.append("money or financial claim")
            result.possible_beneficiaries.append("financially affected party")
            result.apparent_desired_outcomes.append("financial resolution")

        if any(w in lowered for w in ["family", "friend", "protect", "loyal"]):
            result.possible_gains.append("relationship preservation")
            result.possible_losses.append("relationship trust")
            result.possible_beneficiaries.append("protected person or group")
            result.apparent_desired_outcomes.append("protect another person")

        if any(w in lowered for w in ["lawyer", "court", "police", "lawsuit", "charged"]):
            result.possible_gains.append("legal position protection")
            result.possible_losses.append("legal exposure")
            result.possible_beneficiaries.append("legal party")
            result.apparent_desired_outcomes.append("reduce legal risk")

        if any(w in lowered for w in ["embarrassed", "ashamed", "reputation", "public"]):
            result.possible_gains.append("reputation protection")
            result.possible_losses.append("public image")
            result.possible_beneficiaries.append("speaker or associated group")
            result.apparent_desired_outcomes.append("avoid embarrassment or reputational harm")

        if not any([
            result.possible_gains,
            result.possible_losses,
            result.possible_beneficiaries,
            result.apparent_desired_outcomes
        ]):
            result.apparent_desired_outcomes.append("unknown")

        return result


# ============================================================
# CONTRADICTION / TENSION DETECTOR
# ============================================================


class TensionDetector:
    ABSOLUTE_MARKERS = ["always", "never", "everyone", "nobody", "obviously", "clearly"]
    PASSIVE_VOICE_MARKERS = ["it was done", "mistakes were made", "things happened"]
    HEARSAY_AS_FACT_MARKERS = ["someone said", "i heard", "they told me"]

    def detect(
        self,
        claims: List[ClaimUnit],
        prior_statements: List[str],
        known_facts: List[str]
    ) -> List[ContradictionOrTension]:
        tensions: List[ContradictionOrTension] = []

        for claim in claims:
            lowered = claim.text.lower()

            if any(m in lowered for m in self.ABSOLUTE_MARKERS):
                tensions.append(ContradictionOrTension(
                    tension_type="absolute_language",
                    description="Claim uses absolute language that may need narrowing.",
                    related_claims=[claim.claim_id],
                    clarification_question="When you say that, do you mean always, or were there exceptions?"
                ))

            if any(m in lowered for m in self.PASSIVE_VOICE_MARKERS):
                tensions.append(ContradictionOrTension(
                    tension_type="passive_voice_obscuring_actor",
                    description="Claim may obscure who performed the action.",
                    related_claims=[claim.claim_id],
                    clarification_question="Who specifically took that action?"
                ))

            if claim.claim_type == ClaimType.HEARSAY and claim.evidence_status in {
                EvidenceStatus.UNSUPPORTED,
                EvidenceStatus.UNKNOWN
            }:
                tensions.append(ContradictionOrTension(
                    tension_type="hearsay_presented_without_source_verification",
                    description="Claim appears secondhand and lacks verification.",
                    related_claims=[claim.claim_id],
                    clarification_question="Who was the original source, and did they observe it directly?"
                ))

            if claim.claim_type == ClaimType.CAUSAL_CLAIM and not claim.supporting_evidence:
                tensions.append(ContradictionOrTension(
                    tension_type="unsupported_causal_claim",
                    description="Claim asserts causation without identified evidence.",
                    related_claims=[claim.claim_id],
                    clarification_question="What connects the cause to the outcome, and what else could explain it?"
                ))

        for idx, prior in enumerate(prior_statements, start=1):
            for claim in claims:
                if self._simple_conflict(prior, claim.text):
                    tensions.append(ContradictionOrTension(
                        tension_type="prior_statement_conflict",
                        description=f"Current claim may conflict with prior statement #{idx}.",
                        related_claims=[claim.claim_id],
                        clarification_question="Your earlier statement seems different from this one. What changed or needs correction?"
                    ))

        for idx, fact in enumerate(known_facts, start=1):
            for claim in claims:
                if self._simple_conflict(fact, claim.text):
                    tensions.append(ContradictionOrTension(
                        tension_type="known_fact_conflict",
                        description=f"Current claim may conflict with known fact #{idx}.",
                        related_claims=[claim.claim_id],
                        clarification_question="How does this fit with the verified fact already available?"
                    ))

        return tensions

    def _simple_conflict(self, a: str, b: str) -> bool:
        a_low = a.lower()
        b_low = b.lower()

        negation_pairs = [
            ("was", "was not"),
            ("did", "did not"),
            ("sent", "did not send"),
            ("signed", "did not sign"),
            ("there", "not there"),
            ("yes", "no")
        ]

        for positive, negative in negation_pairs:
            if positive in a_low and negative in b_low:
                return True
            if negative in a_low and positive in b_low:
                return True

        return False


# ============================================================
# CONFIDENCE SCORER
# ============================================================


class ConfidenceScorer:
    def score_claim(self, claim: ClaimUnit) -> ClaimUnit:
        score = 0.25

        if claim.evidence_status == EvidenceStatus.VERIFIED:
            score += 0.50
        elif claim.evidence_status == EvidenceStatus.SUPPORTED:
            score += 0.35
        elif claim.evidence_status == EvidenceStatus.PLAUSIBLE:
            score += 0.10
        elif claim.evidence_status == EvidenceStatus.UNSUPPORTED:
            score -= 0.05
        elif claim.evidence_status == EvidenceStatus.CONTRADICTED:
            score -= 0.30

        if claim.claim_type == ClaimType.FACT:
            score += 0.05
        elif claim.claim_type == ClaimType.HEARSAY:
            score -= 0.10
        elif claim.claim_type == ClaimType.ASSUMPTION:
            score -= 0.10
        elif claim.claim_type == ClaimType.INTERPRETATION:
            score -= 0.05
        elif claim.claim_type == ClaimType.CAUSAL_CLAIM and not claim.supporting_evidence:
            score -= 0.10
        elif claim.claim_type == ClaimType.INTENT_CLAIM and not claim.supporting_evidence:
            score -= 0.10

        if len(claim.text.split()) >= 8:
            score += 0.05

        score = max(0.0, min(1.0, score))
        claim.confidence_score = round(score, 2)
        claim.confidence_grade = self.grade(score)
        return claim

    def overall(self, claims: List[ClaimUnit], tensions: List[ContradictionOrTension]) -> Tuple[float, ConfidenceGrade]:
        if not claims:
            return 0.0, ConfidenceGrade.VERY_LOW

        avg = sum(c.confidence_score for c in claims) / len(claims)
        penalty = min(0.30, len(tensions) * 0.03)
        score = max(0.0, min(1.0, avg - penalty))
        return round(score, 2), self.grade(score)

    def grade(self, score: float) -> ConfidenceGrade:
        if score <= 0.20:
            return ConfidenceGrade.VERY_LOW
        if score <= 0.40:
            return ConfidenceGrade.LOW
        if score <= 0.65:
            return ConfidenceGrade.MEDIUM
        if score <= 0.85:
            return ConfidenceGrade.HIGH
        return ConfidenceGrade.VERY_HIGH


# ============================================================
# ETHICAL FOLLOW-UP GENERATOR
# ============================================================


class EthicalFollowUpGenerator:
    def generate(
        self,
        claims: List[ClaimUnit],
        tensions: List[ContradictionOrTension],
        signals: List[PsychologicalSignal],
        constraints: List[HiddenConstraint]
    ) -> List[EthicalFollowUp]:
        questions: List[EthicalFollowUp] = []

        for claim in claims:
            if claim.evidence_status in {EvidenceStatus.UNSUPPORTED, EvidenceStatus.UNKNOWN}:
                questions.append(EthicalFollowUp(
                    question=f"What evidence, record, message, document, or witness could help verify this claim: '{claim.text}'?",
                    follow_up_type=FollowUpType.VERIFY,
                    purpose="Verify unsupported or unknown claim."
                ))

            if claim.claim_type == ClaimType.HEARSAY:
                questions.append(EthicalFollowUp(
                    question=f"Who originally provided this information, and did they observe it directly: '{claim.text}'?",
                    follow_up_type=FollowUpType.SOURCE_CHECK,
                    purpose="Separate direct knowledge from secondhand information."
                ))

            if claim.claim_type in {ClaimType.INTERPRETATION, ClaimType.ASSUMPTION, ClaimType.INTENT_CLAIM}:
                questions.append(EthicalFollowUp(
                    question=f"What specific facts led you to that interpretation: '{claim.text}'?",
                    follow_up_type=FollowUpType.MEANING_CHECK,
                    purpose="Separate observed facts from interpretation."
                ))

            if claim.claim_type == ClaimType.UNCERTAINTY_CLAIM:
                questions.append(EthicalFollowUp(
                    question="Which parts are you certain about, and which parts feel unclear?",
                    follow_up_type=FollowUpType.UNCERTAINTY_CHECK,
                    purpose="Preserve uncertainty instead of forcing certainty."
                ))

        for tension in tensions:
            questions.append(EthicalFollowUp(
                question=tension.clarification_question,
                follow_up_type=FollowUpType.CLARIFY,
                purpose=f"Clarify tension: {tension.tension_type}"
            ))

        for signal in signals:
            if signal.signal in {"fear", "avoidance", "shame"}:
                questions.append(EthicalFollowUp(
                    question="Is there any part of this that feels unsafe, uncomfortable, or difficult to discuss?",
                    follow_up_type=FollowUpType.CONSTRAINT_CHECK,
                    purpose="Protect dignity and detect pressure without coercion."
                ))

        for constraint in constraints:
            questions.append(EthicalFollowUp(
                question=f"Is {constraint.constraint.replace('_', ' ')} affecting what you feel comfortable saying?",
                follow_up_type=FollowUpType.CONSTRAINT_CHECK,
                purpose="Identify possible pressure ethically."
            ))

        questions.append(EthicalFollowUp(
            question="Is there anything you want to correct, clarify, or add before this is relied on?",
            follow_up_type=FollowUpType.CORRECTION_WINDOW,
            purpose="Give the person a fair correction window."
        ))

        return self._dedupe_questions(questions)

    def _dedupe_questions(self, questions: List[EthicalFollowUp]) -> List[EthicalFollowUp]:
        seen = set()
        unique = []

        for q in questions:
            key = q.question.lower().strip()
            if key not in seen:
                seen.add(key)
                unique.append(q)

        return unique[:25]


# ============================================================
# UNKNOWN DETECTOR
# ============================================================


class UnknownDetector:
    def detect(
        self,
        claims: List[ClaimUnit],
        surface: SurfaceStatement,
        data: AnswerAnalysisInput
    ) -> List[str]:
        unknowns: List[str] = []

        if not data.question_asked:
            unknowns.append("Original question is unknown, so answer framing cannot be fully evaluated.")

        if not data.context:
            unknowns.append("Context is missing or limited.")

        if not data.available_evidence:
            unknowns.append("No external evidence provided for verification.")

        if not data.timeline:
            unknowns.append("Timeline is missing or incomplete.")

        if surface.uncertainty_markers:
            unknowns.append("The answer contains uncertainty markers that should be preserved.")

        unsupported = [c.claim_id for c in claims if c.evidence_status == EvidenceStatus.UNSUPPORTED]
        if unsupported:
            unknowns.append(f"Unsupported claims require verification: {', '.join(unsupported)}.")

        hearsay = [c.claim_id for c in claims if c.claim_type == ClaimType.HEARSAY]
        if hearsay:
            unknowns.append(f"Hearsay claims require source tracing: {', '.join(hearsay)}.")

        return unknowns


# ============================================================
# MAIN ENGINE
# ============================================================


class AnswerAnalysisEngine:
    VERSION = "1.0.0"

    def __init__(self) -> None:
        self.ethics_gate = EthicsGate()
        self.surface_extractor = SurfaceStatementExtractor()
        self.claim_classifier = ClaimClassifier()
        self.evidence_mapper = EvidenceMapper()
        self.psych_detector = PsychologicalSignalDetector()
        self.constraint_detector = HiddenConstraintDetector()
        self.incentive_mapper = IncentiveMapper()
        self.tension_detector = TensionDetector()
        self.confidence_scorer = ConfidenceScorer()
        self.follow_up_generator = EthicalFollowUpGenerator()
        self.unknown_detector = UnknownDetector()

    def analyze(self, data: AnswerAnalysisInput) -> AnswerAnalysisReport:
        ethics_status, audit_notes = self.ethics_gate.check(data)

        surface = self.surface_extractor.extract(data.subject_answer)

        if ethics_status == EthicsStatus.BLOCK:
            return AnswerAnalysisReport(
                engine_version=self.VERSION,
                timestamp_utc=self._now(),
                ethics_status=ethics_status,
                surface_statement=surface,
                claim_units=[],
                psychological_signal_hypotheses=[],
                hidden_constraint_hypotheses=[],
                incentive_map=IncentiveMap(),
                contradictions_or_tensions=[],
                unknowns=["Analysis blocked by ethics gate."],
                ethical_follow_up_questions=[],
                overall_confidence_score=0.0,
                overall_confidence_grade=ConfidenceGrade.VERY_LOW,
                audit_notes=audit_notes
            )

        claims = self.claim_classifier.build_claim_units(data.subject_answer)
        claims = self.evidence_mapper.map_evidence(claims, data.available_evidence)

        for i, claim in enumerate(claims):
            claims[i] = self.confidence_scorer.score_claim(claim)

        psych_signals = self.psych_detector.detect(data.subject_answer)
        hidden_constraints = self.constraint_detector.detect(data.subject_answer)
        incentive_map = self.incentive_mapper.map(data.subject_answer, claims, data.context)

        tensions = self.tension_detector.detect(
            claims=claims,
            prior_statements=data.prior_statements,
            known_facts=data.known_facts
        )

        unknowns = self.unknown_detector.detect(claims, surface, data)

        follow_ups = self.follow_up_generator.generate(
            claims=claims,
            tensions=tensions,
            signals=psych_signals,
            constraints=hidden_constraints
        )

        overall_score, overall_grade = self.confidence_scorer.overall(claims, tensions)

        return AnswerAnalysisReport(
            engine_version=self.VERSION,
            timestamp_utc=self._now(),
            ethics_status=ethics_status,
            surface_statement=surface,
            claim_units=claims,
            psychological_signal_hypotheses=psych_signals,
            hidden_constraint_hypotheses=hidden_constraints,
            incentive_map=incentive_map,
            contradictions_or_tensions=tensions,
            unknowns=unknowns,
            ethical_follow_up_questions=follow_ups,
            overall_confidence_score=overall_score,
            overall_confidence_grade=overall_grade,
            audit_notes=audit_notes
        )

    def to_json(self, report: AnswerAnalysisReport) -> str:
        return json.dumps(asdict(report), indent=2, ensure_ascii=False)

    def _now(self) -> str:
        return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ============================================================
# EXAMPLE AGENT USE
# ============================================================


if __name__ == "__main__":
    engine = AnswerAnalysisEngine()

    example_input = AnswerAnalysisInput(
        subject_answer=(
            "I think he knew what was going on, but I am not completely sure. "
            "Maria told me he was there before the meeting. "
            "I felt pressured because my manager was watching everything."
        ),
        question_asked="What happened before the meeting?",
        speaker_role="witness",
        context="Workplace incident review.",
        known_facts=[
            "A meeting occurred at 3 PM."
        ],
        available_evidence=[
            EvidenceItem(
                evidence_id="EV_001",
                evidence_type="calendar_record",
                description="Calendar invite confirms meeting at 3 PM.",
                source="company_calendar",
                reliability="high",
                supports_claim_ids=["CLAIM_001"]
            )
        ],
        prior_statements=[],
        timeline=[
            "Meeting scheduled at 3 PM."
        ],
        interview_goal="fact_finding",
        risk_level="employment",
        consent_status="explicit"
    )

    report = engine.analyze(example_input)
    print(engine.to_json(report))