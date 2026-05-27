from autonomous_agent.security.redactor import Redactor


def test_redacts_known_token_patterns() -> None:
    text = "token sk-abcdefghijklmnopqrstuvwxyz123456 bearer abcdefghijklmnopqrstuvwxyz"
    cleaned = Redactor().redact(text)
    assert "sk-abcdefghijklmnopqrstuvwxyz" not in cleaned
    assert "[REDACTED:OPENAI_KEY]" in cleaned


def test_redacts_sensitive_mapping_fields() -> None:
    cleaned = Redactor().redact_mapping({"github_token": "ghp_abcdefghijklmnopqrstuvwxyz123456"})
    assert cleaned["github_token"] == "[REDACTED:FIELD]"


def test_redactor_does_not_redact_token_count_fields() -> None:
    cleaned = Redactor().redact_mapping({"max_tokens": 4096, "api_key": "abc"})
    assert cleaned["max_tokens"] == 4096
    assert cleaned["api_key"] == "[REDACTED:FIELD]"
