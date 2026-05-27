"""Workspace path policy."""
from __future__ import annotations

from pathlib import Path

from ..exceptions import SecurityViolation


class PathPolicy:
    """Resolve paths and enforce workspace containment and denylist rules."""

    def __init__(self, workspace: Path, forbidden_paths: list[str]):
        self.workspace = Path(workspace).resolve()
        self.forbidden = forbidden_paths

    def resolve(self, candidate: str | Path) -> Path:
        raw = Path(candidate)
        full = raw if raw.is_absolute() else self.workspace / raw
        resolved = full.resolve()
        try:
            resolved.relative_to(self.workspace)
        except ValueError as exc:
            raise SecurityViolation(f"path escapes workspace: {candidate}") from exc
        rel = resolved.relative_to(self.workspace).as_posix()
        for forbidden in self.forbidden:
            cleaned = forbidden.strip().lstrip("/")
            if not cleaned:
                continue
            if cleaned.endswith("/"):
                if rel.startswith(cleaned.rstrip("/") + "/") or rel == cleaned.rstrip("/"):
                    raise SecurityViolation(f"path is forbidden: {candidate}")
            elif rel == cleaned or rel.startswith(cleaned + "/"):
                raise SecurityViolation(f"path is forbidden: {candidate}")
        return resolved
