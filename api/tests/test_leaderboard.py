"""Leaderboard API tests. Run with:  cd api && uv run python tests/test_leaderboard.py   (pytest also works if installed)."""

import os
import sys
import tempfile
from pathlib import Path

os.environ["LEADERBOARD_DB"] = str(Path(tempfile.mkdtemp()) / "lb.sqlite3")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import leaderboard as lb  # noqa: E402

client = TestClient(app)


def landing(name, seed=4242, reason="ok", vV=1.1, vH=0.4, tilt=3.0, miss=10.0, fuel=40.0, t=60.0, score=None, grade=None):
    want = lb.landing_score(reason, vV, vH, tilt, miss, fuel)
    sc = want if score is None else score
    return {
        "challenge": "landing", "seed": seed, "name": name, "score": sc, "grade": grade or lb.grade_for(sc, reason),
        "stats": {"reason": reason, "vV": vV, "vH": vH, "tilt": tilt, "miss": miss, "fuelPct": fuel, "timeS": t, "site": "site_a"},
    }


def launch(name, seed=777, rms=2.0, d1=1.0, d2=1.2, dv=20.0, t=70.0):
    traj, staging, burn = lb.launch_parts(rms, d1, d2, dv)
    return {
        "challenge": "launch", "seed": seed, "name": name, "score": lb.launch_score(traj, staging, burn), "grade": "A",
        "stats": {"rmsDeg": rms, "delay1": d1, "delay2": d2, "dv": dv, "timeS": t},
    }


def fresh():
    lb.reset_limits()


def test_week_and_seeds():
    r = client.get("/leaderboard/week").json()
    assert r["week"] == lb.week_id() and r["ends_at"] > 0
    assert 10000 <= r["seeds"]["landing"] < 100000 and r["seeds"]["landing"] != r["seeds"]["launch"]
    assert lb.weekly_seed("2026-W46", "landing") == lb.weekly_seed("2026-W46", "landing")


def test_submit_and_rank():
    fresh()
    for n, kw in [("Ana", dict(vV=0.9, miss=4, fuel=60)), ("Ben", dict(vV=2.0, tilt=9, miss=60, fuel=10)), ("Cy", dict(reason="crashed", vV=7, vH=3, tilt=40, miss=200, fuel=5))]:
        r = client.post("/leaderboard/score", json=landing(n, **kw))
        assert r.status_code == 200, r.text
        lb._last_by_name.clear()
    b = client.get("/leaderboard/board", params={"challenge": "landing", "scope": "week", "seed": 4242}).json()
    names = [e["name"] for e in b["entries"]]
    assert names == ["Ana", "Ben", "Cy"], names
    assert b["entries"][0]["rank"] == 1 and b["entries"][2]["grade"] == "F"
    # all-time board across seeds, and "me"
    b = client.get("/leaderboard/board", params={"challenge": "landing", "scope": "all", "name": "ben"}).json()
    assert b["me"]["name"] == "Ben" and b["total"] == 3


def test_best_run_per_name_only():
    fresh()
    for kw in (dict(vV=2.0, miss=80), dict(vV=0.8, miss=3, fuel=80), dict(vV=1.8, miss=50)):
        assert client.post("/leaderboard/score", json=landing("Dee", seed=11, **kw)).status_code == 200
        lb._last_by_name.clear()
    b = client.get("/leaderboard/board", params={"challenge": "landing", "scope": "all", "seed": 11}).json()
    assert len(b["entries"]) == 1 and b["entries"][0]["score"] == lb.landing_score("ok", 0.8, 0.4, 3.0, 3, 80)


