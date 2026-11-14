"""Builds shipped Moon + star textures from raw NASA SVS downloads (assets-src/downloads/p1).
Run: api/.venv/bin/python -I assets-src/tools/p1-textures.py   (star.f32 comes from decoding starmap_2020_4k.exr with three's EXRLoader)
"""
import json
import numpy as np
import tifffile
from PIL import Image

D = "assets-src/downloads/p1/"
OUT = "web/public/textures/"

# --- Moon colour (LROC colour, 4k) ---
Image.open(D + "lroc_color_16bit_srgb_4k.tif").convert("RGB").save(OUT + "moon/color_4k.webp", quality=86, method=6)
Image.open(D + "lroc_color_2k.jpg").convert("RGB").save(OUT + "moon/color_2k.webp", quality=86, method=6)

# --- Displacement (LDEM 4 px/deg, 8 bit) ---
h4 = tifffile.imread(D + "ldem_4.tif").astype(np.float32)
d = np.clip((h4 + 9.0) / 20.0, 0, 1)
Image.fromarray((d * 255).astype(np.uint8)).save(OUT + "moon/disp_1k.png", optimize=True)

# --- Normal map from LDEM 16 px/deg downsampled to 4096x2048 ---
h = tifffile.imread(D + "ldem_16.tif").astype(np.float32)
h = np.asarray(Image.fromarray(h).resize((4096, 2048), Image.BILINEAR))
R = 1737.4
lat = (0.5 - (np.arange(2048) + 0.5) / 2048) * np.pi
dx = 2 * np.pi * R / 4096 * np.maximum(np.cos(lat), 0.05)[:, None]  # km per pixel east
dy = np.pi * R / 2048  # km per pixel north
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx)
gy = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * dy)  # +v = north = up in the image
S = 6.0  # exaggeration so relief reads at orbital distance
n = np.stack([-gx * S, -gy * S, np.ones_like(gx)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT + "moon/normal_4k.webp", quality=90, method=6)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).resize((2048, 1024), Image.LANCZOS).save(OUT + "moon/normal_2k.webp", quality=90, method=6)

# --- Stars: NASA SVS Deep Star Maps 2020 (4k, linear) -> sRGB with a gentle gain ---
m = json.load(open("/tmp/p1/star.f32.json"))
a = np.fromfile("/tmp/p1/star.f32", dtype=np.float32).reshape(m["h"], m["w"], m["c"])[:, :, :3]
a = np.clip(a * 2.2, 0, 1)
srgb = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
Image.fromarray((srgb * 255).astype(np.uint8)).save(OUT + "stars/starmap_4k.webp", quality=90, method=6)
