"""Mission-control voice.

VOICE_PROVIDER=system      -> {url: null}; the browser speaks with the system voice (web/game/core/audio.ts).
VOICE_PROVIDER=elevenlabs  -> ElevenLabs TTS, cached as data/media/voice/<hash>.mp3, returned as an
                              absolute URL under /media/voice/ (served by the static mount in main.py).
                              The browser adds the radio sound (comms band, static, Quindar tones).

Speakers, like real mission audio:
  capcom  Houston talking to the crew          ELEVENLABS_VOICE_ID       (default: Bill, older American)
  crew    the commander answering from space   ELEVENLABS_CREW_VOICE_ID  (default: Brian, deep American)
  crew2   the lunar module pilot / recovery    ELEVENLABS_LMP_VOICE_ID   (default: Eric, younger American)
  pao     Launch Control / Apollo Control PAO  ELEVENLABS_PAO_VOICE_ID   (default: Adam, broadcast narrator)

Env: ELEVENLABS_API_KEY, optional ELEVENLABS_MODEL (default eleven_v3, the most expressive model),
PUBLIC_API_URL (default: the request's own base URL).
Any failure returns {url: null} so the game falls back to the system voice and never stalls.
POST /voice/prefetch synthesizes a mission's lines in the background so playback never waits.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger("apollo.voice")

VOICE_DIR = Path(__file__).resolve().parents[2] / "data" / "media" / "voice"
# ElevenLabs premade voices: Bill, Brian, Eric, Adam
DEFAULT_VOICES = {
    "capcom": "pqHfZKP75CvOlQylNhV4",
    "crew": "nPczCjzI2devNBz1zQrb",
    "crew2": "cjVigY5qzO86Huf0OWal",
    "pao": "pNInz6obpgDQGcFmaJgB",
}
VOICE_ENV = {"capcom": "ELEVENLABS_VOICE_ID", "crew": "ELEVENLABS_CREW_VOICE_ID", "crew2": "ELEVENLABS_LMP_VOICE_ID", "pao": "ELEVENLABS_PAO_VOICE_ID"}
_locks: dict[str, asyncio.Lock] = {}
# Prefetch runs at most 2 syntheses at once; a line the player is waiting for skips that queue.
_bg_gate = asyncio.Semaphore(2)
_bg: set[asyncio.Task] = set()

Speaker = Literal["capcom", "crew", "crew2", "pao"]


class VoiceIn(BaseModel):
    line_id: str | None = None
    text: str
    speaker: Speaker = "capcom"


class PrefetchLine(BaseModel):
    text: str
    speaker: Speaker = "capcom"


class PrefetchIn(BaseModel):
    lines: list[PrefetchLine]


def enabled() -> bool:
    return os.getenv("VOICE_PROVIDER", "system") == "elevenlabs" and bool(os.getenv("ELEVENLABS_API_KEY"))


def _voice_id(speaker: str) -> str:
    return os.getenv(VOICE_ENV[speaker]) or DEFAULT_VOICES[speaker]


def _model() -> str:
    return os.getenv("ELEVENLABS_MODEL") or "eleven_v3"


def _clean(text: str) -> str:
    return " ".join(text.split())[:600]


def _key(text: str, speaker: str) -> str:
    # voice id + model are part of the hash, so switching voices never serves stale audio
    return hashlib.sha256(f"{_voice_id(speaker)}|{_model()}|{text}".encode()).hexdigest()[:24]


def _settings(model: str) -> dict:
    if model == "eleven_v3":
        # v3 stability is a mode: 0.0 creative, 0.5 natural, 1.0 robust. Natural keeps a calm, even delivery.
        return {"stability": 0.5, "similarity_boost": 0.8}
    return {"stability": 0.6, "similarity_boost": 0.8, "style": 0.1, "use_speaker_boost": True}


async def _synthesize(text: str, speaker: str, dest: Path) -> bool:
    model = _model()
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{_voice_id(speaker)}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "accept": "audio/mpeg"},
            json={"text": text, "model_id": model, "voice_settings": _settings(model)},
        )
    if r.status_code != 200 or not r.content:
        log.warning("ElevenLabs returned %s: %s", r.status_code, r.text[:200])
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return True


async def ensure(text: str, speaker: str, background: bool = False) -> str | None:
    """Cached file name for this line, synthesizing it if needed; None on failure."""
    h = _key(text, speaker)
    dest = VOICE_DIR / f"{h}.mp3"
    if dest.exists():
        return dest.name
    if background:
        # wait for a prefetch slot *before* taking the line's lock, so a player
        # request for the same line is never stuck behind the prefetch queue
        async with _bg_gate:
            return await ensure(text, speaker)
    lock = _locks.setdefault(h, asyncio.Lock())
    async with lock:
        if not dest.exists():
            try:
                if not await _synthesize(text, speaker, dest):
                    return None
            except Exception as e:  # noqa: BLE001
                log.warning("voice synthesis failed: %s", type(e).__name__)
                return None
    return dest.name


@router.post("/voice")
async def voice(body: VoiceIn, request: Request) -> dict:
    text = _clean(body.text)
    if not enabled() or not text:
        return {"url": None}
    name = await ensure(text, body.speaker)
    if not name:
        return {"url": None}
    base = (os.getenv("PUBLIC_API_URL") or str(request.base_url)).rstrip("/")
    return {"url": f"{base}/media/voice/{name}", "speaker": body.speaker}


@router.post("/voice/prefetch")
async def prefetch(body: PrefetchIn) -> dict:
    """Start synthesizing lines in the background (already-cached lines cost nothing)."""
    if not enabled():
        return {"queued": 0}
    todo = {(_clean(l.text), l.speaker) for l in body.lines[:200] if _clean(l.text)}
    todo = {(t, s) for t, s in todo if not (VOICE_DIR / f"{_key(t, s)}.mp3").exists()}
    for t, s in todo:
        task = asyncio.create_task(ensure(t, s, background=True))
        _bg.add(task)
        task.add_done_callback(_bg.discard)
    return {"queued": len(todo)}
