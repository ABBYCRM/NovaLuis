from __future__ import annotations

import pytest

from autonomous_agent.config import Config
from autonomous_agent.exceptions import ConfigError


def test_config_loads_defaults() -> None:
    cfg = Config.load()
    assert cfg.agent.max_iterations >= 1
    assert cfg.logging.format in {"json", "text"}


def test_config_rejects_unknown_key() -> None:
    with pytest.raises(ConfigError):
        Config.load(overrides={"agent": {"missing": True}})
