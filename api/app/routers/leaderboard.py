"""Leaderboards for the arcade challenges and the weekly crew board for full missions.

Storage: one small SQLite file, api/data/leaderboard/leaderboard.sqlite3 (override with LEADERBOARD_DB; gitignored).
No auth: a name, basic validation, per-client rate limiting and plausibility checks. Challenge scores are recomputed
here from the raw touchdown / burn numbers the client sends (the formulas are twins of web/game/arcade/scoring.ts),
so a submitted score that does not follow from its numbers, or numbers that cannot happen, are rejected (422).

Endpoints
  GET  /leaderboard/week                       this week's id, end time and the shared weekly seeds
  POST /leaderboard/score                      submit a landing / launch challenge run
  GET  /leaderboard/board?challenge=landing&scope=week|all[&seed=N][&name=X][&limit=20]
  POST /leaderboard/mission                    a full mission's result (called by the report screen)
  GET  /leaderboard/mission?scope=week|all[&limit=20]

POST /leaderboard/mission body (for the report screen):
  { "room": "APOLLO-7K3", "crew": ["Ana", "Ben"], "score": 0-1000, "level": 1-99 (optional),
    "seconds": 60-86400 (optional, mission duration), "hp": 0-100 (optional, crew HP left) }
  Keeps the best score per room per week. A solo mission is a crew of one.
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, ValidationError

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

DB_PATH = Path(os.getenv("LEADERBOARD_DB") or Path(__file__).resolve().parents[2] / "data" / "leaderboard" / "leaderboard.sqlite3")
_lock = threading.Lock()

# ---- scoring twins of web/game/arcade/scoring.ts -------------------------------------------------------------------
LIMIT_DEG = 12.0  # leg tilt tolerance of the challenge lander
V_SAFE, V_CRASH = 2.2, 5.0
CAPS = {"ok": 1000, "hard": 700, "boulder": 700, "tipped": 350, "crashed": 100}
TLI_TARGET_TOL = 100.0  # half-width of the green burn window (m/s)
TRAJ_TOL = 8.0  # rms pitch error (deg) that costs most trajectory points


def _clamp(x: float, a: float, b: float) -> float:
    return min(b, max(a, x))


def _lin(v: float, good: float, bad: float) -> float:
    return _clamp((bad - v) / (bad - good), 0.0, 1.0)


def _rnd(x: float) -> int:
    return int(math.floor(x + 0.5))


def landing_score(reason: str, v_v: float, v_h: float, tilt: float, miss: float, fuel_pct: float) -> int:
    pts = (
        300 * _lin(v_v, 0.8, V_CRASH)
        + 200 * _lin(v_h, 0.4, 4.0)
        + 150 * _lin(tilt / LIMIT_DEG, 0.3, 1.1)
        + 200 * _lin(miss, 6.0, 120.0)
        + 150 * _clamp(fuel_pct / 30.0, 0.0, 1.0)
    )
    return int(min(CAPS[reason], _rnd(pts)))


def grade_for(score: int, reason: str) -> str:
    if reason == "crashed":
        return "F"
    for g, lo in (("S", 900), ("A", 780), ("B", 620), ("C", 450), ("D", 250)):
        if score >= lo:
            return g
    return "F"


def _stage_score(delay: float) -> float:
    return 100 * _clamp(1 - (delay - 0.5) / 3.5, 0.0, 1.0)


def launch_parts(rms_deg: float, d1: float, d2: float, dv: float) -> tuple[int, int, int]:
    traj = _rnd(100 * _clamp(1 - (rms_deg - TRAJ_TOL * 0.15) / (TRAJ_TOL * 1.1), 0.0, 1.0))
    staging = _rnd((_stage_score(d1) + _stage_score(d2)) / 2)
    burn = _rnd(100 * _clamp(1 - (abs(dv) - TLI_TARGET_TOL / 3) / (TLI_TARGET_TOL * 3), 0.0, 1.0))
    return traj, staging, burn


def launch_score(traj: int, staging: int, burn: int) -> int:
    return _rnd(4 * traj + 2.5 * staging + 3.5 * burn)


# ---- weeks and seeds ----------------------------------------------------------------------------------------------
def week_id(ts: float | None = None) -> str:
    y, w, _ = datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def week_end(ts: float | None = None) -> float:
    d = datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc)
    monday = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (monday + timedelta(days=7)).timestamp()


def weekly_seed(week: str, challenge: str) -> int:
    """Same formula as web/game/arcade/seed.ts weeklySeed (FNV-1a over 'week:challenge', 5 digits)."""
    h = 2166136261
    for b in f"{week}:{challenge}".encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return 10000 + h % 90000


# ---- storage ------------------------------------------------------------------------------------------------------
def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT, challenge TEXT NOT NULL, seed INTEGER NOT NULL, week TEXT NOT NULL,
          name TEXT NOT NULL, score INTEGER NOT NULL, grade TEXT NOT NULL, stats TEXT NOT NULL, created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS scores_board ON scores (challenge, week, seed, score DESC);
        CREATE TABLE IF NOT EXISTS missions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, week TEXT NOT NULL, crew TEXT NOT NULL,
          score INTEGER NOT NULL, level INTEGER, seconds INTEGER, hp INTEGER, created REAL NOT NULL,
          UNIQUE (room, week));
        """
    )
    return c


