# Science and data

The landing-site finder runs on real NASA data. Where a number is tuned for the game rather than taken from data, this page says so.

## Datasets

| What | Source | Notes |
|---|---|---|
| Elevation | LOLA 5 m/px south-pole landing-site DEMs, NASA PGDA product 78, <https://pgda.gsfc.nasa.gov/products/78> (Barker et al. 2021, *Planetary and Space Science* 203, 105119, doi:10.1016/j.pss.2020.105119) | Interpolated from LOLA laser tracks, so rocks and small craters are not resolved |
| Sunlight % | PGDA product 69, `AVGVISIB_85S_060M_201608` (Mazarico et al. 2011, *Icarus* 211, 1066, doi:10.1016/j.icarus.2010.10.030) | Share of time the Sun's disc is visible over an 18.6-year cycle, 60 m/px, upsampled to the tile |
| Earth visibility % | PGDA product 69, `..._EARTH` | Earth counts as visible if any of its disc is above the horizon, which is slightly optimistic for radio |
| Permanent shadow | PGDA product 69, `LPSR_85S_060M_201608` | The cold traps where water ice can survive |
| Sun and Earth direction | JPL Horizons (DE441), sub-solar and sub-Earth points on the Moon | 6-hour steps, 2026-01-01 to 2028-01-01 |
| Human hardware | `api/data/relics.json` and `api/data/heritage.json`, curated from NASA, LROC and ISRO sources with a URL per entry | Some positions (e.g. IM-2 Athena) are approximate |

## Sites

| id | Name | PGDA tile | Centre |
|---|---|---|---|
| `site_a` | Shackleton Rim | Site04 | -89.773, -157.40 |
| `site_b` | Connecting Ridge | Site01 | -89.463, -138.01 |
| `site_c` | de Gerlache Rim | Site11 | -88.663, -67.30 |

`site_a` contains the rim and a large permanently shadowed crater. `site_c` has no permanent shadow inside its tile, so its distance to ice comes from a coarse grid computed from the global map (`api/data/psr_dist.json`).

## Frame

Each tile is 8192 m square with the origin at its centre, +X along the polar-plane x axis, +Z along polar-plane -y (grid rows run along +Z) and +Y up. 1 unit = 1 m. The projection is south polar stereographic with R = 1737.4 km, true scale at the pole: x = r sin(lon), y = r cos(lon). Heights are relative to the tangent plane at the centre: the sphere's curvature (d²/2R, 4.6 m at the tile edge) is removed so the tile is flat.

The orientation was checked by correlating DEM relief against the 60 m illumination map; only this orientation correlates.

## Tile files

`api/scripts/prep_terrain.py` writes each tile to `web/public/terrain/<site>/`:

| File | Contents |
|---|---|
| `height_1025.bin`, `height_513.bin` | 1025² (8 m spacing) and 513² (16 m) heights, uint16 little-endian, row-major, row 0 at grid north. `h = min_m + v / 65535 × (max_m - min_m)` |
| `slope.png` | 0-45°, at about a 20 m scale |
| `rough.png` | 0-2 m RMS roughness |
| `sun.png`, `earth.png` | 0-100% visibility |
| `psr.png` | 255 where permanently shadowed |
| `hazard.png` | Combined hazard, formula below |
| `meta.json` | Size, resolutions, height range, centre, projection, frame, sources |

Overlays are 512² 8-bit greyscale. The API and the client both read these files.

## Sun and Earth at the pole

The Moon's spin axis is tilted only 1.54° from the ecliptic normal, so at the south pole the Sun never rises more than about 2° and circles the horizon once every 29.5 days. Shadows are very long: ridges 1-2 km high stay lit while crater floors never see the Sun. Earth rises and sets with libration (about ±7°), so it is above the horizon only part of the time.

`sunearth.playable()` (`api/app/sim/sunearth.py`, mirrored by `web/game/three/terrain/sun.ts`) returns the Sun and Earth directions in the tile frame for the mission date. If the Sun is below 0.6°, it steps forward a day at a time until the Sun is up so the scene is never black, and reports `shifted_days`. Dates outside the ephemeris table wrap around it, so they are approximate.

## Slope, roughness and hazard

- **Slope** is computed from the 5 m DEM with a Horn 3x3 kernel (its percentiles match the PGDA slope product), then smoothed (Gaussian σ = 2 px, about 20 m) for the overlay. The score uses the slope the lander actually sees: the tilt of a least-squares plane through six points on a 10 m ring, and through three points at the leg radius.
- **Roughness** is the RMS residual of the DEM against a 15 m Gaussian smooth, over a 35 m window.
- **Hazard** = 1 - (1 - ss(7°, 18°, slope)) × (1 - ss(0.35, 1.2 m, roughness)), where ss is smoothstep.

