"""Filesystem snapshot poller."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from ..config import Config


@dataclass(slots=True)
class FileSnapshot:
    digest_by_path: dict[str, str]


class FilePoller:
    def __init__(self, workspace: Path, config: Config):
        self.workspace = Path(workspace).resolve()
        self.config = config

    def snapshot(self) -> FileSnapshot:
        digests: dict[str, str] = {}
        excluded = set(self.config.poller.excluded_dirs)
        for pattern in self.config.poller.file_patterns:
            for path in self.workspace.glob(pattern):
                if not path.is_file() or any(part in excluded for part in path.parts):
                    continue
                if path.stat().st_size > self.config.poller.max_file_size_bytes:
                    continue
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                digests[str(path.relative_to(self.workspace))] = digest
        return FileSnapshot(digest_by_path=dict(sorted(digests.items())))

    @staticmethod
    def changed(before: FileSnapshot, after: FileSnapshot) -> list[str]:
        changed: list[str] = []
        keys = set(before.digest_by_path) | set(after.digest_by_path)
        for key in sorted(keys):
            if before.digest_by_path.get(key) != after.digest_by_path.get(key):
                changed.append(key)
        return changed
