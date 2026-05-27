"""Git command helpers."""
from __future__ import annotations

from pathlib import Path

from ..exceptions import VCSError
from ..security.sandbox import Sandbox


class GitOps:
    def __init__(self, workspace: Path, timeout_s: int = 60):
        self.workspace = Path(workspace).resolve()
        self.timeout_s = timeout_s

    def run(self, args: list[str]) -> str:
        result = Sandbox(self.workspace, timeout_s=self.timeout_s, enabled=False).run(["git", *args])
        if result.exit_code != 0:
            raise VCSError(result.stderr.strip() or result.stdout.strip() or f"git failed: {args}")
        return result.stdout

    def is_repo(self) -> bool:
        try:
            self.run(["rev-parse", "--is-inside-work-tree"])
            return True
        except VCSError:
            return False

    def status(self) -> str:
        return self.run(["status", "--short"])

    def commit_all(self, message: str, author: str | None = None) -> str:
        self.run(["add", "--all"])
        args = ["commit", "-m", message]
        if author:
            args.extend(["--author", author])
        return self.run(args)
