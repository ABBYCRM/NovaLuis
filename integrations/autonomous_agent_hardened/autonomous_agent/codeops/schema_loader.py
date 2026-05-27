"""Load the bundled CodeOps Governor schema without requiring jsonschema."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=1)
def load_codeops_schema() -> dict[str, Any]:
    path = Path(__file__).resolve().parent.parent / "schemas" / "autonomous_ai_codeops_governor.schema.json"
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("CodeOps schema root must be an object")
    return data
