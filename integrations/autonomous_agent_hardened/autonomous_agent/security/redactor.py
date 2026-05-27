"""Redact secrets from logs, errors, and LLM payloads."""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Pattern

_PATTERNS: list[tuple[str, Pattern[str]]] = [
    ("OPENAI_KEY", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("ANTHROPIC_KEY", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("GITHUB_TOKEN", re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}")),
    ("AWS_KEY", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GENERIC_BEARER", re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("JWT", re.compile(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")),
    (
        "PRIVATE_KEY",
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END [^-]+-----"
        ),
    ),
    ("URL_AUTH", re.compile(r"https?://[^:/\s]+:[^@\s]+@")),
]

_SENSITIVE_KEYS = {"api_key", "token", "password", "secret", "authorization", "github_token", "access_token", "refresh_token"}


class Redactor:
    """Pattern-based secret redactor with recursive dict support."""

    def __init__(self, extra_patterns: list[tuple[str, str]] | None = None):
        self._patterns = list(_PATTERNS)
        if extra_patterns:
            for name, raw in extra_patterns:
                self._patterns.append((name, re.compile(raw)))

    def redact(self, text: str) -> str:
        if not text:
            return text
        out = text
        for name, pattern in self._patterns:
            out = pattern.sub(f"[REDACTED:{name}]", out)
        return out

    def redact_mapping(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        clean: dict[str, Any] = {}
        for key, value in payload.items():
            lowered = key.lower()
            if self._is_sensitive_key(lowered):
                clean[key] = "[REDACTED:FIELD]" if value else value
            elif isinstance(value, str):
                clean[key] = self.redact(value)
            elif isinstance(value, Mapping):
                clean[key] = self.redact_mapping(value)
            elif isinstance(value, list):
                clean[key] = [self.redact(item) if isinstance(item, str) else item for item in value]
            else:
                clean[key] = value
        return clean

    @staticmethod
    def _is_sensitive_key(key: str) -> bool:
        if key in _SENSITIVE_KEYS:
            return True
        return key.endswith(("_token", "_secret", "_password", "_api_key"))

    def is_dirty(self, text: str) -> bool:
        return any(pattern.search(text) for _, pattern in self._patterns)
