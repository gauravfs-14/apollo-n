"""Landing-site scoring and Monte Carlo landings on real LOLA terrain. See docs/science.md."""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.sim import landing_mc, sunearth
from app.sim import terrain as T

router = APIRouter()

# (key, label, weight)
WEIGHTS = [("slope", "Flat ground", 30), ("sun", "Sunlight", 20), ("earth", "Radio view of Earth", 15),
           ("ice", "Reach to the ice", 15), ("boulders", "Rocks and bumps", 15), ("relic", "Distance from old hardware", 5)]


class Lander(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pad_radius_m: float | None = None
    leg_span_m: float | None = None
    max_tilt_deg: float | None = None


class ScoreIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    site_id: str
    x: float = 0.0
    z: float = 0.0
    lander: Lander | None = None
    date: str | None = None


class SimIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    site_id: str
    x: float = 0.0
    z: float = 0.0
    n: int = Field(300, ge=1, le=2000)
    lander: Lander | None = None
    seed: int | None = None
    perks: list[str] = []
    difficulty: str = "normal"


def _tile(site_id: str) -> T.Tile:
    try:
        return T.load_tile(site_id)
    except KeyError:
        raise HTTPException(404, f"unknown site {site_id}") from None


def _lander(l: Lander | None) -> dict:
    return l.model_dump(exclude_none=True) if l else {}


def _t(date: str | None) -> float | None:
    if not date:
        return None
    try:
        return datetime.fromisoformat(date.replace("Z", "+00:00")).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        raise HTTPException(422, "bad date") from None


@router.get("/landing/sites")
def sites() -> list[dict]:
    out = []
    for sid in T.sites():
        m = T.load_tile(sid).meta
        out.append({"id": sid, "name": m["name"], "lat": m["center"]["lat"], "lon": m["center"]["lon"],
                    "size_m": m["size_m"], "min_m": m["min_m"], "max_m": m["max_m"]})
    return out


@router.get("/landing/sun")
def sun(site_id: str, date: str | None = None) -> dict:
    c = _tile(site_id).meta["center"]
    return sunearth.playable(c["lat"], c["lon"], _t(date))


@router.post("/landing/score")
def score(body: ScoreIn) -> dict:
    t = _tile(body.site_id)
    L = landing_mc.lander_params(_lander(body.lander))
    x, z = float(np.clip(body.x, -t.half, t.half)), float(np.clip(body.z, -t.half, t.half))
    pad, tol = L["pad_radius_m"], L["max_tilt_deg"]
    lat, lon = T.to_latlon(t, x, z)
    slope_fp = float(T.plane_tilt(t, [x], [z], 10.0, None, 6)[0])
    slope_leg = float(T.plane_tilt(t, [x], [z], L["leg_span_m"] / 2, None, 3)[0])
    slope5 = float(T.slope5_at(t, x, z))
    rough = float(T.roughness_at(t, x, z))
    sun_pct, earth_pct = float(T.sun_pct(t, x, z)), float(T.earth_pct(t, x, z))
    dens = float(T.boulder_density(slope_fp, rough))
    hit = float(T.boulder_hit_prob(dens, pad))
    ice_d, ice_dir = T.dist_to_psr(t, x, z)
    in_psr = ice_d <= 0
    relic_km, relic_name = T.nearest_relic(lat, lon)

    ss = T.smoothstep
    s_slope = float(1 - ss(3, tol * 1.5, slope_fp))
    s_sun = float(np.clip(sun_pct / 70.0, 0, 1))
    s_earth = float(np.clip(earth_pct / 60.0, 0, 1))
    if in_psr:
        s_ice = 0.0
    elif ice_d < 300:
        s_ice = 0.3 + 0.7 * ice_d / 300
    elif ice_d <= 1500:
        s_ice = 1.0
    else:
        s_ice = float(max(0.1, 1 - 0.9 * min(1, (ice_d - 1500) / 2500)))
    s_boul = float(0.6 * (1 - ss(0.02, 0.25, hit)) + 0.4 * (1 - ss(0.3, 1.2, rough)))
    s_relic = float(ss(1, 25, relic_km))
    subs = {"slope": s_slope, "sun": s_sun, "earth": s_earth, "ice": s_ice, "boulders": s_boul, "relic": s_relic}

    text = {
        "slope": f"Ground tilts {slope_fp:.1f} degrees under the lander. Your legs handle up to {tol:.0f}.",
        "sun": f"The Sun shines here {sun_pct:.0f}% of the time. More sun means more power and warmth.",
        "earth": f"Earth is in view {earth_pct:.0f}% of the time, so radio contact is {'easy' if earth_pct > 40 else 'patchy' if earth_pct > 10 else 'poor'}.",
        "ice": ("You would land inside permanent shadow: no sunlight at all." if in_psr else
                f"The nearest permanently dark ice-trap ground is {ice_d:.0f} m away. Close enough to drive to, far enough to stay safe."
                if 300 <= ice_d <= 1500 else
                f"The nearest permanently dark ground is {ice_d:.0f} m away, {'a bit too close to the shadow edge' if ice_d < 300 else 'a long drive'}."),
        "boulders": f"About a {hit * 100:.0f}% chance a boulder sits under a footpad; ground bumpiness is {rough:.2f} m.",
        "relic": f"Nearest human hardware: {relic_name}, {relic_km:.0f} km away. Only matters if it is within about 25 km: keep clear of old hardware.",
    }
    breakdown = []
    for key, label, w in WEIGHTS:
        val, unit = {"slope": (slope_fp, "deg"), "sun": (sun_pct, "%"), "earth": (earth_pct, "%"), "ice": (ice_d, "m"),
                     "boulders": (hit * 100, "% hit"), "relic": (relic_km, "km")}[key]
        breakdown.append({"key": key, "label": label, "value": round(val, 2), "unit": unit,
                          "points": round(subs[key] * w, 1), "weight": w, "text": text[key]})
    total = round(sum(b["points"] for b in breakdown))

    hazards = []
    if slope_fp > tol:
        hazards.append({"kind": "slope", "severity": round(min(1, slope_fp / (tol * 2)), 2), "text": f"Too steep: {slope_fp:.0f} degrees, your lander tips past {tol:.0f}."})
    elif slope_fp > tol * 0.6:
        hazards.append({"kind": "slope", "severity": round(0.3 + 0.3 * (slope_fp / tol - 0.6), 2), "text": "Sloping ground. Risky if you land off-center."})
    if hit > 0.15 or rough > 0.8:
        hazards.append({"kind": "boulders", "severity": round(float(min(1, max(hit * 2, rough / 1.5))), 2), "text": "Rocky and bumpy ground. A footpad may land on a boulder."})
    if in_psr:
        hazards.append({"kind": "dark", "severity": 1.0, "text": "Permanent shadow: no sunlight, extreme cold, no power."})
    elif sun_pct < 20:
        hazards.append({"kind": "dark", "severity": round(1 - sun_pct / 20, 2), "text": f"Mostly dark here ({sun_pct:.0f}% sunlight). Batteries will drain."})
    if earth_pct < 10:
        hazards.append({"kind": "radio", "severity": round(1 - earth_pct / 10, 2), "text": "Earth is rarely in view: weak radio link."})
    if 0 < ice_d < 100:
        hazards.append({"kind": "edge", "severity": 0.5, "text": "Right on the edge of a deep shadowed crater."})

    c = t.meta["center"]
    env = sunearth.playable(c["lat"], c["lon"], _t(body.date))
    return {
        "site_id": body.site_id, "x": round(x, 1), "z": round(z, 1), "lat": round(lat, 4), "lon": round(lon, 3),
        "elevation_m": round(float(T.height_at(t, x, z)), 1),
        "slope_deg": round(slope_fp, 2), "slope_leg_deg": round(slope_leg, 2), "slope_5m_deg": round(slope5, 2),
        "roughness_m": round(rough, 3), "sun_pct": round(sun_pct, 1), "earth_pct": round(earth_pct, 1),
        "in_shadow_region": bool(in_psr), "ice_distance_m": round(ice_d, 0), "ice_direction_deg": None if ice_dir is None else round(ice_dir),
        "relic_km": round(relic_km, 1), "relic_name": relic_name,
        "boulder_density": round(dens, 5), "boulder_hit_pct": round(hit * 100, 1),
        "hazards": hazards, "score": int(max(0, min(100, total))), "breakdown": breakdown,
        "sun_elevation_deg": round(env["sun_el_deg"], 2), "earth_elevation_deg": round(env["earth_el_deg"], 2),
        "date_shifted_days": env["shifted_days"], "tilt_tolerance_deg": tol,
    }


@router.post("/landing/sim")
def sim(body: SimIn) -> dict:
    t = _tile(body.site_id)
    return landing_mc.simulate(t, body.x, body.z, body.n, _lander(body.lander), body.seed, body.perks, body.difficulty)
