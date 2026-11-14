# Apollo N — Game Plan and Build Plan

*Draft 2 · Sat Nov 14, 2026 · RiverHacks × NASA Space Apps · Team of 4*

**Decisions locked (from your answers):**
- **Team:** 4 people. Every phase gets built fully, split across four owners (see §10).
- **Missions:** always **real**, from NASA data/news and SerpApi search. No fictional goals.
- **Graphics:** Blender-made 3D models, realistic look, still fast in a browser (see §7a).
- **Stack:** Next.js + React Three Fiber in the browser; Python (FastAPI) where it helps.
- **Devices:** desktop browsers only.
- **AI:** OpenAI. ⚠️ To check in hour 1: "sign in with ChatGPT" works for some OpenAI tools (like their coding tools), but our deployed game server calls the model on every new mission, which normally needs an **API key**. If that's true, $5–10 of API credits is plenty for the hackathon. Cache every mission plan so the demo never waits.
- **Missions:** real NASA goal and data; the player decides ship, crew, site and route, so outcomes differ every game.
- **Hosting:** deployed online. Frontend on Vercel, Python backend + multiplayer server on Render or Railway.
- **Team:** everyone can do everything, so each person owns **whole features end to end** (see the Hour-1 Setup doc).
- **Puzzles:** solvable with no space knowledge; **difficulty picker** (Easy / Normal / Hard) at mission start.
- **NASA submission:** undecided. Best fit if you submit: Lunar Landing Site Navigator.
- **Voice:** ElevenLabs for mission control and briefings (also enters the ElevenLabs prizes). Generate and cache lines; don't depend on live voice during the pitch.
- **3D models:** start from NASA and free (CC0) models; edit and re-texture in Blender as time allows.
- **Players:** **single player** (one person controls the whole crew) **and online multiplayer** (each astronaut on their own device, joining by room code). See §7b.

---

## 1. One line

**Apollo N is a 3D space-mission game where every mission is generated fresh from real NASA data and live web search: build your ship, pick your crew, fly, find a safe landing spot, and complete the mission on the surface.**

"N" is the mission number. Every new game is Apollo 1, Apollo 2, Apollo 3… and no two play the same.

---

## 2. Reality check first ⚠️

Read this before anything else.

| Fact | What it means |
|---|---|
| **RiverHacks deadline: Sun Nov 15, 1:00 PM CST** (GitHub). NASA deadline: 11:59 PM. | About **24 hours** from now. |
| The full plan has **10 phases**, each a mini-game with 3D, AI and data. | That is a months-long game. It cannot all be finished by Sunday. |
| Judges score a **working demo**. | We build **one complete, polished mission path** with small versions of each phase, and make one phase deep. |
| NASA only judges projects that answer **one official challenge**. | The deep phase must be the **landing-site finder** (challenge: *Lunar Landing Site Navigator*). Everything else is the story around it. |
| Missions must be real. | Goals come from real NASA missions and plans (e.g. finding water ice at the south pole, Artemis sites, commercial landers). Every fact is sourced. |

**Strategy (team of 4):** every phase is built fully, in parallel, by its owner. Two rules keep that possible in 24 hours:
1. **Agree the contracts first** (Mission Plan JSON, phase interface, asset naming) in the first hour, so nobody waits on anybody.
2. **Merge every 3 hours** into one playable build. A phase that isn't merged doesn't exist for the demo.

Honest note: "everything complete, nothing shallow" in 24 hours is still very ambitious. The plan below gives every phase a "done" line and a "polish" line, so you can see early if something is slipping.

---

## 3. The player journey

Each phase: what happens · where the data comes from · what AI does · MVP (Sunday) vs stretch (later).

### Phase 0 — Mission select
- Pick a **real** mission: a past one, an upcoming lander found in the news, or a real NASA goal (e.g. find water ice in a shadowed crater near the south pole). The AI varies how it plays, never the facts.
- **Data:** SerpApi (Google News, Google Scholar) + NASA news/data.
- **AI:** reads search results → writes the **Mission Plan** (see §5). Every fact keeps its source link.
- **MVP:** 3 mission cards generated from live search + 1 cached fallback.

