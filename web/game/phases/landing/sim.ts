// Powered descent physics, the part the player flies. Plain numbers, no React or three.js (so it can be run headless):
// the pilot's client steps it, the other crew receive a copy of the state ten times a second.
//
// World frame = the terrain frame (1 unit = 1 m, +Y up). Lunar gravity 1.62 m/s^2, vacuum (no drag).
// Controls act on three things:
//   throttle  0..1 of `aMax` m/s^2 along the lander's up axis (manual, or the hover assist holds a sink rate)
//   lean      the lander tilts toward forward/right by up to `maxLean`; the thrust tilts with it, so leaning = accelerating sideways
//   fuel      a delta-v budget (m/s); burning at throttle k costs k * aMax per second
// Touchdown is judged on what the player did (see evalTouchdown): sink rate, sideways speed, attitude against the real
// terrain normal under the footpads (vs the legs' tilt tolerance), boulders under a foot, and distance from the probe spot.
import type { Difficulty } from "../../types";

export const G = 1.62;
export const FT = 3.281;
const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lin = (v: number, good: number, bad: number) => clamp((bad - v) / (bad - good), 0, 1);

export interface Ground {
  h(x: number, z: number): number;
  /** boulders big enough to damage a foot (x, z, size in m) */
  boulders: { x: number; z: number; size: number }[];
  /** keep the lander over mapped terrain */
  half: number;
}

export interface LandParams {
  aMax: number;
  /** attitude response time constant (s) */
  tau: number;
  maxLean: number;
  /** sink rate (m/s) above which the legs are damaged / the lander is lost */
  vSafe: number;
  vCrash: number;
  /** leg tilt tolerance (deg) */
  limit: number;
  /** delta-v budget (m/s) */
  fuel0: number;
  /** hover assist available / on by default / autopilot available */
  hoverAvail: boolean;
  hoverDefault: boolean;
  autoAvail: boolean;
  /** the autopilot is part of easy mode; on normal and hard using it caps the score */
  autoFree: boolean;
  /** footpad ring radius (m) */
  padR: number;
}

/** Per-difficulty landing: wider tolerances and more fuel on easy, the real leg limit on normal, less luck on hard. */
export function landParams(d: Difficulty | undefined, o: { limitDeg: number; deltaV: number; fuelMult: number; padR: number }): LandParams {
  const k = { easy: 1.3, normal: 1, hard: 0.9 }[d ?? "normal"];
  const fuelK = { easy: 1.45, normal: 1, hard: 0.85 }[d ?? "normal"];
  return {
    aMax: 4.2,
    tau: { easy: 0.3, normal: 0.4, hard: 0.55 }[d ?? "normal"],
    maxLean: { easy: 38, normal: 34, hard: 30 }[d ?? "normal"] * D2R,
    vSafe: 2.2 * k, vCrash: 5 * k,
    limit: o.limitDeg * k,
    fuel0: 120 * (0.88 + 0.12 * (o.deltaV / 2900)) * fuelK * o.fuelMult,
    hoverAvail: d !== "hard",
    hoverDefault: d !== "hard",
    autoAvail: true,
    autoFree: d === "easy",
    padR: o.padR,
  };
}

export type Reason = "ok" | "hard" | "boulder" | "tipped" | "crashed";

export interface LandScore {
  total: number;
  stars: number;
  parts: { label: string; points: number; max: number; text: string }[];
  status: string;
}

export interface LandResult {
  reason: Reason;
  /** sink rate and sideways speed at touchdown (m/s) */
  vV: number;
  vH: number;
  /** angle between the lander's axis and the terrain normal under the feet (deg) */
  misalign: number;
  /** slope of the ground under the footpads (deg) */
  slope: number;
  /** what the tilt check used: the worse of the slope and (misalignment + sideways speed) (deg) */
  tilt: number;
  limit: number;
  miss: number;
  fuelPct: number;
  /** lander lean direction at touchdown, unit (x, z): the way it falls when it tips */
  tx: number;
  tz: number;
  score: LandScore;
}

