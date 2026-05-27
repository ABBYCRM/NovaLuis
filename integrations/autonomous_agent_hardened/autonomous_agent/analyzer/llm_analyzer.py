"""Optional LLM analyzer wrapper.

This module intentionally avoids pretending to patch code without a configured backend.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..config import Config
from ..core.types import AnalysisResult, Finding, Severity
from ..exceptions import LLMError, LLMResponseError
from .backends import LLMBackend, build_backend


class LLMAnalyzer:
    def __init__(self, config: Config, backend: LLMBackend | None = None):
        self.config = config
        self.backend = backend or build_backend(config)

    def analyze(self, target: Path) -> AnalysisResult:
        prompt = self._build_prompt(target)
        try:
            response = self.backend.complete(prompt)
        except LLMError:
            raise
        try:
            data = json.loads(response.content)
        except json.JSONDecodeError as exc:
            raise LLMResponseError("LLM response must be JSON") from exc
        findings = [
            Finding(
                code=str(item.get("code", "LLM_FINDING")),
                message=str(item.get("message", "No message")),
                path=item.get("path"),
                severity=Severity(str(item.get("severity", "medium"))),
                evidence=item.get("evidence"),
            )
            for item in data.get("findings", [])
        ]
        return AnalysisResult(findings=findings, confidence=float(data.get("confidence", 0.0)), source=response.backend)

    def _build_prompt(self, target: Path) -> str:
        if target.is_file():
            text = target.read_text(encoding="utf-8", errors="replace")
            text = text[: self.config.llm.max_context_chars]
            return json.dumps({"task": "analyze_file", "path": str(target), "content": text})
        return json.dumps({"task": "analyze_directory", "path": str(target)})
