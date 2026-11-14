# Apollo N

A 3D Moon-mission game where every mission is generated from real NASA data and live news.
Build your ship, pick your crew, fly, find a safe landing site on real lunar terrain, and complete the mission on the surface.

Full design: [docs/plan.md](docs/plan.md) · Contracts: [docs/hour1-setup.md](docs/hour1-setup.md)

## Run locally

```bash
# API (Python 3.12, uv)
cd api && cp .env.example .env   # fill SERPAPI_KEY
uv run uvicorn app.main:app --reload --port 8000

# Web
cd web && pnpm install && pnpm dev   # http://localhost:3000  (add ?perf or press ` for the perf overlay)
```

AI: `LLM_PROVIDER=codex` uses the local `codex` CLI (ChatGPT sign-in, dev only). `LLM_PROVIDER=openai` + `OPENAI_API_KEY` for hosting.
Voice: `VOICE_PROVIDER=system` uses the browser's system voice. ElevenLabs comes later.

## Layout

```
web/game/core/       store, net (WebSocket + offline solo), PhaseRunner (one shared Canvas), perf, audio, Effects
web/game/phases/<id> one folder per phase, each exports `phase: PhaseModule`
web/game/minigames/  reusable puzzles
web/game/types/      contracts (MissionPlan, GameState, messages)
web/public/          models/ (glb), textures/, hdri/, terrain/, audio/
api/app/             routers/ services/ sim/ game/state.py (authoritative reducer)
shared/              mission-plan.schema.json, fallback-plans/
assets-src/credits/  license + source of every downloaded asset
```

## Contracts (short)

- **Phase module**: `{ id, Scene?, Hud, preload?, frameloop? }`. `Scene` renders inside the single shared `<Canvas>`; `Hud` is a 2D overlay (its wrapper is `pointer-events-none`, so add `pointer-events-auto` to interactive panels).
- **Inside a phase**: `const { state, plan, me, patch, complete, emit, actsAs } = useGame()`. Never mutate state locally.
  - `patch(phase, data)` merges into `state.phaseData[phase]` (shared with the crew).
  - `complete(phase, score0to100)` finishes the phase; the server advances.
  - `emit(kind, data)` broadcasts a transient event; listen with `onServerEvent`.
  - `actsAs(role)` – true if this player plays that role (solo: all roles; multi: own role + unclaimed roles for the host).
- **Server reducer**: `api/app/game/state.py` and `web/game/core/reducer.ts` must stay identical in behavior.
- **Assets**: `.glb`, 1 unit = 1 m, Y-up, `category_name_variant.glb`, compressed (Meshopt + WebP/KTX2), textures ≤ 2K. Record every download in `assets-src/credits/`.

## Performance rules

- One `<Canvas>` for the whole game; never create another.
- Respect `useQuality()` (`low | medium | high`): DPR cap, shadows, shadow-map size, post effects, instance counts, terrain segments. Quality auto-drops when FPS falls.
- Instancing for repeated meshes (rocks, debris), no per-frame allocations in `useFrame`, dispose what you create, `frameloop: "demand"` for static phases.
- Perf numbers per phase live on `window.__apolloPerf`. Target: ≥ 55 fps p95 < 25 ms on an M-series laptop at `high`; ≥ 30 fps at `low` on integrated graphics.
