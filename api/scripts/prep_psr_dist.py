"""Coarse distance-to-permanent-shadow grid (65x65 over each 8 km tile) from the global 60 m LPSR map, so tiles with no PSR
inside (site_c) still get a real 'distance to ice' number. Output api/data/psr_dist.json."""
import json
import math
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[2]
a = np.asarray(np.memmap(ROOT / "assets-src/downloads/p4/illum/LPSR_85S_060M_201608.IMG", dtype="<i2", mode="r", shape=(5058, 5058)))
psr = a > 0
dist = distance_transform_edt(~psr) * 60.0
out = {}
for d in sorted((ROOT / "web/public/terrain").iterdir()):
    mp = d / "meta.json"
    if not mp.exists():
        continue
    m = json.loads(mp.read_text())
    cx, cy, half, n = m["center"]["plane_x_m"], m["center"]["plane_y_m"], m["size_m"] / 2, 65
    g = np.linspace(-half, half, n)
    X, Z = np.meshgrid(g, g)
    col = (cx + X) / 60.0 + 2528.5
    row = 2528.5 - (cy - Z) / 60.0
    from scipy.ndimage import map_coordinates
    v = map_coordinates(dist, [row, col], order=1, mode="nearest")
    out[d.name] = {"n": n, "m": np.round(v).astype(int).tolist()}
    print(d.name, "min dist to PSR (m)", int(v.min()), "centre", int(v[n // 2, n // 2]))
(ROOT / "api/data/psr_dist.json").write_text(json.dumps(out, separators=(",", ":")))
