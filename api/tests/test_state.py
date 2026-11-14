"""Reducer + room-rule tests. Run with:  cd api && uv run python tests/test_state.py   (pytest also works if installed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.game.state import PHASE_ORDER, apply, clean_score, disconnect, new_state, release_role  # noqa: E402
from app.routers.rooms import ROLE_TIMEOUT, ROOM_TTL, Bucket, Room, expired, sweep_room  # noqa: E402


def join(s, pid, name="A"):
    r = apply(s, pid, {"type": "join", "id": pid, "name": name})
    assert not isinstance(r, str), r
    return r


def act(s, pid, kind, _phase=None, **data):
    return apply(s, pid, {"type": "action", "phase": _phase or s["phase"], "kind": kind, "data": data})


def player(s, pid):
    return next(p for p in s["players"] if p["id"] == pid)


def test_first_player_is_host_and_max_four():
    s = new_state("R", "multi")
    for i in range(4):
        s = join(s, f"p{i}")
    assert [p["isHost"] for p in s["players"]] == [True, False, False, False]
    assert apply(s, "p9", {"type": "join", "id": "p9", "name": "X"}) == "Room is full (4 astronauts max)"


def test_reconnect_keeps_same_player():
    s = join(new_state("R", "multi"), "a", "Ann")
    s = join(s, "b", "Bob")
    n = len(s["players"])
    s = disconnect(s, "b")
    assert player(s, "b")["connected"] is False
    s = join(s, "b", "Bobby")
    assert len(s["players"]) == n and player(s, "b")["connected"] and player(s, "b")["name"] == "Bobby"


def test_host_migration_and_rejoin():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = disconnect(s, "a")
    assert player(s, "b")["isHost"] and not player(s, "a")["isHost"]
    s = join(s, "a")  # old host returns: stays a normal player
    assert player(s, "b")["isHost"] and not player(s, "a")["isHost"]


def test_everyone_left_then_first_back_is_host():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = disconnect(disconnect(s, "a"), "b")
    s = join(s, "b")
    assert player(s, "b")["isHost"] and not player(s, "a")["isHost"]


def test_roles_unique_and_validated():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = apply(s, "a", {"type": "pick_role", "role": "pilot"})
    assert player(s, "a")["role"] == "pilot"
    assert apply(s, "b", {"type": "pick_role", "role": "pilot"}) == "Role already taken"
    assert apply(s, "b", {"type": "pick_role", "role": "captain"}) == "Unknown role"
    s = apply(s, "a", {"type": "pick_role", "role": None})
    assert "role" not in player(s, "a")


def test_actions_checked():
    s = join(new_state("R", "multi"), "a")
    assert act(s, "ghost", "patch") == "Join first"
    assert act(s, "a", "patch", _phase="launch") == "Not in phase launch"
    assert act(s, "a", "nope").startswith("Unknown action")
    assert apply(s, "a", {"type": "action", "phase": "select", "kind": "patch", "data": [1, 2]}) == "Bad action data"
    s2 = act(s, "a", "patch", x=1)
    assert s2["phaseData"]["select"] == {"x": 1} and s2["version"] == s["version"] + 1


def test_complete_advances_and_clamps():
    s = join(new_state("R", "solo"), "a")
    for i, ph in enumerate(PHASE_ORDER[:-1]):
        s = act(s, "a", "complete", score=250 if i == 0 else -5)
        assert s["phase"] == PHASE_ORDER[i + 1]
    assert s["scores"]["select"] == 100 and s["scores"]["build"] == 0
    assert clean_score("abc") == 0 and clean_score(float("nan")) == 0 and clean_score(None) == 0


def test_goto_and_reset_host_only():
    s = join(join(new_state("R", "multi"), "a"), "b")
    assert act(s, "b", "goto", phase="crew") == "Only the host can jump phases"
    assert act(s, "a", "goto", phase="mars") == "Unknown phase"
    s = act(s, "a", "goto", phase="crew")
    assert s["phase"] == "crew"
    assert act(s, "b", "reset") == "Only the host can reset"
    s = act(s, "a", "reset")
    assert s["phase"] == "select" and len(s["players"]) == 2


def test_names_sanitised():
    s = join(new_state("R", "multi"), "a", "   ")
    assert player(s, "a")["name"] == "Astronaut"
    s = join(s, "b", "x" * 80)
    assert len(player(s, "b")["name"]) == 24


def test_solo_takeover():
    s = join(new_state("R", "solo"), "a")
    assert apply(s, "b", {"type": "join", "id": "b", "name": "B"}) == "Solo room is full"
    s = disconnect(s, "a")
    s = join(s, "b", "B")
    assert len(s["players"]) == 1 and s["players"][0]["id"] == "b" and s["players"][0]["isHost"]


def test_release_role_only_when_disconnected():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = apply(s, "b", {"type": "pick_role", "role": "engineer"})
    assert "role" in player(release_role(s, "b"), "b")  # still connected: untouched
    s = disconnect(s, "b")
    s = release_role(s, "b")
    assert "role" not in player(s, "b")
    s = apply(s, "a", {"type": "pick_role", "role": "engineer"})  # now free for someone else
    assert player(s, "a")["role"] == "engineer"


def test_room_sweep_releases_role_after_timeout_and_restores():
    room = Room("R", "multi")
    room.state = join(join(room.state, "a"), "b")
    room.state = apply(room.state, "b", {"type": "pick_role", "role": "pilot"})
    room.state = disconnect(room.state, "b")
    room.disconnected_at["b"] = 100.0
    assert sweep_room(room, 100.0 + ROLE_TIMEOUT - 1) is False and player(room.state, "b")["role"] == "pilot"
    assert sweep_room(room, 100.0 + ROLE_TIMEOUT + 1) is True
    assert "role" not in player(room.state, "b") and room.lost_roles["b"] == "pilot"


def test_room_expiry():
    room = Room("R", "multi")
    room.last_active = 1000.0
    assert not expired(room, 1000.0 + ROOM_TTL - 1)
    assert expired(room, 1000.0 + ROOM_TTL + 1)
    room.sockets["a"] = object()  # someone connected: never expires
    assert not expired(room, 1000.0 + ROOM_TTL * 5)


def test_rate_limit_bucket():
    b = Bucket(rate=10, burst=5)
    b.t = 0.0
    assert [b.allow(0.0) for _ in range(6)] == [True] * 5 + [False]
    assert b.allow(0.5)  # 5 tokens refilled


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                fails += 1
                print("FAIL", name, repr(e))
    sys.exit(1 if fails else 0)
