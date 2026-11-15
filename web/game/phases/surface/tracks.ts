// The surface mission: one task track per role, all open at once, plus where everything stands in the world.
// Positions are deterministic from the plan seed so every player sees the same layout.
import type { MissionPlan, Role } from "../../types";
import { EARTH_AZ, hashStr, mulberry32, PLAY_RADIUS, SUN_AZ, type Ground } from "./ground";

export type TaskKind = "scan" | "drill" | "stow" | "relay" | "panel" | "cable" | "gear" | "stakes" | "rim" | "lrrr" | "crate" | "flag";

export interface TaskDef {
  id: string;
  role: Role;
  kind: TaskKind;
  title: string;
  hint: string;
  coop?: boolean; // faster with a partner, still possible alone
  anyone?: boolean; // any player may do it (the scientist's sample is carried by whoever is free)
  final?: boolean;
}

export const TASKS: TaskDef[] = [
  { id: "ice", role: "scientist", kind: "scan", title: "Find where the ice is hiding", hint: "Water ice only survives where the Sun never reaches. Trust the scanner." },
  { id: "core", role: "scientist", kind: "drill", title: "Collect a sample of untouched soil", hint: "The soil near the lander is churned up by the engine. Dig where it is level and far from the dust." },
  { id: "stow", role: "scientist", kind: "stow", title: "Bring the sample back and seal it in the rack", hint: "Keep the container upright: no jumping with it. Anyone can carry it.", anyone: true },
  { id: "relay", role: "engineer", kind: "relay", title: "Get a radio link to Earth working", hint: "Radio needs a clear line of sight. Earth sits low on the horizon.", },
  { id: "panel", role: "engineer", kind: "panel", title: "Restore power: the solar panel is out of alignment", hint: "Turn it until it matches its outline." },
  { id: "cable", role: "engineer", kind: "cable", title: "Connect the lander to its battery pack", hint: "One person holds the cable steady while another connects it. Alone you must use the slow clamp.", coop: true },
  { id: "gear", role: "pilot", kind: "gear", title: "Check the lander's four footpads", hint: "Hard landings crack footpads. Look at each one." },
  { id: "stakes", role: "pilot", kind: "stakes", title: "Mark a safe rover route with three stakes", hint: "Level ground, spaced out, leading away from the crater." },
  { id: "rim", role: "pilot", kind: "rim", title: "Photograph the permanently shadowed crater", hint: "Frame the whole bowl from outside its rim." },
  { id: "lrrr", role: "commander", kind: "lrrr", title: "Give Earth's observatories a laser target", hint: "The reflector must sit level, with Earth in view, away from the lander." },
  { id: "crate", role: "commander", kind: "crate", title: "Set up the seismometer station on quiet ground", hint: "Heavy: lift it with a partner (faster) or alone (slow). It needs level ground far from the lander's noise.", coop: true },
  { id: "flag", role: "commander", kind: "flag", title: "Plant the flag and gather the crew for the team photo", hint: "Unlocks when every other task is done. Pick level ground close to the lander.", coop: true, final: true },
];
/** A sensible order for one player doing every role (also each role's own order). */
export const ORDER = ["gear", "panel", "cable", "relay", "lrrr", "crate", "stakes", "rim", "ice", "core", "stow", "flag"];
export const TASK_BY_ID: Record<string, TaskDef> = Object.fromEntries(TASKS.map((t) => [t.id, t]));
export const ROLE_ORDER: Role[] = ["commander", "pilot", "engineer", "scientist"];

export interface Spot {
  x: number;
  z: number;
}
export interface Layout {
  rack: Spot;
  relayPick: Spot;
  relayBest: Spot;
  panel: Spot;
  cableA: Spot;
  cableB: Spot;
  pads: Spot[];
  stakes: Spot[];
  rim: Spot;
  lrrr: Spot;
  crateStart: Spot;
  crateTarget: Spot;
  core: Spot;
  scan: { main: Spot; area: Spot };
  flag: Spot;
  sunPost: Spot;
  earthPost: Spot;
  psr: Spot;
  regolith: Spot;
  boulder: Spot & { dir: number; len: number };
  smallCrater: Spot & { r: number };
}

