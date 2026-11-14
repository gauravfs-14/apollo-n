// Sun / Earth direction at a south-pole tile from real JPL Horizons sub-points.
// TypeScript twin of api/app/sim/sunearth.py (keep the two in sync). Frame: +X plane x, +Y up, +Z plane -y.
import type { MissionPlan } from "../../types";

export interface Ephemeris {
  t0_unix: number;
  step_s: number;
  n: number;
  sun_lon: number[];
  sun_lat: number[];
  earth_lon: number[];
  earth_lat: number[];
}

export interface SkyState {
  /** unit vector toward the Sun / Earth in the game frame */
  sunDir: [number, number, number];
  earthDir: [number, number, number];
  sunElDeg: number;
  earthElDeg: number;
  /** compass-style azimuth 0 = grid north (-Z), clockwise */
  sunAzDeg: number;
  earthAzDeg: number;
  t: number;
  shiftedDays: number;
}

export const DEFAULT_T = 1_794_000_000; // 2026-11-14, build date
const MIN_SUN_EL = 0.6;

let ephPromise: Promise<Ephemeris> | null = null;
export function loadEphemeris(): Promise<Ephemeris> {
  ephPromise ??= fetch("/terrain/ephemeris.json")
    .then((r) => r.json())
    .then((d: Ephemeris) => {
      for (const k of ["sun_lon", "earth_lon"] as const) {
        const a = d[k];
        for (let i = 1; i < a.length; i++) {
          while (a[i] - a[i - 1] > 180) a[i] -= 360;
          while (a[i] - a[i - 1] < -180) a[i] += 360;
        }
      }
      return d;
    });
  return ephPromise;
}

function interp(e: Ephemeris, arr: number[], t: number) {
  const span = (e.n - 1) * e.step_s;
  let tt = t - e.t0_unix;
  if (tt < 0 || tt > span) tt = ((tt % span) + span) % span; // wrapped outside 2026-2027 (approximate)
  const f = tt / e.step_s;
  const i = Math.min(e.n - 2, Math.floor(f));
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

const D2R = Math.PI / 180;
function unit(lat: number, lon: number): [number, number, number] {
  const la = lat * D2R;
  const lo = lon * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
function frame(lat: number, lon: number) {
  const up = unit(lat, lon);
  // plane +x ~ ME +Y
  const d = up[1];
  let x: [number, number, number] = [-d * up[0], 1 - d * up[1], -d * up[2]];
  const nx = Math.hypot(...x);
  x = [x[0] / nx, x[1] / nx, x[2] / nx];
  const z: [number, number, number] = [
    x[1] * up[2] - x[2] * up[1],
    x[2] * up[0] - x[0] * up[2],
    x[0] * up[1] - x[1] * up[0],
  ];
  return { x, up, z };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function directions(e: Ephemeris, lat: number, lon: number, t: number) {
  const f = frame(lat, lon);
  const toGame = (v: [number, number, number]): [number, number, number] => [dot(f.x, v), dot(f.up, v), dot(f.z, v)];
  const sun = toGame(unit(interp(e, e.sun_lat, t), interp(e, e.sun_lon, t)));
  const earth = toGame(unit(interp(e, e.earth_lat, t), interp(e, e.earth_lon, t)));
  const az = (v: number[]) => ((Math.atan2(v[0], -v[2]) / D2R) % 360 + 360) % 360;
  return {
    sunDir: sun,
    earthDir: earth,
    sunElDeg: Math.asin(sun[1]) / D2R,
    earthElDeg: Math.asin(earth[1]) / D2R,
    sunAzDeg: az(sun),
    earthAzDeg: az(earth),
  };
}

/** Sun/Earth for time t; if the Sun is under ~0.6 deg (polar night season) advance day by day. */
export function skyAt(e: Ephemeris, lat: number, lon: number, t = DEFAULT_T, minEl = MIN_SUN_EL): SkyState {
  let d = directions(e, lat, lon, t);
  let shifted = 0;
  while (d.sunElDeg < minEl && shifted < 400) {
    t += 86400;
    shifted++;
    d = directions(e, lat, lon, t);
  }
  return { ...d, t, shiftedDays: shifted };
}

/** Every player derives the same mission date from the plan, so everyone sees the same shadows. */
export function missionTime(plan?: Pick<MissionPlan, "seed"> | null): number {
  return DEFAULT_T + (((plan?.seed ?? 0) % 28) + 28) % 28 * 86400;
}
export const missionDateIso = (t: number) => new Date(t * 1000).toISOString();