def test_plausibility_rejections():
    fresh()
    bad = [
        landing("Eve", score=1000),  # score does not follow from the numbers
        landing("Eve", t=3),  # impossibly fast
        landing("Eve", vV=4.0, reason="ok"),  # "ok" with a hard touchdown
        landing("Eve", fuel=140),  # fuel > 100 %
        landing("Eve", tilt=-1),
    ]
    for p in bad:
        r = client.post("/leaderboard/score", json=p)
        assert r.status_code == 422, (p, r.status_code, r.text)
    p = landing("Eve")
    p["grade"] = "S" if p["grade"] != "S" else "F"
    assert client.post("/leaderboard/score", json=p).status_code == 422
    p = launch("Eve")
    p["score"] = 1000
    assert client.post("/leaderboard/score", json=p).status_code == 422
    p = launch("Eve", dv=-90000)
    assert client.post("/leaderboard/score", json=p).status_code == 422
    assert client.post("/leaderboard/score", json={**landing("Eve"), "name": "   "}).status_code == 422
    assert client.post("/leaderboard/score", json={**landing("Eve"), "challenge": "nope"}).status_code == 422
    assert client.post("/leaderboard/score", json={**landing("Eve"), "seed": -5}).status_code == 422


def test_name_is_sanitised():
    fresh()
    r = client.post("/leaderboard/score", json=landing("  <b>Mal\"lory</b>\n  The   Great  ", seed=99)).json()
    assert r["name"] == "bMallory/b The Great", r


def test_launch_board():
    fresh()
    assert client.post("/leaderboard/score", json=launch("Fay")).status_code == 200
    lb._last_by_name.clear()
    assert client.post("/leaderboard/score", json=launch("Gus", rms=9, d1=3, d2=4, dv=-250)).status_code == 200
    b = client.get("/leaderboard/board", params={"challenge": "launch", "scope": "week"}).json()
    assert [e["name"] for e in b["entries"]] == ["Fay", "Gus"]


def test_rate_limit():
    fresh()
    assert client.post("/leaderboard/score", json=landing("Hal", seed=5)).status_code == 200
    assert client.post("/leaderboard/score", json=landing("Hal", seed=5)).status_code == 429  # same name, too soon
    fresh()
    codes = []
    for i in range(16):
        codes.append(client.post("/leaderboard/score", json=landing(f"Spam{i}", seed=6)).status_code)
    assert codes[:12] == [200] * 12 and 429 in codes[12:], codes
    fresh()


def test_mission_board():
    fresh()
    r = client.post("/leaderboard/mission", json={"room": "APOLLO-7K3", "crew": ["Ana", "Ben"], "score": 640, "level": 2, "seconds": 900, "hp": 70})
    assert r.status_code == 200 and r.json()["improved"] and r.json()["rank_week"] == 1, r.text
    lb._last_by_name.clear()
    # a worse replay in the same room does not replace the better one; a better one does
    assert client.post("/leaderboard/mission", json={"room": "apollo-7k3", "crew": ["Ana"], "score": 300}).json()["improved"] is False
    lb._last_by_name.clear()
    assert client.post("/leaderboard/mission", json={"room": "APOLLO-9ZZ", "crew": ["Cy"], "score": 800}).json()["rank_week"] == 1
    lb._last_by_name.clear()
    b = client.get("/leaderboard/mission", params={"scope": "week"}).json()
    assert [e["room"] for e in b["entries"]] == ["APOLLO-9ZZ", "APOLLO-7K3"] and b["entries"][1]["crew"] == ["Ana", "Ben"]
    for bad in ({"room": "x", "crew": ["A"], "score": 5}, {"room": "APOLLO-AAA", "crew": [], "score": 5},
                {"room": "APOLLO-AAA", "crew": ["A"], "score": 5000}, {"room": "APOLLO-AAA", "crew": list("abcde"), "score": 5}):
        assert client.post("/leaderboard/mission", json=bad).status_code == 422, bad


if __name__ == "__main__":
    n = 0
    for k, v in list(globals().items()):
        if k.startswith("test_") and callable(v):
            v()
            n += 1
            print("ok", k)
    print(f"{n} leaderboard tests passed")
