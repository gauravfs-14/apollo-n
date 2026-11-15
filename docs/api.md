# API reference

FastAPI app in `api/app/main.py`. Responses over 1 KB are gzipped. Static files under `api/data/media/` are served at `/media`.

## Health

### `GET /health`

```json
{ "ok": true, "llm": "codex", "voice": "system" }
```

The web app reads `voice` to decide whether to request recorded voice clips or use the browser's speech engine.

## Missions

Router: `api/app/routers/missions.py`. Plan format: [Missions](missions.md).

### `GET /missions/options?difficulty=normal&refresh=false`

Three mission cards for a difficulty, always instant. Cards come from the ready pool and are topped up with fallback plans.

```json
{
  "difficulty": "normal",
  "cards": [{ "plan": { }, "image": "https://…", "kind": "live" }],
  "pool": { "easy": 3, "normal": 2, "hard": 3 },
  "generating": true
}
```

`refresh=true` discards the cards just shown and refills the pool. An unknown difficulty returns 422.

### `POST /missions`

Body: `{ "difficulty": "normal", "seed"?: int, "level"?: int }`. Returns a mission plan.

- With `level` (1-15): takes a pool or fallback plan and fits it to the level. `level` overrides `difficulty`.
- With `seed`: returns the cached plan for that difficulty and seed, generating one live if needed (can take up to a minute).
- Otherwise: takes a pool or fallback plan.

### `POST /missions/{plan_id}/chosen`

Marks a plan as used so it is removed from the pool. Returns `{ "ok": true, "consumed": bool }`.

### `GET /missions/{plan_id}`

A plan handed out earlier. 404 if unknown.

### `GET /missions/{plan_id}/card`

`{ plan, image, kind }` for a plan. 404 if unknown.

### `GET /missions/pool`

Pool status: `{ ready, generating, last_error, avg_gen_seconds }`.

### `GET /missions/fallback`

The raw `shared/fallback-plans/apollo-1.json`, used by the `?phase=` dev jump.

## Landing