const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

export function layoutSurface(plan: MissionPlan, ground: Ground): Layout {
  const rnd = mulberry32((plan.seed ^ hashStr("surface-layout")) >>> 0);
  const c = ground.crater;
  const dl = Math.hypot(c.x, c.z);
  const toLander = { x: -c.x / dl, z: -c.z / dl };
  const used: Spot[] = [];
  const keep = <T extends Spot>(s: T, ...more: Spot[]) => {
    used.push(s, ...more);
    return s;
  };

  interface Find {
    az: number;
    azW: number;
    r0: number;
    r1: number;
    gap?: number;
    flat?: number;
    ok?: (s: Spot) => boolean;
  }
  /** First flat, open spot in an annulus sector (best of the tries when none is flat enough). */
  const find = ({ az, azW, r0, r1, gap = 12, flat = 0.955, ok }: Find): Spot => {
    let best: Spot | null = null;
    let bestN = -1;
    // widen the search window when nothing flat and open turns up
    for (let wide = 0; wide < 4; wide++) {
      const w = wide === 3 ? Math.PI * 2 : azW * (1 + wide * 1.5);
      const lo = Math.max(10, r0 * (1 - wide * 0.15));
      const hi = Math.min(PLAY_RADIUS - 14, r1 * (1 + wide * 0.2));
      for (let i = 0; i < 90; i++) {
        const a = az + (rnd() - 0.5) * w;
        const r = lo + rnd() * (hi - lo);
        const s = { x: Math.sin(a) * r, z: Math.cos(a) * r };
        if (Math.hypot(s.x - c.x, s.z - c.z) < c.r * 1.3) continue;
        if (used.some((u) => dist(u, s) < gap) || (ok && !ok(s))) continue;
        const n = ground.normalAt(s.x, s.z).y;
        if (n >= flat) return s;
        if (n > bestN) {
          bestN = n;
          best = s;
        }
      }
    }
    return best ?? { x: Math.sin(az) * (r0 + r1) * 0.5, z: Math.cos(az) * (r0 + r1) * 0.5 };
  };

  const rack = keep({ x: -1.8, z: 9.0 });
  const relayPick = keep({ x: 4.8, z: 6.5 });
  const panel = keep({ x: -6.8, z: 4.2 });
  const cableA = keep({ x: 7.2, z: -2.6 });
  const cableB = keep({ x: 14.0, z: -6.0 });
  const pads = [0, 1, 2, 3].map((k) => keep({ x: Math.sin((k * Math.PI) / 2) * 5.4, z: Math.cos((k * Math.PI) / 2) * 5.4 }));
  const crateStart = keep({ x: -8.6, z: 10.4 });
  const flag = keep(find({ az: SUN_AZ + 0.25, azW: 1.2, r0: 14, r1: 30, gap: 6, flat: 0.975 }));
  const sunPost = keep(find({ az: SUN_AZ + 1.15, azW: 0.3, r0: 12, r1: 14, gap: 5 }));
  const earthPost = keep(find({ az: EARTH_AZ - 0.95, azW: 0.3, r0: 12, r1: 14, gap: 5 }));

  // radio relay: the open ground with the best view of Earth (the answer the hint ring points at)
  let relayBest: Spot = { x: Math.sin(EARTH_AZ) * 40, z: Math.cos(EARTH_AZ) * 40 };
  let bestScore = -1e9;
  for (let i = 0; i < 260; i++) {
    const a = EARTH_AZ + (rnd() - 0.5) * 3.2;
    const r = 20 + rnd() * 95;
    const s = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    if (Math.hypot(s.x - c.x, s.z - c.z) < c.r * 1.1 || ground.normalAt(s.x, s.z).y < 0.9) continue;
    const m = Math.min(ground.earthMargin(s.x, s.z, 60), 8);
    const score = m * 3 - r * 0.03 + (m >= 3 ? 40 : 0);
    if (score > bestScore) {
      bestScore = score;
      relayBest = s;
    }
  }
  keep(relayBest);

  const lrrr = keep(find({ az: EARTH_AZ + (rnd() - 0.5) * 0.7, azW: 1.4, r0: 24, r1: 45, gap: 14, flat: 0.978, ok: (s) => ground.earthMargin(s.x, s.z, 60) > 1.6 }));
  const crateTarget = keep(find({ az: EARTH_AZ + 2.4, azW: 1.2, r0: 44, r1: 58, gap: 14, flat: 0.965 }));

  // pilot's route: three stakes going out and around, away from the crater
  const away = Math.atan2(-toLander.x, -toLander.z);
  const stakes = [
    keep(find({ az: away - 0.4, azW: 0.3, r0: 46, r1: 56, gap: 20, flat: 0.96 })),
    keep(find({ az: away + 0.1, azW: 0.3, r0: 66, r1: 78, gap: 20, flat: 0.96 })),
    keep(find({ az: away + 0.6, azW: 0.3, r0: 88, r1: 100, gap: 20, flat: 0.96 })),
  ];
  const core = keep(find({ az: away + 1.5 * (rnd() > 0.5 ? 1 : -1), azW: 0.9, r0: 62, r1: 96, gap: 18, flat: 0.96 }));

  // scientist: the ice signal inside the shadowed crater
  const sa = rnd() * Math.PI * 2;
  const sr = c.r * (0.16 + rnd() * 0.3);
  const scan = { main: { x: c.x + Math.sin(sa) * sr, z: c.z + Math.cos(sa) * sr }, area: { x: c.x, z: c.z } };

  // pilot: viewpoint on the crater's near rim, and the rim marker for the field notes
  const rot = (v: Spot, a: number) => ({ x: v.x * Math.cos(a) - v.z * Math.sin(a), z: v.x * Math.sin(a) + v.z * Math.cos(a) });
  const rv = rot(toLander, 0.12);
  const rim = keep({ x: c.x + rv.x * c.r * 1.22, z: c.z + rv.z * c.r * 1.22 });
  const pv = rot(toLander, -0.55);
  const psr = keep({ x: c.x + pv.x * c.r * 1.2, z: c.z + pv.z * c.r * 1.2 });

  // a sloped patch for the boulder that rolled down it
  let boulder = { x: 40, z: -30, dir: 0, len: 12 };
  let bestSlope = -1;
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 28 + rnd() * 44;
    const s = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    if (Math.hypot(s.x - c.x, s.z - c.z) < c.r * 1.3 || used.some((u) => dist(u, s) < 12)) continue;
    const n = ground.normalAt(s.x, s.z);
    const slope = 1 - n.y;
    if (slope > 0.015 && slope < 0.09 && slope > bestSlope) {
      bestSlope = slope;
      boulder = { x: s.x, z: s.z, dir: Math.atan2(n.x, n.z), len: 11 + rnd() * 6 };
    }
  }
  keep(boulder);

  // a small crater: the deepest bowl in a ring of candidates (depth = ring mean minus centre)
  let smallCrater = { x: -30, z: -30, r: 5 };
  let bestDepth = 0.15;
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 24 + rnd() * 50;
    const s = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    if (Math.hypot(s.x - c.x, s.z - c.z) < c.r * 1.3 || used.some((u) => dist(u, s) < 9)) continue;
    const h0 = ground.heightAt(s.x, s.z);
    for (const rr of [4, 6, 9]) {
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += ground.heightAt(s.x + Math.cos((k * Math.PI) / 4) * rr, s.z + Math.sin((k * Math.PI) / 4) * rr);
      const depth = sum / 8 - h0;
      if (depth > bestDepth) {
        bestDepth = depth;
        smallCrater = { x: s.x, z: s.z, r: rr };
      }
    }
  }
  keep(smallCrater);
  const regolith = { x: core.x + 4 * Math.sin(away), z: core.z + 4 * Math.cos(away) };

  return { rack, relayPick, relayBest, panel, cableA, cableB, pads, stakes, rim, lrrr, crateStart, crateTarget, core, scan, flag, sunPost, earthPost, psr, regolith, boulder, smallCrater };
}

