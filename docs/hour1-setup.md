# Apollo N — Hour-1 Setup

*Everything the team agrees on before anyone writes feature code. Sat Nov 14, 2026.*

**Goal of hour 1:** after 60 minutes, all 4 people can build their features in parallel without waiting on each other.

---

## 1. Who builds what (feature ownership)

Everyone can do everything, so each person owns **whole features end to end** (3D + UI + backend + sound for that feature). Owners can swap or help at every merge point.

| Owner | Features | Phases |
|---|---|---|
| **P1 · Mission brain** | Mission generator (SerpApi + NASA + OpenAI), mission select screen, AI flight director, ElevenLabs voice lines, mission report | 0, 10 + AI everywhere |
| **P2 · Ship & launch** | Ship builder + 3D assembly, supply drop, boarding, pre-launch checklist mini-games, launch cinematic | 1, 2, 4, 5 |
| **P3 · Crew & journey** | Game shell, multiplayer rooms, crew & roles, cruise hurdles | 3, 6 + core |
| **P4 · The Moon** | Landing-site finder (real terrain, scores, simulated landings), landing cinematic, surface exploration | 7, 8, 9 |

P4 has the heaviest load. At the first merge point, rebalance if needed (e.g. P2 takes the surface walk).

---

## 2. Repo layout

```
apollo-n/
├─ web/                         Next.js + React Three Fiber (Vercel)
│  ├─ app/                      routes: / (menu), /play/[room]
│  ├─ game/
│  │  ├─ core/                  store (Zustand), phaseRunner, net (WebSocket client), audio
│  │  ├─ phases/                one folder per phase: select/ build/ drop/ crew/ board/
│  │  │                         checklist/ launch/ cruise/ site/ landing/ surface/ report/
│  │  ├─ minigames/             reusable puzzles (quiz, order, memory, dodge, wires, align…)
│  │  └─ types/                 MissionPlan, GameState, messages (generated from /shared)
│  └─ public/
│     ├─ models/                .glb files (compressed)
│     ├─ audio/                 sfx + music
│     └─ terrain/               pre-processed lunar terrain tiles
├─ api/                         FastAPI (Render or Railway)
│  ├─ app/main.py
│  ├─ app/routers/              missions.py  landing.py  director.py  voice.py  rooms.py
│  ├─ app/services/             serp.py  nasa.py  llm.py  eleven.py  cache.py
│  ├─ app/sim/                  terrain.py  sunearth.py  landing_mc.py
│  └─ app/game/                 state.py (authoritative game state + rules)
├─ shared/
│  ├─ mission-plan.schema.json  ← single source of truth
│  └─ messages.schema.json
├─ assets-src/                  .blend files (not deployed)
└─ README.md                    these contracts, copied in
```

Generate types from `/shared` so front and back never disagree:
- TypeScript: `json-schema-to-typescript`
- Python: `datamodel-code-generator` → Pydantic models

---

## 3. Contract 1: the Mission Plan

The AI writes it, the server validates it, every phase reads it. If validation fails → retry once → fall back to a cached plan.

```json
{
  "id": "apollo-7",
  "seed": 48213,
  "difficulty": "easy",
  "title": "Apollo 7: Ice in the Dark",
  "goal": { "text": "Find signs of water ice in a permanently shadowed crater", "why": "Water can become drinking water, air and rocket fuel" },
  "facts": [
    { "id": "f1", "text": "…", "source_url": "https://…", "source_name": "…", "verified": true }
  ],
  "destination": { "body": "moon", "region": "south_pole", "candidate_sites": ["site_a", "site_b", "site_c"] },
  "ship": {
    "slots": ["engine", "power", "payload", "legs", "comms"],
    "constraints": { "max_mass_kg": 1500, "min_battery_hours": 50, "required_payload": ["drill"] }
  },
  "crew": { "min": 1, "max": 4, "roles": ["commander", "pilot", "engineer", "scientist"] },
  "checklist": { "style": "order_steps", "items": [{ "prompt": "…", "answer": "…", "fact_id": "f1" }] },
  "cruise": [
    { "type": "solar_storm", "role": "commander", "difficulty": 1, "story": "…", "fact_id": "f2" },
    { "type": "engine_fault", "role": "engineer", "difficulty": 1, "story": "…" }
  ],
  "surface": {
    "tasks": [
      { "id": "t1", "role": "scientist", "type": "scan", "hint": "Follow the coldest ground", "unlocks": "t2" },
      { "id": "t2", "role": "engineer", "type": "deploy_relay", "hint": "Needs a clear view of Earth" }
    ],
    "final": "t3"
  },
  "voice_lines": [{ "id": "brief_1", "text": "…" }]
}
```

