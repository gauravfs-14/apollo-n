"""Sun and Earth direction at a lunar-south-pole tile, from real JPL Horizons sub-points (api/data/ephemeris.json).

Game frame (same as web/game/three/terrain): origin = tile centre, +X = polar-plane +x, +Y = local up,
+Z = polar-plane -y. Directions returned are unit vectors FROM the surface TOWARD the body.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[2] / "data" / "ephemeris.json"
DEFAULT_T = 1_794_000_000.0  # 2026-11-14 ~19:20 UTC, the build date of the game
MIN_SUN_EL_DEG = 0.6  # the game picks a date at/after the mission date where the Sun is at least this high


@lru_cache(maxsize=1)
def _eph() -> dict:
    d = json.loads(DATA.read_text())
    for k in ("earth_lon", "sun_lon"):
        d[k] = np.degrees(np.unwrap(np.radians(d[k])))
    for k in ("earth_lat", "sun_lat"):
        d[k] = np.asarray(d[k], dtype=float)
    return d


def _interp(key: str, t: float) -> float:
    e = _eph()
    span = (e["n"] - 1) * e["step_s"]
    # outside 2026-01..2027-12 the table is wrapped (approximate); documented in docs/science.md
    tt = (t - e["t0_unix"]) % span if not (e["t0_unix"] <= t <= e["t0_unix"] + span) else t - e["t0_unix"]
    return float(np.interp(tt / e["step_s"], np.arange(e["n"]), e[key]))


def subpoints(t_unix: float) -> dict:
    """Selenographic (ME frame, east lon) sub-solar and sub-Earth points."""
    return {
        "sun_lon": _interp("sun_lon", t_unix) % 360.0, "sun_lat": _interp("sun_lat", t_unix),
        "earth_lon": _interp("earth_lon", t_unix) % 360.0, "earth_lat": _interp("earth_lat", t_unix),
    }


def _unit(lat: float, lon: float) -> np.ndarray:
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def frame(lat: float, lon: float) -> np.ndarray:
    """3x3 matrix whose rows are the game axes (X,Y,Z) expressed in the Moon-fixed ME frame."""
    up = _unit(lat, lon)
    a = np.array([0.0, 1.0, 0.0])  # polar-plane +x  ~  ME +Y
    x = a - a.dot(up) * up
    x /= np.linalg.norm(x)
    z = np.cross(x, up)
    return np.stack([x, up, z])


def directions(lat: float, lon: float, t_unix: float) -> dict:
    sp = subpoints(t_unix)
    F = frame(lat, lon)
    sun = F @ _unit(sp["sun_lat"], sp["sun_lon"])
    earth = F @ _unit(sp["earth_lat"], sp["earth_lon"])
    return {
        "t": t_unix,
        "sun_dir": sun.tolist(), "sun_el_deg": math.degrees(math.asin(sun[1])),
        "earth_dir": earth.tolist(), "earth_el_deg": math.degrees(math.asin(earth[1])),
        "sun_az_deg": math.degrees(math.atan2(sun[0], -sun[2])) % 360,  # 0 = grid north (-Z), clockwise
        "earth_az_deg": math.degrees(math.atan2(earth[0], -earth[2])) % 360,
        **sp,
    }


def playable(lat: float, lon: float, t_unix: float | None = None, min_el: float = MIN_SUN_EL_DEG) -> dict:
    """Sun/Earth for the mission date; if the Sun is below `min_el` (polar night season), advance day by day."""
    t = DEFAULT_T if t_unix is None else t_unix
    d = directions(lat, lon, t)
    shifted = 0
    while d["sun_el_deg"] < min_el and shifted < 400:
        t += 86400.0
        shifted += 1
        d = directions(lat, lon, t)
    d["shifted_days"] = shifted
    return d


def sun_for_horizon(lat: float, lon: float, t0: float, days: float = 365.25, step_h: float = 6.0) -> np.ndarray:
    """(T,3) unit vectors toward the Sun in the game frame, for horizon-based illumination statistics."""
    ts = t0 + np.arange(0, days * 86400, step_h * 3600)
    F = frame(lat, lon)
    return np.array([F @ _unit(_interp("sun_lat", t), _interp("sun_lon", t)) for t in ts])