# ---- validation + rate limiting ------------------------------------------------------------------------------------
_NAME_BAD = re.compile(r"[\x00-\x1f\x7f<>&\"'`\\]")


def clean_name(raw: str) -> str:
    n = re.sub(r"\s+", " ", _NAME_BAD.sub("", raw)).strip()[:24]
    if not n:
        raise HTTPException(422, "name is empty")
    return n


IP_LIMIT, IP_WINDOW = 12, 60.0  # submissions per client per minute
NAME_GAP = 3.0  # seconds between two submissions under one name
_hits: dict[str, deque[float]] = defaultdict(deque)
_last_by_name: dict[str, float] = {}


def reset_limits() -> None:
    _hits.clear()
    _last_by_name.clear()


def rate_limit(request: Request, name: str) -> None:
    now = time.monotonic()
    ip = request.client.host if request.client else "?"
    q = _hits[ip]
    while q and now - q[0] > IP_WINDOW:
        q.popleft()
    if len(q) >= IP_LIMIT:
        raise HTTPException(429, "too many submissions, slow down")
    key = name.lower()
    if now - _last_by_name.get(key, -1e9) < NAME_GAP:
        raise HTTPException(429, "one submission every few seconds")
    q.append(now)
    _last_by_name[key] = now
    if len(_last_by_name) > 5000:
        _last_by_name.clear()


# ---- models -------------------------------------------------------------------------------------------------------
class LandingStats(BaseModel):
    reason: Literal["ok", "hard", "boulder", "tipped", "crashed"]
    vV: float = Field(ge=0, le=60, description="sink rate at touchdown, m/s")
    vH: float = Field(ge=0, le=60, description="sideways speed, m/s")
    tilt: float = Field(ge=0, le=180, description="tilt used by the leg check, deg")
    miss: float = Field(ge=0, le=5000, description="distance from the target, m")
    fuelPct: float = Field(ge=0, le=100)
    timeS: float = Field(ge=0, le=1800, description="flight time, s")
    site: str | None = Field(default=None, max_length=40)


class LaunchStats(BaseModel):
    rmsDeg: float = Field(ge=0, le=90)
    delay1: float = Field(ge=0, le=6)
    delay2: float = Field(ge=0, le=6)
    dv: float = Field(ge=-6000, le=2000, description="achieved minus target speed, m/s")
    timeS: float = Field(ge=0, le=1800)


class ScoreIn(BaseModel):
    challenge: Literal["landing", "launch"]
    seed: int = Field(ge=0, le=2**31 - 1)
    name: str = Field(min_length=1, max_length=60)
    score: int = Field(ge=0, le=1000)
    grade: str = Field(min_length=1, max_length=2)
    stats: dict


class MissionIn(BaseModel):
    room: str = Field(pattern=r"^[A-Za-z0-9-]{3,16}$")
    crew: list[str] = Field(min_length=1, max_length=4)
    score: int = Field(ge=0, le=1000)
    level: int | None = Field(default=None, ge=1, le=99)
    seconds: int | None = Field(default=None, ge=60, le=86400)
    hp: int | None = Field(default=None, ge=0, le=100)


def _parse(model, data: dict):
    try:
        return model(**data)
    except (ValidationError, TypeError) as e:
        raise HTTPException(422, f"bad stats: {str(e)[:120]}") from None


def _check_landing(s: ScoreIn) -> dict:
    st = _parse(LandingStats, s.stats)
    if st.timeS < 12:
        raise HTTPException(422, "implausible flight time")
    if st.reason == "ok" and (st.vV > V_SAFE + 0.05 or st.tilt > LIMIT_DEG + 0.05):
        raise HTTPException(422, "outcome does not match the touchdown numbers")
    if st.reason == "hard" and st.vV <= V_SAFE - 0.05:
        raise HTTPException(422, "outcome does not match the touchdown numbers")
    if st.reason == "crashed" and st.vV < V_CRASH - 0.05 and st.tilt < 30 and st.vH < 2:
        pass  # body strike or a steep lean can crash a slow touchdown: accepted
    want = landing_score(st.reason, st.vV, st.vH, st.tilt, st.miss, st.fuelPct)
    if abs(want - s.score) > 2 or s.grade != grade_for(want, st.reason):
        raise HTTPException(422, "score does not follow from the touchdown numbers")
    return st.model_dump(exclude_none=True)


def _check_launch(s: ScoreIn) -> dict:
    st = _parse(LaunchStats, s.stats)
    if st.timeS < 30:
        raise HTTPException(422, "implausible flight time")
    traj, staging, burn = launch_parts(st.rmsDeg, st.delay1, st.delay2, st.dv)
    want = launch_score(traj, staging, burn)
    if abs(want - s.score) > 2:
        raise HTTPException(422, "score does not follow from the flight numbers")
    return st.model_dump()


