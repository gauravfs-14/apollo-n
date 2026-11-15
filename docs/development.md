# Development

## Repo layout

```
web/
  app/                   Next.js routes: / (menu) and /play/[room]
  game/
    core/                store, net, reducer, PhaseRunner, perf, audio, comms, roles, skip
    phases/<id>/         one folder per phase; index.ts exports `phase: PhaseModule`
    minigames/           checklist puzzles
    flight/              input, flight sync, difficulty, flight HUD widgets
    three/               shared 3D: astronaut, Earth, Moon, stars, ship/, terrain/
    journey/             levels and saved progress
    data/                parts, perks, radio script, bundled fallback plan and heritage data
    types/               shared TypeScript types
    ui/                  shell, settings, loading screen, UI kit
  public/                models/, textures/, hdri/, terrain/, audio/
  scripts/               QA, benchmarks, screenshots, asset pipelines, gameplay video
api/
  app/
    routers/             missions, landing, director, voice, rooms, surface
    services/            plan generation, LLM, SerpApi, NASA images, feasibility, cache
    sim/                 terrain queries, Monte Carlo landings, Sun and Earth
    game/state.py        authoritative reducer
    models.py            mission plan model and validation
  data/                  ephemeris, relics, heritage sites, shadow grids; cache/ and media/ at runtime
  scripts/               data preparation
  tests/                 reducer tests and a WebSocket smoke test
shared/
  mission-plan.schema.json   generated from api/app/models.py
  build-envelope.json        every buildable lander, generated from web/game/data/parts.ts
  fallback-plans/            hand-checked mission plans
assets-src/
  credits/               source and license of every third-party asset
  tools/, p2/            asset build scripts
  downloads/             raw downloads (gitignored)
```

## Things that must stay in sync

| Change | Also update |
|---|---|
| `web/game/core/reducer.ts` | `api/app/game/state.py` and `api/tests/test_state.py` |
| `web/game/core/roles.ts` | `rebalance` in `api/app/game/state.py` |
| `MissionPlan` in `web/game/types/index.ts` | `api/app/models.py`, then `python -m app.models` to regenerate the schema |
| Parts in `web/game/data/parts.ts` | `cd web && npx tsx scripts/build-envelope.ts` |
| `web/game/journey/levels.ts` | `fit_level` in `api/app/services/plan.py` |
| `web/game/three/terrain/sun.ts` | `api/app/sim/sunearth.py` |
| Boulder model or landing parameters | Both the API (`api/app/sim/`) and the client's offline estimates (`web/game/phases/site/`) |

## Adding a phase

1. Create `web/game/phases/<id>/index.ts` exporting `phase: PhaseModule` with a `Hud`, and a `Scene` if it draws 3D.
2. Add the id to `PhaseId` and `PHASE_ORDER` in `web/game/types/index.ts` and to `PHASE_ORDER` in `api/app/game/state.py`.
3. Register the loader in `web/game/core/phases.ts`, and a track in `PHASE_TRACK` (`web/game/core/music.ts`).
4. Read and write shared state through `useGame()`; gate role work with `actsAs(role)`; end with `complete(id, score)`.
5. Make sure it never dead-ends: offer the host a skip after a timeout and handle the API being down.

Rules for scenes:

- Never create another `<Canvas>`. Render inside the shared one.
- Respect `useQuality()`: shadows, shadow map size, post-processing, instance counts, terrain segments.
- Use instancing for repeated meshes, allocate nothing inside `useFrame`, dispose geometries and textures you create.
- List heavy assets in `preload`, and wrap slow setup in `useLoadingHold()` so the loading screen covers it.
- Use `frameloop: "demand"` for static phases.
- HUD wrappers are `pointer-events-none`; add `pointer-events-auto` to interactive panels. Use the kit in `web/game/ui/kit.tsx` and the colour tokens in `web/app/globals.css`.

## Checks

```bash
cd web && npx tsc --noEmit        # types
cd web && pnpm lint               # eslint
cd api && uv run python tests/test_state.py
```

There is no CI; run these before pushing.

## QA scripts

Playwright scripts in `web/scripts/` drive the real game in headless Chromium with GPU flags for macOS (Metal). They expect the web app on `:3000` and the API on `:8000` (`WEB_URL` and `API_URL` override this in the main scripts). They open phases directly with `?phase=` and read the `window.__apollo*` hooks.

