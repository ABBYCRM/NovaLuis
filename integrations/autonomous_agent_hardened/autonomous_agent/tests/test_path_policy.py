from pathlib import Path

import pytest

from autonomous_agent.exceptions import SecurityViolation
from autonomous_agent.security.path_policy import PathPolicy


def test_path_policy_blocks_escape(tmp_path: Path) -> None:
    policy = PathPolicy(tmp_path, [])
    with pytest.raises(SecurityViolation):
        policy.resolve(tmp_path.parent / "outside.txt")


def test_path_policy_blocks_forbidden(tmp_path: Path) -> None:
    policy = PathPolicy(tmp_path, [".env", "secrets/"])
    with pytest.raises(SecurityViolation):
        policy.resolve(".env")
    with pytest.raises(SecurityViolation):
        policy.resolve("secrets/key.txt")
