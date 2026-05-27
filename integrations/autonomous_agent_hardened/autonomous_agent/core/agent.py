"""Agent orchestrator."""
from __future__ import annotations

import logging
from pathlib import Path

from ..analyzer.rule_analyzer import RuleAnalyzer
from ..config import Config
from ..core.state import AgentState, StateMachine
from ..core.types import AgentRunResult, AnalysisResult, PatchApplyResult, ReviewResult, TestResult
from ..memory.store import MemoryStore
from ..patcher.patcher import Patcher
from ..reviewer.critic import Critic
from ..runner.test_runner import TestRunner

logger = logging.getLogger(__name__)


class AutonomousAgent:
    def __init__(self, config: Config):
        self.config = config
        self.workspace = Path(config.agent.workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        state_dir = self.workspace / config.agent.state_dir
        self.memory = MemoryStore(state_dir / "memory.sqlite3")
        self.state = StateMachine()

    def run_once(self, target: Path | str | None = None, dry_run: bool | None = None) -> AgentRunResult:
        dry = self.config.agent.dry_run if dry_run is None else dry_run
        target_path = Path(target or self.workspace).resolve()
        analyses: list[AnalysisResult] = []
        reviews: list[ReviewResult] = []
        tests: list[TestResult] = []
        patch_result = PatchApplyResult()

        self.state.transition(AgentState.CONTEXT_LOAD)
        self.state.transition(AgentState.TASK_PARSE)
        self.state.transition(AgentState.PRIORITY_CHECK)
        self.state.transition(AgentState.PLAN)

        analyzer = RuleAnalyzer(self.config)
        analysis = analyzer.analyze_path(target_path)
        analyses.append(analysis)
        self.memory.append("analysis", analysis)

        critic = Critic(self.config, self.workspace)
        review = critic.review(analysis)
        reviews.append(review)
        self.memory.append("review", review)

        self.state.transition(AgentState.EXECUTE)
        if analysis.patches and review.approved:
            patcher = Patcher(self.workspace, self.config)
            patch_result = patcher.apply(analysis.patches, dry_run=dry)
            self.memory.append("patch", patch_result)
        elif analysis.patches and not review.approved:
            patch_result.errors.extend(review.risks or review.reasons)

        self.state.transition(AgentState.VERIFY)
        runner = TestRunner(self.workspace, self.config)
        tests = runner.run_detected()
        for test in tests:
            self.memory.append("test", test)

        failed = [test for test in tests if not test.passed]
        status = "fixed" if not patch_result.errors and not failed else "partial"
        if patch_result.errors and not analysis.patches:
            status = "blocked"

        self.state.transition(AgentState.OUTPUT)
        result = AgentRunResult(
            status=status,
            analyses=analyses,
            patches=patch_result,
            reviews=reviews,
            tests=tests,
            workspace=self.workspace,
        )
        self.memory.append("run", result)
        self.state.transition(AgentState.LOG_UPDATE)
        self.state.transition(AgentState.DONE)
        logger.info("agent run complete", extra={"status": status, "tests": len(tests)})
        return result
