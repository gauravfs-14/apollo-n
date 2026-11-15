# Gameplay

A mission runs through eleven phases. Each one ends with `complete(phase, score)`, a score from 0 to 100. Code for each phase is in `web/game/phases/<id>/`.

| # | Phase id | What happens |
|---|---|---|
| 0 | `select` | Pick a level on the journey map |
| 1 | `build` | Choose the lander's parts |
| 2 | `crew` | Name the crew or pick roles |
| 3 | `board` | Walkout and boarding cinematic |
| 4 | `checklist` | Pre-launch checklist minigame |
| 5 | `launch` | Launch cinematic |
| 6 | `cruise` | Hurdles on the way to the Moon |
| 7 | `site` | Find a safe landing spot on real terrain |
| 8 | `landing` | Fly the powered descent |
| 9 | `surface` | Walk on the Moon and do the mission's tasks |
| 10 | `report` | Score, stars and what was real |

## Rules that apply everywhere

**Difficulty** comes from the level: 1-4 easy, 5-9 normal, 10-15 hard. Each level also has a hazard tier (1-3) that tightens the cruise hurdles.

**Ship integrity (HP)** starts at 100. Checklist mistakes and bad landings cost HP, scaled by difficulty (easy x0.6, hard x1.4). At 0 HP the ship is lost and the game jumps to the report.

**Hints** unlock after a number of mistakes: 0 on easy, 1 on normal, 3 on hard. This applies to the build, checklist and surface.

**No dead ends.** Every phase has a way forward: the host can skip any phase from the pause menu, long tasks offer a skip after a timeout, and API failures fall back to offline estimates.

