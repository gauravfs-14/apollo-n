"""LLM access behind one function. Provider is chosen by LLM_PROVIDER:

- "codex"  (default, dev): shells out to the local `codex exec` CLI, which uses the
           developer's ChatGPT sign-in. No API key needed. Not for production hosting.
- "openai": OpenAI Responses API with OPENAI_API_KEY.

Callers ask for JSON and get a parsed dict back (or an exception).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil

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


async def _codex(prompt: str, timeout: float) -> str:
    exe = shutil.which("codex")
    if not exe:
        raise LLMError("codex CLI not found; set LLM_PROVIDER=openai")
    proc = await asyncio.create_subprocess_exec(
        exe, "exec", "--skip-git-repo-check", "-s", "read-only", "-",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        cwd="/tmp",
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(prompt.encode()), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise LLMError("codex timed out")
    if proc.returncode != 0:
        raise LLMError(f"codex exited {proc.returncode}")
    return out.decode()


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


async def complete_json(system: str, user: str, timeout: float = 120) -> dict:
    prompt = f"{system}\n\n---\n\n{user}\n\nRespond with ONE JSON object only. No prose, no markdown."
    text = await (_openai(prompt, timeout) if PROVIDER == "openai" else _codex(prompt, timeout))
    return _extract_json(text)


async def complete_text(system: str, user: str, timeout: float = 60) -> str:
    prompt = f"{system}\n\n---\n\n{user}\n\nRespond with JSON: {{\"text\": \"...\"}}"
    return str((await complete_json(system, prompt, timeout)).get("text", "")).strip()
