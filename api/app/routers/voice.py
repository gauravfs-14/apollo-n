"""Mission-control voice. VOICE_PROVIDER=system → {url: null}; the browser speaks with
the system voice. VOICE_PROVIDER=elevenlabs → cached mp3 under /media/voice (later)."""

from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class VoiceIn(BaseModel):
    line_id: str | None = None
    text: str


@router.post("/voice")
async def voice(body: VoiceIn) -> dict:
    if os.getenv("VOICE_PROVIDER", "system") != "elevenlabs":
        return {"url": None}
    return {"url": None}  # TODO(P1): ElevenLabs TTS → data/media/voice/<hash>.mp3
