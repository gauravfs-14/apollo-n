# Missions

Every mission is a **mission plan**: one JSON object that sets the story, the build limits, the checklist, the cruise hurdles, the surface tasks and Houston's key lines. Plans are written by an LLM from recent lunar news, validated, and adjusted so they can always be won.

## The plan format

The source of truth is the Pydantic model in `api/app/models.py`. Running `python -m app.models` from `api/` regenerates `shared/mission-plan.schema.json`. The TypeScript mirror is `MissionPlan` in `web/game/types/index.ts`. Every object rejects unknown fields.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Always `apollo-{number}` |
| `number` | int ≥ 1 | The N in Apollo N, from a persistent server counter |
| `seed` | int | Drives per-mission variation, including radio phrasing |
| `difficulty` | `easy` \| `normal` \| `hard` | |
| `level` | int, optional | Journey level, added after validation (not in the schema) |
| `title` | string | Must start with `Apollo {number}: ` |
| `tagline` | string | |
| `goal` | `{ text, why }` | The objective and why it matters |
| `inspired_by` | `{ name, source_url, date? }` | The real story the mission comes from |
| `facts` | `Fact[]`, 2 or more | `{ id, text, source_url, source_name, verified }` |
| `destination` | `{ body: "moon", region, region_name, candidate_sites[] }` | Candidate sites: `{ id, name, lat, lon, why }` |
| `ship` | `{ slots[], constraints, rationale }` | Constraints: `max_mass_kg`, `min_battery_hours`, `min_delta_v`, `required_payload[]` |
| `crew` | `{ min, max, roles[] }` | Always 1-4 players and all four roles |
| `checklist` | `{ style, items[] }` | 3-8 items `{ prompt, answer, options?, fact_id? }` |
| `cruise` | `CruiseHurdle[]` | `{ type, role, difficulty: 1\|2\|3, story, fact_id? }` |
| `surface` | `{ tasks[], final }` | 2-5 tasks `{ id, role, type, title, hint, unlocks? }` |
| `voice_lines` | `{ id, text }[]` | Must include `brief_1`, `launch_1`, `landing_1`, `success_1` |

Rules the JSON Schema cannot express are checked in `MissionPlan._cross_checks`:

- Candidate sites are exactly the three locked sites below, in order. The LLM only writes their `why`.
- Fact ids are unique and every `fact_id` points at a real fact.
- Quiz items have at least two options and the answer is one of them.
- Hurdle count fits the difficulty: easy 2, normal 3, hard 4-5.
- Surface task ids are unique, `unlocks` names another task, and `final` is a task id.

**Checklist answers by style.** `quiz`: the correct option. `order_steps`: the step's position, `"1"` to `"5"`. `memory_match`: the plain-words match for the term. `switch_panel`: `"on"` or `"off"`.

**Locked sites.** Terrain exists only for three tiles, so every plan uses them:

| id | Name | Lat | Lon |
|---|---|---|---|
| `site_a` | Shackleton Rim | -89.773 | -157.40 |
| `site_b` | Connecting Ridge | -89.463 | -138.01 |
| `site_c` | de Gerlache Rim | -88.663 | -67.30 |

The rest of the radio script is not in the plan. It is generated on the client from templates in `web/game/data/missionComms.ts`, with wording picked by the plan's seed.

## How a plan is generated

`api/app/services/plan.py`:

1. **Topic.** One of ten lunar topics (Artemis, Intuitive Machines, Blue Ghost, ispace, VIPER, lunar ice, LRO, Chandrayaan, Chang'e, the south pole). The checklist style is picked at random.
2. **Sources.** SerpApi Google News and Google web queries for the topic. Empty snippets are filled from each page's meta description. The six longest usable snippets become sources `s1`-`s6`. Fewer than two sources is a failure.
3. **Writing.** The LLM (OpenAI or the codex CLI) gets the sources and returns the plan's creative parts as JSON.
4. **Fact checking.** Each fact must cite a source, every number in it must appear in that source, and at least 40% of its longer words must too. Facts that pass are marked `verified`. At least two must survive.
5. **Assembly.** Sites are locked, ship numbers clamped, hurdle lists trimmed or padded, missing voice lines filled with defaults, leaked source ids scrubbed.
6. **Feasibility** (`api/app/services/feasible.py`). The constraints are checked against `shared/build-envelope.json`, every buildable lander. If no build meets them, the limits are relaxed step by step until one does. Regenerate the envelope after changing parts: `cd web && npx tsx scripts/build-envelope.ts`.
7. **Validation.** If the plan fails, the errors and the previous JSON go back to the LLM once. A second failure falls back.

### The pool

Generating takes 20-60 seconds, so the server keeps a pool of three ready plans per difficulty, filled in the background from startup. `GET /missions/options` and `POST /missions` answer instantly from the pool, using a fallback plan when it is empty. The pool avoids two plans from the same news story. It is saved in `api/data/cache/pool/`.

### Fallbacks

`shared/fallback-plans/apollo-1.json` to `apollo-4.json` are hand-checked plans. When the pool is empty or generation fails, one is picked (preferring a story not shown yet), renumbered with the next mission number and fitted to the difficulty.

`web/game/data/fallback-plan.json` is a copy of `apollo-1` bundled into the web app, used when the API cannot be reached.

## Levels

`web/game/journey/levels.ts`, mirrored by `fit_level` in `api/app/services/plan.py`. Keep the two in sync.

| Levels | Difficulty | Hurdles |
|---|---|---|
| 1-4 | easy | 2 |
| 5-9 | normal | 3 |
| 10-12 | hard | 4 |
| 13-15 | hard | 5 |

Hazard tier per level: `1 1 1 2 1 1 2 2 2 2 2 2 3 3 3`. Fitting a plan to a level sets its difficulty, trims or pads the hurdles to the count and sets each hurdle's `difficulty` to the tier. Passing needs a score of 40.

## Caches

All server caches are JSON files under `api/data/cache/<namespace>/` (gitignored).

| Namespace | Holds | Lifetime |
|---|---|---|
| `plans` | Every plan handed out, by id | permanent |
| `pool` | Ready plans per difficulty | permanent |
| `state` | The mission number counter | permanent |
| `seeded` | Plans made with an explicit seed | permanent |
| `director` | Flight Director comments | permanent |
| `serp` | News and web search results | 24 h |
| `page_desc` | Article meta descriptions | 7 days |
| `nasa` | NASA image search results | 3 days |
| `surface_poi`, `surface_explore` | Surface points of interest | 6 h |
| `surface_serp`, `surface_serp_img` | Web snippets and images for the surface | 3 days, 30 days |

Delete `api/data/cache/` to start fresh. The mission counter starts again from 1.
