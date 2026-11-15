// Walkable lunar ground at human scale (1 unit = 1 m), centered on the lander at (0,0).
// A pure, deterministic height function (broad terrain + hash-grid craters at several scales)
// so the mesh, the player, the rocks and the line-of-sight checks always agree.
// When P4's real-DEM loader is available this module is the single place to swap in
// `heightAt` from the DEM plus the procedural fine detail.
import * as THREE from "three";

export const AREA = 320; // inner detailed mesh size (m)
export const PLAY_RADIUS = 135; // soft boundary
// Sun / Earth directions. These are live bindings: the defaults below are used until SurfaceScene calls setSurfaceSky()
// with the real ephemeris direction for the landing site and mission date (before the ground is built).
export let SUN_ELEV = (2.4 * Math.PI) / 180;
export let SUN_AZ = 2.35; // radians, direction TO the sun in the x/z plane: (sin, cos)
export let EARTH_ELEV = (6.5 * Math.PI) / 180;
export let EARTH_AZ = SUN_AZ + 2.25;

export const SUN_DIR = new THREE.Vector3();
export const EARTH_DIR = new THREE.Vector3();
const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
function refreshDirs() {
  SUN_DIR.set(Math.sin(SUN_AZ) * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV), Math.cos(SUN_AZ) * Math.cos(SUN_ELEV)).normalize();
  EARTH_DIR.set(Math.sin(EARTH_AZ) * Math.cos(EARTH_ELEV), Math.sin(EARTH_ELEV), Math.cos(EARTH_AZ) * Math.cos(EARTH_ELEV)).normalize();
}
refreshDirs();

/** Real sun/earth unit vectors (tile frame, y up) from three/terrain/sun.ts. Azimuths are kept; elevations are clamped
 *  so the game stays playable (a sun under 0.8 deg gives km-long shadows, an Earth under the horizon makes radio tasks impossible). */
export function setSurfaceSky(sunDir: [number, number, number], earthDir: [number, number, number]) {
  SUN_AZ = Math.atan2(sunDir[0], sunDir[2]);
  SUN_ELEV = clamp(Math.asin(clamp(sunDir[1], -1, 1)), 0.8 * D2R, 8 * D2R);
  EARTH_AZ = Math.atan2(earthDir[0], earthDir[2]);
  EARTH_ELEV = clamp(Math.asin(clamp(earthDir[1], -1, 1)), 3 * D2R, 9 * D2R);
  refreshDirs();
  if (typeof window !== "undefined") (window as unknown as { __surfaceSky: unknown }).__surfaceSky = { sunElDeg: SUN_ELEV / D2R, sunAzDeg: SUN_AZ / D2R, earthElDeg: EARTH_ELEV / D2R, earthAzDeg: EARTH_AZ / D2R, raw: { sunDir, earthDir } };
}

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function h2(x: number, y: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, s: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s);
  const b = h2(ix + 1, iy, s);
  const c = h2(ix, iy + 1, s);
  const d = h2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface CraterScale {
  size: number;
  density: number;
  rMin: number;
  rMax: number;
  ratio: number;
}
const SCALES: CraterScale[] = [
  { size: 130, density: 0.55, rMin: 0.16, rMax: 0.42, ratio: 0.1 },
  { size: 44, density: 0.6, rMin: 0.12, rMax: 0.4, ratio: 0.12 },
  { size: 15, density: 0.6, rMin: 0.1, rMax: 0.4, ratio: 0.14 },
  { size: 6, density: 0.5, rMin: 0.1, rMax: 0.36, ratio: 0.16 },
];

export interface Ground {
  seed: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  crater: { x: number; z: number; r: number; depth: number };
  /** 1 = lit by the Sun, 0 = in (baked, far-field) shadow. Texture covers VIS_SIZE m centered on the lander. */
  buildSunVis(): THREE.DataTexture;
  /** Margin (m) by which the line toward Earth clears the terrain from (x,z) at head height. <0 means blocked. */
  earthMargin(x: number, z: number, steps?: number): number;
  isNearCraterFloor(x: number, z: number): boolean;
}

