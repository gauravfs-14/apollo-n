"""Authoritative game state + rules. Mirror of web/game/core/reducer.ts. Keep in sync."""

from __future__ import annotations

import copy
from typing import Any

PHASE_ORDER = [
    "select", "build", "drop", "crew", "board", "checklist",
    "launch", "cruise", "site", "landing", "surface", "report",
]
ROLES = ["commander", "pilot", "engineer", "scientist"]


def clean_name(raw: Any, fallback: str = "Astronaut") -> str:
    """Names are trimmed, capped at 24 chars and never empty (mirrored in reducer.ts)."""
    name = str(raw).strip()[:24] if isinstance(raw, str) else ""
    return name or fallback


def clean_score(raw: Any) -> float:
    try:
        v = float(raw or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, v)) if v == v else 0.0  # NaN -> 0


def new_state(room: str, mode: str) -> dict[str, Any]:
    return {"room": room, "mode": mode, "phase": "select", "players": [],
            "scores": {}, "phaseData": {}, "version": 0}


def apply(s: dict[str, Any], player_id: str, msg: dict[str, Any]) -> dict[str, Any] | str:
    """Return the new state, or an error string if the message is rejected."""
    st = copy.deepcopy(s)
    me = next((p for p in st["players"] if p["id"] == player_id), None)
    t = msg.get("type")

    if t == "join":
        if me:
            me["connected"] = True
            me["name"] = clean_name(msg.get("name"), me["name"])
        else:
            if st["mode"] == "solo" and len(st["players"]) >= 1:
                # A new tab/device takes over a solo game whose player has left.
                if st["players"][0]["connected"]:
                    return "Solo room is full"
                st["players"][0].update(id=msg["id"], name=clean_name(msg.get("name")), connected=True)
                st["version"] += 1
                return st
            if len(st["players"]) >= 4:
                return "Room is full (4 astronauts max)"
            st["players"].append({"id": msg["id"], "name": clean_name(msg.get("name")),
                                  "connected": True, "isHost": len(st["players"]) == 0})
        # Never leave a room without a connected host: the (re)joining player takes over.
        if not any(p["isHost"] and p["connected"] for p in st["players"]):
            for p in st["players"]:
                p["isHost"] = p["id"] == msg["id"]
    elif t == "pick_role":
        if not me:
            return "Join first"
        role = msg.get("role")
        if role is not None and role not in ROLES:
            return "Unknown role"
        if role and any(p["id"] != me["id"] and p.get("role") == role for p in st["players"]):
            return "Role already taken"
        if role:
            me["role"] = role
        else:
            me.pop("role", None)
    elif t == "action":
        if not me:
            return "Join first"
        if msg.get("phase") != st["phase"]:
            return f"Not in phase {msg.get('phase')}"
        kind, data = msg.get("kind"), msg.get("data") or {}
        if not isinstance(data, dict):
            return "Bad action data"
        if kind == "patch":
            st["phaseData"][st["phase"]] = {**st["phaseData"].get(st["phase"], {}), **data}
        elif kind == "set_plan":
            st["plan"] = data.get("plan")
        elif kind == "complete":
            st["scores"][st["phase"]] = clean_score(data.get("score", 0))
            i = PHASE_ORDER.index(st["phase"])
            if i < len(PHASE_ORDER) - 1:
                st["phase"] = PHASE_ORDER[i + 1]
        elif kind == "goto":
            if not me["isHost"]:
                return "Only the host can jump phases"
            if data.get("phase") not in PHASE_ORDER:
                return "Unknown phase"
            st["phase"] = data["phase"]
        elif kind == "reset":
            if not me["isHost"]:
                return "Only the host can reset"
            fresh = new_state(st["room"], st["mode"])
            fresh["players"], fresh["version"] = st["players"], st["version"] + 1
            return fresh
        else:
            return f"Unknown action {kind}"
    else:
        return s
    st["version"] += 1
    return st


def disconnect(s: dict[str, Any], player_id: str) -> dict[str, Any]:
    st = copy.deepcopy(s)
    for p in st["players"]:
        if p["id"] == player_id:
            p["connected"] = False
    # Hand host to the next connected player if the host left.
    if not any(p["isHost"] and p["connected"] for p in st["players"]):
        nxt = next((p for p in st["players"] if p["connected"]), None)
        if nxt:
            for p in st["players"]:
                p["isHost"] = p is nxt
    st["version"] += 1
    return st


def release_role(s: dict[str, Any], player_id: str) -> dict[str, Any]:
    """A player gone for too long: their role becomes unclaimed (the host plays it via actsAs)."""
    st = copy.deepcopy(s)
    for p in st["players"]:
        if p["id"] == player_id and not p["connected"] and "role" in p:
            p.pop("role")
            st["version"] += 1
    return st