export interface LandSim {
  /** attempt number (a retry starts a new one) */
  att: number;
  t: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** lean forward / right (rad), and the lean commanded by the arrow keys (ramps while a key is held, relaxes to level when released) */
  lf: number; lr: number; cf: number; cr: number;
  thr: number; thrCmd: number;
  fuel: number;
  /** hover assist: target vertical speed */
  vt: number;
  /** hover assist: commanded ground speed forward / right (m/s), set by the arrows; zero = hold position */
  vcF: number; vcR: number;
  hover: boolean;
  auto: boolean;
  /** heading the controls are relative to: unit (x, z) */
  fx: number; fz: number;
  /** radar altitude of the lowest footpad (m) */
  alt: number;
  /** a footpad is within a metre or so of the ground */
  contact: boolean;
  fuelOutAt: number; // -1 = not yet
  /** touchdown happened; result is set */
  down: boolean;
  tDown: number;
  result: LandResult | null;
  /** earlier attempts (a retry costs points on normal) */
  retries: number;
  /** the autopilot flew part of this landing on a difficulty that does not give it for free */
  assisted: boolean;
}

export function newLand(att: number, target: { x: number; z: number }, ground: Ground, P: LandParams, heading: number, retries = 0): LandSim {
  let fx = Math.cos(heading), fz = Math.sin(heading);
  let sx = target.x - fx * 260, sz = target.z - fz * 260;
  const lim = ground.half - 70;
  if (Math.abs(sx) > lim || Math.abs(sz) > lim) { // start on the other side if the map ends there
    fx = -fx; fz = -fz; sx = target.x - fx * 260; sz = target.z - fz * 260;
  }
  sx = clamp(sx, -lim, lim); sz = clamp(sz, -lim, lim);
  const y0 = Math.max(ground.h(sx, sz), ground.h(target.x, target.z)) + 300;
  return {
    att, t: 0, x: sx, y: y0, z: sz, vx: fx * 15, vy: -8, vz: fz * 15, lf: -0.2, lr: 0, cf: 0, cr: 0, thr: 0.4, thrCmd: 0.4, fuel: P.fuel0, vt: -8, vcF: 15, vcR: 0,
    hover: P.hoverDefault, auto: false, fx, fz, alt: 300, contact: false, fuelOutAt: -1, down: false, tDown: -1, result: null, retries, assisted: false,
  };
}

export interface LandInput {
  /** W / S: -1..1 (throttle, or the hover assist's sink-rate target) */
  thr: number;
  cut: boolean;
  full: boolean;
  /** up / down arrow (forward / back), right / left arrow */
  lf: number;
  lr: number;
}

/** Body axis (thrust direction) for the current lean. */
export function upVec(s: LandSim, out: [number, number, number] = [0, 1, 0]) {
  const m = Math.hypot(s.lf, s.lr);
  const k = m > 1e-6 ? Math.sin(m) / m : 1;
  const rx = -s.fz, rz = s.fx;
  out[0] = (s.fx * s.lf + rx * s.lr) * k;
  out[1] = Math.cos(m);
  out[2] = (s.fz * s.lf + rz * s.lr) * k;
  return out;
}

const tmpU: [number, number, number] = [0, 1, 0];
const PADS = [0, 1, 2, 3].map((k) => {
  const a = Math.PI / 4 + (k * Math.PI) / 2;
  return [Math.sin(a), Math.cos(a)] as const;
});

/** Body axes for the current attitude (the lander's local x, y = thrust axis, z = heading), 9 numbers: ex, ey, ez. */
export function bodyBasis(s: LandSim, up: [number, number, number], b: number[]) {
  const d = s.fx * up[0] + s.fz * up[2];
  let zx = s.fx - up[0] * d, zy = -up[1] * d, zz = s.fz - up[2] * d;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  b[0] = up[1] * zz - up[2] * zy; b[1] = up[2] * zx - up[0] * zz; b[2] = up[0] * zy - up[1] * zx;
  b[3] = up[0]; b[4] = up[1]; b[5] = up[2];
  b[6] = zx; b[7] = zy; b[8] = zz;
  return b;
}
const basis = new Array<number>(9).fill(0);