**Enums (fixed list, so the game always has a template):**
- `difficulty`: `easy | normal | hard`
- `checklist.style`: `quiz | order_steps | memory_match | switch_panel`
- `cruise[].type`: `debris_field | solar_storm | engine_fault | nav_correction | comms_blackout`
- `surface.tasks[].type`: `scan | collect_sample | deploy_relay | repair | navigate_to`

---

## 4. Contract 2: game state (server is the boss)

```ts
type PhaseId = 'select'|'build'|'drop'|'crew'|'board'|'checklist'|'launch'|'cruise'|'site'|'landing'|'surface'|'report';
type Role = 'commander'|'pilot'|'engineer'|'scientist';

interface Player { id: string; name: string; role?: Role; connected: boolean; isHost: boolean; }

interface GameState {
  room: string;            // "APOLLO-7K3"
  mode: 'solo'|'multi';
  plan?: MissionPlan;
  phase: PhaseId;
  players: Player[];
  scores: Partial<Record<PhaseId, number>>;
  phaseData: Record<string, unknown>;   // e.g. chosen ship parts, chosen landing site
  version: number;                       // increases on every change
}
```

**Single player = a room with one player who holds every role.** Same code path, so solo and multiplayer never drift apart.

---

## 5. Contract 3: multiplayer messages (WebSocket `/ws/rooms/{code}`)

**Client → server**
| type | payload | when |
|---|---|---|
| `join` | `{name}` | open room |
| `pick_role` | `{role}` | crew phase |
| `ready` | `{}` | end of a cutscene / lobby |
| `action` | `{phase, kind, data}` | any game move (e.g. `{phase:'build', kind:'choose_part', data:{slot:'engine', part:'engine_b'}}`) |
| `pos` | `{x,y,z,rotY}` | surface walk, ~10 times a second |

**Server → client**
| type | payload | note |
|---|---|---|
| `state` | full `GameState` | after every change |
| `event` | `{kind, data}` | triggers: `play_cutscene`, `sfx`, `voice`, `hurdle_start`, `phase_complete` |
| `pos` | `{playerId, x,y,z,rotY}` | relayed, not stored |
| `error` | `{message}` | rejected action |

Rules: the server validates every action, owns the timer, and advances the phase when the required roles are done. If a player drops for 30 s, the host (or AI) takes their role.

---

## 6. Contract 4: phase components (frontend)

Every phase folder exports the same shape, so P3's phase runner can mount anyone's phase:

```ts
export const phase: PhaseModule = {
  id: 'build',
  Scene,        // React Three Fiber scene (3D)
  Hud,          // 2D overlay (React)
  preload: ['/models/ship_engine_a.glb', '/audio/clank.mp3'],
};

// Inside a phase: read state, send actions. Never change state locally.
const { state, me, send } = useGame();
send({ type: 'action', phase: 'build', kind: 'choose_part', data: { slot: 'power', part: 'power_c' } });
```

---

## 7. Contract 5: HTTP API

| Method | Path | In | Out | Owner |
|---|---|---|---|---|
| POST | `/missions` | `{difficulty, seed?}` | `MissionPlan` | P1 |
| GET | `/missions/{id}` | — | `MissionPlan` (cached) | P1 |
| POST | `/rooms` | `{mode}` | `{room}` | P3 |
| POST | `/landing/score` | `{site_id, lat, lon, date, lander}` | `{score, sun_hours, earth_hours, slope_deg, relic_km, hazards[]}` | P4 |
| POST | `/landing/sim` | `{site_id, lat, lon, n, lander}` | `{safe_pct, landings:[{x,y,tilt,ok}]}` | P4 |
| POST | `/director` | `{phase, numbers, question?}` | `{text}` — explains numbers, never invents them | P1 |
| POST | `/voice` | `{line_id, text}` | `{url}` (cached mp3) | P1 |

---

## 8. Contract 6: 3D assets

