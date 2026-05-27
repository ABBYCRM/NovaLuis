"""Git status poller."""
from __future__ import annotations

from pathlib import Path

from ..security.sandbox import Sandbox


class GitPoller:
    def __init__(self, workspace: Path, timeout_s: int = 30):
        self.workspace = Path(workspace).resolve()
        self.timeout_s = timeout_s

    def changed_files(self) -> list[str]:
        result = Sandbox(self.workspace, timeout_s=self.timeout_s, enabled=False).run(
            ["git", "status", "--porcelain"]
        )
        if result.exit_code != 0:
            return []
        files: list[str] = []
        for line in result.stdout.splitlines():
            if len(line) > 3:
                files.append(line[3:].strip())
        return files