**Roles.** Commander, pilot, engineer and scientist. In solo you hold all four. In multiplayer they are shared out among players (see [Multiplayer](multiplayer.md#roles)), and role-gated tasks can only be done by the role holder while others watch.

## 0. Select

A journey map of 15 levels. Each card shows the mission title and goal, the hazard count, your best stars and the real news story it was written from. A level unlocks when the previous one is passed.

Pressing Play loads the level's mission (the one stored for this level, otherwise a new one from `POST /missions`, otherwise the bundled fallback), sends it to the room and plays the briefing. Score: always 100.

In multiplayer only the host chooses; the crew sees which level the host is looking at.

## 1. Build

Pick one part for each of five slots. Live bars track mass, battery, delta-v and power against the mission's limits.

| Part | Mass | Stats |
|---|---|---|
| Hydrolox bell (`engine_a`) | 210 kg | Δv 2900 m/s, 40 W |
| Storable cluster (`engine_b`) | 150 kg | Δv 2250 m/s, 25 W |
| Methalox big bell (`engine_c`) | 330 kg | Δv 3300 m/s, 70 W |
| Solar wings + battery (`power_a`) | 160 kg | +900 W, 24 h battery |
| RTG + battery (`power_b`) | 230 kg | +300 W, 90 h |
| Fuel cell pack (`power_c`) | 190 kg | +600 W, 55 h |
| Ice drill (`payload_a`) | 130 kg | 350 W; drill, sample |
| Spectrometer mast (`payload_b`) | 70 kg | 120 W; spectrometer, camera |
| Relay satellite (`payload_c`) | 90 kg | 80 W; relay, camera |
| Tripod struts (`legs_a`) | 90 kg | 12° tilt tolerance |
| Wide splayed legs (`legs_b`) | 125 kg | 18° |
| Crushable stubs (`legs_c`) | 60 kg | 8° |
| High-gain dish (`comms_a`) | 40 kg | 60 W, radio 0.9 |
| Phased array (`comms_b`) | 55 kg | 90 W, radio 0.8; relay |
| Whips + small dish (`comms_c`) | 15 kg | 20 W, radio 0.5 |

The structure adds 700 kg. Effective Δv is the engine's Δv x clamp(√(1500 / (mass + 500)), 0.6, 1.3), so heavy builds lose performance. Part data is in `web/game/data/parts.ts`.

**Score** (`evaluateBuild`): four checks worth 20 each (mass under the limit, battery over the minimum, Δv over the minimum, required payload tags present), with partial credit when a check fails; a power budget check worth 10; and up to 10 for staying light. Locking in with unmet needs is allowed after a confirmation.

**Perk.** Locking in rolls one perk, seeded by the mission and weighted by the build score (better builds get rarer perks).

| Perk | Rarity | Effect |
|---|---|---|
| `extra_fuel` | rare | Tighter landing scatter in the Monte Carlo, 10% more landing fuel |
| `better_lidar` | legendary | In the Monte Carlo, 70% of landings that would tip divert to the flattest nearby spot; boulder risk halved |
| `water_shield` | common | More time and a bigger shelter in the solar storm |
| `high_gain_antenna` | common | Wider sweet spot in the comms blackout |
| `spare_parts` | common | More time and one pipe pre-connected in the engine fault |

See [Known issues](known-issues.md) for how perks currently apply.

**Roles.** Engineer owns engine and power, pilot owns legs and comms, scientist owns the payload. Only the host or commander can lock in.

## 2. Crew

Four role cards, each describing that role's jobs later in this mission. Solo players can rename the crew. In multiplayer players press "Prefer this role" to claim one. The host continues. Score: 100.

## 3. Board

A cinematic walkout and ingress, about 22 seconds. Skippable by vote. Score: 100.

## 4. Checklist

The commander plays the minigame named by `plan.checklist.style`; others watch progress. Each mistake costs 5 HP.

| Style | Mechanic | Timer on normal |
|---|---|---|
| `quiz` | Choose the answer; a fact is shown after | 20 s per question |
| `order_steps` | Drag or arrow-key the steps into order, then check | 20 s + 14 s per step |
| `memory_match` | Flip cards to pair each term with its plain-words meaning | 30 s per pair |
| `switch_panel` | Flip the named switch among eight | 12 s per command |

Timers are off on easy and x0.55 on hard.

**Score:** 100 x accuracy x (0.75 + 0.25 x speed) x (1 - min(0.3, 0.04 x mistakes)). The host can skip after 45 seconds for a score of 40.

## 5. Launch

A 44-second cinematic: countdown, ignition, liftoff, staging and translunar injection, with mission control on the radio. Skippable by vote. Score: 100.

## 6. Cruise

The plan's hurdles run in order: a brief, the hurdle, then a score card. The phase score is the average of the hurdle scores. Each hurdle belongs to one role; the player holding it plays, and the others watch a live view.

Difficulty is a value L from 0 to 1: easy 0, normal 0.4, hard 0.75, plus 0.12 per hazard tier above 1. Each hurdle interpolates its timers and tolerances on L.

| Hurdle | Default role | Mechanic | Score |
|---|---|---|---|
| Debris field | pilot | Steer through gaps in rock walls for 26 s (arrows, WASD or mouse) | max(25, 100 - 20 x hits) |
| Solar storm | commander | Drag the four crew into the water shield before time runs out | 70 + 30 x time left, or 70 x share sheltered |
| Engine fault | engineer | Rotate pipe tiles to connect tank to engine | 60 + 40 x time left, or 15 + 35 x route reached |
| Nav correction | pilot | Turn two dials to put your ring on the target and hold it | 65 + 35 x time left, or partial by distance |
| Comms blackout | commander | Tune frequency and dish until signal stays above 88% | 60 + 40 x time left, or 15 + 35 x best signal |

Skips: the player can skip after 70 s (score 30), the host after 90 s (score 40).

## 7. Site

An orbital view over one of three real LOLA terrain tiles at the lunar south pole. Each player picks an overlay: slope, sunlight, radio (Earth visibility), roughness or overall hazard. A Sun slider shows how shadows move over a lunar day.

The pilot clicks to drop a probe. The server scores the spot (`POST /landing/score`) on six terms: flat ground 30, sunlight 20, Earth in view 15, distance to ice 15, boulders 15, distance from old hardware 5. The Flight Director comments on the result (`POST /director`). "Run 300 test landings" calls `POST /landing/sim`, which scatters landings around the aim point and reports how many stay upright. The method is in [Science](science.md#monte-carlo-landings).

**Score:** probe score x safe landing % / 100.

A "Show a good area" hint is always available on easy, after 2 probes on normal and after 4 on hard. After 150 seconds the host can let mission control pick. With the API down the client estimates scores locally.

The chosen spot becomes the landing target, the Monte Carlo's 95% ring sets the target ring size, and the tilt limit carries over to the landing.

## 8. Landing

A powered descent from 300 m up and 260 m out, moving at 15 m/s. Lunar gravity 1.62 m/s², no air, maximum thrust 4.2 m/s², physics at 120 Hz. Fuel is a Δv budget of about 120 m/s, scaled by the engine, difficulty (easy x1.45, hard x0.85) and the `extra_fuel` perk.

| Key | Action |
|---|---|
| W / S | Throttle up and down, or set sink rate with hover assist |
| Shift | Full throttle while held |
| X | Cut the engine |
| Arrows | Lean the lander, relative to the camera |
| H | Hover assist on or off (easy and normal) |
| P | Autopilot; any input takes control back |
| R | Retry (easy and normal) |
| Drag, double-click, wheel | Look, lock the mouse, zoom |

**Hover assist** turns W/S into a target sink rate and the arrows into a target ground speed; letting go holds position.

**Touchdown.** Tilt is the worse of the ground slope under the feet and the lander's own misalignment plus sideways speed. Outcomes, in order: crashed (too fast, leaning past 50°, or the body hits), tipped (tilt over the leg limit), boulder (a foot on a rock 0.5 m or larger), hard (over the safe sink rate), ok. Safe sink rate is 2.2 m/s and crash 5 m/s, x1.3 on easy and x0.9 on hard.

**Score:** sink rate 30, sideways speed 20, tilt 25, distance to target 15, fuel left 10, then capped by outcome (ok 100, hard or boulder 70, tipped 35, crashed 12). On normal each retry costs 8 points; using the autopilot on normal or hard caps the score at 60.

**HP:** crash 100, tipped 25, hard 12 or 25, boulder 12, out of fuel 12.

In multiplayer the pilot flies and everyone else watches. After 40 seconds any crew member can propose letting the autopilot land.

## 9. Surface

The commander climbs down the ladder (skip with Space), then the crew walks the surface around the lander: walk 2.3 m/s, sprint 6 m/s, jump about 2.25 m. The terrain is generated around a named shadowed crater; solo players get AI crewmates.

The plan's surface tasks form a chain. Each belongs to a role.

| Task type | What to do |
|---|---|
| `navigate_to` | Walk to the marker on the crater rim |
| `scan` | Follow the beeping scanner and hold E at the right spot for 1.6 s |
| `collect_sample` | Hold E at the sample site for 2.6 s |
| `deploy_relay` | Pick up the relay at the lander, carry it at least 14 m out to ground with a clear view of Earth, press E |
| `repair` | Open the panel by the lander and turn it (A/D) into alignment, then hold |

Hint rings show always on easy, after 1 mistake on normal, after 3 on hard. A "Return to lander and finish" button appears after 6 to 9 minutes so the phase always ends.

**Score:** 78 x share of tasks done + up to 20 for speed (full at 0, none at 8 minutes) - 2 per mistake + 2 for finishing.

When the final task is done a flag is planted and the player chooses **Explore the Moon** or **Finish mission**. Explore mode overlays AR tags on the scene: lander parts, the crater, Earth and the Sun, and markers on the horizon for 29 real landing and impact sites (Apollo 11-17, Luna, Lunokhod, Chang'e, Chandrayaan, SLIM, Intuitive Machines and more) with their distance and bearing. Data comes from `GET /surface/explore`, with a bundled offline copy.

## 10. Report

The total score is the average of the ten phase scores from select to surface; a skipped phase counts as 0. Rank: Gold 85+, Silver 65+, otherwise Bronze.

The level is **passed** when the ship survived and the total is at least 40. Stars: 3 at 85+, 2 at 65+, 1 at 40+. The best result is kept.

The screen lists each phase's score, ship HP, a Flight Director debrief, the crew, and **What was real**: the news story the mission was built from and the first three sourced facts. Passing missions get a 1200x630 share card. The host chooses Back to map, Next level or Retry.
