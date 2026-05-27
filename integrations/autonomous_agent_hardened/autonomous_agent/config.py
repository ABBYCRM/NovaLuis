"""Layered configuration: defaults -> file -> env vars -> CLI overrides."""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, TypeVar, get_args, get_origin

import yaml

from .exceptions import ConfigError

T = TypeVar("T")


@dataclass(slots=True)
class LLMSettings:
    backend: str = "disabled"
    model: str | None = None
    temperature: float = 0.1
    max_tokens: int = 4096
    timeout_seconds: int = 120
    retries: int = 3
    retry_backoff: float = 2.0
    max_context_chars: int = 80_000
    api_key: str | None = None
    base_url: str | None = None


@dataclass(slots=True)
class ReviewerSettings:
    enabled: bool = True
    min_confidence: float = 0.6
    require_test_pass: bool = True
    block_on_security: bool = True


@dataclass(slots=True)
class PollerSettings:
    file_patterns: list[str] = field(default_factory=lambda: ["**/*.py"])
    excluded_dirs: list[str] = field(
        default_factory=lambda: [
            ".agent_memory",
            ".git",
            "__pycache__",
            ".venv",
            "venv",
            "node_modules",
            ".pytest_cache",
            "dist",
            "build",
        ]
    )
    max_file_size_bytes: int = 524_288
    error_log_paths: list[str] = field(default_factory=lambda: ["errors.log"])


@dataclass(slots=True)
class RunnerSettings:
    python_command: list[str] = field(default_factory=lambda: ["python", "-m", "pytest", "-q"])
    js_command: list[str] = field(default_factory=lambda: ["npm", "test", "--silent"])
    ts_command: list[str] = field(default_factory=lambda: ["npx", "tsc", "--noEmit"])
    timeout_seconds: int = 300
    sandbox: bool = True


@dataclass(slots=True)
class VCSSettings:
    enabled: bool = False
    auto_commit: bool = False
    auto_push: bool = False
    branch_prefix: str = "agent/fix"
    commit_signature: str = "autonomous-agent <agent@local>"
    open_pull_request: bool = False
    github_repo: str | None = None
    github_token: str | None = None


@dataclass(slots=True)
class SecuritySettings:
    redact_secrets: bool = True
    forbidden_paths: list[str] = field(default_factory=lambda: [".env", "secrets/", ".ssh/"])
    max_patch_size_bytes: int = 65_536
    allow_delete: bool = False


@dataclass(slots=True)
class MemorySettings:
    backend: str = "sqlite"
    retention_days: int = 30


@dataclass(slots=True)
class LoggingSettings:
    level: str = "INFO"
    format: str = "json"
    file: str | None = None


@dataclass(slots=True)
class MetricsSettings:
    enabled: bool = False
    port: int = 9090


@dataclass(slots=True)
class AgentSettings:
    max_recursion: int = 3
    max_iterations: int = 10
    poll_interval_seconds: int = 5
    workspace: str = "."
    state_dir: str = ".agent_memory"
    dry_run: bool = False
    parallel_files: int = 4
    autonomy_level: str = "level_1_local_patch"


