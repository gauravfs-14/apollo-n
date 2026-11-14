"""Landing-site scoring + Monte Carlo landings. STUB. P4 replaces this."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ScoreIn(BaseModel):
    site_id: str
    x: float
    z: float
    lander: dict | None = None


@router.post("/landing/score")
def score(body: ScoreIn) -> dict:
    return {"score": 50, "sun_pct": 50, "earth_pct": 50, "slope_deg": 5, "relic_km": 10, "hazards": []}
