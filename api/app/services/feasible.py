"""Make ship constraints winnable with the real parts catalog.

shared/build-envelope.json lists the stats of every buildable ship (generated from
web/game/data/parts.ts by web/scripts/build-envelope.ts). The LLM picks story-driven
numbers; we relax them just enough that at least one build passes.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ENVELOPE = Path(__file__).resolve().parents[3] / "shared" / "build-envelope.json"

# Words the LLM might use → catalog capability tags.
TAG_ALIASES = {
    "drill": "drill", "sample": "sample", "sample_container": "sample", "sampler": "sample",
    "spectrometer": "spectrometer", "science_instruments": "spectrometer", "instruments": "spectrometer",
    "camera": "camera", "rover": "camera", "imager": "camera",
    "relay": "relay", "relay_antenna": "relay", "radio_relay": "relay", "antenna": "relay",
}


@lru_cache(maxsize=1)
def _envelope() -> dict:
    return json.loads(ENVELOPE.read_text())


def _ok(b: dict, c: dict) -> bool:
    return (b["mass"] <= c["max_mass_kg"] and b["battery"] >= c["min_battery_hours"]
            and b["dv"] >= c["min_delta_v"] and set(c["required_payload"]) <= set(b["tags"]))


def winnable(c: dict) -> bool:
    return any(_ok(b, c) for b in _envelope()["builds"])


def make_feasible(c: dict) -> dict:
    env = _envelope()
    c = dict(c)
    tags: list[str] = []
    for t in c.get("required_payload") or []:
        m = TAG_ALIASES.get(str(t).strip().lower().replace(" ", "_"))
        if m and m not in tags:
            tags.append(m)
    c["required_payload"] = tags[:2] or ["spectrometer"]
    max_mass = max(b["mass"] for b in env["builds"])
    min_dv = min(b["dv"] for b in env["builds"])
    batteries = sorted({b["battery"] for b in env["builds"]})
    def relaxed(c: dict, what: str) -> dict:
        n = dict(c)
        if what == "mass":
            n["max_mass_kg"] = min(max_mass, c["max_mass_kg"] + 25)
        elif what == "dv":
            n["min_delta_v"] = max(min_dv, c["min_delta_v"] - 50)
        elif what == "battery":
            n["min_battery_hours"] = max([x for x in batteries if x < c["min_battery_hours"]] or [batteries[0]])
        elif what == "tags":
            n["required_payload"] = c["required_payload"][:-1]
        return n

    for _ in range(200):
        if winnable(c):
            break
        # one small step that fixes it? take it. Otherwise nudge mass + delta-v together.
        fix = next((relaxed(c, w) for w in ("mass", "dv", "battery", "tags") if winnable(relaxed(c, w))), None)
        if fix:
            c = fix
            break
        nxt = relaxed(relaxed(c, "mass"), "dv")
        if nxt == c:
            nxt = relaxed(c, "battery") if c["min_battery_hours"] > batteries[0] else relaxed(c, "tags")
        c = nxt
    c["max_mass_kg"] = round(c["max_mass_kg"] / 10) * 10 if winnable({**c, "max_mass_kg": round(c["max_mass_kg"] / 10) * 10}) else c["max_mass_kg"]
    return c
