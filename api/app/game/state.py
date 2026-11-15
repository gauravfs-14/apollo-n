"""Authoritative game state + rules. Mirror of web/game/core/reducer.ts. Keep in sync."""

from __future__ import annotations

import copy
from typing import Any

PHASE_ORDER = [
    "select", "build", "crew", "board", "checklist",  # "drop" (supply crate) retired
    "launch", "cruise", "site", "landing", "surface", "report",
]
ROLES = ["commander", "pilot", "engineer", "scientist"]
HP_BASE = 100  # ship integrity of a stock hull
HP_CAP = 200  # the reinforced-hull upgrades never go past this


def clean_hp_max(raw: Any) -> float:
    """Hull integrity chosen when the mission starts (reinforced hull upgrade): HP_BASE..HP_CAP. Mirrored in reducer.ts."""
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return float(HP_BASE)
    return max(float(HP_BASE), min(float(HP_CAP), v)) if v == v else float(HP_BASE)


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


def rebalance(st: dict[str, Any]) -> None:
    """Deal the four roles evenly among the players in the room (in place). Mirror of web/game/core/roles.ts.

    Players in the room = everyone not `released` (connected, or inside the 30 s reconnect grace).
    Quota: 4 // n each, and the 4 % n extras go to the players already holding the most roles
    (so assignments stay stable), then non-hosts, then later joiners. Explicit picks (`picked`) are kept;
    roles a player held before are kept up to their quota; the rest go to whoever has the biggest deficit.
    """
    for p in st["players"]:
        if p.get("released"):
            p["roles"] = []
            p.pop("picked", None)
            p.pop("role", None)
    active = [p for p in st["players"] if not p.get("released")]
    n = len(active)
    if n == 0:
        return
    owner: dict[str, int] = {}
    for i, p in enumerate(active):
        pk = p.get("picked")
        if pk in ROLES and pk not in owner:
            owner[pk] = i
        else:
            p.pop("picked", None)
    prev = [[r for r in ROLES if r in (p.get("roles") or ([p["role"]] if p.get("role") else []))] for p in active]
    base, extra = divmod(len(ROLES), n)
    by_keep = sorted(range(n), key=lambda i: (-len(prev[i]), active[i]["isHost"], -i))
    quota = [base + (1 if i in by_keep[:extra] else 0) for i in range(n)]
    for i, p in enumerate(active):
        if p.get("picked"):
            quota[i] = max(quota[i], 1)
    held: list[set[str]] = [set() for _ in range(n)]
    for r, i in owner.items():
        held[i].add(r)
    for i in range(n):
        for r in prev[i]:
            if r not in owner and len(held[i]) < quota[i] and all(r not in h for h in held):
                held[i].add(r)
    for r in ROLES:
        if any(r in h for h in held):
            continue
        i = min(range(n), key=lambda k: (len(held[k]) - quota[k], k))
        held[i].add(r)
    for i, p in enumerate(active):
        p["roles"] = [r for r in ROLES if r in held[i]]
        p["role"] = p.get("picked") or p["roles"][0]


def new_state(room: str, mode: str) -> dict[str, Any]:
    return {"room": room, "mode": mode, "phase": "select", "players": [],
            "scores": {}, "phaseData": {}, "hp": 100, "hpMax": HP_BASE, "failed": None, "sp": 0, "version": 0}


def apply(s: dict[str, Any], player_id: str, msg: dict[str, Any]) -> dict[str, Any] | str:
    """Return the new state, or an error string if the message is rejected."""
    st = copy.deepcopy(s)
    me = next((p for p in st["players"] if p["id"] == player_id), None)
    t = msg.get("type")

    if t == "join":
        if me:
            me["connected"] = True
            me.pop("released", None)
            me["name"] = clean_name(msg.get("name"), me["name"])
        else:
            if st["mode"] == "solo" and len(st["players"]) >= 1:
                # A new tab/device takes over a solo game whose player has left.
                if st["players"][0]["connected"]:
                    return "Solo room is full"
                st["players"][0].update(id=msg["id"], name=clean_name(msg.get("name")), connected=True)
                rebalance(st)
                st["version"] += 1
                return st
            if len(st["players"]) >= 4:
                return "Room is full (4 astronauts max)"
            st["players"].append({"id": msg["id"], "name": clean_name(msg.get("name")),
                                  "connected": True, "isHost": len(st["players"]) == 0, "roles": []})
        # Never leave a room without a connected host: the (re)joining player takes over.
        if not any(p["isHost"] and p["connected"] for p in st["players"]):
            for p in st["players"]:
                p["isHost"] = p["id"] == msg["id"]
        rebalance(st)
    elif t == "pick_role":
        if not me:
            return "Join first"
        role = msg.get("role")
        if role is not None and role not in ROLES:
            return "Unknown role"
        if role and any(p["id"] != me["id"] and p.get("picked") == role and not p.get("released") for p in st["players"]):
            return "Role already taken"  # only another player's explicit pick blocks it; auto-assigned roles move
        if role:
            me["picked"] = role
        else:
            me.pop("picked", None)
        rebalance(st)
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
            if st["phase"] == "select" and "hpMax" in data:
                # the host's hull for this mission: integrity starts full at hpMax
                st["hpMax"] = clean_hp_max(data["hpMax"])
                st["hp"] = st["hpMax"]
        elif kind == "complete":
            st["scores"][st["phase"]] = clean_score(data.get("score", 0))
            i = PHASE_ORDER.index(st["phase"])
            if i < len(PHASE_ORDER) - 1:
                st["phase"] = PHASE_ORDER[i + 1]
        elif kind == "damage":
            # ship integrity: at 0 the mission fails and everyone goes to the report
            if st.get("failed"):
                return s
            try:
                amount = max(0.0, min(100.0, float(data.get("amount", 0) or 0)))
            except (TypeError, ValueError):
                amount = 0.0
            st["hp"] = max(0.0, float(st.get("hp", 100)) - amount)
            if st["hp"] <= 0:
                st["failed"] = str(data.get("reason") or "The ship was lost.")[:160]
                st["phase"] = "report"
        elif kind == "earn":
            # supply points: earned on the journey (activities, quizzes), shared by the crew
            try:
                amount = round(max(0.0, min(500.0, float(data.get("amount", 0) or 0))))
            except (TypeError, ValueError):
                amount = 0
            st["sp"] = max(0, int(st.get("sp", 0)) + amount)
        elif kind in ("spend", "heal"):
            try:
                cost = max(0, round(float((data.get("cost") if kind == "heal" else data.get("amount")) or 0)))
            except (TypeError, ValueError):
                return "Bad amount"
            if int(st.get("sp", 0)) < cost:
                return "Not enough supply points"
            st["sp"] = int(st.get("sp", 0)) - cost
            if kind == "heal":
                try:
                    gain = max(0.0, min(100.0, float(data.get("amount", 0) or 0)))
                except (TypeError, ValueError):
                    gain = 0.0
                st["hp"] = min(float(st.get("hpMax", 100)), float(st.get("hp", 100)) + gain)
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
    """A player gone for too long: they leave the balance and the others split their roles."""
    st = copy.deepcopy(s)
    for p in st["players"]:
        if p["id"] == player_id and not p["connected"] and not p.get("released"):
            p["released"] = True
            rebalance(st)
            st["version"] += 1
    return st
