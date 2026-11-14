// Landing-site API client + offline fallbacks (the game never dead-ends if the API is down).
import { api } from "../../core/api";
import { getPart } from "../../data/parts";
import { perkEffects } from "../../data/perks";
import type { TerrainData } from "../../three/terrain";
import type { Difficulty } from "../../types";

export interface LanderSpec {
  leg_span_m: number;
  max_tilt_deg: number;
  pad_radius_m: number;
}
export interface Breakdown {
  key: string;
  label: string;
  value: number;
  unit: string;
  points: number;
  weight: number;
  text: string;
}
export interface Hazard {
  kind: string;
  severity: number;
  text: string;
}
export interface ScoreOut {
  site_id: string;
  x: number;
  z: number;
  lat: number;
  lon: number;
  elevation_m: number;
  slope_deg: number;
  slope_5m_deg: number;
  roughness_m: number;
  sun_pct: number;
  earth_pct: number;
  ice_distance_m: number | null;
  in_shadow_region: boolean;
  relic_km: number;
  relic_name: string;
  boulder_hit_pct: number;
  hazards: Hazard[];
  score: number;
  breakdown: Breakdown[];
  tilt_tolerance_deg: number;
  offline?: boolean;
}
export interface Landing {
  x: number;
  z: number;
  tilt: number;
  ok: boolean;
  reason: string;
}
export interface SimOut {
  n: number;
  seed: number;
  safe_pct: number;
  mean_tilt_deg: number;
  p95_tilt_deg: number;
  tilt_limit_deg: number;
  ellipse: { sigma_x_m: number; sigma_z_m: number; rotation_deg: number; radius95_m: number };
  landings: Landing[];
  breakdown: { ok: number; tipped: number; boulder: number; oob: number };
  offline?: boolean;
}

const LEG_SPAN: Record<string, number> = { a: 9, b: 12, c: 6 };

/** Lander numbers from the ship the crew built (P2 parts catalog). */
export function landerFromBuild(parts: Record<string, string> | undefined): LanderSpec {
  const legs = getPart(parts?.legs);
  const variant = (parts?.legs ?? "legs_a").slice(-1);
  const span = LEG_SPAN[variant] ?? 9;
  return { leg_span_m: span, max_tilt_deg: legs?.tiltTolerance ?? 10, pad_radius_m: span / 2 };
}

export function perksFor(perk: string | undefined): string[] {
  return perk === "extra_fuel" || perk === "better_lidar" ? [perk] : [];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export async function fetchScore(site_id: string, x: number, z: number, lander: LanderSpec, date: string): Promise<ScoreOut> {
  return api<ScoreOut>("/landing/score", { site_id, x: r1(x), z: r1(z), lander, date });
}

export async function fetchSim(
  site_id: string, x: number, z: number, lander: LanderSpec, difficulty: Difficulty, perks: string[], seed: number, n = 300,
): Promise<SimOut> {
  const s = await api<SimOut>("/landing/sim", { site_id, x: r1(x), z: r1(z), n, lander, difficulty, perks, seed });
  s.landings = s.landings.map((l) => ({ ...l, x: r1(l.x), z: r1(l.z), tilt: r1(l.tilt) }));
  return s;
}

export async function fetchDirector(numbers: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await api<{ text: string }>("/director", { phase: "site", numbers });
    return r.text || null;
  } catch {
    return null;
  }
}

