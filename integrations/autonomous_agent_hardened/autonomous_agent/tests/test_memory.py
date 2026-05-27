from pathlib import Path

from autonomous_agent.memory.store import MemoryStore


def test_memory_roundtrip(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "m.sqlite3")
    row_id = store.append("event", {"ok": True})
    rows = store.recent("event")
    assert row_id >= 1
    assert rows[0]["payload"] == {"ok": True}
