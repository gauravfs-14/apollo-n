// Landing outcome: one seeded sample from the Monte Carlo test landings, so every player sees the same touchdown.
import type { TerrainData } from "../../three/terrain";
import type { Landing, SimOut } from "../site/api";

export interface Outcome {
  x: number;
  z: number;
  tilt: number;
  ok: boolean;
  reason: string;
  /** distance from the probe the crew dropped (m) */
  miss: number;
  /** leg tilt tolerance used (deg) */
  limit: number;
  /** yaw of the lander (rad) and compass of the downhill direction (rad, atan2(x,z) in the XZ plane) */
  yaw: number;
  /** horizontal unit vector (x,z) the ground tilts toward (downhill) */
  dx: number;
  dz: number;
}

function hash(n: number) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function pickOutcome(
  sim: SimOut | undefined, probe: { x: number; z: number } | undefined, seed: number, data: TerrainData, footR: number,
): Outcome {
  const list: Landing[] = sim?.landings?.length ? sim.landings : [{ x: probe?.x ?? 0, z: probe?.z ?? 0, tilt: 3, ok: true, reason: "ok" }];
  const inBounds = list.filter((l) => l.reason !== "oob");
  const pool = inBounds.length ? inBounds : list;
  const l = pool[Math.floor(hash(seed ^ (sim?.seed ?? 0)) * pool.length) % pool.length];
  const yaw = hash(seed * 7 + 13) * Math.PI * 2;
  const n = footNormal(data, l.x, l.z, yaw, footR);
  const hm = Math.hypot(n.x, n.z);
  const dx = hm > 1e-4 ? n.x / hm : Math.sin(yaw);
  const dz = hm > 1e-4 ? n.z / hm : Math.cos(yaw);
  const px = probe?.x ?? l.x;
  const pz = probe?.z ?? l.z;
  return {
    x: l.x, z: l.z, tilt: l.tilt, ok: l.ok, reason: l.reason,
    miss: Math.hypot(l.x - px, l.z - pz), limit: sim?.tilt_limit_deg ?? 10, yaw, dx, dz,
  };
}

/** Unit normal of the plane through the four DEM points under the feet (x,y,z). */
export function footNormal(data: TerrainData, x: number, z: number, yaw: number, r: number) {
  const pts: [number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const a = yaw + (k * Math.PI) / 2 + Math.PI / 4;
    const px = x + Math.sin(a) * r;
    const pz = z + Math.cos(a) * r;
    pts.push([px, data.heightAt(px, pz), pz]);
  }
  // opposing feet give two tangent vectors; normal = cross
  const t1 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
  const t2 = [pts[3][0] - pts[1][0], pts[3][1] - pts[1][1], pts[3][2] - pts[1][2]];
  let nx = t1[1] * t2[2] - t1[2] * t2[1];
  let ny = t1[2] * t2[0] - t1[0] * t2[2];
  let nz = t1[0] * t2[1] - t1[1] * t2[0];
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const m = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / m, y: ny / m, z: nz / m };
}

export interface LandingScore {
  total: number;
  stars: number;
  parts: { label: string; points: number; max: number; text: string }[];
  status: string;
}

/** Transparent formula: tilt 60 + condition 30 + accuracy 10. */
export function scoreLanding(o: Outcome, radius95: number): LandingScore {
  const r = Math.min(1, o.tilt / Math.max(1, o.limit));
  const tiltPts = o.reason === "tipped" ? 0 : Math.round(60 * (1 - 0.7 * Math.pow(r, 1.5)));
  const cond = o.reason === "ok" ? 30 : o.reason === "boulder" ? 12 : 0;
  const acc = Math.round(10 * (1 - Math.min(1, o.miss / Math.max(30, radius95))));
  const total = Math.max(0, Math.min(100, tiltPts + cond + acc));
  const stars = total >= 88 ? 3 : total >= 65 ? 2 : total >= 35 ? 1 : 0;
  const status =
    o.reason === "ok" ? "Upright and stable. The crew is safe."
    : o.reason === "boulder" ? "Down, but a foot landed on a boulder and a leg is damaged."
    : o.reason === "tipped" ? "The lander tipped over on the slope."
    : "Touched down at the edge of the map.";
  return {
    total, stars, status,
    parts: [
      { label: "Final tilt", points: tiltPts, max: 60, text: `${o.tilt.toFixed(1)} degrees. Your legs allow ${o.limit.toFixed(0)}.` },
      { label: "Condition", points: cond, max: 30, text: o.reason === "ok" ? "Nothing damaged." : o.reason === "boulder" ? "Leg damaged by a rock." : "Hull and legs lost." },
      { label: "On target", points: acc, max: 10, text: `${Math.round(o.miss)} m from your probe.` },
    ],
  };
}
