"""Mission Plan generation. STUB: returns the fallback plan. P1 replaces this."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
FALLBACK = Path(__file__).resolve().parents[3] / "shared" / "fallback-plans"


class NewMission(BaseModel):
    difficulty: str = "normal"
    seed: int | None = None


@router.post("/missions")
async def new_mission(body: NewMission) -> dict:
    plan = json.loads((FALLBACK / "apollo-1.json").read_text())
    plan["difficulty"] = body.difficulty
    return plan
