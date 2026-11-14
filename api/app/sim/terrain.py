"""Real-DEM queries for a game tile (web/public/terrain/<id>/). All functions are vectorized numpy.

Frame: origin = tile centre, +X = grid column direction, +Z = grid row direction (row 0 at Z=-size/2), +Y up (metres).
Boulder model (shared with the client): density = 0.0008 + 0.004*ss(6,20,slope10) + 0.003*ss(0.3,1.2,rough)  [per m^2].
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, map_coordinates

ROOT = Path(__file__).resolve().parents[3]
TERRAIN_DIR = ROOT / "web" / "public" / "terrain"
RELICS = ROOT / "api" / "data" / "relics.json"
R_MOON_M = 1_737_400.0


def smoothstep(a: float, b: float, v):
    t = np.clip((np.asarray(v, dtype=float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


@dataclass
class Tile:
    id: str
    meta: dict
    size: float
    n: int
    h: np.ndarray  # (n,n) metres, row=Z, col=X
    slope: np.ndarray  # 512 overlays, 0..45 deg
    rough: np.ndarray  # metres 0..2
    sun: np.ndarray  # pct
    earth: np.ndarray
    hazard: np.ndarray  # 0..1
    psr: np.ndarray  # bool
    dist_psr: np.ndarray  # metres, 0 inside
    psr_idx: np.ndarray  # nearest PSR pixel (row, col) per pixel
    far: np.ndarray | None  # coarse 65x65 distance-to-PSR (m) from the global 60 m LPSR map
    ov_n: int

    @property
    def half(self) -> float:
        return self.size / 2


def sites() -> list[str]:
    return sorted(p.name for p in TERRAIN_DIR.iterdir() if (p / "meta.json").exists())


@lru_cache(maxsize=8)
def load_tile(site_id: str) -> Tile:
    d = TERRAIN_DIR / site_id
    if not (d / "meta.json").exists():
        raise KeyError(site_id)
    meta = json.loads((d / "meta.json").read_text())
    n = meta["resolutions"]["1025"]["n"]
    raw = np.fromfile(d / "height_1025.bin", dtype="<u2").reshape(n, n).astype(np.float32)
    h = meta["min_m"] + raw / 65535.0 * (meta["max_m"] - meta["min_m"])

    def png(name: str) -> np.ndarray:
        return np.asarray(Image.open(d / name).convert("L"), dtype=np.float32) / 255.0

    ov_n = meta["overlays"]["size"]
    psr = png("psr.png") > 0.5
    fp = ROOT / "api" / "data" / "psr_dist.json"
    far = None
    if fp.exists():
        e = json.loads(fp.read_text()).get(site_id)
        far = np.asarray(e["m"], dtype=np.float32) if e else None
    px = meta["size_m"] / (ov_n - 1)
    dist, idx = distance_transform_edt(~psr, return_indices=True)
    return Tile(
        id=site_id, meta=meta, size=meta["size_m"], n=n, h=h,
        slope=png("slope.png") * 45.0, rough=png("rough.png") * 2.0, sun=png("sun.png") * 100.0,
        earth=png("earth.png") * 100.0, hazard=png("hazard.png"), psr=psr, far=far,
        dist_psr=(dist * px).astype(np.float32), psr_idx=idx.astype(np.int32), ov_n=ov_n,
    )


def _clamp(t: Tile, x, z):
    return np.clip(x, -t.half, t.half), np.clip(z, -t.half, t.half)


def inside(t: Tile, x, z):
    return (np.abs(x) <= t.half) & (np.abs(z) <= t.half)


def height_at(t: Tile, x, z):
    x, z = _clamp(t, np.asarray(x, float), np.asarray(z, float))
    s = (t.n - 1) / t.size
    out = map_coordinates(t.h, [np.atleast_1d((z + t.half) * s), np.atleast_1d((x + t.half) * s)], order=1, mode="nearest")
    return out[0] if np.ndim(x) == 0 and np.ndim(z) == 0 else out


def normal_at(t: Tile, x, z, eps: float = 4.0):
    hx = height_at(t, x + eps, z) - height_at(t, x - eps, z)
    hz = height_at(t, x, z + eps) - height_at(t, x, z - eps)
    nx, ny, nz = -hx / (2 * eps), np.ones_like(hx), -hz / (2 * eps)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv, ny * inv, nz * inv], axis=-1)


def _overlay(t: Tile, arr: np.ndarray, x, z, order=1):
    x, z = _clamp(t, np.asarray(x, float), np.asarray(z, float))
    s = (t.ov_n - 1) / t.size
    out = map_coordinates(arr, [np.atleast_1d((z + t.half) * s), np.atleast_1d((x + t.half) * s)], order=order, mode="nearest")
    return out[0] if np.ndim(x) == 0 and np.ndim(z) == 0 else out


def sun_pct(t, x, z):
    return _overlay(t, t.sun, x, z)


def earth_pct(t, x, z):
    return _overlay(t, t.earth, x, z)


def hazard_at(t, x, z):
    return _overlay(t, t.hazard, x, z)


def roughness_at(t, x, z):
    return _overlay(t, t.rough, x, z)


def slope5_at(t, x, z):
    """Local slope (deg) at ~10 m baseline from the DEM."""
    nrm = normal_at(t, x, z, eps=5.0)
    return np.degrees(np.arccos(np.clip(nrm[..., 1], -1, 1)))


def plane_tilt(t: Tile, x, z, radius_m: float, yaw=None, k: int = 4):
    """Tilt (deg) of the best-fit plane through k points on a ring of `radius_m` around (x,z) plus the centre.
    x,z arrays of shape (N,); yaw (N,) radians or None. Returns (N,) degrees. Exact LSQ plane for k=3 legs + centre."""
    x = np.atleast_1d(np.asarray(x, float))
    z = np.atleast_1d(np.asarray(z, float))
    yaw = np.zeros_like(x) if yaw is None else np.asarray(yaw, float)
    ang = yaw[:, None] + np.arange(k)[None, :] * (2 * np.pi / k)
    px = x[:, None] + radius_m * np.cos(ang)
    pz = z[:, None] + radius_m * np.sin(ang)
    ph = height_at(t, px, pz)
    # ring points are symmetric, so the LSQ plane gradient = (2/(k r^2)) * sum(h_i * offset_i) (k>=3 symmetric)
    gx = 2.0 / (k * radius_m) * np.sum(ph * np.cos(ang), axis=1)
    gz = 2.0 / (k * radius_m) * np.sum(ph * np.sin(ang), axis=1)
    return np.degrees(np.arctan(np.hypot(gx, gz)))


def footprint_slope(t: Tile, x, z, radius_m: float = 10.0):
    """Mean tilt over a ring footprint: 8 yaw samples x 6-point ring, averaged in max sense (RMS) -> deg."""
    x = np.atleast_1d(np.asarray(x, float))
    z = np.atleast_1d(np.asarray(z, float))
    out = np.zeros_like(x)
    for yaw in (0.0, np.pi / 6):
        out = np.maximum(out, plane_tilt(t, x, z, radius_m, np.full_like(x, yaw), k=6))
    return out


def boulder_density(slope10_deg, rough_m):
    return 0.0008 + 0.004 * smoothstep(6, 20, slope10_deg) + 0.003 * smoothstep(0.3, 1.2, rough_m)


def boulder_hit_prob(density, pad_radius_m: float):
    return 1.0 - np.exp(-np.asarray(density) * math.pi * pad_radius_m ** 2)


def dist_to_psr(t: Tile, x, z):
    """Distance (m) to nearest permanently shadowed pixel (0 inside) and bearing (deg clockwise from grid north=-Z)."""
    if not t.psr.any():
        if t.far is None:
            return 99999.0, None
        xx, zz = _clamp(t, np.asarray(x, float), np.asarray(z, float))
        s = (t.far.shape[0] - 1) / t.size
        v = map_coordinates(t.far, [np.atleast_1d((zz + t.half) * s), np.atleast_1d((xx + t.half) * s)], order=1, mode="nearest")
        return float(v[0]), None  # direction unknown: the shadow lies outside this tile
    d = float(_overlay(t, t.dist_psr, x, z))
    x0, z0 = _clamp(t, np.asarray(x, float), np.asarray(z, float))
    s = (t.ov_n - 1) / t.size
    r, c = int(round((float(z0) + t.half) * s)), int(round((float(x0) + t.half) * s))
    r, c = min(max(r, 0), t.ov_n - 1), min(max(c, 0), t.ov_n - 1)
    pr, pc = t.psr_idx[:, r, c]
    dx, dz = (pc - c) / s, (pr - r) / s
    bearing = None if d <= 0 else math.degrees(math.atan2(dx, -dz)) % 360
    return d, bearing


def to_latlon(t: Tile, x: float, z: float) -> tuple[float, float]:
    c = t.meta["center"]
    px, py = c["plane_x_m"] + x, c["plane_y_m"] - z
    r = math.hypot(px, py)
    return -90 + 2 * math.degrees(math.atan(r / (2 * R_MOON_M))), math.degrees(math.atan2(px, py))


@lru_cache(maxsize=1)
def _relics() -> list[dict]:
    return json.loads(RELICS.read_text())["relics"]


def nearest_relic(lat: float, lon: float) -> tuple[float, str]:
    la1, lo1 = math.radians(lat), math.radians(lon)
    best = (1e18, "")
    for r in _relics():
        la2, lo2 = math.radians(r["lat"]), math.radians(r["lon"])
        a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        d = 2 * R_MOON_M * math.asin(min(1, math.sqrt(a))) / 1000.0
        if d < best[0]:
            best = (d, r["name"])
    return best
