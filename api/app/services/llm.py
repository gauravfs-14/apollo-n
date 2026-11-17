"""LLM access behind one function. Provider is chosen by LLM_PROVIDER:

- "codex"  (default, dev): shells out to the local `codex exec` CLI, which uses the
           developer's ChatGPT sign-in. No API key needed. Not for production hosting.
- "openai": OpenAI Responses API with OPENAI_API_KEY.
- "disabled": use the game's bundled missions and director templates.

Callers ask for JSON and get a parsed dict back (or an exception).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import tempfile
from pathlib import Path

import httpx

PROVIDER = os.getenv("LLM_PROVIDER", "codex")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")


class LLMError(RuntimeError):
    pass


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        raise LLMError(f"No JSON object in model output: {text[:200]}")
    return json.loads(text[start:end + 1])


CODEX_MODEL = os.getenv("CODEX_MODEL", "")  # e.g. "gpt-5-mini"; empty = codex default
CODEX_EFFORT = os.getenv("CODEX_EFFORT", "low")  # reasoning effort: low is plenty for JSON writing


class _Gate:
    """At most `total` model calls at once; background (pool) calls may use at most `bg_limit` of them,
    so an interactive call (the flight director) always finds a free slot."""

    def __init__(self, total: int) -> None:
        self.total, self.bg_limit, self.running, self.bg_running = total, 1, 0, 0
        self._cv: asyncio.Condition | None = None

    def _cond(self) -> asyncio.Condition:
        if self._cv is None:
            self._cv = asyncio.Condition()
        return self._cv

    async def acquire(self, background: bool) -> None:
        cv = self._cond()
        async with cv:
            await cv.wait_for(lambda: self.running < self.total and (not background or self.bg_running < self.bg_limit))
            self.running += 1
            self.bg_running += background

    async def release(self, background: bool) -> None:
        cv = self._cond()
        async with cv:
            self.running -= 1
            self.bg_running -= background
            cv.notify_all()


_procs: set = set()


def _kill(p) -> None:
    """codex is a node wrapper around a native binary: kill the whole process group."""
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            p.kill()
        except ProcessLookupError:
            pass


def kill_all() -> None:
    """Stop running codex children (called on API shutdown/reload so none are orphaned)."""
    for p in list(_procs):
        _kill(p)


# Never more than two codex processes at once.
gate = _Gate(int(os.getenv("LLM_CONCURRENCY", "2")))


async def _codex(prompt: str, timeout: float, background: bool = False) -> str:
    exe = shutil.which("codex")
    if not exe:
        raise LLMError("codex CLI not found; set LLM_PROVIDER=openai")
    fd, out_path = tempfile.mkstemp(prefix="codex-", suffix=".txt")
    os.close(fd)
    cmd = [exe, "exec", "--skip-git-repo-check", "-s", "read-only", "-o", out_path, "-c", f'model_reasoning_effort="{CODEX_EFFORT}"']
    if CODEX_MODEL:
        cmd += ["-m", CODEX_MODEL]
    cmd.append("-")
    try:
        await gate.acquire(background)
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                cwd="/tmp", start_new_session=True,
            )
            _procs.add(proc)
            try:
                await asyncio.wait_for(proc.communicate(prompt.encode()), timeout)
            except asyncio.TimeoutError:
                _kill(proc)
                await proc.wait()
                raise LLMError("codex timed out")
            except asyncio.CancelledError:
                _kill(proc)
                raise
        finally:
            _procs.discard(proc)
            await gate.release(background)
        if proc.returncode != 0:
            raise LLMError(f"codex exited {proc.returncode}")
        return Path(out_path).read_text()
    finally:
        Path(out_path).unlink(missing_ok=True)


async def _openai(prompt: str, timeout: float) -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise LLMError("OPENAI_API_KEY not set")
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": OPENAI_MODEL, "input": prompt, "text": {"format": {"type": "json_object"}}},
        )
        r.raise_for_status()
        data = r.json()
    return data.get("output_text") or "".join(
        c.get("text", "") for o in data.get("output", []) for c in o.get("content", []) if c.get("type") == "output_text"
    )


async def complete_json(system: str, user: str, timeout: float = 120, background: bool = False) -> dict:
    """`background=True` for bulk work (mission pool); interactive calls leave a slot free for themselves."""
    if PROVIDER == "disabled":
        raise LLMError("Live mission writing is disabled; using bundled missions")
    prompt = f"{system}\n\n---\n\n{user}\n\nRespond with ONE JSON object only. No prose, no markdown."
    text = await (_openai(prompt, timeout) if PROVIDER == "openai" else _codex(prompt, timeout, background))
    return _extract_json(text)


async def complete_text(system: str, user: str, timeout: float = 60) -> str:
    data = await complete_json(system, user + '\n\nReturn {"text": "..."}', timeout)
    return str(data.get("text", "")).strip()