/** Footpad offsets from the lander origin in the world frame: out[k] = [dx, dy, dz]. */
function padOffsets(s: LandSim, R: number, up: [number, number, number], out: number[][]) {
  const b = bodyBasis(s, up, basis);
  for (let k = 0; k < 4; k++) {
    const lx = PADS[k][0] * R, lz = PADS[k][1] * R;
    out[k][0] = b[0] * lx + b[3] * 0.05 + b[6] * lz;
    out[k][1] = b[1] * lx + b[4] * 0.05 + b[7] * lz;
    out[k][2] = b[2] * lx + b[5] * 0.05 + b[8] * lz;
  }
}
const off = [0, 1, 2, 3].map(() => [0, 0, 0]);

/** Unit normal of the plane through the DEM under four footpads placed horizontally around (x, z). */
export function footPlane(ground: Ground, x: number, z: number, R: number) {
  const p = PADS.map(([sx, sz]) => [x + sx * R, ground.h(x + sx * R, z + sz * R), z + sz * R]);
  const t1 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const t2 = [p[3][0] - p[1][0], p[3][1] - p[1][1], p[3][2] - p[1][2]];
  let nx = t1[1] * t2[2] - t1[2] * t2[1], ny = t1[2] * t2[0] - t1[0] * t2[2], nz = t1[0] * t2[1] - t1[1] * t2[0];
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const m = Math.hypot(nx, ny, nz) || 1;
  return [nx / m, ny / m, nz / m] as const;
}

const sinkFloor = (alt: number) => -(0.7 + 0.18 * Math.max(0, alt)); // the assist never lets you sink faster than this

/** Easy-mode autopilot: where to lean and what sink rate to hold to land on the target. */
export function autopilot(s: LandSim, target: { x: number; z: number }) {
  const dx = target.x - s.x, dz = target.z - s.z;
  const dist = Math.hypot(dx, dz);
  const ux = dist > 1e-3 ? dx / dist : 0, uz = dist > 1e-3 ? dz / dist : 0;
  const low = s.alt < 7;
  const sp = low ? 0 : Math.min(15, 0.9 * Math.sqrt(2 * 1.0 * dist));
  let ax = clamp(0.9 * (ux * sp - s.vx), -1.4, 1.4);
  let az = clamp(0.9 * (uz * sp - s.vz), -1.4, 1.4);
  const am = Math.hypot(ax, az);
  const th = Math.atan2(am, G);
  if (am < 1e-6) { ax = 0; az = 0; }
  const dirx = am > 1e-6 ? ax / am : 0, dirz = am > 1e-6 ? az / am : 0;
  const lean = Math.min(th, 26 * D2R);
  const rx = -s.fz, rz = s.fx;
  // vertical: a gentle profile, slowed while the target is still far away
  const prof = -Math.min(22, 0.6 + Math.sqrt(2 * 1.0 * Math.max(0, s.alt)));
  const vh = Math.hypot(s.vx, s.vz);
  const tgo = dist / Math.max(3, vh);
  const allowed = -Math.max(0.8, (s.alt - 8) / (tgo + 2.5));
  return { lf: lean * (dirx * s.fx + dirz * s.fz), lr: lean * (dirx * rx + dirz * rz), vt: Math.max(prof, allowed) };
}

const H = 1 / 120;
const VC_MAX = 10; // m/s: top ground speed the arrows ask for under the hover assist

/** Hold a key and the commanded lean grows (46 deg/s); release and it relaxes back to level. */
function ramp(v: number, axis: number, max: number, h: number) {
  if (axis !== 0) return clamp(v + axis * 0.8 * h * (v * axis < 0 ? 2 : 1), -max, max);
  return v - Math.sign(v) * Math.min(Math.abs(v), 1.5 * h);
}

/** Advance by dt (fixed internal steps). Does nothing once touched down. */
export function stepLand(s: LandSim, dt: number, inp: LandInput, ground: Ground, P: LandParams, target: { x: number; z: number }) {
  let left = dt;
  while (left > 1e-9 && !s.down) {
    const h = Math.min(H, left);
    left -= h;
    sub(s, h, inp, ground, P, target);
  }
}

