# Science notes: Lunar Landing Site Navigator

Everything the site finder shows comes from real NASA data; game-tuned numbers are labeled as such.

## Data
| What | Source | Notes |
|---|---|---|
| Elevation | LOLA 5 m/px south-pole landing-site DEMs, NASA PGDA product 78, https://pgda.gsfc.nasa.gov/products/78 (Barker et al. 2021, Planetary and Space Science 203, 105119, doi:10.1016/j.pss.2020.105119) | Interpolated from LOLA laser tracks, so fine detail (rocks, small craters) is not resolved. Heights relative to the 1737.4 km sphere; we remove sphere curvature (d^2/2R, 4.6 m at the tile edge) so the tile is a flat tangent plane. |
| Sunlight % | PGDA product 69 `AVGVISIB_85S_060M_201608`, Mazarico et al. 2011, Icarus 211, 1066, doi:10.1016/j.icarus.2010.10.030 | Share of time the Sun disc is visible, hourly steps over a full 18.6-year nutation cycle, from the 60 m map; we upsample bicubically to the tile, so edges are soft. |
| Earth visibility % | same product, `..._EARTH` | Earth counts as visible if any part of its disc is above the horizon (slightly optimistic for radio). |
| Permanent shadow | same product, `LPSR_85S_060M_201608` | The cold traps where water ice can survive. `api/data/psr_dist.json` stores a coarse distance-to-shadow grid from the global map so tiles with no shadow inside (site_c) still get a real ice distance. |
| Sun and Earth direction | JPL Horizons API (DE441), Moon sub-solar and sub-Earth points, `api/scripts/fetch_ephemeris.py` | 6-hour steps 2026-01-01 to 2027-12-31, in `api/data/ephemeris.json`. Outside that range the table is wrapped (approximate). |
| Human hardware | Wikipedia "List of artificial objects on the Moon" (cites LROC/NASA/ISRO), LROC posts for Odysseus and Chandrayaan-2; `api/data/relics.json` has per-entry URLs | Athena (IM-2) position is approximate. |

## Sites and coordinates
The PGDA site tiles map to the candidate sites as follows (tile centre from `web/public/terrain/<id>/meta.json`):
- site_a "Shackleton Rim" = PGDA Site04, centre lat -89.773, lon -157.40 (the tile contains the rim and a large permanently shadowed crater).
- site_b "Connecting Ridge" = PGDA Site01, centre lat -89.463, lon -138.01.
- site_c "de Gerlache Rim" = PGDA Site11, centre lat -88.663, lon -67.30.

The coordinates first supplied for site_a (-89.45, -137.0) are actually the Connecting Ridge, and the ones for site_b (-89.4, -152.0) match no PGDA site. site_c was right. Update `candidate_sites` in the mission plans to the tile centres above.

## Frame
Tile = 8192 m square, origin at the centre, +X = polar-plane +x, +Z = polar-plane -y (grid rows run along +Z), +Y up. Polar stereographic, R = 1737.4 km, true scale at the pole, x = r sin(lon), y = r cos(lon). Verified by correlating DEM relief against the 60 m illumination map (only this orientation correlates).

## Sun and Earth at the pole
The Moon's spin axis is tilted only 1.54 degrees from the ecliptic normal, so at the south pole the Sun never rises above about 2 degrees and circles the horizon once per 29.5 days. Terrain shadows are therefore extremely long, and ridges 1-2 km high stay lit while crater floors never see the Sun. Earth swings up and down with libration (about +-7 degrees), so it is above the horizon only part of the time. `sunearth.playable()` returns the Sun/Earth unit vectors in the tile frame for the mission date; in the polar-night season (Sun below 0.6 degrees) it advances day by day until the Sun is up so the scene is never black. The response reports `shifted_days`.

## Slope, roughness, hazard
- Slope: from the 5 m DEM (Horn 3x3), identical to the PGDA slope product (checked: percentiles match), then smoothed (Gaussian sigma 2 px, about a 20 m scale) for the overlay. The API computes the slope the lander actually sees: tilt of the plane through a 10 m ring (6 points) around the probe, and through the leg ring (3 points at leg_span/2).
- Roughness: RMS residual of the DEM against its 15 m Gaussian smooth over a 35 m window.
- Hazard overlay: 1 - (1 - ss(7, 18 deg, slope)) * (1 - ss(0.35, 1.2 m, roughness)). Real polar terrain is steep: the median 20 m slope in our tiles is 11-19 degrees. Current NASA lander designs (Artemis HLS-class) require roughly single-digit-degree slopes at the pad (about 6-10 degrees depending on the vehicle); the game tolerances (8, 12, 18 degrees for the three leg parts) are game-tuned.

