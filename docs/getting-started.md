# Getting started

## Requirements

- Node.js and pnpm 10 (the web app pins `pnpm@10.8.0`)
- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Optional: a [SerpApi](https://serpapi.com) key for live missions, an OpenAI key or the `codex` CLI for writing them, and an ElevenLabs key for the voice cast
- Optional, for QA scripts and the gameplay video: Playwright's Chromium and `ffmpeg`

The game runs without any keys. With no API reachable at all, solo play still works offline from the bundled mission plan (see [Missions](missions.md#fallbacks)).

## Run the API

```bash
cd api
cp .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

Check it with `curl localhost:8000/health`, which returns the active LLM and voice providers.

## Run the web app

```bash
cd web
pnpm install
pnpm dev        # http://localhost:3000
```

The web app finds the API through `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). Put it in `web/.env.local` if the API runs elsewhere. The WebSocket URL is derived from it by swapping `http` for `ws`.

## Configuration

All backend settings are environment variables, loaded from `api/.env`.

| Variable | Default | Effect |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS origins, comma separated |
| `SERPAPI_KEY` | none | Needed for live missions and web extras on the surface. Without it, mission generation fails and fallback plans are used |
| `LLM_PROVIDER` | `codex` | `openai` calls the OpenAI Responses API. Any other value runs the local `codex` CLI (ChatGPT sign-in, for development only) |
| `OPENAI_API_KEY` | none | Required when `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-5-mini` | Model for the OpenAI provider |
| `CODEX_MODEL` | codex default | Passed to `codex exec -m` |
| `CODEX_EFFORT` | `low` | Codex reasoning effort |
| `LLM_CONCURRENCY` | `2` | Concurrent LLM calls across the server |
| `VOICE_PROVIDER` | `system` | `elevenlabs` turns on recorded voices. `system` makes the browser speak lines with its own speech engine |
| `ELEVENLABS_API_KEY` | none | Required for `elevenlabs` |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_CREW_VOICE_ID`, `ELEVENLABS_LMP_VOICE_ID`, `ELEVENLABS_PAO_VOICE_ID` | built-in ids | Voices for CAPCOM, the commander, the lunar module pilot and Apollo Control (PAO) |
| `ELEVENLABS_MODEL` | `eleven_v3` | Text-to-speech model |
| `ELEVENLABS_SPEED` | `1.12` | Speaking speed for models other than v3 |
| `PUBLIC_API_URL` | request base URL | Prefix for voice clip URLs, for when the API sits behind a proxy |

## Jumping straight to a phase

Any phase can be opened directly with a fallback plan loaded:

```
http://localhost:3000/play/DEV-X?mode=solo&phase=landing&perf
```

`phase` is a phase id (see [Gameplay](gameplay.md)), `perf` opens the performance overlay. `DEV-X` is any code: the server creates unknown rooms when `mode=solo`. In development builds `diff=easy|normal|hard` overrides the difficulty of the flight phases.

## Controls

| Where | Keys and mouse |
|---|---|
| Everywhere | <kbd>Esc</kbd> pause menu (settings, skip a phase as host, leave). <kbd>`</kbd> toggles the performance overlay |
| Landing | <kbd>W</kbd>/<kbd>S</kbd> throttle (sink rate with hover assist), <kbd>Shift</kbd> full throttle, <kbd>X</kbd> cut engine, arrows lean, <kbd>H</kbd> hover assist, <kbd>P</kbd> autopilot, <kbd>R</kbd> retry, drag to look, wheel to zoom |
| Surface | <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows walk, <kbd>Shift</kbd> sprint, <kbd>Space</kbd> jump or skip the ladder, <kbd>E</kbd> interact, drag to look, double-click locks the mouse, wheel to zoom |

Per-phase controls are listed in [Gameplay](gameplay.md).

## Deploying

There is no deployment config in the repo. Things to know before hosting:

- Use `LLM_PROVIDER=openai`. The codex provider needs a signed-in CLI on the machine.
- Run the API as a **single process**. Rooms, the mission pool, the LLM concurrency gate and voice locks live in memory, so several workers would each hold their own copy.
- Rooms are lost on restart. Solo players reconnect into a fresh empty room.
- `api/data/cache/` and `api/data/media/` hold generated plans, search results and voice clips. Keep them on a persistent disk to avoid paying for them again.
- Set `ALLOWED_ORIGINS` to the web origin and `NEXT_PUBLIC_API_URL` on the web build.
