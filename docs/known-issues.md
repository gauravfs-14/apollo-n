# Known issues

Places where the code does not do what the UI, a comment or another part of the code says. Each entry names the file to fix.

## Gameplay

- **Cruise perks never apply.** `web/game/phases/cruise/CruiseHud.tsx` reads the perk from `phaseData.drop`, but the drop phase is retired and the perk is now stored by the build phase. `water_shield`, `high_gain_antenna` and `spare_parts` have no effect, and the "helps here" note never shows. Read it with `usePerk()` instead.
- **The player is never told which perk they got.** Only the retired drop screen showed it.
- **`better_lidar`'s listed effect does nothing.** Its `hazardOverlay` value in `web/game/data/perks.ts` is never read. The real effect is server side, in the Monte Carlo (see [Science](science.md#monte-carlo-landings)).
- **`extra_fuel` scatter differs.** The server uses x0.6 (`api/app/sim/landing_mc.py`); the client's offline estimate and the perk text use x0.7.
- **Easy landings scale the tilt limit twice.** The Monte Carlo's limit is already x1.3 on easy, and `landParams` in `web/game/phases/landing/sim.ts` multiplies it by 1.3 again, for x1.69. On hard the landing applies x0.9 to the unscaled limit.
- **Every surviving mission passes.** Select, crew, board and launch always score 100, which alone makes an average of 40, the pass mark.
- **The surface finish button comes later on harder levels** (6 minutes on easy, 7 on normal, 9 on hard), which is the reverse of the other difficulty rules.
- **The debris hurdle shows three lives but has no fail state.** Losing them does not end the hurdle.
- **`web/game/phases/landing/outcome.ts`** is unused legacy code.

## API

- **A level-fitted plan does not validate against its own schema.** `level` is added after validation and `mission-plan.schema.json` forbids extra fields.
- **The default Monte Carlo seed changes between server restarts.** Without a `seed`, `landing_mc.py` hashes the site id with Python's `hash()`, which is randomized per process.
- **`DEFAULT_T` in `api/app/sim/sunearth.py`** is commented as 2026-11-14 but is 2026-11-06 21:20 UTC.
- **`api/data/leaderboard/leaderboard.sqlite3`** is tracked but nothing reads it; the leaderboard was reverted.
- **`api/app/routers/surface.py`'s docstring** says it runs Google queries; it uses DuckDuckGo and Bing.
- **Voice names in `api/app/routers/voice.py`'s docstring** do not match the ids in the code and `.env.example`.
- **Startup and shutdown hooks** use FastAPI's deprecated `on_event`.

## Tooling

- `e2e-solo.mjs` advertises a `--fast` flag that it does not read.
- Several screenshot scripts hardcode `localhost:3000` and ignore `WEB_URL`: `surface-*`, `flagshot`, `acne`, `launchseries`, `menushot`, `voice-test`.
- `api/tests/test_state.py` says it runs under pytest, but pytest is not a dependency.
- `assets-src/credits/p2.md` says `rocket_roar` and `ignition` were synthesized; `audio.md` says they, and `staging`, came from ElevenLabs.
- The README's gameplay video link is a placeholder (`VIDEO_ID`).
- Leftover Next.js template SVGs are still in `web/public/`.