| Rule | Value |
|---|---|
| Format | `.glb`, compressed (Draco or Meshopt geometry, KTX2 textures) |
| Units | 1 unit = 1 metre, Y-up |
| Origin | At the object's base or its pivot (hinges, wheels, lander feet) |
| Names | `category_name_variant.glb`: `ship_engine_a`, `crew_suit_b`, `prop_drill_a`, `relic_lm_descent`, `terrain_site_a` |
| Ship parts | Each has an empty called `socket_*` where the next part attaches (assembly animation snaps sockets together) |
| Budget | Ship part ≤ 20k triangles; hero lander ≤ 80k; textures ≤ 2K |
| Licenses | Record every downloaded model's source and license in `assets-src/CREDITS.md` |

---

## 9. Puzzles: no space knowledge needed

Every puzzle shows a **one-line goal** and clear visual cues. Space facts appear as "did you know" rewards, never as requirements.

**Difficulty picker at mission start:** Easy / Normal / Hard.

| | Easy | Normal | Hard |
|---|---|---|---|
| Timers | none or generous | standard | tight |
| Hints | always on | after 1 mistake | after 3 mistakes |
| Hurdles per cruise | 2 | 3 | 4–5 |
| Landing tolerance | wide | real lander limits | real limits + worse luck |

**Puzzle catalog:**
| Where | Puzzle | Player sees |
|---|---|---|
| Build | Balance the bars | Pick parts so power, mass and fuel bars all stay green |
| Checklist | Order the steps / quiz / memory / switch panel | Big icons, one rule per screen |
| Cruise: debris | Dodge | Steer with arrow keys through gaps |
| Cruise: solar storm | Take cover | Move the crew behind the shield before the timer ends |
| Cruise: engine fault | Connect the pipes | Rotate tiles until fuel flows |
| Cruise: navigation | Line up the rings | Turn two dials until circles overlap |
| Site | Hot/cold scanner | Scan colors show safe (cool) vs risky (hot) ground |
| Surface | Follow the signal | Beeps get faster near the target |

---

## 10. Environment variables

```
SERPAPI_KEY=
OPENAI_API_KEY=          # check if a ChatGPT sign-in can replace this; usually it can't for a server
ELEVENLABS_API_KEY=
ALLOWED_ORIGINS=https://apollo-n.vercel.app
```

Never commit keys. Use `.env` locally and the host's secret settings in production.

---

## 11. Hour-1 checklist (all 4, 60 minutes)

- [ ] **0–10 min:** create repo, add everyone, protect `main`, create branches `p1-mission`, `p2-ship`, `p3-crew`, `p4-moon`.
- [ ] **10–25 min:** P3 scaffolds Next.js + R3F + Zustand; P1 scaffolds FastAPI with stub endpoints returning fake data.
- [ ] **10–25 min:** P2 + P4 write `shared/mission-plan.schema.json` and `messages.schema.json` from this doc; generate types.
- [ ] **25–45 min, data tests (one each):**
  - P1: one SerpApi Google News call + one OpenAI call that returns valid Mission Plan JSON.
  - P2: load one NASA/CC0 model into R3F with real lighting.
  - P3: two browsers join the same room over WebSocket and see each other's `join`.
  - P4: download one lunar terrain tile and render it in R3F.
- [ ] **45–55 min:** deploy empty frontend (Vercel) and backend (Render/Railway); confirm they talk.
- [ ] **55–60 min:** everyone pushes; merge to `main`; agree the next merge time (4 PM).

---

## 12. First three tasks after hour 1

| Owner | Task 1 | Task 2 | Task 3 |
|---|---|---|---|
| P1 | `/missions`: SerpApi + NASA facts → OpenAI → validated plan, cached | Mission select screen (3 real mission cards with sources) | `/director` with strict "explain only these numbers" prompt |
| P2 | Ship builder UI + balance-the-bars rule | 3D assembly animation (parts fly to sockets) | Checklist "order the steps" mini-game |
| P3 | Phase runner + `useGame()` hook wired to WebSocket state | Room create/join screens + crew role picker | First cruise hurdle (dodge debris) |
| P4 | Terrain tile + slope/shadow overlay | `/landing/score` (slope, sun, Earth, relic distance) | Probe drop + score panel |

---

## 13. "Done" for each phase

A phase is done when: it loads from the phase runner, works in solo **and** multiplayer, has sound, has a loading state, can't soft-lock (always a way forward), and sends a score.

---

## 14. Still open

- **NASA challenge:** to be eligible for NASA judging, the submission must answer **one** official challenge. Best fit: **Lunar Landing Site Navigator** (Phase 7 is exactly that). Decide by Sunday evening; nothing in the build changes either way.
- **OpenAI access:** confirm in hour 1 whether you need an API key.
