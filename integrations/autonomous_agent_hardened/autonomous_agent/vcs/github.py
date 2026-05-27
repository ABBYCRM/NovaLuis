"""GitHub integration facade.

PyGithub is optional. This wrapper fails closed when not configured.
"""
from __future__ import annotations

from ..config import VCSSettings
from ..exceptions import VCSError


class GitHubClient:
    def __init__(self, settings: VCSSettings):
        self.settings = settings

    def enabled(self) -> bool:
        return bool(self.settings.enabled and self.settings.github_repo and self.settings.github_token)

    def ensure_enabled(self) -> None:
        if not self.enabled():
            raise VCSError("GitHub integration is not fully configured")

    def open_pull_request(self, title: str, body: str, head: str, base: str = "main") -> str:
        self.ensure_enabled()
        try:
            from github import Github  # type: ignore
        except ImportError as exc:
            raise VCSError("PyGithub is not installed; install autonomous-agent[github]") from exc
        gh = Github(self.settings.github_token)
        repo = gh.get_repo(self.settings.github_repo)
        pr = repo.create_pull(title=title, body=body, head=head, base=base)
        return str(pr.html_url)