| Script | What it does |
|---|---|
| `shot.mjs <phase> [out.png] [waitMs] [--quality=] [--size=]` | Screenshot one phase and print fps, frame times, draw calls, triangles and console errors |
| `perf.mjs [--phases=] [--quality=high,low] [--seconds=6] [--warmup=6000] [--size=1440x900] [--out=]` | Benchmark every phase at each tier and write a markdown table (default `/tmp/apollo-perf.md`) |
| `e2e-solo.mjs [--quality=] [--throttle=N] [--tag=]` | Play a full solo mission through the UI; screenshots and a JSON report in `/tmp/e2e` |
| `e2e-multi.mjs` | Two players: sync, role gating, role balance, disconnect and reconnect. Exits 1 on failure |
| `journey-check.mjs` | Journey map layout, unlocks and the failure path at two window sizes |
| `flight-landing.mjs <good\|bad\|hard\|auto\|fuel> [easy\|normal\|hard]` | Scripted descents; prints the outcome and saves frames |
| `surface-move.mjs` | Walk and sprint speeds, jump reliability, stuck keys |
| `surface-tasks.mjs` | Runs the surface task chain |
| `loading-test.mjs`, `leaks.mjs`, `hitches.mjs`, `quality-switch-test.mjs` | Loading screen, GPU memory leaks, frame hitches, live quality changes |
| `radio-test.mjs`, `radio-render.mjs`, `voice-test.mjs`, `comms-test.mjs`, `music-test.mjs` | Audio and radio checks |
| `skip-vote-test.mjs`, `sync-test.mjs` | Multiplayer skip votes and flight sync |

### Gameplay video

```bash
cd web && node scripts/gameplay-video.mjs [--out=/tmp/gameplay] [--quality=high] [--from=<phase>]
python3 scripts/gameplay-cut.py
```

The recorder plays a full solo mission at human pace, captures the screen and the game's own audio, and draws the pointer, clicks and keys on top (`input-overlay.js`, `audio-tap.js`). Output is 1920x1080 at 60 fps in `/tmp/gameplay/gameplay.mp4`. The cut script trims it to about two minutes; its list of takes is tied to one recording, so check it after recording again. Both need `ffmpeg`.

## Performance

Targets on an M-series laptop at `high`: at least 55 fps, p95 frame time under 25 ms, under 300 draw calls and under 1.5M triangles. At `low`: at least 30 fps on integrated graphics. Draw calls and triangles count every render pass including post-processing.

Last full run (Apple M4 Pro, 1440x900, headless Chrome capped at 60 fps):

| Phase | High: draw calls | High: triangles | Low: draw calls | Low: triangles |
|---|---|---|---|---|
| select | 21 | 67k | 2 | 6k |
| build | 52 | 19k | 12 | 9k |
| crew | 73 | 417k | 23 | 133k |
| board | 73 | 177k | 20 | 78k |
| checklist | 34 | 1k | 14 | 1k |
| launch | 111 | 142k | 67 | 62k |
| cruise | 108 | 75k | 47 | 31k |
| site | 23 | 527k | 4 | 35k |
| landing | 116 | 892k | 52 | 217k |
| surface | 115 | 1135k | 47 | 256k |
| report | 24 | 74k | 5 | 13k |

Every phase held 60 fps with p95 under 18 ms at both tiers. Re-run `node scripts/perf.mjs` after changing a scene.

## Assets

`web/public/` holds about 60 MB:

| Folder | Contents |
|---|---|
| `models/` | Moon rocks (Poly Haven), the rigged astronaut (`crew/astronaut.glb`, from NASA's Z-2 suit) |
| `textures/` | Moon colour and normals (NASA CGI Moon Kit), star map (NASA Deep Star Maps), Earth day, night and ocean (Blue Marble, Black Marble), regolith and pad textures (Poly Haven) |
| `hdri/` | Two Poly Haven HDRIs for the hangar and pad |
| `terrain/` | The three LOLA tiles and the ephemeris (see [Science](science.md#tile-files)) |
| `audio/` | Music, sound effects, ambience loops |

Rules for new assets:

- `.glb`, 1 unit = 1 m, Y up. Compress with `npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048`.
- Ship parts up to 20k triangles, hero models up to 80k. Textures 2K at most, 1K preferred.
- Use public-domain or CC0 sources: NASA 3D Resources and SVS, Poly Haven, ambientCG. Avoid non-commercial licenses and anything behind a login.
- Keep raw downloads in `assets-src/downloads/` (gitignored) and never run anything downloaded.
- Record each asset in `assets-src/credits/` with its path, source URL, author and license.

Asset pipelines:

| Script | Builds |
|---|---|
| `web/scripts/pack-astronaut.sh` | The astronaut: texture cleanup (`prep_suit_textures.py`), rigging (`rig-astronaut.mjs`), meshopt compression |
| `assets-src/tools/p1-textures.py` | Moon colour, normal and displacement maps and the star map from NASA SVS downloads |
| `assets-src/p2/gen_sfx.sh` | UI sound effects, synthesized with ffmpeg |
| `api/scripts/prep_terrain.py` | Terrain tiles (see [Science](science.md#data-preparation)) |

## Licenses

| Content | License |
|---|---|
| NASA data, imagery, 3D models and Apollo transcripts | Public domain |
| Poly Haven models, textures and HDRIs | CC0 |
| Music by Kevin MacLeod | CC BY 4.0 |
| ElevenLabs voices and some sound effects | ElevenLabs terms |

Full per-file list: `assets-src/credits/`.
