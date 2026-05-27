"""Resource-limited subprocess execution."""
from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from ..exceptions import SecurityViolation

logger = logging.getLogger(__name__)

try:  # POSIX only
    import resource
except ImportError:  # pragma: no cover - Windows path
    resource = None  # type: ignore[assignment]


@dataclass(slots=True)
class SandboxResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    killed_oom: bool = False


class Sandbox:
    """Run subprocesses with bounded cwd, timeout, environment, and POSIX rlimits."""

    def __init__(
        self,
        cwd: Path,
        timeout_s: int = 300,
        cpu_seconds: int = 300,
        memory_mb: int = 2048,
        enabled: bool = True,
    ):
        self.cwd = Path(cwd).resolve()
        if not self.cwd.exists():
            raise SecurityViolation(f"sandbox cwd does not exist: {self.cwd}")
        self.timeout_s = timeout_s
        self.cpu_seconds = cpu_seconds
        self.memory_bytes = memory_mb * 1024 * 1024
        self.enabled = enabled and os.name == "posix" and resource is not None

    def _preexec(self) -> None:
        os.setsid()
        if not resource:
            return
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (self.cpu_seconds, self.cpu_seconds))
            resource.setrlimit(resource.RLIMIT_AS, (self.memory_bytes, self.memory_bytes))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        except (ValueError, OSError) as exc:
            logger.warning("could not set sandbox rlimits: %s", exc)

    def run(self, cmd: list[str], env: Mapping[str, str] | None = None) -> SandboxResult:
        if not cmd:
            raise SecurityViolation("empty command")
        exe = shutil.which(cmd[0])
        if not exe:
            return SandboxResult(127, "", f"executable not found: {cmd[0]}", False)
        try:
            proc = subprocess.Popen(
                [exe, *cmd[1:]],
                cwd=str(self.cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=self._safe_env(env),
                preexec_fn=self._preexec if self.enabled else None,
            )
            try:
                stdout, stderr = proc.communicate(timeout=self.timeout_s)
                return SandboxResult(proc.returncode, stdout, stderr, False, proc.returncode == -signal.SIGKILL)
            except subprocess.TimeoutExpired:
                self._terminate_process(proc)
                stdout, stderr = proc.communicate()
                return SandboxResult(-1, stdout, stderr, True)
        except OSError as exc:
            return SandboxResult(126, "", str(exc), False)

    def _terminate_process(self, proc: subprocess.Popen[str]) -> None:
        if self.enabled:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
                return
            except ProcessLookupError:
                return
            except OSError:
                logger.exception("failed to kill sandbox process group")
        proc.kill()

    @staticmethod
    def _safe_env(env: Mapping[str, str] | None) -> dict[str, str]:
        allowlist = {
            "PATH",
            "HOME",
            "TMPDIR",
            "TEMP",
            "TMP",
            "PYTHONPATH",
            "VIRTUAL_ENV",
            "CI",
            "NODE_ENV",
        }
        safe = {key: value for key, value in os.environ.items() if key in allowlist}
        safe.setdefault("OPENBLAS_NUM_THREADS", "1")
        safe.setdefault("OMP_NUM_THREADS", "1")
        safe.setdefault("NUMEXPR_NUM_THREADS", "1")
        safe.setdefault("MKL_NUM_THREADS", "1")
        if env:
            for key, value in env.items():
                if "TOKEN" in key.upper() or "SECRET" in key.upper() or "PASSWORD" in key.upper():
                    continue
                safe[key] = value
        return safe
