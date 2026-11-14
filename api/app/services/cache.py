"""Tiny JSON-file cache. Protects SerpApi credits and keeps demos instant."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2] / "data" / "cache"


def _path(ns: str, key: str) -> Path:
    h = hashlib.sha1(key.encode()).hexdigest()[:20]
    return ROOT / ns / f"{h}.json"


def get(ns: str, key: str, max_age_s: float | None = None) -> Any | None:
    p = _path(ns, key)
    if not p.exists():
        return None
    if max_age_s is not None and time.time() - p.stat().st_mtime > max_age_s:
        return None
    return json.loads(p.read_text())


def put(ns: str, key: str, value: Any) -> None:
    p = _path(ns, key)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=1))