Real polar terrain is steep: the median 20 m slope in these tiles is 11-19°. Current crewed lander designs need roughly single-digit slopes at the pad. The game's leg tolerances (8°, 12° and 18°) are game-tuned.

## Boulders

No DEM at this resolution shows boulders, so the server and client share a statistical model:

```
density (per m²) = 0.0008 + 0.004 × ss(6, 20, slope10) + 0.003 × ss(0.3, 1.2, roughness)
P(footpad of radius r lands on a hazardous boulder) = 1 - exp(-density × π r²)
```

The 3D view places instanced boulders with the same density, so what the player sees matches what the simulation rolls.

## Landing-site score

`POST /landing/score` returns 0-100 as the sum of weighted sub-scores, each from 0 to 1.

| Term | Weight | Sub-score |
|---|---|---|
| Flat ground | 30 | 1 - ss(3°, 1.5 × leg tolerance, 10 m footprint slope) |
| Sunlight | 20 | sun% / 70, capped at 1 (the best ridges reach about 88%) |
| Radio view of Earth | 15 | earth% / 60, capped at 1 |
| Reach to the ice | 15 | 0 inside permanent shadow; 0.3 to 1 over 0-300 m; 1 for 300-1500 m; falls to 0.1 by 4000 m |
| Rocks and bumps | 15 | 0.6 × (1 - ss(0.02, 0.25, boulder hit chance)) + 0.4 × (1 - ss(0.3, 1.2 m, roughness)) |
| Distance from old hardware | 5 | ss(1, 25 km, distance to the nearest relic) |

Each term comes back in `breakdown[]` with its value, unit, points and a plain-English sentence. The UI and the Flight Director only explain these numbers; the director's text is rejected if it contains a number not in the input.

Only the Chandrayaan-1 Moon Impact Probe (2008) lies within about 12 km of these tiles; every other relic is hundreds of kilometres away. The hardware term is a small tiebreak.

## Monte Carlo landings

`POST /landing/sim` (`api/app/sim/landing_mc.py`) simulates n landings aimed at one point:

1. **Dispersion.** Touchdown points are drawn from a Gaussian around the aim point with σ = 60 m per axis. Real descent ellipses are hundreds of metres; this is scaled for the game. σ is x0.8 on easy, x1.15 on hard, and x0.6 with the `extra_fuel` perk.
2. **Hazard avoidance.** With the `better_lidar` perk, a touchdown that would exceed the tilt limit is diverted with probability 0.7 to the flattest of six random points within 40 m, and boulder risk is halved.
3. **Tilt** is the tilt of the plane through three legs at a random heading on the real DEM, plus a small leg and attitude term, |N(0, 1)| × 0.7°.
4. **Boulders.** The hit probability from the boulder model, x1.3 on hard, capped at 0.95.
5. **Outcome**, in order: `oob` (off the tile), `boulder`, `tipped` (tilt over the limit), otherwise `ok`.

The tilt limit is the legs' tolerance from the build, x1.3 on easy. The lander defaults are a 9 m leg span, 4.5 m pad radius and 10° tolerance. Results are deterministic for a given seed (NumPy `default_rng`); about 5 ms for 500 landings.

The 95% ring has radius σ√5.991, the 95% quantile of a 2D Gaussian.

## Limits

- The DEM is interpolated from laser tracks and the illumination maps are 60 m, so small features are smoothed out.
- Shadows cast from outside the 8 km tile are not modelled in the 3D view.
- Boulders are statistical, not mapped.
- Lander tolerances, dispersion and the score weights are game-tuned.
- The surface phase uses procedurally generated terrain, not a LOLA tile.

## Data preparation

Raw downloads go in `assets-src/downloads/p4/` (gitignored; three DEMs of about 41 MB and three illumination maps of about 51 MB).

| Script | Output |
|---|---|
| `api/scripts/prep_terrain.py` | The tile files above |
| `api/scripts/fetch_ephemeris.py` | `api/data/ephemeris.json`, copied to `web/public/terrain/ephemeris.json` |
| `api/scripts/prep_psr_dist.py` | `api/data/psr_dist.json`, a 65x65 distance-to-shadow grid per site |

Run them from the repo root with `api/.venv/bin/python api/scripts/<script>.py`.