export const barsFromMargin = (m: number) => (m < 0 ? 0 : m < 0.6 ? 1 : m < 1.6 ? 2 : m < 2.6 ? 3 : 4);

/** Score 0-100: tasks 54, no hints used 8 (each tier bought costs 1/24 of it), field notes 14, teamwork 8, speed 10, final 6, minus 2 per mistake. */
export function surfaceScore(a: { hintTiers: number; done: number; total: number; poi: number; poiTotal: number; coop: number; coopTotal: number; elapsed: number; mistakes: number; finished: boolean }) {
  const s =
    54 * (a.done / Math.max(1, a.total)) +
    8 * (1 - Math.min(1, a.hintTiers / Math.max(1, a.total * 2))) +
    14 * (a.poi / Math.max(1, a.poiTotal)) +
    8 * (a.coop / Math.max(1, a.coopTotal)) +
    10 * Math.max(0, 1 - a.elapsed / 600) +
    (a.finished ? 6 : 0) -
    2 * a.mistakes;
  return Math.max(0, Math.min(100, Math.round(s)));
}

const layouts = new WeakMap<Ground, Layout>();
/** One layout per ground (Tasks and Pois share it). */
export function getLayout(plan: MissionPlan, ground: Ground): Layout {
  let l = layouts.get(ground);
  if (!l) layouts.set(ground, (l = layoutSurface(plan, ground)));
  return l;
}

