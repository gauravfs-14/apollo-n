# Architecture

```
web/      Next.js 16 + React Three Fiber. Renders the game, runs every phase, can run solo games fully offline.
api/      FastAPI. Writes missions, scores landing sites, runs Monte Carlo landings, hosts multiplayer rooms, synthesizes voices.
shared/   Contracts both sides read: the mission-plan JSON Schema, fallback plans, the lander build envelope.
```

The server is authoritative for multiplayer state, but the client carries a copy of the same reducer so a solo game can run with no server at all.

## Routes

| Route | File | Purpose |
|---|---|---|
| `/` | `web/app/page.tsx` | Main menu over an Earthrise scene. Name field, solo journey, host a room, join by code, settings |
| `/play/[room]` | `web/app/play/[room]/page.tsx` | The game. Connects to the room and renders `PhaseRunner` and `GameShell` |

Query parameters on `/play/[room]`:

| Param | Effect |
|---|---|
| `mode=solo\|multi` | Anything except `multi` is solo |
| `phase=<id>` | Once this client is host, loads the fallback plan if none is set and jumps to the phase (`core/devJump.ts`) |
| `perf` | Starts with the performance overlay open |
| `diff=easy\|normal\|hard` | Overrides flight difficulty (development builds only) |
| `p4info` | Logs draw calls and triangles summed over every render pass |

A few phases read their own debug parameters in development builds: `bt` and `lt` (start the board and launch cinematics at a time), `style` (force a checklist style), `crewpose` and `crewcam`, and `finale` (preview the surface flag finale).

The menu stores the player name in `localStorage` under `apollo.name`. Room codes look like `APOLLO-7K3`; the join box accepts `apollo 7k3` or just `7k3`.

## Game state

Types live in `web/game/types/index.ts` and mirror the Python side.

```ts
GameState {
  room: string
  mode: "solo" | "multi"
  plan?: MissionPlan               // see missions.md
  phase: PhaseId
  players: Player[]                // { id, name, roles[], picked?, role?, released?, connected, isHost }
  scores: Partial<Record<PhaseId, number>>       // 0-100 per finished phase
  phaseData: Partial<Record<PhaseId, Record<string, unknown>>>  // shared scratch space per phase
  hp?: number                      // ship integrity, 0-100
  failed?: string | null           // why the ship was lost
  version: number                  // bumped on every change
}
```

Phase order (`PHASE_ORDER`): `select, build, crew, board, checklist, launch, cruise, site, landing, surface, report`. A twelfth id, `drop`, is retired; its folder remains but it is never entered.