function sub(s: LandSim, h: number, inp: LandInput, ground: Ground, P: LandParams, target: { x: number; z: number }) {
  s.t += h;
  s.cf = ramp(s.cf, inp.lf, P.maxLean, h);
  s.cr = ramp(s.cr, inp.lr, P.maxLean, h);
  let cLf = s.cf, cLr = s.cr;
  const hovering = s.hover || s.auto;
  if (s.auto) {
    const c = autopilot(s, target);
    cLf = c.lf; cLr = c.lr; s.vt = c.vt;
  } else if (hovering) {
    s.vt = clamp(s.vt + inp.thr * 3.5 * h, -12, 3);
    // velocity control, like a translation hand controller: the arrows ask for a ground speed in that direction,
    // letting go asks for zero; the computer leans the lander to get there (no drift to catch by hand)
    const step = 6 * h;
    s.vcF += clamp(inp.lf * VC_MAX - s.vcF, -step, step);
    s.vcR += clamp(inp.lr * VC_MAX - s.vcR, -step, step);
    const rx = -s.fz, rz = s.fx;
    const vF = s.vx * s.fx + s.vz * s.fz, vR = s.vx * rx + s.vz * rz;
    const aF = clamp(1.1 * (s.vcF - vF), -2, 2), aR = clamp(1.1 * (s.vcR - vR), -2, 2);
    const am = Math.hypot(aF, aR);
    const lean = Math.min(Math.atan2(am, G), P.maxLean * 0.85);
    cLf = am > 1e-6 ? (lean * aF) / am : 0;
    cLr = am > 1e-6 ? (lean * aR) / am : 0;
    s.cf = cLf; s.cr = cLr; // hand back smoothly if the assist is switched off
  }
  // attitude: first-order response, rate limited
  s.lf += clamp((cLf - s.lf) / P.tau, -1.2, 1.2) * h;
  s.lr += clamp((cLr - s.lr) / P.tau, -1.2, 1.2) * h;
  const m0 = Math.hypot(s.lf, s.lr);
  if (m0 > P.maxLean * 1.05) { s.lf *= (P.maxLean * 1.05) / m0; s.lr *= (P.maxLean * 1.05) / m0; }
  const up = upVec(s, tmpU);
  // throttle
  if (hovering) {
    const vt = Math.max(s.vt, sinkFloor(s.alt));
    s.thrCmd = clamp((G + 2.0 * (vt - s.vy)) / (P.aMax * Math.max(0.5, up[1])), 0, 1);
    if (inp.cut) { s.hover = false; s.auto = false; s.thrCmd = 0; }
  } else {
    s.thrCmd = inp.cut ? 0 : clamp(s.thrCmd + (inp.thr + (inp.full ? 1.2 : 0)) * 0.9 * h, 0, 1);
  }
  if (s.fuel <= 0) s.thrCmd = 0;
  s.thr += (s.thrCmd - s.thr) * Math.min(1, h / 0.25);
  const a = s.thr * P.aMax;
  s.vx += a * up[0] * h;
  s.vy += (a * up[1] - G) * h;
  s.vz += a * up[2] * h;
  s.fuel = Math.max(0, s.fuel - a * h);
  if (s.fuel <= 0 && s.fuelOutAt < 0) s.fuelOutAt = s.t;
  s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
  // the map edge is a wall (nothing is rendered beyond it)
  const lim = ground.half - 30;
  if (Math.abs(s.x) > lim) { s.x = clamp(s.x, -lim, lim); s.vx = 0; }
  if (Math.abs(s.z) > lim) { s.z = clamp(s.z, -lim, lim); s.vz = 0; }

  // ground
  padOffsets(s, P.padR, up, off);
  let clear = 1e9;
  for (let k = 0; k < 4; k++) clear = Math.min(clear, s.y + off[k][1] - ground.h(s.x + off[k][0], s.z + off[k][2]));
  // deck and mast: the body hitting the ground is a crash
  const body = s.y + up[1] * 3.3 - ground.h(s.x + up[0] * 3.3, s.z + up[2] * 3.3);
  s.alt = Math.max(0, clear);
  s.contact = clear < 1.5;
  if (clear <= 0 || body <= 0) touchdown(s, ground, P, target, up, body <= 0 && clear > 0.3);
}

function touchdown(s: LandSim, ground: Ground, P: LandParams, target: { x: number; z: number }, up: [number, number, number], bodyStrike: boolean) {
  s.down = true;
  s.tDown = s.t;
  s.result = evalTouchdown(s, ground, P, target, up, bodyStrike);
  s.thrCmd = 0;
}

