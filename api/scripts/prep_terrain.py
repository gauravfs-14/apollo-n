"""Cut game terrain tiles from real NASA LOLA data. Run:  api/.venv/bin/python api/scripts/prep_terrain.py

Inputs (download once into assets-src/downloads/p4/, gitignored):
  dem/SiteNN_final_adj_5mpp_surf.tif   PGDA product 78 (Barker et al. 2021), 3200x3200 px @ 5 m, polar stereographic metres
  illum/AVGVISIB_85S_060M_201608.IMG   PGDA product 69, mean Sun visibility 2009-2013 LOLA topography, 60 m/px, int16 * 4e-5
  illum/AVGVISIB_85S_060M_201608_EARTH.IMG  same, Earth visibility
  illum/LPSR_85S_060M_201608.IMG       permanent shadow flag (DN +20000 = in PSR)
Outputs per site (web/public/terrain/<site_id>/):
  height_513.bin, height_1025.bin   uint16 LE row-major, h = min + v/65535*(max-min); row 0 = +y (grid north) edge
  slope.png sun.png earth.png hazard.png psr.png   512x512 8-bit grey overlays
  meta.json

Local frame (shared with the game): origin = tile centre, +X = polar-plane +x, +Z = polar-plane -y (so image rows
run along +Z), +Y up. Heights are relative to the tangent plane at the centre (sphere curvature d^2/2R removed).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates, uniform_filter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets-src/downloads/p4"
OUT = ROOT / "web/public/terrain"
R = 1_737_400.0  # LOLA reference sphere, m
SIZE_M = 8192.0  # tile edge
N_HI, N_LO, N_OV = 1025, 513, 512

# site_id -> PGDA site, tile origin (x of col 0, y of row 0 in metres), crop window (col0,row0 in native px)
SITES = {
    "site_a": dict(pgda="Site04", name="Shackleton Rim", origin=(-9000.0, 1000.0), win=(450, 650),
                   note="PGDA product 78 Site04 'Shackleton rim' (Mazarico et al. 2011 site 04)"),
    "site_b": dict(pgda="Site01", name="Connecting Ridge", origin=(-19000.0, -4000.0), win=(800, 800),
                   note="PGDA product 78 Site01 'Connecting ridge' (Mazarico et al. 2011 site 01)"),
    "site_c": dict(pgda="Site11", name="de Gerlache Rim", origin=(-45000.0, 23000.0), win=(700, 650),
                   note="PGDA product 78 Site11 'de Gerlache rim' (Mazarico et al. 2011 site 11)"),
}


def plane_to_latlon(x: float, y: float) -> tuple[float, float]:
    r = math.hypot(x, y)
    colat = 2 * math.degrees(math.atan(r / (2 * R)))
    return -90 + colat, math.degrees(math.atan2(x, y))


def smoothstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load_ill(name: str, scale: float, offset: float = 0.0) -> np.ndarray:
    a = np.memmap(SRC / "illum" / f"{name}.IMG", dtype="<i2", mode="r", shape=(5058, 5058))
    return np.asarray(a, dtype=np.float32) * scale + offset


def main() -> None:
    sun = load_ill("AVGVISIB_85S_060M_201608", 4e-5)
    earth = load_ill("AVGVISIB_85S_060M_201608_EARTH", 4e-5)
    psr = load_ill("LPSR_85S_060M_201608", 2.5e-5, 0.5)

    for sid, cfg in SITES.items():
        z_full = tifffile.imread(SRC / "dem" / f"{cfg['pgda']}_final_adj_5mpp_surf.tif").astype(np.float32)
        ox, oy = cfg["origin"]
        c0, r0 = cfg["win"]
        wpx = int(round(SIZE_M / 5.0)) + 4  # a little margin for filters
        z = z_full[r0 : r0 + wpx, c0 : c0 + wpx]
        # native metric slope (Horn 3x3 on the 5 m grid => ~10 m baseline), smoothed to ~lander-pad scale
        gy, gx = np.gradient(z, 5.0)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        slope_pad = np.degrees(np.arctan(np.hypot(*np.gradient(gaussian_filter(z, 2.0), 5.0))))  # ~20 m scale
        rough = np.sqrt(np.maximum(uniform_filter((z - gaussian_filter(z, 3.0)) ** 2, 7), 0))  # RMS residual, 35 m window

        # tile centre in plane metres
        cx = ox + (c0 + wpx / 2) * 5.0
        cy = oy - (r0 + wpx / 2) * 5.0
        lat, lon = plane_to_latlon(cx, cy)

        def sample(arr, n, spacing, order=1, native=5.0, src_origin=None):
            """Sample a native-grid array (cols->x, rows->-y) on the n x n game grid."""
            jj = (np.arange(n) - (n - 1) / 2) * spacing  # metres from centre
            xs = cx + jj[None, :] + 0 * jj[:, None]
            ys = cy - jj[:, None] + 0 * jj[None, :]  # row i -> Z=+jj -> y = cy - jj
            col = (xs - ox) / native - c0
            row = (oy - ys) / native - r0
            return map_coordinates(arr, [row, col], order=order, mode="nearest")

        def sample_ill(arr, n, spacing, order=3):
            jj = (np.arange(n) - (n - 1) / 2) * spacing
            xs = cx + jj[None, :] + 0 * jj[:, None]
            ys = cy - jj[:, None] + 0 * jj[None, :]
            return map_coordinates(arr, [2528.5 - ys / 60.0, xs / 60.0 + 2528.5], order=order, mode="nearest")

        zf = gaussian_filter(z, 0.6)
        d2 = lambda n, sp: (((np.arange(n) - (n - 1) / 2) * sp) ** 2)[None, :] + (((np.arange(n) - (n - 1) / 2) * sp) ** 2)[:, None]
        sp_hi = SIZE_M / (N_HI - 1)
        sp_lo = SIZE_M / (N_LO - 1)
        hi = sample(zf, N_HI, sp_hi) - d2(N_HI, sp_hi) / (2 * R)
        lo = sample(zf, N_LO, sp_lo) - d2(N_LO, sp_lo) / (2 * R)
        zmin, zmax = float(hi.min()), float(hi.max())

        def enc(a):
            return np.round((a - zmin) / (zmax - zmin) * 65535).clip(0, 65535).astype("<u2")

        d = OUT / sid
        d.mkdir(parents=True, exist_ok=True)
        enc(hi).tofile(d / "height_1025.bin")
        enc(lo).tofile(d / "height_513.bin")

        sp_ov = SIZE_M / (N_OV - 1)
        s_ov = sample(slope_pad, N_OV, sp_ov)
        r_ov = sample(rough, N_OV, sp_ov)
        sun_ov = np.clip(sample_ill(sun, N_OV, sp_ov), 0, 1)
        ear_ov = np.clip(sample_ill(earth, N_OV, sp_ov), 0, 1)
        psr_ov = (sample_ill(psr, N_OV, sp_ov, order=1) > 0.5).astype(np.float32)
        haz = 1 - (1 - smoothstep(7.0, 18.0, s_ov)) * (1 - smoothstep(0.35, 1.2, r_ov))

        def png(name, a):
            Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(d / name, optimize=True)

        png("slope.png", s_ov / 45.0)  # 0..45 deg
        png("sun.png", sun_ov)  # 0..100 %
        png("earth.png", ear_ov)
        png("hazard.png", haz)
        png("psr.png", psr_ov)
        png("rough.png", r_ov / 2.0)  # 0..2 m RMS

        meta = {
            "site_id": sid,
            "name": cfg["name"],
            "size_m": SIZE_M,
            "resolutions": {"1025": {"n": N_HI, "spacing_m": sp_hi}, "513": {"n": N_LO, "spacing_m": sp_lo}},
            "height_encoding": "uint16 little-endian, row-major, h = min_m + v/65535*(max_m-min_m); row0 = +y edge of polar plane (Z=-size/2)",
            "min_m": zmin,
            "max_m": zmax,
            "center": {"lat": round(lat, 4), "lon": round(lon, 4), "plane_x_m": cx, "plane_y_m": cy},
            "projection": "south polar stereographic, R=1737.4 km, true scale at pole, lon east (x=r sin lon, y=r cos lon)",
            "frame": "origin tile centre; +X=plane x; +Z=plane -y; +Y up; heights vs tangent plane at centre",
            "overlays": {
                "size": N_OV,
                "slope": "slope.png: 0..45 deg, 20 m scale, from 5 m DEM",
                "rough": "rough.png: 0..2 m RMS residual (35 m window)",
                "sun": "sun.png: 0..100 % of time Sun disc visible (PGDA 69, 60 m, bicubic upsampled)",
                "earth": "earth.png: 0..100 % Earth visibility (PGDA 69)",
                "psr": "psr.png: 255 = permanently shadowed (LPSR 60 m)",
                "hazard": "hazard.png: 0..1 terrain hazard = 1-(1-ss(7,18deg,slope))(1-ss(0.35,1.2m,rough))",
            },
            "source": {
                "dem": f"LOLA {cfg['pgda']} 5 m/px, Barker et al. 2021 (PSS 203, 105119), NASA PGDA product 78 https://pgda.gsfc.nasa.gov/products/78",
                "illumination": "NASA PGDA product 69 (Mazarico et al. 2011, Icarus 211, 1066), AVGVISIB_85S_060M_201608 + _EARTH + LPSR",
                "note": cfg["note"],
            },
        }
        (d / "meta.json").write_text(json.dumps(meta, indent=1))
        print(sid, cfg["name"], f"lat {lat:.3f} lon {lon:.2f}", f"z {zmin:.0f}..{zmax:.0f}",
              f"slope p50/p95 {np.percentile(s_ov, 50):.1f}/{np.percentile(s_ov, 95):.1f}",
              f"sun mean {sun_ov.mean()*100:.0f}% psr {psr_ov.mean()*100:.0f}%")


if __name__ == "__main__":
    main()
