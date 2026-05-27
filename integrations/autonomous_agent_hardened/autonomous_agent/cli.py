"""Command-line interface."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click

from .answer_analysis import AnswerAnalysisEngine, AnswerAnalysisInput, EvidenceItem
from .codeops import CodeOpsGovernor
from .config import Config
from .core.agent import AutonomousAgent
from .core.agentic_runtime import AgenticRuntime
from .logging_setup import setup_logging
from .runner.test_runner import TestRunner
from .security.redactor import Redactor
from .user_model.engine import UserUnderstandingEngine
from .user_model.psych_alphabet import PSYCH_ALPHABET_ASCII, PSYCH_ALPHABET_TREE


def _load(config_path: str | None, workspace: str | None, dry_run: bool | None) -> Config:
    overrides: dict[str, Any] = {"agent": {}}
    if workspace:
        overrides["agent"]["workspace"] = workspace
    if dry_run is not None:
        overrides["agent"]["dry_run"] = dry_run
    cfg = Config.load(config_path, overrides=overrides if overrides["agent"] else None)
    setup_logging(cfg.logging.level, cfg.logging.format, cfg.logging.file, Redactor())
    return cfg


@click.group()
def main() -> None:
    """Autonomous code repair agent."""


@main.command("config")
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
def config_cmd(config_path: str | None) -> None:
    """Print effective redacted configuration."""
    cfg = Config.load(config_path)
    redactor = Redactor()
    click.echo(json.dumps(redactor.redact_mapping(cfg.to_dict()), indent=2, sort_keys=True))


@main.command()
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--target", type=click.Path(), default=".")
@click.option("--workspace", type=click.Path(), default=None)
@click.option("--dry-run/--no-dry-run", default=None)
def analyze(config_path: str | None, target: str, workspace: str | None, dry_run: bool | None) -> None:
    """Run analyzer/reviewer without forced VCS actions."""
    cfg = _load(config_path, workspace, dry_run)
    agent = AutonomousAgent(cfg)
    result = agent.run_once(Path(target), dry_run=True)
    click.echo(json.dumps(_result_summary(result), indent=2, sort_keys=True))


@main.command()
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--target", type=click.Path(), default=".")
@click.option("--workspace", type=click.Path(), default=None)
def verify(config_path: str | None, target: str, workspace: str | None) -> None:
    """Run detected verification commands."""
    cfg = _load(config_path, workspace or target, None)
    results = TestRunner(Path(target), cfg).run_detected()
    payload = [{"command": r.command, "exit_code": r.exit_code, "passed": r.passed} for r in results]
    click.echo(json.dumps(payload, indent=2, sort_keys=True))
    if any(not r.passed for r in results):
        raise SystemExit(1)


@main.command()
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--target", type=click.Path(), default=".")
@click.option("--workspace", type=click.Path(), default=None)
@click.option("--dry-run/--no-dry-run", default=None)
def run(config_path: str | None, target: str, workspace: str | None, dry_run: bool | None) -> None:
    """Run one bounded analyze -> review -> patch -> verify cycle."""
    cfg = _load(config_path, workspace or target, dry_run)
    result = AutonomousAgent(cfg).run_once(Path(target), dry_run=dry_run)
    click.echo(json.dumps(_result_summary(result), indent=2, sort_keys=True))
    if result.status not in {"fixed"}:
        raise SystemExit(1)


@main.command("claw")
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--task", required=True, help="Task for the agentic OpenClaw-like loop.")
@click.option("--workspace", type=click.Path(), default=".")
@click.option("--dry-run/--no-dry-run", default=None)
@click.option("--max-iterations", type=int, default=None)
def claw(config_path: str | None, task: str, workspace: str, dry_run: bool | None, max_iterations: int | None) -> None:
    """Run OpenClaw-like plan -> tool -> verify -> correct loop."""
    cfg = _load(config_path, workspace, dry_run)
    result = AgenticRuntime(cfg).run(task, max_iterations=max_iterations)
    click.echo(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    if result.status != "fixed":
        raise SystemExit(1)




@main.group("answer")
def answer() -> None:
    """Analyze answers into claims, evidence status, uncertainty, and ethical follow-ups."""


@answer.command("analyze")
@click.argument("text", required=False)
@click.option("--file", "file_path", type=click.Path(exists=True), default=None)
@click.option("--question", "question_asked", default=None)
@click.option("--context", default=None)
@click.option("--speaker-role", default=None)
@click.option("--known-fact", "known_facts", multiple=True)
@click.option("--prior-statement", "prior_statements", multiple=True)
@click.option("--timeline", "timeline_items", multiple=True)
@click.option("--goal", "interview_goal", default=None)
@click.option("--risk-level", default=None)
@click.option("--consent-status", default="unclear")
def answer_analyze(
    text: str | None,
    file_path: str | None,
    question_asked: str | None,
    context: str | None,
    speaker_role: str | None,
    known_facts: tuple[str, ...],
    prior_statements: tuple[str, ...],
    timeline_items: tuple[str, ...],
    interview_goal: str | None,
    risk_level: str | None,
    consent_status: str,
) -> None:
    """Run the ethical Answer Analysis Engine on exact answer text."""
    if file_path:
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    data = AnswerAnalysisInput(
        subject_answer=text or "",
        question_asked=question_asked,
        speaker_role=speaker_role,
        context=context,
        known_facts=list(known_facts),
        available_evidence=[],
        prior_statements=list(prior_statements),
        timeline=list(timeline_items),
        interview_goal=interview_goal,
        risk_level=risk_level,
        consent_status=consent_status,
    )
    engine = AnswerAnalysisEngine()
    click.echo(engine.to_json(engine.analyze(data)))


@answer.command("reference")
def answer_reference() -> None:
    """Print the Answer Analysis Engine OS schema/reference."""
    schema_path = Path(__file__).resolve().parent / "schemas" / "answer_analysis_engine_os.schema.json"
    click.echo(schema_path.read_text(encoding="utf-8"))


@main.group("user")
def user() -> None:
    """Analyze user-context signals for non-clinical response planning."""


@user.command("analyze")
@click.argument("text", required=False)
@click.option("--file", "file_path", type=click.Path(exists=True), default=None)
@click.option("--task-context", default=None)
def user_analyze(text: str | None, file_path: str | None, task_context: str | None) -> None:
    """Analyze user text into style/preferences/guardrails without diagnosis."""
    if file_path:
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    payload = UserUnderstandingEngine().analyze(text or "", task_context=task_context)
    click.echo(json.dumps(payload.to_dict(), indent=2, sort_keys=True))


@user.command("reference")
@click.option("--format", "fmt", type=click.Choice(["json", "ascii"]), default="json")
def user_reference(fmt: str) -> None:
    """Print the embedded psych alphabet reference used by the runtime."""
    if fmt == "ascii":
        click.echo(PSYCH_ALPHABET_ASCII)
    else:
        click.echo(json.dumps(PSYCH_ALPHABET_TREE, indent=2, sort_keys=True))


@main.group("codeops")
def codeops() -> None:
    """Run CodeOps Governor policy checks and governed autonomy commands."""


@codeops.command("preflight")
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--workspace", type=click.Path(), default=".")
@click.option("--autonomy", default=None, help="Autonomy level, e.g. level_1_local_patch or level_2_branch_pr.")
def codeops_preflight(config_path: str | None, workspace: str, autonomy: str | None) -> None:
    """Print CodeOps autonomy, branch, file budget, path, secret, and private-data checks."""
    cfg = _load(config_path, workspace, None)
    level = autonomy or cfg.agent.autonomy_level
    result = CodeOpsGovernor(Path(workspace), level).preflight()
    click.echo(json.dumps(result, indent=2, sort_keys=True))
    blocked = result.get("branch_policy", {}).get("decision") == "BLOCK" or bool(result.get("file_budget", {}).get("files_blocked"))
    if blocked:
        raise SystemExit(1)


@codeops.command("run")
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--task", required=True)
@click.option("--workspace", type=click.Path(), default=".")
@click.option("--autonomy", default=None, help="Autonomy level for this run.")
@click.option("--dry-run/--no-dry-run", default=None)
@click.option("--max-iterations", type=int, default=None)
def codeops_run(config_path: str | None, task: str, workspace: str, autonomy: str | None, dry_run: bool | None, max_iterations: int | None) -> None:
    """Run the agentic runtime with CodeOps Governor wired into every tool gate."""
    overrides = {"agent": {"workspace": workspace}}
    if dry_run is not None:
        overrides["agent"]["dry_run"] = dry_run
    if autonomy:
        overrides["agent"]["autonomy_level"] = autonomy
    cfg = Config.load(config_path, overrides=overrides)
    setup_logging(cfg.logging.level, cfg.logging.format, cfg.logging.file, Redactor())
    result = AgenticRuntime(cfg).run(task, max_iterations=max_iterations)
    click.echo(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    if result.status != "fixed":
        raise SystemExit(1)


def _result_summary(result: Any) -> dict[str, Any]:
    return {
        "status": result.status,
        "workspace": str(result.workspace),
        "findings": sum(len(a.findings) for a in result.analyses),
        "patches_applied": result.patches.applied,
        "patch_errors": result.patches.errors,
        "reviews": [
            {"approved": r.approved, "confidence": r.confidence, "risks": r.risks, "reasons": r.reasons}
            for r in result.reviews
        ],
        "tests": [
            {"command": t.command, "exit_code": t.exit_code, "passed": t.passed, "timed_out": t.timed_out}
            for t in result.tests
        ],
    }