Router: `api/app/routers/landing.py`. Coordinates are metres in the tile frame (see [Science](science.md#frame)).

### `GET /landing/sites`

`[{ id, name, lat, lon, size_m, min_m, max_m }]` for every terrain tile.

### `GET /landing/sun?site_id=site_a&date=2026-11-14T00:00:00Z`

Sun and Earth directions over the tile on a date. If the Sun is below the horizon, the date is moved forward day by day until it is up; `shifted_days` reports by how much.

```json
{ "t": 0, "sun_dir": [0, 0, 0], "sun_el_deg": 1.2, "sun_az_deg": 0,
  "earth_dir": [0, 0, 0], "earth_el_deg": 4.1, "earth_az_deg": 0,
  "sun_lat": 0, "sun_lon": 0, "earth_lat": 0, "earth_lon": 0, "shifted_days": 0 }
```

404 for an unknown site, 422 for a bad date.

### `POST /landing/score`

Scores one landing spot.

```json
{ "site_id": "site_a", "x": 120, "z": -340,
  "lander": { "pad_radius_m": 4.5, "leg_span_m": 9, "max_tilt_deg": 12 },
  "date": "2026-11-14T00:00:00Z" }
```

Response fields:

| Field | Meaning |
|---|---|
| `lat`, `lon`, `elevation_m` | Where the probe is |
| `slope_deg`, `slope_leg_deg`, `slope_5m_deg` | Slope over a 10 m footprint, across the legs, and at 5 m |
| `roughness_m` | RMS bumpiness |
| `sun_pct`, `earth_pct` | Share of time the Sun and Earth are visible |
| `in_shadow_region`, `ice_distance_m`, `ice_direction_deg` | Permanent shadow and the distance and bearing to it |
| `boulder_density`, `boulder_hit_pct` | Statistical boulder model |
| `relic_km`, `relic_name` | Nearest human hardware |
| `hazards[]` | Any of `slope`, `boulders`, `dark`, `radio`, `edge` |
| `score` | 0-100 |
| `breakdown[]` | `{ key, label, value, unit, points, weight, text }` per term |
| `sun_elevation_deg`, `earth_elevation_deg`, `date_shifted_days`, `tilt_tolerance_deg` | Context |

The weights are in [Science](science.md#landing-site-score).

### `POST /landing/sim`

Monte Carlo landings around a point.

```json
{ "site_id": "site_a", "x": 120, "z": -340, "n": 300,
  "lander": { "max_tilt_deg": 12, "leg_span_m": 9 },
  "seed": 42, "perks": ["better_lidar"], "difficulty": "normal" }
```

`n` is 1-2000. Response:

```json
{ "n": 300, "seed": 42, "safe_pct": 81.3, "mean_tilt_deg": 6.1, "p95_tilt_deg": 11.4,
  "tilt_limit_deg": 12,
  "ellipse": { "sigma_x_m": 60, "sigma_z_m": 60, "rotation_deg": 0, "radius95_m": 146.9 },
  "landings": [{ "x": 0, "z": 0, "tilt": 0, "ok": true, "reason": "ok" }],
  "breakdown": { "ok": 244, "tipped": 40, "boulder": 12, "oob": 4 } }
```

## Flight Director

### `POST /director`

Body: `{ "phase": "site", "numbers": { "slope_deg": 6.2 }, "question"?: "…" }`. Returns `{ "text", "source": "llm" | "template" | "cache" }`.

The LLM's answer is accepted only if every number in it appears in the input, it is one to four sentences and under 420 characters. Otherwise a template sentence built from the numbers is returned.

## Voice

Router: `api/app/routers/voice.py`.

### `POST /voice`

Body: `{ "line_id"?: string, "text": string, "speaker": "capcom" | "crew" | "crew2" | "pao" }`. Returns `{ "url": "…/media/voice/<hash>.mp3", "speaker" }`, or `{ "url": null }` when voices are off or synthesis fails. Clips are cached on disk by voice, model, speed and text, so each line is paid for once.

### `POST /voice/prefetch`

Body: `{ "lines": [{ "text", "speaker" }] }`, up to 200. Synthesizes missing clips in the background, two at a time. Returns `{ "queued": n }`.

## Surface

Router: `api/app/routers/surface.py`.

### `GET /surface/explore?lat=-89.77&lon=-157.4&enrich=6`

Every known landing and impact site, sorted by distance from `lat`/`lon`, each with `bearing_deg`, a NASA image where one exists, and facts. The nearest `enrich` sites (0-12) also get web snippets from trusted domains. Returns `{ lat, lon, web, sites[], env[] }`.

### `GET /surface/explore/item?id=apollo11&lat=-90&lon=0`

Web snippets and an image for one site, fetched the first time a player opens its tag. Returns `{ id, web, image }`; 404 if unknown.

### `GET /surface/poi?site_id=site_a&x=0&z=0&web=true`

Points of interest around a spot on a tile: nearby relics with distance and bearing, plus environment notes (permanent shadow, ice, regolith, boulders, craters, Sun, Earth, instruments). Returns `{ site_id, lat, lon, web, pois[] }`.

## Rooms

Router: `api/app/routers/rooms.py`. Protocol: [Multiplayer](multiplayer.md).

| Endpoint | Returns |
|---|---|
| `POST /rooms` body `{ "mode": "solo" \| "multi" }` | `{ "room": "APOLLO-7K3" }`; 503 when the server is full |
| `GET /rooms/{code}` | `{ "exists": bool, "players": n }` |
| `WS /ws/rooms/{code}?mode=solo\|multi` | The game socket |

## External services

| Service | Used for | Key |
|---|---|---|
| SerpApi (Google News, Google, DuckDuckGo, Bing, Google Images) | Mission sources, surface extras | `SERPAPI_KEY` |
| OpenAI Responses API or the `codex` CLI | Writing missions, Flight Director lines | `OPENAI_API_KEY` or a codex sign-in |
| ElevenLabs text-to-speech | Voice clips | `ELEVENLABS_API_KEY` |
| NASA Image and Video Library | Mission and site images | none |
| JPL Horizons | Ephemeris, fetched once by a script | none |
