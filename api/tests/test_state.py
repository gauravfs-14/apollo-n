"""Reducer + room-rule tests. Run with:  cd api && uv run python tests/test_state.py   (pytest also works if installed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.game.state import PHASE_ORDER, ROLES, apply, clean_score, disconnect, new_state, release_role  # noqa: E402
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
    assert player(s, "a")["picked"] == "pilot" and "pilot" in player(s, "a")["roles"]
    assert apply(s, "b", {"type": "pick_role", "role": "pilot"}) == "Role already taken"
    assert apply(s, "b", {"type": "pick_role", "role": "captain"}) == "Unknown role"
    s = apply(s, "a", {"type": "pick_role", "role": None})
    assert "picked" not in player(s, "a")


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


def roles(s):
    return {p["id"]: p["roles"] for p in s["players"] if not p.get("released")}


def covered(s):
    """Every role held by exactly one player, shares as even as possible."""
    held = [r for p in s["players"] for r in p["roles"]]
    assert sorted(held) == sorted(ROLES), held
    sizes = sorted(len(p["roles"]) for p in s["players"] if not p.get("released"))
    assert sizes[-1] - sizes[0] <= 1, sizes


def test_balance_as_players_join():
    s = join(new_state("R", "multi"), "a")
    assert roles(s) == {"a": ROLES}
    s = join(s, "b")
    covered(s)
    assert [len(p["roles"]) for p in s["players"]] == [2, 2]
    s = join(s, "c")
    covered(s)
    assert sorted(len(p["roles"]) for p in s["players"]) == [1, 1, 2]
    assert len(player(s, "a")["roles"]) == 1  # the extra role goes to a guest, not the host
    s = join(s, "d")
    covered(s)
    assert all(len(p["roles"]) == 1 for p in s["players"])


def test_pick_honoured_and_deterministic():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = apply(s, "b", {"type": "pick_role", "role": "pilot"})
    assert "pilot" in player(s, "b")["roles"] and player(s, "b")["role"] == "pilot"
    covered(s)
    s = join(s, "c")
    covered(s)
    assert "pilot" in player(s, "b")["roles"]  # a join never steals an explicit pick
    s = apply(s, "c", {"type": "pick_role", "role": "commander"})  # taking a role someone only holds automatically
    assert "commander" in player(s, "c")["roles"] and "commander" not in player(s, "a")["roles"]
    covered(s)
    assert apply(s, "a", {"type": "pick_role", "role": "commander"}) == "Role already taken"
    # same inputs -> same answer
    assert apply(s, "a", {"type": "pick_role", "role": "scientist"}) == apply(s, "a", {"type": "pick_role", "role": "scientist"})


def test_everyone_picks_and_solo_unchanged():
    s = join(new_state("R", "solo"), "a")
    s = apply(s, "a", {"type": "pick_role", "role": "pilot"})
    assert player(s, "a")["roles"] == ROLES
    m = new_state("R", "multi")
    for pid, r in zip("abcd", ROLES):
        m = apply(join(m, pid), pid, {"type": "pick_role", "role": r})
    assert roles(m) == {pid: [r] for pid, r in zip("abcd", ROLES)}


def test_release_role_only_when_disconnected():
    s = join(join(new_state("R", "multi"), "a"), "b")
    s = apply(s, "b", {"type": "pick_role", "role": "engineer"})
    assert not player(release_role(s, "b"), "b").get("released")  # still connected: untouched
    s = disconnect(s, "b")
    assert len(player(s, "b")["roles"]) == 2  # grace: keeps its roles until the timeout
    s = release_role(s, "b")
    assert player(s, "b")["roles"] == [] and player(s, "a")["roles"] == ROLES
    covered(s)


def test_leave_after_timeout_then_reconnect():
    room = Room("R", "multi")
    for pid in "abc":
        room.state = join(room.state, pid)
    room.state = apply(room.state, "c", {"type": "pick_role", "role": "scientist"})
    room.state = disconnect(room.state, "c")
    room.disconnected_at["c"] = 100.0
    assert sweep_room(room, 100.0 + ROLE_TIMEOUT - 1) is False and "scientist" in player(room.state, "c")["roles"]
    assert sweep_room(room, 100.0 + ROLE_TIMEOUT + 1) is True
    assert player(room.state, "c")["roles"] == [] and room.lost_roles["c"] == "scientist"
    covered(room.state)
    assert [len(player(room.state, x)["roles"]) for x in "ab"] == [2, 2]
    # reconnect: dealt in again, then the pick is restored (what the websocket handler does)
    room.state = join(room.state, "c")
    covered(room.state)
    assert len(player(room.state, "c")["roles"]) >= 1
    room.state = apply(room.state, "c", {"type": "pick_role", "role": room.lost_roles.pop("c")})
    assert "scientist" in player(room.state, "c")["roles"]
    covered(room.state)
    assert sorted(len(p["roles"]) for p in room.state["players"]) == [1, 1, 2]


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


def test_damage_fails_mission_at_zero():
    s = new_state("R", "solo")
    s = apply(s, "a", {"type": "join", "id": "a", "name": "A"})
    s = apply(s, "a", {"type": "action", "phase": "select", "kind": "complete", "data": {"score": 100}})
    assert s["hp"] == 100 and s["phase"] == "build"
    s = apply(s, "a", {"type": "action", "phase": "build", "kind": "damage", "data": {"amount": 40, "reason": "x"}})
    assert s["hp"] == 60 and not s["failed"] and s["phase"] == "build"
    s = apply(s, "a", {"type": "action", "phase": "build", "kind": "damage", "data": {"amount": 70, "reason": "Hull breach"}})
    assert s["hp"] == 0 and s["failed"] == "Hull breach" and s["phase"] == "report"
    # once failed, further damage is ignored
    s2 = apply(s, "a", {"type": "action", "phase": "report", "kind": "damage", "data": {"amount": 5}})
    assert s2["hp"] == 0 and s2["failed"] == "Hull breach"
    # reset restores integrity
    s3 = apply(s, "a", {"type": "action", "phase": "report", "kind": "reset"})
    assert s3["hp"] == 100 and s3["failed"] is None and s3["phase"] == "select"


def test_hull_upgrade_sets_hp_max_at_mission_start():
    s = new_state("R", "solo")
    assert s["hpMax"] == 100
    s = apply(s, "a", {"type": "join", "id": "a", "name": "A"})
    s = apply(s, "a", {"type": "action", "phase": "select", "kind": "set_plan", "data": {"plan": {"id": "x"}, "hpMax": 130}})
    assert s["hpMax"] == 130 and s["hp"] == 130
    s = apply(s, "a", {"type": "action", "phase": "select", "kind": "complete", "data": {"score": 100}})
    s = apply(s, "a", {"type": "action", "phase": "build", "kind": "damage", "data": {"amount": 40, "reason": "x"}})
    assert s["hp"] == 90 and s["hpMax"] == 130
    # junk and out-of-range values are clamped; hpMax is only honoured while in select
    s2 = new_state("R", "solo")
    s2 = apply(s2, "a", {"type": "join", "id": "a", "name": "A"})
    assert apply(s2, "a", {"type": "action", "phase": "select", "kind": "set_plan", "data": {"hpMax": 9999}})["hpMax"] == 200
    assert apply(s2, "a", {"type": "action", "phase": "select", "kind": "set_plan", "data": {"hpMax": "bad"}})["hpMax"] == 100
    assert apply(s2, "a", {"type": "action", "phase": "select", "kind": "set_plan", "data": {"hpMax": 5}})["hpMax"] == 100
    s2 = apply(s2, "a", {"type": "action", "phase": "select", "kind": "complete", "data": {"score": 100}})
    s2 = apply(s2, "a", {"type": "action", "phase": "build", "kind": "set_plan", "data": {"hpMax": 150}})
    assert s2["hpMax"] == 100 and s2["hp"] == 100
    # reset restores the stock hull
    s3 = apply(s, "a", {"type": "action", "phase": "build", "kind": "reset"})
    assert s3["hpMax"] == 100 and s3["hp"] == 100


def test_drop_phase_retired():
    s = new_state("R", "solo")
    s = apply(s, "a", {"type": "join", "id": "a", "name": "A"})
    s = apply(s, "a", {"type": "action", "phase": "select", "kind": "complete", "data": {"score": 100}})
    s = apply(s, "a", {"type": "action", "phase": "build", "kind": "complete", "data": {"score": 80}})
    assert s["phase"] == "crew"


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
