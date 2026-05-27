# PSYCH ALPHABET USER UNDERSTANDING MODULE

Purpose: convert user-provided psychological/family-systems vocabulary into **non-clinical agent behavior controls**.

Runtime use:

```text
user message
→ UserUnderstandingEngine.analyze()
→ response_strategy + guardrails + safety_flags
→ planner prompt context
→ tool execution remains governed by BOS_TRINITY + CodeOps
```

Hard boundaries:

```text
NO diagnosis
NO therapy simulation
NO claims that family members have disorders as fact
NO unsupported psychological certainty
YES direct style adaptation
YES evidence-first execution
YES boundary-aware wording
YES crisis-safe escalation when actual first-person crisis language appears
```

Embedded tree lives in:

```text
autonomous_agent/user_model/psych_alphabet.py
```
