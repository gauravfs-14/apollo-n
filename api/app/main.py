from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from app.routers import director, landing, missions, rooms, surface, voice  # noqa: E402

app = FastAPI(title="Apollo N API")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (missions, landing, director, voice, rooms, surface):
    app.include_router(r.router)

MEDIA = Path(__file__).resolve().parents[1] / "data" / "media"
MEDIA.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA), name="media")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "llm": os.getenv("LLM_PROVIDER", "codex"), "voice": os.getenv("VOICE_PROVIDER", "system")}
