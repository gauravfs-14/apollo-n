// Loads a real LOLA/PGDA terrain tile (see api/scripts/prep_terrain.py) and exposes CPU + GPU data.
// Frame: 1 unit = 1 m, origin = tile centre, +X = grid column, +Z = grid row (row 0 at Z = -size/2), +Y up.
// Heights are relative to the tangent plane at the centre (sphere curvature already removed).
import * as THREE from "three";
import { loadEphemeris, type Ephemeris } from "./sun";

export interface TerrainMeta {
  site_id: string;
  name: string;
  size_m: number;
  min_m: number;
  max_m: number;
  center: { lat: number; lon: number; plane_x_m: number; plane_y_m: number };
  source: { dem: string; illumination: string; note: string };
  overlays: { size: number };
  resolutions: Record<string, { n: number; spacing_m: number }>;
}

export interface OverlaySample {
  slopeDeg: number;
  roughM: number;
  sunPct: number;
  earthPct: number;
  hazard: number;
  psr: boolean;
}

export interface TerrainData {
  siteId: string;
  meta: TerrainMeta;
  size: number;
  n: number;
  spacing: number;
  heights: Float32Array;
  ephemeris: Ephemeris;
  /** GPU textures (shared, created once) */
  tex: { height: THREE.DataTexture; grad: THREE.DataTexture; ovA: THREE.DataTexture; ovB: THREE.DataTexture };
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  /** slope in degrees of the plane through the DEM within `radius` metres (lander footprint scale) */
  slopeDegAt(x: number, z: number, radius?: number): number;
  overlayAt(x: number, z: number): OverlaySample;
  /** boulder density per m^2 (shared formula with api/app/sim/terrain.py) */
  boulderDensityAt(x: number, z: number): number;
  inside(x: number, z: number, margin?: number): boolean;
  dispose(): void;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function decodeGray(url: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
  bmp.close();
  return { data: out, w: c.width, h: c.height };
}

const cache = new Map<string, Promise<TerrainData>>();

export function loadTerrain(siteId: string): Promise<TerrainData> {
  let p = cache.get(siteId);
  if (!p) {
    p = build(siteId);
    cache.set(siteId, p);
    p.catch(() => cache.delete(siteId));
  }
  return p;
}

async function build(siteId: string): Promise<TerrainData> {
  const base = `/terrain/${siteId}`;
  const [meta, buf, eph, slope, rough, sun, earth, haz, psr] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json() as Promise<TerrainMeta>),
    fetch(`${base}/height_1025.bin`).then((r) => r.arrayBuffer()),
    loadEphemeris(),
    decodeGray(`${base}/slope.png`),
    decodeGray(`${base}/rough.png`),
    decodeGray(`${base}/sun.png`),
    decodeGray(`${base}/earth.png`),
    decodeGray(`${base}/hazard.png`),
    decodeGray(`${base}/psr.png`),
  ]);
  const N = meta.resolutions["1025"].n;
  const size = meta.size_m;
  const spacing = size / (N - 1);
  const u16 = new Uint16Array(buf);
  const heights = new Float32Array(N * N);
  const range = meta.max_m - meta.min_m;
  for (let i = 0; i < heights.length; i++) heights[i] = meta.min_m + (u16[i] / 65535) * range;

  // ---- GPU textures ----
  const height = new THREE.DataTexture(heights, N, N, THREE.RedFormat, THREE.FloatType);
  height.minFilter = height.magFilter = THREE.NearestFilter;
  height.needsUpdate = true;

  // gradient (dh/dx, dh/dz) as half floats: 8-bit normals would band badly under a 2 degree Sun
  const grad = new Uint16Array(N * N * 2);
  const hh = (i: number, j: number) => heights[Math.min(N - 1, Math.max(0, i)) * N + Math.min(N - 1, Math.max(0, j))];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const gx = (hh(i, j + 1) - hh(i, j - 1)) / (2 * spacing);
      const gz = (hh(i + 1, j) - hh(i - 1, j)) / (2 * spacing);
      const k = (i * N + j) * 2;
      grad[k] = THREE.DataUtils.toHalfFloat(gx);
      grad[k + 1] = THREE.DataUtils.toHalfFloat(gz);
    }
  const gradTex = new THREE.DataTexture(grad, N, N, THREE.RGFormat, THREE.HalfFloatType);
  gradTex.minFilter = gradTex.magFilter = THREE.LinearFilter;
  gradTex.needsUpdate = true;

  const M = slope.w;
  const a = new Uint8Array(M * M * 4);
  const b = new Uint8Array(M * M * 4);
  for (let i = 0; i < M * M; i++) {
    a[i * 4] = slope.data[i];
    a[i * 4 + 1] = sun.data[i];
    a[i * 4 + 2] = earth.data[i];
    a[i * 4 + 3] = haz.data[i];
    b[i * 4] = psr.data[i];
    b[i * 4 + 1] = rough.data[i];
    b[i * 4 + 3] = 255;
  }
  const mk = (d: Uint8Array) => {
    const t = new THREE.DataTexture(d, M, M, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const ovA = mk(a);
  const ovB = mk(b);

  // ---- CPU sampling ----
  const half = size / 2;
  const inv = 1 / spacing;
  function heightAt(x: number, z: number) {
    const fx = Math.min(N - 1.001, Math.max(0, (x + half) * inv));
    const fz = Math.min(N - 1.001, Math.max(0, (z + half) * inv));
    const j = fx | 0;
    const i = fz | 0;
    const tx = fx - j;
    const tz = fz - i;
    const k = i * N + j;
    return (
      (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - tz) + (heights[k + N] * (1 - tx) + heights[k + N + 1] * tx) * tz
    );
  }
  function normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = spacing;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return out.set(-gx, 1, -gz).normalize();
  }
  function slopeDegAt(x: number, z: number, radius = 6) {
    // least-squares plane through 8 ring points + centre
    let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxh = 0, szh = 0, n = 0;
    for (let k = -1; k < 8; k++) {
      const px = k < 0 ? 0 : Math.cos((k / 8) * Math.PI * 2) * radius;
      const pz = k < 0 ? 0 : Math.sin((k / 8) * Math.PI * 2) * radius;
      const h = heightAt(x + px, z + pz);
      sx += px; sz += pz; sh += h; sxx += px * px; szz += pz * pz; sxh += px * h; szh += pz * h; n++;
    }
    // ring is symmetric so sx = sz = 0 and the normal equations decouple
    const bx = (sxh - (sx * sh) / n) / (sxx - (sx * sx) / n);
    const bz = (szh - (sz * sh) / n) / (szz - (sz * sz) / n);
    return (Math.atan(Math.hypot(bx, bz)) * 180) / Math.PI;
  }
  const oi = M - 1;
  function ov(data: Uint8Array, x: number, z: number) {
    const fx = Math.min(oi - 0.001, Math.max(0, (x / size + 0.5) * oi));
    const fz = Math.min(oi - 0.001, Math.max(0, (z / size + 0.5) * oi));
    const j = fx | 0;
    const i = fz | 0;
    const tx = fx - j;
    const tz = fz - i;
    const k = i * M + j;
    return (data[k] * (1 - tx) + data[k + 1] * tx) * (1 - tz) + (data[k + M] * (1 - tx) + data[k + M + 1] * tx) * tz;
  }
  function overlayAt(x: number, z: number): OverlaySample {
    return {
      slopeDeg: (ov(slope.data, x, z) / 255) * 45,
      roughM: (ov(rough.data, x, z) / 255) * 2,
      sunPct: (ov(sun.data, x, z) / 255) * 100,
      earthPct: (ov(earth.data, x, z) / 255) * 100,
      hazard: ov(haz.data, x, z) / 255,
      psr: ov(psr.data, x, z) > 127,
    };
  }
  function boulderDensityAt(x: number, z: number) {
    const s = slopeDegAt(x, z, 10);
    const r = (ov(rough.data, x, z) / 255) * 2;
    return 0.0008 + 0.004 * smooth(6, 20, s) + 0.003 * smooth(0.3, 1.2, r);
  }

  return {
    siteId,
    meta,
    size,
    n: N,
    spacing,
    heights,
    ephemeris: eph,
    tex: { height, grad: gradTex, ovA, ovB },
    heightAt,
    normalAt,
    slopeDegAt,
    overlayAt,
    boulderDensityAt,
    inside: (x, z, m = 0) => Math.abs(x) <= half - m && Math.abs(z) <= half - m,
    dispose() {
      height.dispose();
      gradTex.dispose();
      ovA.dispose();
      ovB.dispose();
      cache.delete(siteId);
    },
  };
}
