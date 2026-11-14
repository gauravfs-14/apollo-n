"""AI flight director: explains the numbers it is given in plain words and never invents any.

Guards: the prompt forbids new numbers, and a post-check rejects any output containing a digit
sequence that is not present in the input (then a template sentence is used). Cached by input hash.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import cache, llm

router = APIRouter()

SYSTEM = """You are the Flight Director in Houston mission control, talking to a young crew who know nothing about space.
Explain the numbers you are given in 1 to 3 short plain sentences, in a calm, steady, reassuring voice.
Hard rules:
- Use ONLY numbers that appear in the input. Never calculate, estimate, round or invent a number or a fact.
- No jargon without explaining it. No lists, no markdown, no emoji, no exclamation marks.
- If the input includes a question, answer it using only the input; if the input cannot answer it, say what the numbers do show.
- Output JSON: {"text": "..."}"""

NUM = re.compile(r"\d[\d,]*\.?\d*")
WORD_NUM = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred", "thousand", "million"}


class DirectorIn(BaseModel):
    phase: str
    numbers: dict
    question: str | None = None


def _nums(s: str) -> set[str]:
    return {m.replace(",", "").rstrip(".") for m in NUM.findall(s)}


def numbers_ok(text: str, source: str) -> bool:
    """Every number in `text` must appear in `source`."""
    return _nums(text) <= _nums(source)


def _label(k: str) -> str:
    return k.replace("_", " ").strip()


def _fmt(v) -> str:
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def template(body: DirectorIn) -> str:
    parts = [f"{_label(k)} {_fmt(v)}" for k, v in list(body.numbers.items())[:6] if not isinstance(v, (dict, list))]
    phase = _label(body.phase)
    if not parts:
        return f"Flight, the {phase} numbers are in. We are watching them closely."
    return f"Flight, here are the {phase} numbers: " + ", ".join(parts) + ". We will keep watching them together."


@router.post("/director")
async def director(body: DirectorIn) -> dict:
    payload = {"phase": body.phase, "numbers": body.numbers, "question": body.question}
    source = json.dumps(payload, sort_keys=True)
    key = hashlib.sha256(source.encode()).hexdigest()
    hit = cache.get("director", key)
    if hit:
        return {"text": hit["text"], "source": "cache"}
    text, origin = "", "template"
    try:
        out = await asyncio.wait_for(
            llm.complete_text(SYSTEM, "Input:\n" + json.dumps(payload, indent=1), timeout=20), timeout=20
        )
        out = re.sub(r"\s+", " ", out).strip()
        sentences = len(re.findall(r"[.!?](\s|$)", out))
        words = set(re.findall(r"[a-z]+", out.lower()))
        spelled_ok = not (words & WORD_NUM) or (words & WORD_NUM) <= set(re.findall(r"[a-z]+", source.lower()))
        if out and numbers_ok(out, source) and spelled_ok and 1 <= sentences <= 4 and len(out) < 420:
            text, origin = out, "llm"
    except Exception:  # noqa: BLE001 - timeout, codex missing, bad JSON: all degrade to the template
        pass
    if not text:
        text = template(body)
    if origin == "llm":  # only cache real answers; templates may be replaced by a later good one
        cache.put("director", key, {"text": text})
    return {"text": text, "source": origin}
