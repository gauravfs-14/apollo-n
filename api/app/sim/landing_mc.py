"""Monte Carlo touchdowns on the real DEM. Deterministic by seed, fully vectorized."""
from __future__ import annotations

import math

import numpy as np

from . import terrain as T

DEFAULT_LANDER = {"leg_span_m": 9.0, "pad_radius_m": 4.5, "max_tilt_deg": 10.0}
BASE_SIGMA_M = 60.0  # 1-sigma dispersion per axis; real powered-descent ellipses are 100s of m, game-scaled
DIFF = {"easy": dict(tilt=1.3, sigma=0.8, luck=1.0), "normal": dict(tilt=1.0, sigma=1.0, luck=1.0),
        "hard": dict(tilt=1.0, sigma=1.15, luck=1.3)}


def lander_params(lander: dict | None, difficulty: str = "normal") -> dict:
    d = {**DEFAULT_LANDER, **{k: float(v) for k, v in (lander or {}).items() if k in DEFAULT_LANDER and v is not None}}
    if lander and "leg_span_m" in lander and "pad_radius_m" not in lander:
        d["pad_radius_m"] = d["leg_span_m"] / 2
    d["tilt_limit_deg"] = d["max_tilt_deg"] * DIFF.get(difficulty, DIFF["normal"])["tilt"]
    return d


def simulate(tile: T.Tile, x: float, z: float, n: int = 300, lander: dict | None = None, seed: int | None = None,
             perks: list[str] | None = None, difficulty: str = "normal") -> dict:
    perks = perks or []
    diff = DIFF.get(difficulty, DIFF["normal"])
    L = lander_params(lander, difficulty)
    seed = int(seed if seed is not None else (hash((tile.id, round(x), round(z))) & 0x7FFFFFFF))
    rng = np.random.default_rng(seed)
    sigma = BASE_SIGMA_M * diff["sigma"] * (0.6 if "extra_fuel" in perks else 1.0)
    px = x + rng.normal(0, sigma, n)
    pz = z + rng.normal(0, sigma, n)
    legr = L["leg_span_m"] / 2
    pad = L["pad_radius_m"]

    if "better_lidar" in perks:
        bad = T.plane_tilt(tile, px, pz, legr, None, 3) > L["tilt_limit_deg"]
        divert = bad & (rng.random(n) < 0.7)
        if divert.any():
            m = int(divert.sum())
            ang = rng.uniform(0, 2 * np.pi, (m, 6))
            rad = 40.0 * np.sqrt(rng.random((m, 6)))
            cx, cz = px[divert][:, None] + rad * np.cos(ang), pz[divert][:, None] + rad * np.sin(ang)
            tilts = T.plane_tilt(tile, cx.ravel(), cz.ravel(), legr, None, 3).reshape(m, 6)
            j = np.argmin(tilts, axis=1)
            px[divert] = cx[np.arange(m), j]
            pz[divert] = cz[np.arange(m), j]

    ok_in = T.inside(tile, px, pz)
    yaw = rng.uniform(0, 2 * np.pi, n)
    plane = T.plane_tilt(tile, px, pz, legr, yaw, 3)
    tilt = plane + np.abs(rng.normal(0, 1.0, n)) * 0.7  # leg stroke / attitude residual
    slope10 = T.plane_tilt(tile, px, pz, 10.0, None, 6)
    dens = T.boulder_density(slope10, T.roughness_at(tile, px, pz))
    p_b = np.clip(T.boulder_hit_prob(dens, pad) * diff["luck"] * (0.5 if "better_lidar" in perks else 1.0), 0, 0.95)
    boulder = rng.random(n) < p_b
    tipped = tilt > L["tilt_limit_deg"]
    reason = np.where(~ok_in, "oob", np.where(boulder, "boulder", np.where(tipped, "tipped", "ok")))
    ok = reason == "ok"
    counts = {k: int((reason == k).sum()) for k in ("ok", "tipped", "boulder", "oob")}
    landings = [{"x": round(float(a), 1), "z": round(float(b), 1), "tilt": round(float(c), 2), "ok": bool(d), "reason": str(e)}
                for a, b, c, d, e in zip(px, pz, tilt, ok, reason)]
    return {
        "n": n, "seed": seed, "safe_pct": round(100.0 * float(ok.mean()), 1),
        "mean_tilt_deg": round(float(tilt.mean()), 2), "p95_tilt_deg": round(float(np.percentile(tilt, 95)), 2),
        "tilt_limit_deg": round(L["tilt_limit_deg"], 2),
        "ellipse": {"sigma_x_m": round(sigma, 1), "sigma_z_m": round(sigma, 1), "rotation_deg": 0.0,
                    "radius95_m": round(sigma * math.sqrt(5.991), 1)},
        "landings": landings, "breakdown": counts,
    }
