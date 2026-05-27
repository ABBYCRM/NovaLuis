"""Secret scanner backed by the package Redactor patterns."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..security.redactor import Redactor


@dataclass(slots=True)
class SecretFinding:
    path: str
    reason: str = "secret_detected"

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "reason": self.reason}


class SecretScanner:
    def __init__(self, workspace: Path, redactor: Redactor | None = None, max_read_bytes: int = 512_000):
        self.workspace = Path(workspace).resolve()
        self.redactor = redactor or Redactor()
        self.max_read_bytes = max_read_bytes

    def scan(self, paths: list[str]) -> list[SecretFinding]:
        findings: list[SecretFinding] = []
        for raw in paths:
            rel, path = self._resolve(raw)
            if not path.exists() or not path.is_file():
                continue
            try:
                blob = path.read_bytes()[: self.max_read_bytes]
                text = blob.decode("utf-8", errors="ignore")
            except OSError:
                continue
            if self.redactor.is_dirty(text):
                findings.append(SecretFinding(rel))
        return findings

    def _resolve(self, raw: str) -> tuple[str, Path]:
        candidate = Path(raw)
        full = candidate if candidate.is_absolute() else self.workspace / candidate
        resolved = full.resolve()
        try:
            return resolved.relative_to(self.workspace).as_posix(), resolved
        except ValueError as exc:
            raise ValueError(f"path escapes workspace: {raw}") from exc
