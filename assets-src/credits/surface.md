# Surface phase credits

## 3D models
No external models are shipped for the surface props. NASA 3D Resources (public domain) was checked for Apollo LRRR, ALSEP and flag models: the repository has an Apollo Lunar Module, LRO, LADEE and rover models but none of the small surface instruments, so the retroreflector (10 x 10 corner-cube array), seismometer station, sample rack, cable run, stakes, relay and field-note markers are procedural low-poly meshes built in `web/game/phases/surface/Items.tsx` and `Props.tsx`. Nothing to attribute.

## Field-note facts (shown in the world, with source names)
Served by `GET /surface/poi` (`api/app/routers/surface.py`). Each fact keeps its source link.
- Hardware positions and distances: `api/data/relics.json` (Wikipedia list of artificial objects on the Moon, citing LROC / NASA / ISRO); distance is great-circle from the landing spot, direction is preserved by the polar stereographic projection.
- Curated facts: NASA science pages (LCROSS, LRO), NASA image articles (Odysseus, Vikram), Colaprete et al. 2010 (Science), Li et al. 2018 (PNAS), Wikipedia (Moon Impact Probe, IM-2, Chandrayaan-3, Luna 25, lunar soil, Lunar Laser Ranging, ALSEP, libration, peak of eternal light).
- Illumination, Earth visibility and shadow numbers: NASA PGDA product 69 (Mazarico et al. 2011), see docs/science.md.
- "Web" facts: SerpApi (DuckDuckGo engine, Bing as backup), filtered to science and space-agency domains, cached 3 days per query.