# ---- endpoints ----------------------------------------------------------------------------------------------------
@router.get("/week")
def week() -> dict:
    w = week_id()
    return {"week": w, "ends_at": week_end(), "seeds": {c: weekly_seed(w, c) for c in ("landing", "launch")}}


@router.post("/score")
def post_score(s: ScoreIn, request: Request) -> dict:
    name = clean_name(s.name)
    stats = _check_landing(s) if s.challenge == "landing" else _check_launch(s)
    rate_limit(request, name)
    now = time.time()
    w = week_id(now)
    with _lock, _db() as c:
        c.execute(
            "INSERT INTO scores (challenge, seed, week, name, score, grade, stats, created) VALUES (?,?,?,?,?,?,?,?)",
            (s.challenge, s.seed, w, name, s.score, s.grade, json.dumps(stats), now),
        )
        out = {"ok": True, "week": w, "name": name}
        for scope in ("week", "all"):
            out[f"rank_{scope}"] = _rank(c, s.challenge, scope, s.seed, name)
    return out


def _best_rows(c: sqlite3.Connection, challenge: str, scope: str, seed: int | None):
    where, args = ["challenge = ?"], [challenge]
    if scope == "week":
        where.append("week = ?")
        args.append(week_id())
    if seed is not None:
        where.append("seed = ?")
        args.append(seed)
    # best run per name (case-insensitive); ties go to the earlier run
    rows = c.execute(f"SELECT * FROM scores WHERE {' AND '.join(where)} ORDER BY score DESC, created ASC", args).fetchall()
    seen: set[str] = set()
    out = []
    for r in rows:
        k = r["name"].lower()
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def _rank(c: sqlite3.Connection, challenge: str, scope: str, seed: int | None, name: str) -> int | None:
    for i, r in enumerate(_best_rows(c, challenge, scope, seed)):
        if r["name"].lower() == name.lower():
            return i + 1
    return None


@router.get("/board")
def board(
    challenge: Literal["landing", "launch"],
    scope: Literal["week", "all"] = "week",
    seed: int | None = Query(default=None, ge=0, le=2**31 - 1),
    name: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    with _lock, _db() as c:
        rows = _best_rows(c, challenge, scope, seed)
    entries = [
        {"rank": i + 1, "name": r["name"], "score": r["score"], "grade": r["grade"], "seed": r["seed"],
         "stats": json.loads(r["stats"]), "at": r["created"]}
        for i, r in enumerate(rows)
    ]
    out = {"challenge": challenge, "scope": scope, "seed": seed, "week": week_id(), "total": len(entries), "entries": entries[:limit]}
    if name:
        me = next((e for e in entries if e["name"].lower() == name.strip().lower()), None)
        out["me"] = me
    return out


@router.post("/mission")
def post_mission(m: MissionIn, request: Request) -> dict:
    crew = []
    for n in m.crew:
        cn = clean_name(n)
        if cn.lower() not in [x.lower() for x in crew]:
            crew.append(cn)
    rate_limit(request, f"room:{m.room.upper()}")
    now = time.time()
    w = week_id(now)
    with _lock, _db() as c:
        old = c.execute("SELECT score FROM missions WHERE room = ? AND week = ?", (m.room.upper(), w)).fetchone()
        improved = old is None or m.score > old["score"]
        if improved:
            c.execute(
                "INSERT INTO missions (room, week, crew, score, level, seconds, hp, created) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(room, week) DO UPDATE SET crew=excluded.crew, score=excluded.score, level=excluded.level, "
                "seconds=excluded.seconds, hp=excluded.hp, created=excluded.created",
                (m.room.upper(), w, json.dumps(crew), m.score, m.level, m.seconds, m.hp, now),
            )
        better = c.execute("SELECT COUNT(*) AS n FROM missions WHERE week = ? AND score > (SELECT score FROM missions WHERE room = ? AND week = ?)", (w, m.room.upper(), w)).fetchone()["n"]
    return {"ok": True, "week": w, "improved": improved, "rank_week": better + 1}


@router.get("/mission")
def mission_board(scope: Literal["week", "all"] = "week", limit: int = Query(default=20, ge=1, le=100)) -> dict:
    with _lock, _db() as c:
        if scope == "week":
            rows = c.execute("SELECT * FROM missions WHERE week = ? ORDER BY score DESC, created ASC LIMIT ?", (week_id(), limit)).fetchall()
        else:
            rows = c.execute("SELECT * FROM missions ORDER BY score DESC, created ASC LIMIT ?", (limit,)).fetchall()
    return {
        "scope": scope, "week": week_id(),
        "entries": [
            {"rank": i + 1, "room": r["room"], "crew": json.loads(r["crew"]), "score": r["score"], "level": r["level"],
             "seconds": r["seconds"], "hp": r["hp"], "week": r["week"], "at": r["created"]}
            for i, r in enumerate(rows)
        ],
    }
