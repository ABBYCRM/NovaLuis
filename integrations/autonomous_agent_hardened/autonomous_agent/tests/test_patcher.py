from pathlib import Path

from autonomous_agent.config import Config
from autonomous_agent.core.types import PatchOperation
from autonomous_agent.patcher.patcher import Patcher


def test_patcher_write_and_replace(tmp_path: Path) -> None:
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    patcher = Patcher(tmp_path, cfg)
    result = patcher.apply([PatchOperation(path="a.txt", action="write", content="hello")])
    assert result.ok
    result = patcher.apply([
        PatchOperation(path="a.txt", action="replace", expected_old="hell", replacement="yell")
    ])
    assert result.ok
    assert (tmp_path / "a.txt").read_text() == "yello"


def test_patcher_blocks_env(tmp_path: Path) -> None:
    cfg = Config.load(overrides={"agent": {"workspace": str(tmp_path)}})
    result = Patcher(tmp_path, cfg).apply([
        PatchOperation(path=".env", action="write", content="TOKEN=bad")
    ])
    assert not result.ok
    assert "forbidden" in result.errors[0]
