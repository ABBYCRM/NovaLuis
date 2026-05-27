from pathlib import Path

from autonomous_agent.config import Config
from autonomous_agent.core.types import AnalysisResult, PatchOperation
from autonomous_agent.reviewer.critic import Critic


def test_reviewer_rejects_risky_patch(tmp_path: Path) -> None:
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    analysis = AnalysisResult(
        confidence=0.9,
        patches=[PatchOperation(path="x.py", action="write", content="eval('1')")],
    )
    review = Critic(cfg, tmp_path).review(analysis)
    assert not review.approved
    assert review.risks


def test_reviewer_approves_no_patch(tmp_path: Path) -> None:
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    review = Critic(cfg, tmp_path).review(AnalysisResult(confidence=1.0))
    assert review.approved
