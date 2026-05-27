"""Deterministic, conservative analyzer for common repository issues."""
from __future__ import annotations

import ast
import re
from pathlib import Path

from ..config import Config
from ..core.types import AnalysisResult, Finding, PatchOperation, Severity


class RuleAnalyzer:
    """Finds safe, evidence-backed issues without external services."""

    def __init__(self, config: Config):
        self.config = config

    def analyze_path(self, target: Path) -> AnalysisResult:
        target = target.resolve()
        findings: list[Finding] = []
        patches: list[PatchOperation] = []
        if target.is_file():
            self._analyze_file(target, findings, patches)
        else:
            for path in self._iter_files(target):
                self._analyze_file(path, findings, patches)
        confidence = 0.75 if findings else 1.0
        return AnalysisResult(findings=findings, patches=patches, confidence=confidence, source="rule")

    def analyze_error_text(self, text: str) -> AnalysisResult:
        findings: list[Finding] = []
        if "ModuleNotFoundError" in text:
            match = re.search(r'No module named [\'"]([^\'"]+)', text)
            missing = match.group(1) if match else "unknown"
            findings.append(
                Finding(
                    code="PY_MODULE_NOT_FOUND",
                    message=f"Python import failed for module {missing}",
                    severity=Severity.HIGH,
                    evidence=text[-1000:],
                )
            )
        if "SyntaxError" in text:
            findings.append(
                Finding(
                    code="PY_SYNTAX_ERROR",
                    message="Python syntax error detected in verification output",
                    severity=Severity.HIGH,
                    evidence=text[-1000:],
                )
            )
        return AnalysisResult(findings=findings, confidence=0.65 if findings else 1.0, source="rule:error")

    def _iter_files(self, root: Path) -> list[Path]:
        found: list[Path] = []
        excluded = set(self.config.poller.excluded_dirs)
        for pattern in self.config.poller.file_patterns:
            for path in root.glob(pattern):
                if not path.is_file():
                    continue
                if any(part in excluded for part in path.parts):
                    continue
                if path.stat().st_size > self.config.poller.max_file_size_bytes:
                    continue
                found.append(path)
        return sorted(set(found))

    def _analyze_file(
        self, path: Path, findings: list[Finding], patches: list[PatchOperation]
    ) -> None:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(
                Finding(
                    code="NON_UTF8_FILE",
                    message="File cannot be decoded as UTF-8; skipping automated patch",
                    path=str(path),
                    severity=Severity.LOW,
                )
            )
            return
        task_markers = ("TO" + "DO", "FIX" + "ME")
        if any(marker in text for marker in task_markers):
            findings.append(
                Finding(
                    code="TASK_MARKER",
                    message="Unresolved task marker remains in source",
                    path=str(path),
                    severity=Severity.LOW,
                )
            )
        if path.suffix == ".py":
            try:
                ast.parse(text, filename=str(path))
            except SyntaxError as exc:
                findings.append(
                    Finding(
                        code="PY_SYNTAX_ERROR",
                        message=exc.msg,
                        path=str(path),
                        line=exc.lineno,
                        severity=Severity.HIGH,
                        evidence=(exc.text or "").strip(),
                    )
                )
        if path.name == "__init__.py" and not text.strip():
            patches.append(
                PatchOperation(
                    path=str(path),
                    action="write",
                    content='"""Package marker."""\n',
                    reason="avoid empty package marker",
                )
            )