## Boulders (statistical, not mapped)
No 8 m DEM resolves boulders, so the game uses a model shared by server and client: density per m^2 = 0.0008 + 0.004 ss(6, 20, slope10) + 0.003 ss(0.3, 1.2, rough). The chance a footpad of radius r sits on a hazardous (>0.4 m) boulder is 1 - exp(-density pi r^2). Instanced boulders in the 3D view use the same density, so what you see matches what the sim rolls.

## Monte Carlo landings (`POST /landing/sim`)
1. Aim point plus Gaussian dispersion, sigma = 60 m per axis (real descent ellipses are hundreds of metres; game-scaled), x0.6 with the `extra_fuel` perk, x0.8 easy, x1.15 hard.
2. `better_lidar` perk: a touchdown that would exceed the tilt limit is diverted with probability 0.7 to the flattest of 6 random candidates within 40 m; boulder risk is halved.
3. Tilt = tilt of the plane through 3 legs at random yaw (real DEM) plus a small random leg/attitude term (|N(0,1)| x 0.7 deg).
4. A touchdown is ok when tilt <= limit, no boulder under a pad (hard: x1.3 boulder odds), and it is inside the tile. Reasons: `ok | tipped | boulder | oob`.
5. Limit = lander `max_tilt_deg` (client passes the legs part `tiltTolerance` from `web/game/data/parts.ts`; default 10), x1.3 on easy.
Deterministic by `seed` (numpy `default_rng`). About 5 ms for n=500.

The client sends `lander: {leg_span_m, max_tilt_deg, pad_radius_m}`: `max_tilt_deg = parts.legs.tiltTolerance` (8 / 12 / 18); wide legs use `leg_span_m` about 12, tripod 9, stubs 6.

## Score (`POST /landing/score`), 0-100
| Term | Weight | Sub-score 0-1 |
|---|---|---|
| Flat ground | 30 | 1 - ss(3, 1.5 x tolerance, 10 m footprint slope) |
| Sunlight | 20 | sun% / 70, capped at 1 (the best ridges reach about 88%) |
| Radio view of Earth | 15 | earth% / 60, capped at 1 |
| Reach to the ice | 15 | 0 inside permanent shadow (no sun); 0.3 to 1 over 0-300 m; 1 for 300-1500 m; falls to 0.1 by 4000 m |
| Rocks and bumps | 15 | 0.6 (1 - ss(0.02, 0.25, boulder hit)) + 0.4 (1 - ss(0.3, 1.2 m, roughness)) |
| Distance from old hardware | 5 | ss(1, 25 km, nearest relic distance) |

Every response includes `breakdown[]` with value, unit, points and a plain-English sentence, so the UI and the AI director only explain the numbers, never invent them. "Cool = safe": the client colors high sub-scores cool and low ones hot.

## Relics, honestly
Only the Chandrayaan-1 Moon Impact Probe (2008) is within about 12 km of the pole tiles; everything else is hundreds of km away, so the relic term is a small tiebreak and only bites near that impact point.

## Data prep
- `api/scripts/prep_terrain.py`: cuts 8192 m windows from the PGDA tiles, writes `height_513.bin`, `height_1025.bin` (uint16, min/max in `meta.json`) and 512 px overlays (`slope, rough, sun, earth, psr, hazard`).
- `api/scripts/fetch_ephemeris.py`: Horizons sub-solar and sub-Earth points.
- `api/scripts/prep_psr_dist.py`: coarse distance-to-shadow grids.
Raw downloads live in `assets-src/downloads/p4/` (gitignored); sizes: 3 DEMs 41 MB each, 3 illumination maps 51 MB each.

## Limits
The DEM is interpolated from tracks and the illumination maps are 60 m; local shadows from outside the 8 km tile are not modeled in the 3D view; boulders are statistical; lander tolerances and dispersion are game-tuned.
