"""Fetch Sun / Earth selenographic sub-points from JPL Horizons (DE441) for the Moon, geocentric observer.
Output: api/data/ephemeris.json (+ copy to web/public/terrain/ephemeris.json).  Run once.
Horizons quantities: 14 = observer (Earth) sub-lon/lat on the Moon, 15 = Sun sub-lon/lat. MOON_ME frame, east-positive."""
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
START, STOP, STEP_H = "2026-01-01", "2028-01-01", 6
params = {
    "format": "text", "COMMAND": "'301'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
    "CENTER": "'500'", "START_TIME": f"'{START}'", "STOP_TIME": f"'{STOP}'", "STEP_SIZE": f"'{STEP_H} h'",
    "QUANTITIES": "'14,15'", "ANG_FORMAT": "'DEG'", "CSV_FORMAT": "'YES'",
}
txt = httpx.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=120).text
body = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
rows = []
for ln in body:
    c = [x.strip() for x in ln.split(",")]
    rows.append((c[0], float(c[3]), float(c[4]), float(c[5]), float(c[6])))
t0 = datetime.strptime(rows[0][0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()
out = {
    "source": "JPL Horizons API, Moon (301) from geocenter (500), DE441, MOON_ME frame, quantities 14 & 15",
    "t0_unix": t0, "step_s": STEP_H * 3600, "n": len(rows),
    "earth_lon": [r[1] for r in rows], "earth_lat": [r[2] for r in rows],
    "sun_lon": [r[3] for r in rows], "sun_lat": [r[4] for r in rows],
}
p = ROOT / "api/data/ephemeris.json"
p.write_text(json.dumps(out, separators=(",", ":")))
shutil.copy(p, ROOT / "web/public/terrain/ephemeris.json")
print(len(rows), "rows", p.stat().st_size // 1024, "KB")
