"""Mission-control voice.

VOICE_PROVIDER=system      -> {url: null}; the browser speaks with the system voice (web/game/core/audio.ts).
VOICE_PROVIDER=elevenlabs  -> ElevenLabs TTS, cached as data/media/voice/<hash>.mp3, returned as an
                              absolute URL under /media/voice/ (served by the static mount in main.py).

Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, optional ELEVENLABS_MODEL (default eleven_multilingual_v2;
use eleven_turbo_v2_5 for lower latency), PUBLIC_API_URL (default: the request's own base URL).
Any failure returns {url: null} so the game falls back to the system voice and never stalls.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger("apollo.voice")

VOICE_DIR = Path(__file__).resolve().parents[2] / "data" / "media" / "voice"
_locks: dict[str, asyncio.Lock] = {}


class VoiceIn(BaseModel):
    line_id: str | None = None
    text: str


def _base(request: Request) -> str:
    return (os.getenv("PUBLIC_API_URL") or str(request.base_url)).rstrip("/")


async def _synthesize(text: str, dest: Path) -> bool:
    key = os.getenv("ELEVENLABS_API_KEY")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID")
    if not key or not voice_id:
        log.warning("ElevenLabs selected but ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID missing")
        return False
    model = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": key, "accept": "audio/mpeg"},
            json={
                "text": text,
                "model_id": model,
                "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True},
            },
        )
    if r.status_code != 200 or not r.content:
        log.warning("ElevenLabs returned %s", r.status_code)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return True


@router.post("/voice")
async def voice(body: VoiceIn, request: Request) -> dict:
    if os.getenv("VOICE_PROVIDER", "system") != "elevenlabs":
        return {"url": None}
    text = " ".join(body.text.split())[:600]
    if not text:
        return {"url": None}
    # voice id + model are part of the hash, so switching voices never serves stale audio
    h = hashlib.sha256(f"{os.getenv('ELEVENLABS_VOICE_ID')}|{os.getenv('ELEVENLABS_MODEL', '')}|{text}".encode()).hexdigest()[:24]
    dest = VOICE_DIR / f"{h}.mp3"
    if not dest.exists():
        lock = _locks.setdefault(h, asyncio.Lock())
        async with lock:
            if not dest.exists():
                try:
                    if not await _synthesize(text, dest):
                        return {"url": None}
                except Exception as e:  # noqa: BLE001
                    log.warning("voice synthesis failed: %s", type(e).__name__)
                    return {"url": None}
    return {"url": f"{_base(request)}/media/voice/{h}.mp3"}