### Phase 1 — Build the ship 🔧
- Light puzzle: pick parts to meet the mission's needs (power, fuel, mass, payload). Budget bars go green/red.
- 3D ship **assembles itself** as you choose: parts fly in and snap together.
- **Data:** part catalog (ours, simple); mission needs from the Mission Plan.
- **AI:** sets the constraints for this mission ("shadowed crater → you need batteries for 50 hours of dark").
- **MVP:** 4 slots (engine, power, payload, legs) × 3 choices each. Modular 3D parts, not AI-generated meshes.

### Phase 2 — Crate opening 🎁
- Score from Phase 1 opens a crate: reveals a bonus part or perk (extra fuel, better radio).
- Rewards are **earned, never bought**. No money, no paid randomness.
- **MVP:** one crate animation, reward picked from score + seed.

### Phase 3 — Crew 👩‍🚀
- Choose 1–4 astronauts; each gets a role: **Commander, Pilot, Engineer, Scientist**.
- Each role owns one hurdle later in the game (pilot = landing, engineer = repair, scientist = finding the ice…).
- **MVP:** 1–4 crew, 4 fixed roles, local "hot-seat" multiplayer (players take turns on one screen).

### Phase 4 — Boarding + pre-launch checklist ✅
- Short boarding animation. Then a checklist mini-game.
- Style is **picked randomly per mission** from a pool: quiz cards, drag-to-order steps, memory match, timed switch-flipping.
- **Data:** questions written by AI from the Mission Plan's real facts (with sources).
- **MVP:** 2 styles (quiz + order-the-steps).

### Phase 5 — Launch 🚀
- Takeoff animation to Earth orbit, then trans-lunar trajectory.
- **MVP:** one cinematic camera sequence. No player input.

### Phase 6 — Cruise hurdles ☄️
- Random events on the way: debris field, solar storm (hide behind shielding), engine fault (engineer repairs), navigation correction (pilot).
- Each cleared hurdle = points.
- **Data:** event types grounded in real hazards; solar storms can use real past events found by search.
- **AI:** picks which hurdles, in what order, and writes their story text.
- **MVP:** 3 hurdle types, 2–3 per mission, each a 20–40 second mini-game.

### Phase 7 — Find the landing site 🎯 **(the NASA challenge core)**
- Fly a scout over **real lunar terrain**. Scan for hazards: craters, steep slopes, loose dust, existing hardware (old landers), shadows.
- Check **sunlight hours** and **Earth radio contact** for the chosen date.
- Drop a probe → spot score. Run **simulated test landings** (landers scatter off-target like real ones; some tip on slopes).
- **Data:** NASA lunar elevation maps (LOLA/PGDA), NASA map of hardware on the Moon (LROC), Sun/Earth positions (JPL Horizons or SPICE); SerpApi for past landing results and upcoming landers nearby.
- **AI:** flight director explains each score in plain words. It never invents numbers.
- **MVP:** one real terrain tile, slope + shadow + hardware layers, probe score, 100–500 simulated landings.

### Phase 8 — Landing + score 🛬
- Cinematic landing at the chosen spot. Tilt, dust spray, relics hit or not.
- Final landing score + stars.
- **MVP:** one animation driven by the simulation result.

### Phase 9 — Surface exploration 🌑
- Exit animation, walk the surface in 3D (open-world style, small area).
- Clues and tasks lead to the goal: sample a shadowed crater, find ice signals, deploy an instrument.
- Each crew role gets one task.
- **AI:** generates the task chain and hints for this mission.
- **MVP:** small walkable area, 3 tasks, 1 goal. Not a GTA-size map.

### Phase 10 — Mission report 📜
- Score breakdown, what was real (with source links), shareable card.
- **MVP:** one summary screen.

---

## 4. "No two missions alike": how generation works

The risk with "AI generates everything": slow, broken, or made-up facts. So we split it:

1. **Facts come from search and NASA**, never from the AI's memory. Each fact keeps a source link or is tagged "unverified".
2. **The AI writes a Mission Plan** (a JSON file): which mission, which constraints, which hurdles, which checklist style, which surface tasks. It must match a strict schema, so the game can't break.
3. **The game engine plays the plan.** All mini-games are pre-built templates; the plan fills them with content and picks the order.
4. **A seed** makes every mission replayable and debuggable: same seed = same mission.
5. **Physics and scores are code, not AI.** The AI only explains them.

