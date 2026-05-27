"""Structured logging with secret redaction."""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from .security.redactor import Redactor

_RESERVED = {
    "args",
    "msg",
    "exc_info",
    "exc_text",
    "levelname",
    "name",
    "pathname",
    "filename",
    "module",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "process",
    "processName",
    "levelno",
    "stack_info",
    "getMessage",
}


class JSONFormatter(logging.Formatter):
    def __init__(self, redactor: Redactor | None = None):
        super().__init__()
        self.redactor = redactor

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in _RESERVED:
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)
        if self.redactor:
            payload = self.redactor.redact_mapping(payload)
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


class RedactingTextFormatter(logging.Formatter):
    def __init__(self, redactor: Redactor | None = None):
        super().__init__("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        self.redactor = redactor

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        return self.redactor.redact(text) if self.redactor else text


def setup_logging(
    level: str = "INFO",
    fmt: str = "json",
    file: str | None = None,
    redactor: Redactor | None = None,
) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    formatter: logging.Formatter = JSONFormatter(redactor) if fmt == "json" else RedactingTextFormatter(redactor)
    stdout = logging.StreamHandler(sys.stdout)
    stdout.setFormatter(formatter)
    root.addHandler(stdout)
    if file:
        handler = logging.FileHandler(file, encoding="utf-8")
        handler.setFormatter(formatter)
        root.addHandler(handler)
