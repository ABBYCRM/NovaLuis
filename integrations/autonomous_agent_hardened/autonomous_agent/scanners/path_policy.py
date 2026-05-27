"""Glob-based repository file policy scanner."""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class PathPolicyFinding:
    path: str
    reason: str
    severity: str = "block"

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "reason": self.reason, "severity": self.severity}


class FilePolicyScanner:
    def __init__(self, workspace: Path, forbidden_patterns: list[str], allowed_write_patterns: list[str] | None = None):
        self.workspace = Path(workspace).resolve()
        self.forbidden_patterns = forbidden_patterns
        self.allowed_write_patterns = allowed_write_patterns or []

    def classify(self, paths: list[str]) -> tuple[list[str], list[PathPolicyFinding]]:
        allowed: list[str] = []
        blocked: list[PathPolicyFinding] = []
        for raw in paths:
            rel = self._normalize(raw)
            match = self._first_match(rel, self.forbidden_patterns)
            if match:
                blocked.append(PathPolicyFinding(rel, f"forbidden_path:{match}"))
                continue
            if self.allowed_write_patterns and not self._first_match(rel, self.allowed_write_patterns):
                blocked.append(PathPolicyFinding(rel, "outside_default_allowed_write_paths", severity="review"))
                continue
            allowed.append(rel)
        return allowed, blocked

    def _normalize(self, raw: str) -> str:
        candidate = Path(raw)
        full = candidate if candidate.is_absolute() else self.workspace / candidate
        resolved = full.resolve()
        try:
            return resolved.relative_to(self.workspace).as_posix()
        except ValueError as exc:
            raise ValueError(f"path escapes workspace: {raw}") from exc

    @staticmethod
    def _first_match(rel: str, patterns: list[str]) -> str | None:
        for pattern in patterns:
            p = pattern.strip()
            if not p:
                continue
            if p.startswith("**/") and fnmatch.fnmatch(rel, p[3:]):
                return pattern
            if fnmatch.fnmatch(rel, p) or fnmatch.fnmatch("/" + rel, p):
                return pattern
            if p.endswith("/**") and rel.startswith(p[:-3].rstrip("/") + "/"):
                return pattern
            if p.endswith("/") and rel.startswith(p.rstrip("/") + "/"):
                return pattern
            if rel == p:
                return pattern
        return None