That gives fresh missions every time while staying stable enough to demo.

---

## 5. Mission Plan (example shape)

```json
{
  "mission_id": "apollo-7",
  "seed": 48213,
  "title": "Apollo 7: Ice in the Dark",
  "goal": "Confirm water ice signals inside a permanently shadowed crater near the south pole",
  "facts": [
    { "text": "South-pole slopes can reach 20 degrees; landers tolerate about 8", "source": "https://…", "verified": true }
  ],
  "ship_constraints": { "min_battery_hours": 50, "max_mass_kg": 1500, "needs": ["drill", "radio_relay"] },
  "crew_roles": ["commander", "pilot", "engineer", "scientist"],
  "checklist_style": "order_steps",
  "cruise_hurdles": [
    { "type": "solar_storm", "role": "commander", "difficulty": 2 },
    { "type": "engine_fault", "role": "engineer", "difficulty": 1 }
  ],
  "landing_region": { "name": "Near Shackleton rim", "dem_tile": "pgda_site_01" },
  "surface_tasks": [
    { "role": "scientist", "task": "scan_crater_floor", "hint": "Follow the coldest ground" },
    { "role": "engineer", "task": "deploy_relay" }
  ]
}
```

---

## 6. Architecture (recommended)

```
Browser (Next.js + React Three Fiber)
 ├─ Game shell: phase state machine (Zustand)
 ├─ 3D scenes: ship builder · launch · cruise · landing finder · surface
 ├─ Mini-game templates (quiz, order, memory, dodge, repair…)
 └─ Audio (Howler.js)
        │  REST
FastAPI backend (Python)
 ├─ /mission/new   → SerpApi + NASA → AI → Mission Plan JSON (cached)
 ├─ /landing/sim   → terrain + Monte Carlo landings → scores
 ├─ /director      → AI explains a score (from numbers given)
 └─ cache (SQLite/JSON) → protects the 1,000 free SerpApi searches
```

**Why this split:** Python is your strength and best for terrain/simulation math; the browser does all 3D.

---

## 7. Options to weigh

### 3D engine
| Option | Good | Bad | Pick? |
|---|---|---|---|
| **React Three Fiber + drei** | Fits Next.js, huge examples, fast to prototype | Need care with performance | ✅ Recommended |
| Plain Three.js | Full control | More boilerplate | OK |
| Babylon.js | Built-in physics, inspector | Less React-friendly | Maybe |
| Unity WebGL | Real game engine | Heavy build, slow iteration, no Python link | ❌ Not in 24 h |

### 7a. Blender → browser pipeline (realistic and fast)

The look comes from good materials and light, not from millions of polygons.

| Step | How | Why |
|---|---|---|
| Model in Blender | Low/mid poly, clean shapes, **real-world scale** (1 unit = 1 m) | Fast to render, correct sizes |
| Materials | **PBR** (base color, roughness, metal, normal maps) | Looks real under any light |
| Bake | Bake ambient occlusion and fine detail into textures | Detail without polygons |
| Export | **glTF/GLB**, one file per part, names agreed in advance (`ship_engine_a.glb`) | Standard for Three.js |
| Compress | `gltf-transform`: **Draco or Meshopt** geometry + **KTX2** textures | Files several times smaller |
| Load | `useGLTF` + preload; `<Suspense>` with a loading screen | No stutter mid-game |
| Light | One sun-like directional light (the Moon has one hard light), HDRI for reflections, real shadows | The single biggest realism win |
| Post-processing | `@react-three/postprocessing`: bloom on engines, SSAO, subtle vignette, tone mapping | Cinematic look |
| Performance | Instancing for rocks/debris, LOD for big models, cap pixel ratio, test on a normal laptop | Smooth on judges' machines |

**Free starting points:** NASA's own 3D model library (check each license), CC0 kits (e.g. Poly Haven textures/HDRIs). Real NASA terrain becomes the lunar ground.

