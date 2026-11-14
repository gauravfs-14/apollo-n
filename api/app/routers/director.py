"""AI flight director: explains numbers in plain words, never invents them. STUB. P1 replaces."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class DirectorIn(BaseModel):
    phase: str
    numbers: dict
    question: str | None = None


@router.post("/director")
async def director(body: DirectorIn) -> dict:
    return {"text": f"Flight, {body.phase} numbers are in."}