@dataclass(slots=True)
class Config:
    agent: AgentSettings = field(default_factory=AgentSettings)
    llm: LLMSettings = field(default_factory=LLMSettings)
    reviewer: ReviewerSettings = field(default_factory=ReviewerSettings)
    poller: PollerSettings = field(default_factory=PollerSettings)
    runner: RunnerSettings = field(default_factory=RunnerSettings)
    vcs: VCSSettings = field(default_factory=VCSSettings)
    security: SecuritySettings = field(default_factory=SecuritySettings)
    memory: MemorySettings = field(default_factory=MemorySettings)
    logging: LoggingSettings = field(default_factory=LoggingSettings)
    metrics: MetricsSettings = field(default_factory=MetricsSettings)

    @classmethod
    def load(cls, path: Path | str | None = None, overrides: dict[str, Any] | None = None) -> "Config":
        data: dict[str, Any] = {}
        default_path = Path(__file__).resolve().parent.parent / "config" / "default.yaml"
        if default_path.exists():
            data = _deep_merge(data, _load_yaml(default_path))
        if path:
            user_path = Path(path)
            if not user_path.exists():
                raise ConfigError(f"Config file not found: {user_path}")
            data = _deep_merge(data, _load_yaml(user_path))
        data = _deep_merge(data, _env_overlay())
        if overrides:
            data = _deep_merge(data, overrides)
        cfg = cls._from_dict(data)
        cfg.validate()
        return cfg

    @classmethod
    def _from_dict(cls, raw: dict[str, Any]) -> "Config":
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(raw) - allowed)
        if unknown:
            raise ConfigError(f"Unknown config sections: {', '.join(unknown)}")
        return cls(
            agent=_coerce_dataclass(AgentSettings, raw.get("agent", {})),
            llm=_coerce_dataclass(LLMSettings, raw.get("llm", {})),
            reviewer=_coerce_dataclass(ReviewerSettings, raw.get("reviewer", {})),
            poller=_coerce_dataclass(PollerSettings, raw.get("poller", {})),
            runner=_coerce_dataclass(RunnerSettings, raw.get("runner", {})),
            vcs=_coerce_dataclass(VCSSettings, raw.get("vcs", {})),
            security=_coerce_dataclass(SecuritySettings, raw.get("security", {})),
            memory=_coerce_dataclass(MemorySettings, raw.get("memory", {})),
            logging=_coerce_dataclass(LoggingSettings, raw.get("logging", {})),
            metrics=_coerce_dataclass(MetricsSettings, raw.get("metrics", {})),
        )

    def validate(self) -> None:
        if self.agent.max_recursion < 0 or self.agent.max_iterations < 1:
            raise ConfigError("agent recursion/iteration limits must be non-negative and non-zero")
        if self.runner.timeout_seconds < 1:
            raise ConfigError("runner.timeout_seconds must be >= 1")
        if not 0 <= self.reviewer.min_confidence <= 1:
            raise ConfigError("reviewer.min_confidence must be between 0 and 1")
        if self.logging.format not in {"json", "text"}:
            raise ConfigError("logging.format must be json or text")
        if self.memory.backend not in {"sqlite", "jsonl"}:
            raise ConfigError("memory.backend must be sqlite or jsonl")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _coerce_dataclass(cls: type[T], raw: dict[str, Any]) -> T:
    if not isinstance(raw, dict):
        raise ConfigError(f"{cls.__name__} section must be a mapping")
    allowed = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ConfigError(f"Unknown {cls.__name__} keys: {', '.join(unknown)}")
    values: dict[str, Any] = {}
    for name, f in cls.__dataclass_fields__.items():  # type: ignore[attr-defined]
        if name not in raw:
            continue
        values[name] = _coerce_value(raw[name], f.type, name)
    return cls(**values)  # type: ignore[misc]


def _coerce_value(value: Any, annotation: Any, field_name: str) -> Any:
    origin = get_origin(annotation)
    if origin is list:
        if not isinstance(value, list):
            raise ConfigError(f"{field_name} must be a list")
        return value
    if annotation is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in {"1", "true", "yes", "on"}
        raise ConfigError(f"{field_name} must be a bool")
    if annotation is int:
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise ConfigError(f"{field_name} must be an int") from exc
    if annotation is float:
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise ConfigError(f"{field_name} must be a float") from exc
    args = get_args(annotation)
    if type(None) in args and value is None:
        return None
    return value


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"Invalid YAML in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"Config root must be a mapping in {path}")
    return data


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in overlay.items():
        if key in out and isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _env_overlay() -> dict[str, Any]:
    out: dict[str, Any] = {}

    def set_path(section: str, key: str, value: Any) -> None:
        out.setdefault(section, {})[key] = value

    env_map = {
        "AGENT_LLM_BACKEND": ("llm", "backend"),
        "AGENT_LLM_MODEL": ("llm", "model"),
        "AGENT_LLM_API_KEY": ("llm", "api_key"),
        "AGENT_LLM_BASE_URL": ("llm", "base_url"),
        "AGENT_WORKSPACE": ("agent", "workspace"),
        "AGENT_DRY_RUN": ("agent", "dry_run"),
        "AGENT_AUTONOMY_LEVEL": ("agent", "autonomy_level"),
        "GITHUB_TOKEN": ("vcs", "github_token"),
        "GITHUB_REPO": ("vcs", "github_repo"),
    }
    for env_key, (section, key) in env_map.items():
        if env_key in os.environ:
            set_path(section, key, os.environ[env_key])
    return out