### Ship 3D models "on the fly"
| Option | Good | Bad | Pick? |
|---|---|---|---|
| **Modular parts** (simple shapes / free CC0 kits) snapped together by code | Instant, reliable, animatable assembly | Less "AI wow" | ✅ For MVP |
| NASA's free 3D models (glTF) for real craft | Real, credible | Need to check license/size per model | ✅ For Apollo-era hardware on the Moon |
| AI text-to-3D APIs (e.g. Meshy, Tripo) | Big wow | Usually slow (tens of seconds to minutes), cost, unpredictable | Stretch: pre-generate a few, label "AI-generated" |

### AI model (Mission Plan + director)
| Option | Note |
|---|---|
| Any strong LLM with **JSON/structured output** | Needed so the plan always parses |
| Cache every generated plan | Demo never waits on the AI |

### Sound
- Free CC0 sound packs + Howler.js for SFX/music.
- **ElevenLabs** voice for mission control (separate RiverHacks prize). Optional.

### 7b. Multiplayer (online + single player)

**How it works:**
1. The host starts a mission and gets a **room code** (e.g. `APOLLO-7K3`).
2. Friends join on their own laptops and each picks an astronaut role.
3. The **server holds the one true game state**. Players send actions ("engineer fixed the valve"); the server checks them and sends the new state to everyone.
4. Each astronaut's hurdle appears on **their own screen**; everyone else watches progress live.
5. **Single player** uses the exact same code with one player holding all roles. That keeps the two modes from drifting apart.

| Option | Good | Bad | Pick? |
|---|---|---|---|
| **FastAPI WebSockets** (in the Python backend we already have) | One backend, simple rooms | We write reconnect logic ourselves | ✅ Recommended |
| Socket.IO on a small Node server | Rooms and reconnects built in | A second server to run | OK |
| Colyseus (game-server framework) | Made for multiplayer games | New thing to learn in 24 h | Maybe |

**Rules to keep it buildable:**
- Sync **game events and scores**, not every 3D frame. Cutscenes play locally on each screen at the same time.
- Only the surface walk shows other players' avatars moving; send their position a few times a second and smooth it.
- If a player drops, the host or AI takes over their role.

**Hosting:** online play means judges' laptops must reach the server. Deploy the backend (Render/Railway/Fly) and frontend (Vercel). Test with 4 laptops on the venue Wi-Fi before the pitch.

---

## 8. Data sources (status)

| Source | Use | Verified today? |
|---|---|---|
| SerpApi Google News / Scholar / Search | Missions, facts, past landings, solar storms | Docs checked ✅; no live call yet |
| NASA FIRMS | — (not used now) | — |
| NASA POWER API | — (not needed for Moon) | Live ✅ |
| PGDA lunar terrain (product 78, 5 m site maps) | Landing terrain | Page read ✅; download untested ❌ |
| PGDA illumination maps (product 69) | Sunlight/Earth visibility averages | Page read ✅ |
| LROC hardware-on-the-Moon shapefile | Relics to avoid | Page found ✅; download untested ❌ |
| JPL Horizons | Sun/Earth position for a date | Untested ❌ |
| NASA 3D models | Apollo hardware, landers | Untested ❌ |
| NASA news / image library | Mission cards, images | Untested ❌ |

**First hour must test every ❌.**

---

## 9. Scoring

| Phase | Points from |
|---|---|
| Build | Constraints met, mass/power efficiency |
| Checklist | Correct answers, speed |
| Cruise | Hurdles cleared |
| Landing finder | Spot score (sun, radio, slope, hazards, relic distance) × safe-landing % |
| Landing | Final tilt, nothing damaged |
| Surface | Tasks done, goal reached |

Total → mission rank (Bronze → Gold) + stars.

---

## 10. Team split (4 people)

| Person | Owns | Delivers |
|---|---|---|
| **A · 3D artist / tech artist** | Blender models, materials, lighting, post-processing, animations (assembly, crate, boarding, launch, landing, exit) | All `.glb` files + cinematic camera sequences |
| **B · Game & 3D engineer** | Next.js + R3F shell, phase state machine, ship builder, cruise hurdles, surface walk, controls | The playable game from start to end |
| **C · Data & AI engineer** | FastAPI, SerpApi, NASA data, Mission Plan generator, AI director, caching | `/mission/new`, `/director`, the Mission Plan JSON |
| **D · Landing science + UX/sound/pitch** | Landing finder math (terrain, slope, shadows, Sun/Earth, relics, simulated landings), quizzes/checklist content, sound, pitch, video | `/landing/sim`, landing scores, audio, demo video, slides |

