"""Surface field notes: facts for the points of interest on the Moon.

GET /surface/poi?site_id=site_a&x=0&z=0[&web=true]

Curated NASA/mission facts (every one with a source link) come first. For each point of interest one SerpApi
Google query adds up to two web results from trusted science domains ("Further reading"). Queries are
site-independent and cached 3 days (a bundle per site 6 h), so credits are only spent on the first request of a topic.
Real numbers (distance and direction to hardware, shadow, Sun and Earth visibility) come from the LOLA tile.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from app.services import cache, serp
from app.sim import terrain as T

router = APIRouter(prefix="/surface", tags=["surface"])
log = logging.getLogger("surface")
HOUR = 3600
R = T.R_MOON_M

WIKI_LIST = "https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon"
PGDA69 = "https://pgda.gsfc.nasa.gov/products/69"
LRO = "https://science.nasa.gov/mission/lro/"


def F(text: str, name: str, url: str) -> dict:
    return {"text": text, "source_name": name, "source_url": url, "via": "curated"}


# relic name prefix -> (poi id, short title, facts, web query)
HERITAGE: list[tuple[str, str, str, list[dict], str]] = [
    ("Chandrayaan-1 Moon Impact Probe", "mip", "Chandrayaan-1 Moon Impact Probe", [
        F("On 14 November 2008 India's Moon Impact Probe left the Chandrayaan-1 orbiter and fell to the surface near Shackleton crater, the first Indian object to reach the Moon.", "Wikipedia: Moon Impact Probe", "https://en.wikipedia.org/wiki/Moon_Impact_Probe"),
        F("It carried a video camera, a radar altimeter and a mass spectrometer that sampled the thin lunar atmosphere during the descent of about 25 minutes.", "Wikipedia: Moon Impact Probe", "https://en.wikipedia.org/wiki/Moon_Impact_Probe"),
        F("The probe was not built to survive: it hit the surface and the impact point is only known from its tracking.", "List of artificial objects on the Moon", WIKI_LIST),
    ], "Chandrayaan-1 Moon Impact Probe impact Shackleton crater south pole"),
    ("LCROSS Centaur", "lcross", "LCROSS Centaur impact, Cabeus", [
        F("On 9 October 2009 the spent Centaur rocket stage of NASA's LCROSS mission hit the permanently shadowed floor of Cabeus crater to throw up material for analysis.", "NASA: LCROSS", "https://science.nasa.gov/mission/lcross/"),
        F("The plume contained water: about 5.6 percent of the ejected soil was water ice (Colaprete et al., Science 2010).", "Colaprete et al. 2010, Science", "https://doi.org/10.1126/science.1186986"),
        F("The impactor weighed about 2,300 kg and struck at roughly 2.5 km/s, about 2.5 times faster than a rifle bullet.", "NASA: LCROSS", "https://science.nasa.gov/mission/lcross/"),
    ], "LCROSS Cabeus impact water ice detected plume results"),
    ("LCROSS shepherding", "lcross_shep", "LCROSS shepherding spacecraft impact", [
        F("About four minutes behind the Centaur, the LCROSS shepherding spacecraft flew through the debris plume, measured it, and sent the data to Earth before it hit too.", "NASA: LCROSS", "https://science.nasa.gov/mission/lcross/"),
        F("Its spectrometers found water vapor and ice grains, plus hydrogen gas, carbon monoxide and other volatiles.", "Colaprete et al. 2010, Science", "https://doi.org/10.1126/science.1186986"),
    ], "LCROSS shepherding spacecraft plume spectrometer water vapor Cabeus"),
    ("Athena (IM-2)", "athena", "Athena (IM-2) lander", [
        F("Intuitive Machines' Athena landed near Mons Mouton in the south polar region on 6 March 2025, closer to the pole than any earlier lander.", "Wikipedia: IM-2", "https://en.wikipedia.org/wiki/IM-2"),
        F("It came to rest on its side in a crater and its battery ran out within a day, so the mission ended early. The position here is approximate.", "Wikipedia: IM-2", "https://en.wikipedia.org/wiki/IM-2"),
    ], "IM-2 Athena lander south pole Mons Mouton landed on its side"),
    ("Odysseus (IM-1)", "odysseus", "Odysseus (IM-1) lander", [
        F("Odysseus touched down near Malapert A on 22 February 2024: the first US landing since Apollo 17 in 1972 and the first by a private company.", "NASA: LRO spots Odysseus", "https://www.nasa.gov/image-article/lro-spots-odysseus/"),
        F("It caught a footpad on the ground and tipped onto its side. NASA's Lunar Reconnaissance Orbiter photographed it two days later.", "NASA: LRO spots Odysseus", "https://www.nasa.gov/image-article/lro-spots-odysseus/"),
    ], "Odysseus IM-1 lander tipped over Malapert A LRO image"),
    ("Chandrayaan-2 Vikram", "vikram2", "Chandrayaan-2 Vikram crash site", [
        F("On 7 September 2019 India's Vikram lander lost contact about 2 km above the surface during its final descent and crashed.", "NASA: LRO spots Vikram crash site", "https://www.nasa.gov/image-article/nasa-lro-spots-chandrayaan-2-vikram-crash-site/"),
        F("LRO found the debris field months later; the first lead came from an amateur, engineer Shanmuga Subramanian.", "NASA: LRO spots Vikram crash site", "https://www.nasa.gov/image-article/nasa-lro-spots-chandrayaan-2-vikram-crash-site/"),
    ], "Chandrayaan-2 Vikram crash site LRO debris found Shanmuga Subramanian"),
    ("Chandrayaan-3 Vikram", "vikram3", "Chandrayaan-3 Vikram lander", [
        F("On 23 August 2023 India made the first soft landing near the lunar south polar region, at 69.4 degrees south.", "Wikipedia: Chandrayaan-3", "https://en.wikipedia.org/wiki/Chandrayaan-3"),
        F("The Pragyan rover drove about 100 m from the lander and measured sulfur in the soil with its X-ray spectrometer.", "Wikipedia: Chandrayaan-3", "https://en.wikipedia.org/wiki/Chandrayaan-3"),
    ], "Chandrayaan-3 Vikram lander Pragyan rover south pole results"),
    ("Luna 25", "luna25", "Luna 25 crash site", [
        F("Russia's Luna 25, its first lunar probe since 1976, crashed on 19 August 2023 after an orbit maneuver went wrong, aiming for the south polar region.", "Wikipedia: Luna 25", "https://en.wikipedia.org/wiki/Luna_25"),
        F("LRO later photographed a new crater about 10 m wide at the crash site.", "List of artificial objects on the Moon", WIKI_LIST),
    ], "Luna 25 crash site LRO crater image August 2023"),
]

# environment + instrument points of interest: id -> (title, facts, web query)
ENV: dict[str, tuple[str, list[dict], str]] = {
    "psr": ("Permanently shadowed crater", [
        F("The Moon's axis is tilted only 1.5 degrees, so the Sun stays at the horizon at the poles and the floors of deep craters have not seen sunlight for billions of years.", "NASA PGDA illumination maps (Mazarico et al. 2011)", PGDA69),
        F("LRO's Diviner radiometer measured temperatures below -230 C in some of these craters, colder than the surface of Pluto.", "NASA: Lunar Reconnaissance Orbiter", LRO),
        F("Shackleton crater, next to the south pole, is about 21 km wide and over 4 km deep. Its floor is a cold trap where water ice can survive.", "Wikipedia: Shackleton (crater)", "https://en.wikipedia.org/wiki/Shackleton_(lunar_crater)"),
    ], "permanently shadowed regions Moon south pole cold traps water ice temperature"),
    "ice": ("Signs of water ice", [
        F("Water ice was confirmed in a polar cold trap by LCROSS in 2009, and NASA's Moon Mineralogy Mapper found ice on the surface of shadowed craters in 2018.", "Li et al. 2018, PNAS", "https://doi.org/10.1073/pnas.1802345115"),
        F("The ice is mixed into the soil, not a sheet. Future crews would heat it to make drinking water, oxygen and rocket fuel.", "Wikipedia: Lunar water", "https://en.wikipedia.org/wiki/Lunar_water"),
    ], "Moon Mineralogy Mapper water ice exposed surface shadowed craters 2018"),
    "regolith": ("Lunar regolith", [
        F("Regolith is the powdery soil made by billions of years of meteorite impacts grinding the rock. It is a few meters deep on the dark plains and up to 10-15 m in the highlands.", "Wikipedia: Lunar soil", "https://en.wikipedia.org/wiki/Lunar_soil"),
        F("With no wind or water to round it, the grains stay sharp and glassy. It clung to Apollo suits, wore at the fabric and smelled like spent gunpowder in the cabin.", "Wikipedia: Lunar soil", "https://en.wikipedia.org/wiki/Lunar_soil"),
    ], "lunar regolith properties dust Apollo suits sharp abrasive"),
    "boulder": ("Boulder with a track", [
        F("LRO's camera has photographed boulders that rolled down slopes and left long tracks. Moonquakes and nearby impacts shake them loose.", "Wikipedia: Lunar Reconnaissance Orbiter", "https://en.wikipedia.org/wiki/Lunar_Reconnaissance_Orbiter"),
        F("The track is a trench dug in soft regolith: on the Moon it stays for millions of years because nothing erases it except new impacts.", "NASA: Lunar Reconnaissance Orbiter", LRO),
    ], "LROC boulder tracks Moon rolling boulders moonquakes"),
    "crater": ("Small impact crater", [
        F("With no atmosphere to burn them up, every size of meteoroid reaches the ground, so the surface is covered in craters from kilometers down to millimeters.", "Wikipedia: Impact crater", "https://en.wikipedia.org/wiki/Impact_crater"),
        F("Scientists date a surface by counting its craters: more craters means older ground.", "Wikipedia: Lunar geologic timescale", "https://en.wikipedia.org/wiki/Geologic_timescale_of_the_Moon"),
    ], "lunar craters age dating crater counting small craters Moon surface"),
    "sun": ("The low Sun", [
        F("At the lunar poles the Sun never climbs more than about 2 degrees above the horizon and circles the sky once every 29.5 days. Shadows are many times longer than the objects that cast them.", "NASA PGDA illumination maps (Mazarico et al. 2011)", PGDA69),
        F("A few ridges stay sunlit most of the year ('peaks of near-eternal light') and make the best places for solar power.", "Wikipedia: Peak of eternal light", "https://en.wikipedia.org/wiki/Peak_of_eternal_light"),
    ], "peaks of eternal light Moon south pole Sun elevation shadows Artemis"),
    "earth": ("Earth on the horizon", [
        F("Because the Moon always shows the same face to Earth, Earth hardly moves in the sky. At the south pole it hugs the horizon and rocks up and down by about 7 degrees (libration).", "Wikipedia: Libration", "https://en.wikipedia.org/wiki/Libration"),
        F("Hills can hide Earth, so radio equipment has to stand on high, open ground with a clear line of sight toward it.", "NASA PGDA illumination maps (Mazarico et al. 2011)", PGDA69),
    ], "Earth visibility from lunar south pole radio line of sight communications Artemis"),
    "lrrr": ("Laser retroreflector", [
        F("Apollo 11, 14 and 15 left laser retroreflector arrays (100, 100 and 300 corner mirrors). Observatories on Earth still fire lasers at them and time the echo.", "Wikipedia: Lunar Laser Ranging experiment", "https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiment"),
        F("The echoes show the Moon is drifting away from Earth by about 3.8 cm each year, and they test Einstein's gravity theory.", "Wikipedia: Lunar Laser Ranging experiment", "https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiment"),
    ], "Apollo retroreflector lunar laser ranging still used today Moon recedes 3.8 cm"),
    "station": ("Seismometer station", [
        F("The Apollo surface experiment packages (ALSEP) carried seismometers that recorded thousands of moonquakes between 1969 and 1977.", "Wikipedia: ALSEP", "https://en.wikipedia.org/wiki/Apollo_Lunar_Surface_Experiments_Package"),
        F("They showed that the Moon rings like a bell after an impact and that it has a crust, a mantle and a small core.", "Wikipedia: Moonquake", "https://en.wikipedia.org/wiki/Moonquake"),
    ], "Apollo seismometer moonquakes ALSEP results Moon interior"),
}

ALLOWED = ("nasa.gov", "esa.int", "isro.gov.in", "wikipedia.org", "asu.edu", "usgs.gov", "planetary.org", "space.com", "universetoday.com",
           "nature.com", "science.org", "pnas.org", "lpi.usra.edu", "skyandtelescope.org", "scientificamerican.com", "britannica.com",
           "smithsonianmag.com", "doi.org", "sciencedirect.com", "usra.edu")


def _trusted(link: str) -> bool:
    host = (urlparse(link).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in ALLOWED)


_gate = asyncio.Semaphore(2)  # gentle on SerpApi


async def _web(query: str) -> list[dict]:
    """Up to two trusted web results for a query (cached 3 days; failures and empty answers are not cached)."""
    hit = cache.get("surface_serp", query, 3 * 24 * HOUR)
    if hit:
        return hit
    out = []
    # Google's organic links come back as google.com redirect wrappers (no real URL), so use SerpApi's DuckDuckGo engine
    # (direct links), and Bing as the backup.
    for engine in ("duckduckgo", "bing"):
        out = await _search_engine(engine, query)
        if out:
            break
    if out:
        cache.put("surface_serp", query, out)
    return out


async def _search_engine(engine: str, query: str) -> list[dict]:
    try:
        async with _gate:
            data = await serp._search({"engine": engine, "q": query})
    except Exception as e:  # SerpError carries only the status, never the key
        log.warning("serp failed: %s %s", type(e).__name__, e)
        return []
    out = []
    for r in data.get("organic_results", []):
        link, snip = r.get("link", ""), re.sub(r"\s*\[\d+\]", "", serp._clean(r.get("snippet")))
        if not link or not _trusted(link) or len(snip) < 50:
            continue
        snippet = snip[:240].rsplit(" ", 1)[0] + ("..." if len(snip) > 240 else "")
        out.append({"text": snippet, "source_name": serp._clean(r.get("title")) or urlparse(link).hostname,
                    "source_url": link, "via": "SerpApi"})
        if len(out) == 2:
            break
    return out


def _plane(lat: float, lon: float) -> tuple[float, float]:
    r = 2 * R * math.tan(math.radians(lat + 90) / 2)
    return r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))


def _gc_km(la1, lo1, la2, lo2) -> float:
    a = math.sin(math.radians(la2 - la1) / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a))) / 1000.0


@router.get("/poi")
async def poi(site_id: str = Query(...), x: float = 0.0, z: float = 0.0, web: bool = True) -> dict:
    try:
        t = T.load_tile(site_id)
    except KeyError:
        raise HTTPException(404, "unknown site")
    x = float(max(-t.half, min(t.half, x)))
    z = float(max(-t.half, min(t.half, z)))
    key = f"{site_id}|{round(x / 50)}|{round(z / 50)}|{int(web)}"
    hit = cache.get("surface_poi", key, 6 * HOUR)
    if hit is not None:
        return hit

    lat, lon = T.to_latlon(t, x, z)
    sun, earth = float(T.sun_pct(t, x, z)), float(T.earth_pct(t, x, z))
    psr_d, _ = T.dist_to_psr(t, x, z)
    c = t.meta["center"]
    here = (c["plane_x_m"] + x, c["plane_y_m"] - z)  # polar plane (x, y)

    pois: list[dict] = []
    queries: dict[str, str] = {}
    relics = {r["name"]: r for r in T._relics()}
    for prefix, pid, title, facts, q in HERITAGE:
        r = next((v for k, v in relics.items() if k.startswith(prefix)), None)
        if not r:
            continue
        px, py = _plane(r["lat"], r["lon"])
        dist_m = _gc_km(lat, lon, r["lat"], r["lon"]) * 1000
        # azimuth in the game frame (+X = plane x, +Z = plane -y); the projection is conformal so directions are preserved
        az = math.degrees(math.atan2(px - here[0], -(py - here[1]))) % 360
        pois.append({"id": pid, "title": title, "kind": "heritage", "distance_m": round(dist_m), "azimuth_deg": round(az, 1),
                     "approx": bool(r.get("approx")), "lat": r["lat"], "lon": r["lon"],
                     "facts": [F(f"Real distance from your landing spot: {dist_m / 1000:.1f} km. Face the marker on the horizon to sight it.",
                                 "api/data/relics.json (LROC / NASA / ISRO positions)", r.get("source", WIKI_LIST).split(" ")[0])] + list(facts)})
        queries[pid] = q
    context = {
        "psr": f"From this landing spot the nearest permanently shadowed ground is {psr_d:.0f} m away." if psr_d < 99000 else None,
        "sun": f"At {abs(lat):.2f} degrees south the Sun disc is visible {sun:.0f} percent of the time here.",
        "earth": f"Earth is above the horizon {earth:.0f} percent of the time here.",
    }
    for pid, (title, facts, q) in ENV.items():
        extra = []
        if context.get(pid):
            extra.append(F(context[pid], "NASA PGDA product 69 (LPSR / AVGVISIB maps)", PGDA69))
        pois.append({"id": pid, "title": title, "kind": "instrument" if pid in ("lrrr", "station") else "environment", "facts": extra + list(facts)})
        queries[pid] = q

    served_web = False
    if web:
        res = await asyncio.gather(*(_web(q) for q in queries.values()))
        for (pid, _), items in zip(queries.items(), res):
            if items:
                served_web = True
                next(p for p in pois if p["id"] == pid)["facts"].extend(items)
    out = {"site_id": site_id, "lat": round(lat, 3), "lon": round(lon, 3), "web": served_web, "pois": pois}
    cache.put("surface_poi", key, out)
    return out
