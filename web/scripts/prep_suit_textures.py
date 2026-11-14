"""Prepare Z-2 suit textures (NASA ACL, public domain): clean up grime, build metal/roughness + accent mask.
Run: cd api && uv run python ../web/scripts/prep_suit_textures.py <dir with z2_Color_s.jpeg, z2_spec_color_s.jpeg, z2_Bump_s.jpeg> <out dir>
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
Image.MAX_IMAGE_PIXELS = None
S = 2048


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


col = Image.open(f"{src}/z2_Color_s.jpeg").convert("RGB").resize((S, S), Image.LANCZOS)
c = np.asarray(col).astype(np.float32) / 255
r, g, b = c[..., 0], c[..., 1], c[..., 2]
lum = 0.3 * r + 0.59 * g + 0.11 * b
sat = c.max(-1) - c.min(-1)

# accent mask: saturated red trim + saturated blue bands
red = smooth(0.12, 0.3, r - np.maximum(g, b)) * (r > 0.35)
blue = smooth(0.1, 0.25, b - np.maximum(r, g)) * (b > 0.25)
accent = np.clip(np.maximum(red, blue), 0, 1)
Image.fromarray((accent * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(f"{out}/accent_mask.webp", quality=90)

# remove the grime. 1) close small dark specks on light fabric (grey closing), 2) pull large mid-dark stains toward clean fabric.
# Real black parts (boots, gloves, hoses) are large and very dark, so they survive.
from PIL import ImageFilter
closed = col.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
cc = np.asarray(closed).astype(np.float32) / 255
cl = 0.3 * cc[..., 0] + 0.59 * cc[..., 1] + 0.11 * cc[..., 2]
fabric = smooth(0.55, 0.75, np.asarray(closed.filter(ImageFilter.GaussianBlur(10))).astype(np.float32).mean(-1) / 255)
speck = smooth(0.04, 0.2, cl - lum) * smooth(0.5, 0.7, cl) * fabric
c = c * (1 - speck[..., None]) + cc * speck[..., None]
lum = 0.3 * c[..., 0] + 0.59 * c[..., 1] + 0.11 * c[..., 2]
sat = c.max(-1) - c.min(-1)
dirt = smooth(0.07, 0.22, lum) * (1 - smooth(0.62, 0.86, lum)) * (1 - smooth(0.12, 0.3, sat))
clean = np.array([0.90, 0.89, 0.86], dtype=np.float32)
c2 = c * (1 - 0.85 * dirt[..., None]) + clean * (0.85 * dirt[..., None]) * (0.6 + 0.4 * lum[..., None] / 0.85)
# big stains (knees, thighs): dark patches whose neighbourhood is mostly clean fabric; boots/gloves are dark islands, kept
lum2 = 0.3 * c2[..., 0] + 0.59 * c2[..., 1] + 0.11 * c2[..., 2]
near = np.asarray(Image.fromarray((np.clip(cc.mean(-1), 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))).astype(np.float32) / 255
stain = smooth(0.25, 0.45, near) * (1 - smooth(0.5, 0.85, lum2)) * (1 - smooth(0.25, 0.5, sat))
c2 = c2 * (1 - 0.75 * stain[..., None]) + clean * 0.75 * stain[..., None] * (0.7 + 0.3 * lum2[..., None])
c2 = np.clip(c2 * 1.04, 0, 1)
# neutralise accent pixels so the shader tint reads clean
c2 = c2 * (1 - accent[..., None]) + (lum[..., None] * 0.9 + 0.1) * accent[..., None]

# visor lenses (mid-grey / yellow in the spec map): gold mirror
spec_full = np.asarray(Image.open(f"{src}/z2_spec_color_s.jpeg").convert("RGB").resize((S, S), Image.LANCZOS)).astype(np.float32) / 255
lens = smooth(0.3, 0.55, np.minimum(spec_full[..., 0], spec_full[..., 1]) - spec_full[..., 2])  # yellow = gold sun visor
gold = np.array([0.66, 0.52, 0.30], dtype=np.float32)
c2 = c2 * (1 - lens[..., None]) + gold * lens[..., None]
Image.fromarray((np.clip(c2, 0, 1) * 255).astype(np.uint8)).save(f"{out}/suit_color.webp", quality=88, method=6)
Image.fromarray((lens * 255).astype(np.uint8)).resize((512, 512)).save("/tmp/lens_mask.png")

# metal/roughness (glTF: G = roughness, B = metalness) from the specular map
spec = np.asarray(Image.open(f"{src}/z2_spec_color_s.jpeg").convert("RGB").resize((S // 2, S // 2), Image.LANCZOS)).astype(np.float32) / 255
sl = spec.max(-1)
rough = np.clip(0.88 - 0.78 * smooth(0.1, 0.9, sl), 0.08, 1)
metal = np.maximum(smooth(0.35, 0.8, sl), np.asarray(Image.fromarray((lens * 255).astype(np.uint8)).resize((S // 2, S // 2))).astype(np.float32) / 255)
rough = np.where(metal > 0.9, np.minimum(rough, 0.12), rough)
mr = np.stack([np.ones_like(sl), rough, metal], -1)
Image.fromarray((mr * 255).astype(np.uint8)).save(f"{out}/suit_mr.webp", quality=88, method=6)

print("ok")
