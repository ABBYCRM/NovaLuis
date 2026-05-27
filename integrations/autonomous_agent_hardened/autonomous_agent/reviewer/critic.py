"""Conservative patch critic."""
from __future__ import annotations

from pathlib import Path

from ..config import Config
from ..core.types import AnalysisResult, PatchOperation, ReviewResult
from ..security.path_policy import PathPolicy

_HIGH_RISK_TOKENS = (
    "subprocess.Popen",
    "os.system",
    "eval(",
    "exec(",
    "rm -rf",
    "chmod 777",
    "pickle.loads",
)


class Critic:
    def __init__(self, config: Config, workspace: Path):
        self.config = config
        self.policy = PathPolicy(workspace, config.security.forbidden_paths)

    def review(self, analysis: AnalysisResult) -> ReviewResult:
        risks: list[str] = []
        reasons: list[str] = []
        if analysis.confidence < self.config.reviewer.min_confidence:
            reasons.append("analysis confidence below configured threshold")
        for patch in analysis.patches:
            risks.extend(self._patch_risks(patch))
        approved = not risks and not reasons
        if not analysis.patches:
            approved = True
            reasons.append("no patch operations requested")
        return ReviewResult(
            approved=approved,
            confidence=analysis.confidence,
            reasons=reasons,
            risks=sorted(set(risks)),
        )

    def _patch_risks(self, patch: PatchOperation) -> list[str]:
        risks: list[str] = []
        try:
            self.policy.resolve(patch.path)
        except Exception as exc:  # noqa: BLE001 - reviewer surfaces any policy failure as a risk
            risks.append(str(exc))
        payload = "\n".join(filter(None, [patch.content, patch.replacement, patch.expected_old]))
        if len(payload.encode("utf-8")) > self.config.security.max_patch_size_bytes:
            risks.append("patch exceeds configured max_patch_size_bytes")
        lowered_path = patch.path.lower()
        if patch.action == "delete" and not self.config.security.allow_delete:
            risks.append("delete operation blocked by config")
        if any(token in payload for token in _HIGH_RISK_TOKENS):
            risks.append("patch contains high-risk execution token")
        if lowered_path.endswith((".env", ".pem", ".key")):
            risks.append("patch targets sensitive file extension/name")
        return risks
