"""Mission Plan endpoints.

GET  /missions/options?difficulty=normal[&refresh=true]  3 ready mission cards, always instant (pool + fallbacks)
POST /missions {difficulty, seed?}                       one plan (from the pool; with a seed it is generated live)
POST /missions/{id}/chosen                               the crew picked this one: retire it, refill the pool
GET  /missions/fallback | /missions/{id}[/card]                 a hand-checked plan | a plan by id
GET  /missions/pool                                      pool status (debug)
"""

from __future__ import annotations

import asyncio
import random

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import cache, llm, plan as planner

router = APIRouter()


@router.on_event("startup")
async def _start_pool() -> None:
    planner.pool.kick()


@router.on_event("shutdown")
async def _stop() -> None:
    llm.kill_all()


def _diff(d: str) -> str:
    if d not in planner.DIFFICULTIES:
        raise HTTPException(422, "difficulty must be easy, normal or hard")
    return d


def _card(e: dict) -> dict:
    return {"plan": e["plan"], "image": e.get("image"), "kind": e.get("kind", "live")}


@router.get("/missions/options")
async def options(difficulty: str = "normal", refresh: bool = Query(False)) -> dict:
    d = _diff(difficulty)
    if refresh:
        planner.pool.drop_shown(d)
    else:
        planner.pool.kick()
    cards = planner.pool.cards(d, 3)
    return {"difficulty": d, "cards": [_card(e) for e in cards], "pool": planner.pool.status()["ready"], "generating": any(planner.pool.busy.values())}


class NewMission(BaseModel):
    difficulty: str = "normal"
    seed: int | None = None


@router.post("/missions")
async def new_mission(body: NewMission) -> dict:
    d = _diff(body.difficulty)
    if body.seed is not None:
        key = f"{d}:{body.seed}"
        hit = cache.get("seeded", key)
        if hit:
            return hit["plan"]
        entry = await planner.generate_or_fallback(d, body.seed)
        cache.put("seeded", key, entry)
        return entry["plan"]
    entry = planner.pool.pop_one(d) or planner.fallback_entry(d, rng=random.Random())
    planner.register(entry)
    return entry["plan"]


@router.post("/missions/{plan_id}/chosen")
async def chosen(plan_id: str) -> dict:
    return {"ok": True, "consumed": planner.pool.consume(plan_id)}


@router.get("/missions/pool")
async def pool_status() -> dict:
    return planner.pool.status()


@router.get("/missions/fallback")
async def fallback_mission() -> dict:
    files = planner._fallback_files()
    import json

    return json.loads(files[0].read_text())


@router.get("/missions/{plan_id}/card")
async def get_card(plan_id: str) -> dict:
    e = planner.lookup(plan_id)
    if not e:
        raise HTTPException(404, "Unknown mission")
    return _card(e)


@router.get("/missions/{plan_id}")
async def get_mission(plan_id: str) -> dict:
    e = planner.lookup(plan_id)
    if not e:
        raise HTTPException(404, "Unknown mission")
    return e["plan"]