State changes only through the reducer (`web/game/core/reducer.ts`, mirrored by `api/app/game/state.py`). See [Multiplayer](multiplayer.md#the-reducer) for every action.

### `useGame()`

Every phase talks to the game through one hook (`web/game/core/useGame.ts`):

| Member | Meaning |
|---|---|
| `state`, `plan`, `me`, `isHost` | Current state, mission plan, this player |
| `patch(phase, data)` | Shallow-merge `data` into `state.phaseData[phase]`, shared with the crew |
| `complete(phase, score)` | Record a 0-100 score and advance to the next phase |
| `emit(kind, data)` | Broadcast a transient event to every client. Not stored. Listen with `onServerEvent` from `core/store.ts` |
| `actsAs(role)` | Whether this client may act for a role (see [Multiplayer](multiplayer.md#roles)) |
| `action(phase, kind, data)`, `send(msg)` | Lower-level senders |

Related helpers:

- `usePhaseData<T>(phase)` reads one phase's shared data.
- `core/hp.ts`: `damage(amount, reason)` reduces ship HP, scaled by difficulty (easy x0.6, normal x1, hard x1.4). Standard costs are `COST.minor` 5, `major` 12, `severe` 25, `fatal` 100. At 0 HP the mission fails and everyone goes to the report.
- `flight/sync.ts`: in multiplayer, the pilot's client simulates flight and broadcasts it at 10 Hz; other clients interpolate and send commands back.

### Store and transport

`web/game/core/store.ts` is a Zustand store holding `state`, this player's id (`meId`, persisted as `apollo.playerId`), the connection status, quality, volume and the perf overlay flag.

`web/game/core/net.ts` connects to `/ws/rooms/{code}?mode=…` and sends `join`. If a solo socket never opens within 3 seconds, the client switches to **local mode**: it builds the state itself and runs every action through the local reducer. Multiplayer needs the server. Lost connections retry with backoff (0.5 s doubling to 8 s); a `4404` close means the room does not exist and is not retried.

## Phases and the shared canvas

Each phase is a folder under `web/game/phases/<id>/` whose `index.ts` exports:

```ts
phase: PhaseModule = {
  id: PhaseId,
  Scene?: ComponentType,      // rendered inside the single shared <Canvas>
  Hud: ComponentType,         // 2D overlay
  preload?: string[],         // asset URLs to fetch before the phase shows
  frameloop?: "always" | "demand",
}
```

`web/game/core/phases.ts` lazy-loads phase modules. `.glb`/`.gltf` preloads go through `useGLTF.preload`, images through `useTexture.preload`, anything else through `fetch`. When a phase starts, the next one is preloaded.

`web/game/core/PhaseRunner.tsx` owns the only `<Canvas>` in the game (the menu has its own, on a separate route). It renders the active phase's `Scene` inside the canvas and its `Hud` in a `pointer-events-none` layer above it; interactive HUD elements opt back in with `pointer-events-auto`. Tone mapping is done in post-processing (`core/Effects.tsx`), so the renderer uses `NoToneMapping`.

The loading screen stays up until the phase module is loaded, its assets are downloaded, every `useLoadingHold()` in the scene is released, and `SceneGate` has compiled the shaders (`gl.compileAsync`) and seen four smooth frames. After 15 seconds the player is offered "Show the scene anyway". While loading, the screen rotates facts from the mission plan.

On every phase change the runner also switches the music track and, once per plan, prefetches every voice line the mission can play (see [Audio](audio.md)).

## Quality tiers

Defined in `web/game/core/perf.tsx` and read with `useQuality()`.

| Tier | Max DPR | Shadows | Shadow map | Post | AO | Instances | Terrain segments |
|---|---|---|---|---|---|---|---|
| low | 1 | off | 1024 | off | off | 0.35 | 128 |
| medium | 1.5 | on | 2048 | on | off | 0.7 | 256 |
| high | 2 | on | 4096 | on | on | 1 | 512 |

The starting tier is the saved choice, otherwise 8+ CPU cores gives high, 4+ medium, fewer low. In Auto mode a `PerformanceMonitor` steps the tier down when frames slow and up when they recover; drops are ignored for the first 6 seconds of a phase so loading hitches don't count. Post-processing (`Effects.tsx`) is N8AO, bloom, AgX tone mapping, vignette and SMAA.

The perf overlay (backtick key, `?perf`, or the settings checkbox) shows fps, p95 frame time, draw calls and triangles. The same numbers are written every second to `window.__apolloPerf = { latest, byPhase }`, which the QA scripts read.

## Shell, settings and skipping

`web/game/ui/GameShell.tsx` draws the top bar (room code with copy-invite, connection state, players, ship HP), error toasts, the multiplayer lobby during select, and the pause menu on <kbd>Esc</kbd>. The pause menu holds settings (quality, master and music volume, test voice, perf overlay), "Skip this phase" for the host, and Leave.

Cinematics use a skip vote (`core/skip.tsx`): solo skips at once; in multiplayer every connected player must agree within 10 seconds.

## Journey and progress

Fifteen levels (`web/game/journey/levels.ts`). Progress is stored per browser in `localStorage` key `apollo.journey.v1` as `{ done: { level: { stars, score } }, plans: { level: planId } }`, so a level replays the same mission. In multiplayer the host's journey decides which level is played. See [Missions](missions.md#levels).

## Shared 3D building blocks

| Path | Contents |
|---|---|
| `web/game/three/` | `Astronaut` (NASA Z-2 suit, rigged, tinted by role), `Earth`, `Moon`, `Starfield` |
| `web/game/three/ship/` | Modular `Lander` built from the chosen parts, `Rocket` with staged groups, `LaunchPad`, engine `Plume`, GPU particles |
| `web/game/three/terrain/` | LOLA tile loading (`useTerrainData`), `Terrain` with overlay modes, lunar shader, baked shadows, sky, boulders, the Sun/Earth ephemeris (`sun.ts`, twin of `api/app/sim/sunearth.py`) |
| `web/game/flight/` | Keyboard input by `event.code`, flight sync, flight damage, HUD widgets |
| `web/game/minigames/` | Quiz, order steps, memory match, switch panel |
| `web/game/ui/` | Shell, settings, loading screen, the UI kit (`Panel`, `Button`, `Stat`, `Meter`, `PhaseTitle`) |

UI colour tokens are in `web/app/globals.css`: `amber` for actions, `cyan` for telemetry, `go` and `nogo` for success and danger.