export const VIS_SIZE = 1800;
const VIS_N = 384;

export interface DemSource {
  /** real-terrain height (m) at tile coordinates */
  heightAt(x: number, z: number): number;
  /** where the lander sits in tile coordinates */
  ox: number;
  oz: number;
}

export function createGround(seed: number, dem?: DemSource): Ground {
  const dem0 = dem ? dem.heightAt(dem.ox, dem.oz) : 0;
  const s0 = seed & 0xffff;
  const rnd = mulberry32(seed);
  // The named crater: ~100 m from the lander, off to the side of the Sun axis so its floor is in shadow.
  const ca = SUN_AZ + Math.PI / 2 + (rnd() - 0.5) * 0.5;
  const craterR = 52;
  const craterD = 15;
  const crater = { x: Math.sin(ca) * 112, z: Math.cos(ca) * 112, r: craterR, depth: craterD };

  const sunAx = Math.sin(SUN_AZ);
  const sunAz = Math.cos(SUN_AZ);
  const earthAx = Math.sin(EARTH_AZ);
  const earthAz = Math.cos(EARTH_AZ);

  function heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    // broad undulation (gentle toward the Sun so the lander is not eclipsed by a swell)
    const dirSun = r > 1 ? (x * sunAx + z * sunAz) / r : 0;
    const swell = 1 - 0.7 * Math.max(0, dirSun);
    let h = dem
      ? Math.max(-250, Math.min(250, dem.heightAt(dem.ox + x, dem.oz + z) - dem0)) * 0.6 * swell
      : (vnoise(x / 240 + 7, z / 240 + 3, s0) * 2 - 1) * 4.2 * swell;
    h += (vnoise(x / 80, z / 80, s0 + 1) * 2 - 1) * 1.2;
    h += (vnoise(x / 26, z / 26, s0 + 2) * 2 - 1) * 0.32;
    h += (vnoise(x / 9, z / 9, s0 + 9) * 2 - 1) * 0.07;
    // far horizon: low rolling highlands (kept down toward the Sun and Earth so both rise above the skyline)
    const far = smooth(260, 1900, r);
    if (far > 0 && !dem) {
      const dirEarth = r > 1 ? (x * earthAx + z * earthAz) / r : 0;
      const keep = (1 - 0.85 * Math.max(0, dirSun)) * (1 - 0.7 * Math.max(0, dirEarth));
      const ridge = 0.35 + vnoise(x / 520, z / 520, s0 + 4) * 0.9 + vnoise(x / 190, z / 190, s0 + 5) * 0.3;
      h += far * far * 75 * ridge * keep;
    }
    // craters
    for (let k = 0; k < SCALES.length; k++) {
      const sc = SCALES[k];
      const cx0 = Math.floor(x / sc.size);
      const cz0 = Math.floor(z / sc.size);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const ix = cx0 + i;
          const iz = cz0 + j;
          if (h2(ix, iz, s0 + 100 + k) > sc.density) continue;
          const px = (ix + 0.15 + 0.7 * h2(ix, iz, s0 + 200 + k)) * sc.size;
          const pz = (iz + 0.15 + 0.7 * h2(ix, iz, s0 + 300 + k)) * sc.size;
          const rr = sc.size * (sc.rMin + (sc.rMax - sc.rMin) * h2(ix, iz, s0 + 400 + k) ** 2);
          const dx = x - px;
          const dz = z - pz;
          const d2 = (dx * dx + dz * dz) / (rr * rr);
          if (d2 > 6) continue;
          const dep = rr * (sc.ratio * (0.7 + 0.6 * h2(ix, iz, s0 + 500 + k)));
          const d = Math.sqrt(d2);
          if (d < 1) h -= dep * (1 - d2);
          h += dep * 0.28 * Math.exp(-((d - 1) * (d - 1)) / 0.1);
          h += (dep * 0.06) / Math.max(1, d2 * d); // held flat inside the rim: a step here made a 0.4 m cliff
        }
      }
    }
    // named crater (flat-ish floor)
    {
      const dx = x - crater.x;
      const dz = z - crater.z;
      const d2 = (dx * dx + dz * dz) / (craterR * craterR);
      if (d2 < 9) {
        const d = Math.sqrt(d2);
        if (d < 1) h -= craterD * (1 - Math.pow(d, 2.6)) * 1.0;
        h += craterD * 0.12 * Math.exp(-((d - 1) * (d - 1)) / 0.06);
        h += (craterD * 0.04) / Math.max(1, d2 * d); // continuous at the rim (was a 0.6 m step)
      }
    }
    // landing pad: flat and level around the lander
    const pad = smooth(11, 34, r);
    return h * pad;
  }

  const e = 0.35;
  function normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const hl = heightAt(x - e, z);
    const hr = heightAt(x + e, z);
    const hd = heightAt(x, z - e);
    const hu = heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  let visTex: THREE.DataTexture | null = null;
  function buildSunVis() {
    if (visTex) return visTex;
    const N = VIS_N;
    const cell = VIS_SIZE / N;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) H[j * N + i] = heightAt((i + 0.5) * cell - VIS_SIZE / 2, (j + 0.5) * cell - VIS_SIZE / 2);
    const sample = (gx: number, gz: number) => {
      const x = Math.min(N - 1.001, Math.max(0, gx));
      const z = Math.min(N - 1.001, Math.max(0, gz));
      const ix = x | 0;
      const iz = z | 0;
      const fx = x - ix;
      const fz = z - iz;
      const a = H[iz * N + ix];
      const b = H[iz * N + ix + 1];
      const c = H[(iz + 1) * N + ix];
      const d = H[(iz + 1) * N + ix + 1];
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };
    const t = Math.tan(SUN_ELEV);
    const stepX = sunAx / cell;
    const stepZ = sunAz / cell;
    const raw = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h0 = H[j * N + i] + 0.4;
        let lit = 1;
        for (let k = 1; k <= 110; k++) {
          const dist = k * cell;
          const gx = i + stepX * k;
          const gz = j + stepZ * k;
          if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) break;
          if (sample(gx, gz) > h0 + dist * t) {
            lit = 0;
            break;
          }
        }
        raw[j * N + i] = lit;
      }
    }
    const data = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let sum = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = Math.min(N - 1, Math.max(0, i + di));
            const jj = Math.min(N - 1, Math.max(0, j + dj));
            sum += raw[jj * N + ii];
            n++;
          }
        data[j * N + i] = Math.round((sum / n) * 255);
      }
    visTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    visTex.magFilter = THREE.LinearFilter;
    visTex.minFilter = THREE.LinearFilter;
    visTex.wrapS = visTex.wrapT = THREE.ClampToEdgeWrapping;
    visTex.needsUpdate = true;
    return visTex;
  }

  function earthMargin(x: number, z: number, steps = 90) {
    const y0 = heightAt(x, z) + 1.7;
    const t = Math.tan(EARTH_ELEV);
    let m = 1e9;
    for (let k = 1; k <= steps; k++) {
      const d = k * 8 + (k > 40 ? (k - 40) * 12 : 0);
      const hx = x + earthAx * d;
      const hz = z + earthAz * d;
      const margin = y0 + d * t - heightAt(hx, hz);
      if (margin < m) m = margin;
      if (m < -2) return m;
    }
    return m;
  }

  function isNearCraterFloor(x: number, z: number) {
    return Math.hypot(x - crater.x, z - crater.z) < crater.r * 0.7;
  }

  return { seed, heightAt, normalAt, crater, buildSunVis, earthMargin, isNearCraterFloor };
}
