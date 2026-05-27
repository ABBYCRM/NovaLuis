from __future__ import annotations

from pathlib import Path

import pytest

from autonomous_agent.config import Config


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    return Config.load(overrides={"agent": {"workspace": str(tmp_path)}, "runner": {"sandbox": False}})
