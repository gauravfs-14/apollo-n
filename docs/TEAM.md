# Team rules (for every agent working on Apollo N)

Repo: /Users/gchhetri/Developer/PERSONAL/appolo-n (private GitHub `gauravfs-14/apollo-n`, branch `main`).
Read first: README.md, docs/plan.md, docs/hour1-setup.md, web/game/types/index.ts, web/game/core/*, web/game/ui/kit.tsx, web/AGENTS.md (Next 16 has breaking changes; read node_modules/next/dist/docs when touching Next APIs).

## Shared checkout: four people work in the same folder at once
- Only edit files you own (listed in your brief). If you truly need a change in a shared file (types, core, reducer, kit, globals.css, package.json), make it small and additive, never rename/remove existing exports, and mention it in your final report.
- Commit often (every meaningful step), ONLY your own paths, using pathspec commits so you never sweep up someone else's work:
  `git add <your paths> && git commit -m "<area>: <what>" -- <your paths>` then `git push -q || true`.
  If `.git/index.lock` exists, wait a few seconds and retry. Never `git add -A`, never `git stash`, never reset/checkout others' files.
- Commit messages: plain, no "Co-Authored-By" or Claude/AI attribution lines anywhere.
- Don't add npm/pip dependencies unless unavoidable. Installed already: three, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing, zustand, howler, playwright, @gltf-transform/cli (web); fastapi, httpx, numpy, scipy, pillow, tifffile (api). If you must add one, do it in one go and commit package.json + lockfile immediately.

## Servers already running (do not start others, do not kill them)
- Web: http://localhost:3000 (`next dev`, hot reload). API: http://localhost:8000 (uvicorn --reload). Logs: /tmp/web.log, /tmp/api.log.
- Jump to any phase with a plan loaded: http://localhost:3000/play/DEV-X?mode=solo&phase=<phaseId>&perf
- Verify visually + measure: `cd web && node scripts/shot.mjs <phaseId> /tmp/<name>.png 6000 [--quality=low]` → saves a real-GPU screenshot and prints fps/p95/draw calls/triangles + console errors. LOOK at the PNG with the Read tool. Iterate until it looks genuinely good.
- Typecheck: `cd web && npx tsc --noEmit`. Lint your files: `npx eslint game/phases/<x>`.

## Quality bar
- Goal: a realistic, polished, cinematic product. Physically based materials, one strong key light (the Sun), real scale (1 unit = 1 m), good HDRI/star backgrounds, subtle post via `<Effects/>` from web/game/core/Effects.tsx.
- Use real assets from the internet where it saves work and looks better: NASA 3D Resources (https://github.com/nasa/NASA-3D-Resources, https://science.nasa.gov/3d-resources/ — public domain), NASA SVS (CGI Moon Kit, Deep Star Maps, Blue Marble — public domain), Poly Haven (https://api.polyhaven.com, CC0 HDRIs/textures/models), ambientCG (CC0 textures). Avoid CC-BY-NC and anything needing login. Record each asset in assets-src/credits/<you>.md (path, source URL, author, license).
- Downloads: put raw downloads in assets-src/downloads/<you>/ (gitignored); never execute anything you download. Ship optimized copies in web/public/... : `npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048` (cap ship part ≤ 20k tris, hero ≤ 80k; textures ≤ 2K, prefer 1K). Keep total public assets you add under ~40 MB.
- Performance is a hard requirement. One shared Canvas (never create another <Canvas>). Respect `useQuality()` (shadows, shadowMapSize, post, ao, instances, terrainSegments). Instancing for repeats, no allocations inside useFrame, dispose created geometries/textures, preload via the phase's `preload` list. Target at high: ≥55 fps, p95 < 25 ms, < 300 draw calls, < 1.5M triangles. Check with shot.mjs at --quality=high and --quality=low and report the numbers.
- HUD: use web/game/ui/kit.tsx (Panel, Button, Stat, Meter, PhaseTitle) and the tokens in app/globals.css (amber action, cyan telemetry, go/nogo). The HUD wrapper is pointer-events-none: add pointer-events-auto on interactive elements. No emoji in UI, no purple gradients, plain clear copy. Puzzles must be solvable with zero space knowledge: one-line goal, clear visual cues. Respect `plan.difficulty` (easy/normal/hard per docs/hour1-setup.md §9).
- Multiplayer: everything goes through useGame(): patch/complete/emit; role-gated tasks use actsAs(role); others watch progress (show it). Never soft-lock: there is always a way forward (e.g. host can skip after a timeout).
- Sound: `sfx(name)` from web/game/core/audio.ts loads /audio/sfx/<name>.mp3; voice lines: `speak(text, id)` (system voice for now). Put CC0 sounds you find in web/public/audio/ (credit them). Fail silently if a file is missing.
- Each phase must: load from the runner, have a loading state, work solo + multi, send a 0–100 score via complete(), never dead-end.

## Final report (keep it short)
What you built, files owned, assets used (+licenses), perf numbers (high/low), screenshots paths, known gaps, any shared-file changes, and what you need from the user (keys, decisions).