/** Hint tiers per task (bought with supply points; each unlocks the next): a nudge, a clear lead, the exact answer. */
export const HINT_TEXT: Record<string, [string, string, string]> = {
  ice: ["Cold traps are in the shadowed crater. Head for the dark bowl.", "The scanner works best inside a region of the crater floor. It is marked on the radar and the ground.", "The ice is at the marked spot."],
  core: ["Walk at least 50 m out, away from the crater, to level ground.", "A region of level, undisturbed ground is marked on the radar and the ground.", "Drill at the marked spot."],
  stow: ["The rack stands by the lander, at the end of the cable run.", "The rack area is ringed on the ground.", "The rack is marked. The sample, if dropped, is marked too."],
  relay: ["The relay package is by the lander. Open ground faces Earth, low on the horizon.", "A region with a clear view of Earth is marked on the radar and the ground.", "Set the relay down at the marked spot for full signal."],
  panel: ["The panel stands on a post near the lander, on the side away from the ladder.", "The panel area is ringed on the ground.", "The panel is marked."],
  cable: ["The power port is a small box on the lander's far side; the battery pack is 8 m past it.", "The port area is ringed on the ground.", "The power port is marked. Another player can hold the post for you."],
  gear: ["The footpads are under the lander's four legs.", "Rings show where each footpad is.", "Each remaining footpad is marked."],
  stakes: ["Spread them out: at least 18 m apart, on level ground, away from the crater.", "Three regions on level ground are marked on the radar and the ground.", "Plant the stakes at the marked spots."],
  rim: ["The crater is the large dark bowl. Stay on its outside rim and face it.", "A region on the near rim is marked on the radar and the ground.", "Photograph from the marked spot."],
  lrrr: ["Go 20 to 40 m out toward Earth, onto flat ground.", "A region of flat ground with a view of Earth is marked on the radar and the ground.", "Set the reflector at the marked spot."],
  crate: ["Carry it at least 40 m from the lander, onto level ground.", "A quiet, level region is marked on the radar and the ground.", "Set the station down at the marked spot."],
  flag: ["Level ground close to the lander, where the crew can stand together.", "A region close to the lander is marked on the radar and the ground.", "Plant the flag at the marked spot."],
};
