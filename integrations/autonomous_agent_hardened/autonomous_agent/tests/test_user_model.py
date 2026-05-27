from autonomous_agent.user_model.engine import UserUnderstandingEngine
from autonomous_agent.user_model.psych_alphabet import PSYCH_ALPHABET_TREE
from autonomous_agent.tools.builtin import build_default_registry


def test_user_model_detects_execution_preference_without_diagnosis():
    result = UserUnderstandingEngine().analyze("FIX IT NOW. Read files, patch, run tests, verify. DBT CBT FOO boundaries.")
    keys = {signal.key for signal in result.signals}
    assert "preference.execution_first" in keys
    assert "vocabulary.psych_modalities" in keys
    assert "context.family_systems" in keys
    assert any("disorders as fact" in item for item in result.avoid)
    assert "no diagnosis" in result.profile.clinical_guardrails


def test_user_model_reference_has_hard_limits():
    assert PSYCH_ALPHABET_TREE["hard_limits"]
    assert "no diagnosis" in PSYCH_ALPHABET_TREE["hard_limits"]


def test_default_registry_includes_user_model_tools():
    registry = build_default_registry()
    assert "analyze_user_context" in registry.names()
    assert "psych_alphabet_reference" in registry.names()