export function evalTouchdown(s: LandSim, ground: Ground, P: LandParams, target: { x: number; z: number }, up: [number, number, number], bodyStrike: boolean): LandResult {
  const vV = Math.max(0, -s.vy);
  const vH = Math.hypot(s.vx, s.vz);
  const n = footPlane(ground, s.x, s.z, P.padR);
  const slope = Math.acos(clamp(n[1], -1, 1)) / D2R;
  const misalign = Math.acos(clamp(up[0] * n[0] + up[1] * n[1] + up[2] * n[2], -1, 1)) / D2R;
  const leanDeg = Math.acos(clamp(up[1], -1, 1)) / D2R;
  const tilt = Math.max(slope, misalign + 3.5 * vH);
  const miss = Math.hypot(s.x - target.x, s.z - target.z);
  // boulders under a footpad
  padOffsets(s, P.padR, up, off);
  let boulder = false;
  for (const b of ground.boulders) {
    for (let k = 0; k < 4; k++) {
      if (Math.hypot(s.x + off[k][0] - b.x, s.z + off[k][2] - b.z) < b.size * 0.5 + 0.5) boulder = true;
    }
  }
  const reason: Reason =
    vV > P.vCrash || leanDeg > 50 || bodyStrike ? "crashed"
    : tilt > P.limit ? "tipped"
    : boulder ? "boulder"
    : vV > P.vSafe ? "hard"
    : "ok";
  const m = Math.hypot(s.lf, s.lr) || 1;
  const tx = (s.fx * s.lf + -s.fz * s.lr) / m, tz = (s.fz * s.lf + s.fx * s.lr) / m;
  const fuelPct = (100 * s.fuel) / P.fuel0;
  const r: LandResult = { reason, vV, vH, misalign, slope, tilt, limit: P.limit, miss, fuelPct, tx, tz, score: null as unknown as LandScore };
  r.score = scoreTouchdown(r, P);
  return r;
}

const STATUS: Record<Reason, string> = {
  ok: "Upright and stable. The crew is safe.",
  hard: "Down, but the legs took a hard hit. Systems are damaged.",
  boulder: "Down, but a foot landed on a boulder and a leg is damaged.",
  tipped: "The lander tipped over on the slope.",
  crashed: "The lander hit the surface too hard. Hull and legs lost.",
};

/** Transparent formula: sink rate 30, sideways speed 20, tilt 25, on target 15, fuel left 10; then capped by the outcome. */
export function scoreTouchdown(r: LandResult, P: LandParams): LandScore {
  const v = Math.round(30 * lin(r.vV, 1, P.vCrash));
  const hz = Math.round(20 * lin(r.vH, 0.5, 4));
  const tl = Math.round(25 * lin(r.tilt / Math.max(1, r.limit), 0.3, 1.1));
  const ac = Math.round(15 * lin(r.miss, 8, 120));
  const fu = Math.round(10 * clamp(r.fuelPct / 25, 0, 1));
  const cap = { ok: 100, hard: 70, boulder: 70, tipped: 35, crashed: 12 }[r.reason];
  const total = Math.max(0, Math.min(cap, v + hz + tl + ac + fu));
  const stars = r.reason === "crashed" ? 0 : total >= 85 ? 3 : total >= 60 ? 2 : total >= 30 ? 1 : 0;
  return {
    total, stars, status: STATUS[r.reason],
    parts: [
      { label: "Sink rate", points: v, max: 30, text: `${(r.vV * FT).toFixed(1)} ft/s at touchdown. Safe is under ${(P.vSafe * FT).toFixed(0)}.` },
      { label: "Sideways speed", points: hz, max: 20, text: `${(r.vH * FT).toFixed(1)} ft/s of drift.` },
      { label: "Tilt", points: tl, max: 25, text: `${r.tilt.toFixed(1)} degrees. Your legs allow ${r.limit.toFixed(0)}. The ground under the feet slopes ${r.slope.toFixed(1)}.` },
      { label: "On target", points: ac, max: 15, text: `${Math.round(r.miss)} m from your probe.` },
      { label: "Fuel left", points: fu, max: 10, text: `${Math.round(r.fuelPct)}% of the tank.` },
    ],
  };
}

/** Time left at the hover burn rate (what the crew calls out). */
export const fuelSeconds = (s: LandSim) => s.fuel / G;
