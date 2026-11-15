// The landing challenge as plain data: everything that differs between seeds, derived only from the seed and the real
// terrain (so a friend opening the same link gets the same site, spot, start state and drift).
import { landParams, newLand, type Ground, type LandParams, type LandSim } from "../phases/landing/sim";
import { missionTime, scatterBoulders, type TerrainData } from "../three/terrain";
import { LIMIT_DEG, PAD_R } from "./scoring";
import { SITES, mulberry32 } from "./seed";

export const siteForSeed = (seed: number) => SITES[Math.floor(mulberry32(seed ^ 0x5bd1e995)() * SITES.length)];
export const skyTimeForSeed = (seed: number) => missionTime({ seed });

export interface LandingConfig {
  seed: number;
  siteId: string;
  siteName: string;
  target: { x: number; z: number };
  /** compass heading of the approach, unit (x, z) */
  heading: number;
  start: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  /** steady sideways push (m/s^2) and its slow gust ripple */
  drift: { ax: number; az: number; gust: number; phase: number };
  /** flight-time and distance summaries shown on the briefing */
  startDist: number;
  startAlt: number;
}

export const challengeParams = (): LandParams => landParams("normal", { limitDeg: LIMIT_DEG, deltaV: 2900, fuelMult: 1, padR: PAD_R });

export function buildLanding(seed: number, data: TerrainData): LandingConfig {
  const rnd = mulberry32(seed);
  rnd(); // the first draw picked the site
  // target: one of the flattest spots within 450 m of the tile centre, away from the map edge
  const cand: { x: number; z: number; s: number }[] = [];
  for (let x = -450; x <= 450; x += 25) for (let z = -450; z <= 450; z += 25) {
    if (data.inside(x, z, 220)) cand.push({ x, z, s: data.slopeDegAt(x, z, PAD_R + 4) + 0.004 * Math.hypot(x, z) });
  }
  cand.sort((a, b) => a.s - b.s);
  const pick = cand[Math.floor(rnd() * Math.min(24, cand.length))] ?? { x: 0, z: 0 };
  const heading = rnd() * Math.PI * 2;
  const dist = 230 + rnd() * 90;
  const alt = 260 + rnd() * 80;
  const vf = 8 + rnd() * 12;
  const vlat = (rnd() - 0.5) * 8;
  const vy = -(5 + rnd() * 5);
  const dm = 0.04 + rnd() * 0.1;
  const da = rnd() * Math.PI * 2;
  let fx = Math.cos(heading), fz = Math.sin(heading);
  const lim = data.size / 2 - 70;
  let sx = pick.x - fx * dist, sz = pick.z - fz * dist;
  if (Math.abs(sx) > lim || Math.abs(sz) > lim) { fx = -fx; fz = -fz; sx = pick.x - fx * dist; sz = pick.z - fz * dist; }
  const hd = Math.atan2(fz, fx);
  const rx = -fz, rz = fx;
  const y = Math.max(data.heightAt(sx, sz), data.heightAt(pick.x, pick.z)) + alt;
  return {
    seed, siteId: data.siteId, siteName: data.meta.name, target: { x: pick.x, z: pick.z }, heading: hd,
    start: { x: sx, y, z: sz, vx: fx * vf + rx * vlat, vy, vz: fz * vf + rz * vlat },
    drift: { ax: Math.cos(da) * dm, az: Math.sin(da) * dm, gust: 0.35 + rnd() * 0.3, phase: rnd() * 6.28 },
    startDist: dist, startAlt: alt,
  };
}

export function makeGround(data: TerrainData, c: LandingConfig): Ground {
  const list = scatterBoulders(data, c.target.x, c.target.z, 220, c.seed + (data.siteId.charCodeAt(5) ?? 0) * 977, 1000);
  return { h: data.heightAt, boulders: list.filter((b) => b.size >= 0.5), half: data.size / 2 };
}

/** The first moment of a run (and of every retry): same state for the same seed. */
export function startSim(c: LandingConfig, ground: Ground, P: LandParams, att: number): LandSim {
  const s = newLand(att, c.target, ground, P, c.heading, 0);
  s.fx = Math.cos(c.heading); s.fz = Math.sin(c.heading);
  Object.assign(s, c.start, { alt: c.startAlt, vt: c.start.vy });
  return s;
}

/** The sideways push at flight time t (m/s^2). */
export function driftAt(c: LandingConfig, t: number, out: { x: number; z: number }) {
  const k = 1 + c.drift.gust * Math.sin(t * 0.55 + c.drift.phase) * Math.sin(t * 0.23 + 1.7);
  out.x = c.drift.ax * k;
  out.z = c.drift.az * k;
}
