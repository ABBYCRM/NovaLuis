"""File and diff budget scanner."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class SizeFinding:
    path: str
    size_bytes: int
    decision: str
    reason: str

    def to_dict(self) -> dict[str, object]:
        return {"path": self.path, "size_bytes": self.size_bytes, "decision": self.decision, "reason": self.reason}


class SizeScanner:
    def __init__(self, workspace: Path, warn_mib: int = 50, block_mib: int = 100, max_total_mib: int = 20):
        self.workspace = Path(workspace).resolve()
        self.warn_bytes = warn_mib * 1024 * 1024
        self.block_bytes = block_mib * 1024 * 1024
        self.max_total_bytes = max_total_mib * 1024 * 1024

    def scan(self, paths: list[str]) -> tuple[int, list[SizeFinding]]:
        total = 0
        findings: list[SizeFinding] = []
        for raw in paths:
            rel, path = self._resolve(raw)
            if not path.exists() or not path.is_file():
                continue
            size = path.stat().st_size
            total += size
            if size >= self.block_bytes:
                findings.append(SizeFinding(rel, size, "BLOCK", "file_too_large_for_regular_git"))
            elif size >= self.warn_bytes:
                findings.append(SizeFinding(rel, size, "REQUIRE_REVIEW", "file_requires_large_file_review"))
        if total > self.max_total_bytes:
            findings.append(SizeFinding("<total_changed_bytes>", total, "BLOCK", "changed_bytes_budget_exceeded"))
        return total, findings

    def _resolve(self, raw: str) -> tuple[str, Path]:
        candidate = Path(raw)
        full = candidate if candidate.is_absolute() else self.workspace / candidate
        resolved = full.resolve()
        try:
            return resolved.relative_to(self.workspace).as_posix(), resolved
        except ValueError as exc:
            raise ValueError(f"path escapes workspace: {raw}") from exc
