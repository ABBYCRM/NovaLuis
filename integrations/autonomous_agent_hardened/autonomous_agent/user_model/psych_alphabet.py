"""Luis Ops psych alphabet reference encoded for machines.

Source material: a user-provided ASCII tree covering CBT, DBT, ACT, EMDR, ERP,
personality-pattern vocabulary, diagnosis vocabulary, family-systems roles, FOG,
and an operating layer for identity, skills, boundaries, and the meta-rule that
origin is data rather than destiny.

Safety rule: this knowledge base is for user-context adaptation only. It must not
be used to diagnose the user or third parties.
"""
from __future__ import annotations

from typing import Any

PSYCH_ALPHABET_TREE: dict[str, Any] = {
    "root": {
        "name": "PSYCH_MEGALITHIC_TREE_LUIS_OPS_EDITION",
        "purpose": "Non-clinical user-context map for response planning, self-regulation language, and boundary-aware agent behavior.",
        "meta_rule": "Origin story is data, not destiny; user chooses values and systems.",
    },
    "therapy_modalities": {
        "CBT": {
            "core": "thoughts_feelings_behaviors_loop",
            "agent_use": ["treat beliefs as hypotheses", "separate facts from interpretations", "refactor distorted assumptions"],
        },
        "DBT": {
            "core": "acceptance_and_change",
            "agent_use": ["validate then structure", "check facts", "support boundaries", "reduce escalation"],
        },
        "ACT": {
            "core": "values_based_action_with_defusion",
            "agent_use": ["separate user from story", "anchor recommendations to values", "prefer committed action"],
        },
        "EMDR": {
            "core": "trauma_processing_with_professional_support",
            "agent_use": ["do not simulate therapy", "suggest licensed support for high-charge memories"],
        },
        "ERP": {
            "core": "exposure_without_ritual_response",
            "agent_use": ["notice reassurance loops", "avoid feeding compulsive certainty-seeking", "offer bounded next steps"],
        },
    },
    "pattern_vocabulary": {
        "personality_clusters": ["Cluster A", "Cluster B", "Cluster C"],
        "diagnosis_terms": ["ADHD", "ASD", "MDD", "GAD", "Bipolar", "PTSD", "C-PTSD", "OCD"],
        "guardrail": "Use as vocabulary only; never assert diagnosis without explicit qualified clinical evidence.",
    },
    "family_systems": {
        "FOO": "family_of_origin",
        "roles": ["Golden Child", "Scapegoat", "Lost Child", "Hero", "Mascot"],
        "FOG": {"fear": "abandonment_or_attack_cue", "obligation": "over-explaining_or_over-giving", "guilt": "self-blame_or_ungratefulness_cue"},
        "agent_use": ["watch for role reenactment", "honor boundaries", "avoid shaming", "do not over-pathologize family members"],
    },
    "operating_layer": {
        "identity_reframe": "unplanned_high_variance_architect",
        "skills_map": ["DBT/ACT for regulation", "CBT for belief refactoring", "professional EMDR for high-charge memories", "ERP for sticky avoidance loops"],
        "relationship_strategy": ["name roles without obeying them", "use direct boundaries", "treat FOG as a tag not a command"],
    },
    "response_directives": [
        "be direct and evidence-first",
        "give executable structure",
        "avoid vague reassurance",
        "separate observed facts from assumptions",
        "preserve dignity while enforcing boundaries",
        "ask only when genuinely blocked",
    ],
    "hard_limits": [
        "no diagnosis",
        "no clinical treatment plan",
        "no claims about third-party disorders as fact",
        "crisis or self-harm content requires safety-first response",
    ],
}

PSYCH_ALPHABET_ASCII = r"""
PSYCH_MEGALITHIC_TREE_LUIS_OPS_EDITION
├─ ROOT: origin accepted; system under redesign
├─ THERAPY_MODS
│  ├─ CBT: thoughts↔feelings↔behaviors; belief refactor; evidence tests
│  ├─ DBT: acceptance+change; mindfulness; distress tolerance; emotion regulation; boundaries
│  ├─ ACT: defusion; values; self-as-context; committed action
│  ├─ EMDR: high-charge memories require licensed/professional context
│  └─ ERP: exposure; block rituals; reduce reassurance loops
├─ PERSONALITY_AND_DX_VOCABULARY
│  ├─ Cluster A/B/C terms are vocabulary, not automatic labels
│  ├─ ADHD/ASD/MDD/GAD/Bipolar/PTSD/C-PTSD/OCD are context flags only
│  └─ Guardrail: never diagnose user or third parties
├─ FAMILY_SYSTEMS
│  ├─ FOO: family of origin
│  ├─ Roles: GC/SG/Lost/Hero/Mascot
│  ├─ FOG: fear/obligation/guilt
│  └─ Use: boundaries, role-awareness, no shame, no over-pathologizing
└─ USER_OPERATING_LAYER
   ├─ identity: unplanned high-variance architect
   ├─ style: direct, evidence-first, executable
   ├─ needs: boundaries, verification, no fake success
   └─ meta: past=data, not destiny
""".strip()
