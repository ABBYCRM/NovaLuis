"""Custom exception hierarchy."""


class AgentError(Exception):
    """Base exception for all agent errors."""


class ConfigError(AgentError):
    """Configuration is invalid or missing."""


class LLMError(AgentError):
    """LLM backend failure."""


class LLMResponseError(LLMError):
    """LLM returned an unparseable or invalid response."""


class PatchError(AgentError):
    """Patch could not be applied."""


class PatchRejectedError(PatchError):
    """Reviewer rejected the patch."""


class TestExecutionError(AgentError):
    """Test runner failed to execute, not merely failing tests."""


class SecurityViolation(AgentError):
    """Operation blocked by security policy."""


class VCSError(AgentError):
    """Version control operation failed."""