**Hour 1 (everyone, together):** agree the Mission Plan schema, the phase interface (`onEnter`, `onComplete(score)`), asset names and folder layout, git branches. Write them in the repo README.

**Merge points:** Sat 4 PM · 7 PM · 10 PM · Sun 1 AM · 9 AM · 12 noon (feature freeze).

## 10b. Build plan by time

Order = what judges see first. Cut from the bottom only if a merge point shows something won't finish.

| When (CST) | Do | Done when |
|---|---|---|
| **Sat 1–2 PM** | Repo, Next.js + R3F, FastAPI. Test all ❌ data. | Terrain tile loads; one SerpApi call returns |
| 2–5 PM | **Landing finder (core):** terrain, slope/shadow layers, relics, probe score | Can click a spot and get a real score |
| 5–7 PM | Simulated landings + landing animation + score | 100+ ghost landings, verdict |
| 7–9 PM | `/mission/new`: SerpApi → AI → Mission Plan (cached) | 3 different missions generate |
| 9–11 PM | Phase state machine; ship builder (4 slots) with assembly animation | Can go Mission → Build → Landing |
| 11 PM–1 AM | Checklist quiz + 1 cruise hurdle + launch camera move | Full path playable end to end |
| **1–6 AM** | **Sleep** | — |
| Sun 6–9 AM | Surface walk + 3 tasks; crate; crew picker | All phases exist |
| 9–11 AM | Sound, polish, mission report, bug fixes | No dead ends |
| 11 AM–12:30 PM | README, AI-use statement, 30 s video, 7 slides | Submitted materials ready |
| **12:45 PM** | **Push to GitHub** | ✅ RiverHacks |
| 2 PM | Pitch (3 min + 2 min Q&A) | — |
| by 11:59 PM | NASA submission (click Submit) | ✅ NASA |

**Cut list if behind (cut in this order):** crate → crew roles → surface tasks (keep walk only) → cruise hurdles → checklist. **Never cut the landing finder.**

---

## 11. Risks

| Risk | Fix |
|---|---|
| Scope too big | Vertical slice; cut list above |
| 3D performance on judge laptops | Low-poly, one terrain tile, test on a normal laptop |
| AI returns broken plan | Strict JSON schema + validator + cached fallback plans |
| SerpApi credits run out | Cache everything; pre-generate demo missions |
| Terrain download too big | Downsample one site tile in advance |
| Judges think it's "just a game" | Pitch the landing finder as a real planning tool inside a game; show real data and sources on screen |
| Made-up facts | Every fact has a source or an "unverified" tag; physics is code |

---

## 12. Questions for you (still open)

### Team and time
1. Which of your 4 matches roles A–D? Does anyone know Blender already? (If nobody does, we lean on NASA/CC0 models plus simple Blender edits.)
2. Are you staying overnight, or working from home?

### Mission and science
3. Moon only for Sunday, or Mars as a second destination too? (Moon only keeps the landing finder deep.)
4. Should a real mission be **replayed** (e.g. an upcoming lander's actual target) or **inspired by** real plans (real goal, player picks the site)?

### Game feel
5. Who is the main audience: judges, students, or general players?
6. Hot-seat multiplayer (turns on one screen) OK for the crew, or must crew be separate players online?
7. How hard should puzzles be: 30-second "anyone can do it" or real challenge?
8. Crate as a "supply drop" reward reveal, earned by score, no paid randomness: OK?

### Tech
9. Which AI provider do you have keys/credits for (Mission Plan + director)?
10. Any AI 3D generation credits (Meshy, Tripo…), or Blender-only?
11. **ElevenLabs** voice for mission control (separate RiverHacks prize)?
12. Hosting for judges: Vercel (frontend) + Render/Railway (FastAPI), or run locally on your laptop?
13. Desktop only, or must it run on phones too? (Desktop only is much easier for realistic 3D.)

### Submission
14. Submit to **Lunar Landing Site Navigator** for NASA? (Strongly recommended: it's the deepest phase.)
15. Who pitches? Want me to write the 3-minute script and the demo route next?
