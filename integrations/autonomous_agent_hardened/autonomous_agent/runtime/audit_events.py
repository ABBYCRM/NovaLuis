"""Append-only audit event helpers."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class AuditEvent:
    task_id: str
    repo: str
    actor: str
    action: str
    risk_level: str
    policy_decision: str
    evidence: dict[str, Any] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "task_id": self.task_id,
            "repo": self.repo,
            "actor": self.actor,
            "action": self.action,
            "risk_level": self.risk_level,
            "policy_decision": self.policy_decision,
            "evidence": self.evidence,
            "timestamp": self.timestamp,
        }


class AuditTrail:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: AuditEvent) -> None:
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")
