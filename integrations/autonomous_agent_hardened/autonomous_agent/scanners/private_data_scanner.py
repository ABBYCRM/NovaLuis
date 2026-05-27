"""Conservative private-data scanner for files staged for AI/GitHub actions."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


_PRIVATE_PATTERNS = [
    ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("credit_card", re.compile(r"\b(?:\d[ -]*?){13,16}\b")),
    ("dob_label", re.compile(r"(?i)\b(date of birth|dob)\b")),
    ("patient_label", re.compile(r"(?i)\b(patient|medical record|mrn|hipaa)\b")),
]


@dataclass(slots=True)
class PrivateDataFinding:
    path: str
    signal: str
    reason: str = "possible_private_data"

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "signal": self.signal, "reason": self.reason}


class PrivateDataScanner:
    def __init__(self, workspace: Path, max_read_bytes: int = 512_000):
        self.workspace = Path(workspace).resolve()
        self.max_read_bytes = max_read_bytes

    def scan(self, paths: list[str]) -> list[PrivateDataFinding]:
        findings: list[PrivateDataFinding] = []
        for raw in paths:
            rel, path = self._resolve(raw)
            if not path.exists() or not path.is_file():
                continue
            try:
                text = path.read_bytes()[: self.max_read_bytes].decode("utf-8", errors="ignore")
            except OSError:
                continue
            for name, pattern in _PRIVATE_PATTERNS:
                if pattern.search(text):
                    findings.append(PrivateDataFinding(rel, name))
                    break
        return findings

    def _resolve(self, raw: str) -> tuple[str, Path]:
        candidate = Path(raw)
        full = candidate if candidate.is_absolute() else self.workspace / candidate
        resolved = full.resolve()
        try:
            return resolved.relative_to(self.workspace).as_posix(), resolved
        except ValueError as exc:
            raise ValueError(f"path escapes workspace: {raw}") from exc