// ---------------- offline fallbacks (approximate, same shape) ----------------
const ss = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function localScore(d: TerrainData, x: number, z: number, lander: LanderSpec): ScoreOut {
  const o = d.overlayAt(x, z);
  const slope = d.slopeDegAt(x, z, 10);
  const slopePts = 30 * (1 - ss(lander.max_tilt_deg * 0.4, lander.max_tilt_deg * 1.4, slope));
  const sunPts = 20 * ss(5, 55, o.sunPct);
  const earthPts = 15 * ss(5, 55, o.earthPct);
  const boulders = 15 * (1 - ss(0.0008, 0.008, d.boulderDensityAt(x, z)));
  const icePts = o.psr ? 0 : 10;
  const bd: Breakdown[] = [
    { key: "slope", label: "Flat ground", value: r1(slope), unit: "deg", points: slopePts, weight: 30, text: `Ground tilts ${slope.toFixed(1)} degrees under the lander.` },
    { key: "sun", label: "Sunlight", value: Math.round(o.sunPct), unit: "%", points: sunPts, weight: 20, text: `The Sun shines here ${Math.round(o.sunPct)}% of the time.` },
    { key: "earth", label: "Radio view of Earth", value: Math.round(o.earthPct), unit: "%", points: earthPts, weight: 15, text: `Earth is in view ${Math.round(o.earthPct)}% of the time.` },
    { key: "ice", label: "Reach to the ice", value: 0, unit: "m", points: icePts, weight: 15, text: "Offline estimate." },
    { key: "boulders", label: "Rocks and bumps", value: r1(o.roughM), unit: "m", points: boulders, weight: 15, text: `Ground bumpiness is ${o.roughM.toFixed(2)} m.` },
  ];
  const score = Math.round(bd.reduce((a, b) => a + b.points, 0) + 5);
  return {
    site_id: d.siteId, x, z, lat: d.meta.center.lat, lon: d.meta.center.lon, elevation_m: d.heightAt(x, z),
    slope_deg: r1(slope), slope_5m_deg: r1(slope), roughness_m: o.roughM, sun_pct: o.sunPct, earth_pct: o.earthPct,
    ice_distance_m: null, in_shadow_region: o.psr, relic_km: 18.8, relic_name: "Chandrayaan-1 Moon Impact Probe", boulder_hit_pct: 0,
    hazards: slope > lander.max_tilt_deg ? [{ kind: "slope", severity: 1, text: "Too steep for these legs." }] : [],
    score, breakdown: bd, tilt_tolerance_deg: lander.max_tilt_deg, offline: true,
  };
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

export function localSim(
  d: TerrainData, x: number, z: number, lander: LanderSpec, difficulty: Difficulty, perks: string[], seed: number, n = 300,
): SimOut {
  const rnd = mulberry32(seed);
  const fx = perkEffects(perks[0]);
  const sigma = 60 * fx.landingScatter * (difficulty === "easy" ? 0.8 : difficulty === "hard" ? 1.15 : 1);
  const limit = lander.max_tilt_deg * (difficulty === "easy" ? 1.3 : 1);
  const out: Landing[] = [];
  const bd = { ok: 0, tipped: 0, boulder: 0, oob: 0 };
  const tilts: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = x + gauss(rnd) * sigma;
    const pz = z + gauss(rnd) * sigma;
    if (!d.inside(px, pz, 10)) {
      out.push({ x: px, z: pz, tilt: 0, ok: false, reason: "oob" });
      bd.oob++;
      continue;
    }
    const tilt = d.slopeDegAt(px, pz, lander.leg_span_m / 2) + gauss(rnd) * 1;
    const hit = rnd() < 1 - Math.exp(-d.boulderDensityAt(px, pz) * Math.PI * lander.pad_radius_m ** 2);
    const reason = Math.abs(tilt) > limit ? "tipped" : hit ? "boulder" : "ok";
    bd[reason as keyof typeof bd]++;
    tilts.push(Math.abs(tilt));
    out.push({ x: r1(px), z: r1(pz), tilt: r1(Math.abs(tilt)), ok: reason === "ok", reason });
  }
  tilts.sort((a, b) => a - b);
  return {
    n, seed, safe_pct: r1((bd.ok / n) * 100), mean_tilt_deg: r1(tilts.reduce((a, b) => a + b, 0) / (tilts.length || 1)),
    p95_tilt_deg: r1(tilts[Math.floor(tilts.length * 0.95)] ?? 0), tilt_limit_deg: limit,
    ellipse: { sigma_x_m: sigma, sigma_z_m: sigma, rotation_deg: 0, radius95_m: sigma * 2.45 }, landings: out, breakdown: bd, offline: true,
  };
}

/** Best nearby-ish spot from the overlay data (hint): coarse grid search, flat + sunny + Earth-facing + no rocks. */
export function suggestSpot(d: TerrainData): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let bs = -1;
  for (let x = -3600; x <= 3600; x += 100)
    for (let z = -3600; z <= 3600; z += 100) {
      const o = d.overlayAt(x, z);
      if (o.psr) continue;
      const s = (1 - ss(3, 14, d.slopeDegAt(x, z, 8))) * 0.5 + ss(0.1, 0.7, o.sunPct / 100) * 0.3 + ss(0.1, 0.7, o.earthPct / 100) * 0.2 - o.hazard * 0.3;
      if (s > bs) {
        bs = s;
        best = { x, z };
      }
    }
  return best;
}
