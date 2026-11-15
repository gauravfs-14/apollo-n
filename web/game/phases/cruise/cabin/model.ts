// Hurdle model for the in-cabin cruise. One *actor* client (the role holder, or the host) runs the logic; everyone else
// adopts the actor's snapshots (10 Hz stream + patch at step changes) and sends their help as events the actor applies.
// `d` is mutated in place (read every frame by the 3D stations, no React renders); `useHv` re-renders the HUD.
import { create } from "zustand";
import { COST, damage } from "../../../core/hp";
import type { PerkEffects } from "../../../data/perks";
import type { HurdleType } from "../../../types";
import { DEBRIS_SECONDS, rt } from "../rt";
import { mulberry } from "../flow";
import { CHECKS, type CheckItem } from "./layout";

export const cam = { mode: "walk" as "walk" | "sextant" | "fly", cutAt: 0 };
/** Sextant aiming (local; the actor copies it into d.p each tick). */
export const sx = { ax: 0, ay: 0 };

// ----------------------------------------------------------------------------------------------- state
export type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- per-hurdle payload
export const H = {
  idx: -1,
  type: null as HurdleType | null,
  stage: "brief" as "brief" | "play" | "done",
  d: {} as D,
  level: 0,
  seed: 1,
  fx: null as PerkEffects | null,
  actor: false,
  solo: false,
  /** crew in the cabin (connected humans) for crowd checks: player ids */
  humans: [] as string[],
  me: "",
  npcs: 0,
  checks: [] as string[],
  finish: (_score: number, _note: string) => {},
};
export const useHv = create<{ v: number }>(() => ({ v: 0 }));
export const bump = () => useHv.setState((s) => ({ v: s.v + 1 }));
const now = () => performance.now() / 1000;
/** Actor only: a mistake costs ship integrity and shows what went wrong. */
function hurt(d: D, amount: number, text: string) {
  d.cue = { text: `${text} (-${amount} integrity)`, n: (d.cue?.n ?? 0) + 1 };
  damage(amount, text);
  bump();
}

export const STEP_TEXT: Record<HurdleType, string[]> = {
  engine_fault: ["Acknowledge the master alarm", "Open the engine access panel", "Reroute the fuel valves", "Prime the pump"],
  solar_storm: ["Sound the radiation alert", "Fill the water shield", "Get the whole crew inside"],
  nav_correction: ["Acknowledge the alert", "Sight the first star", "Sight the second star", "Fire the trim burn"],
  comms_blackout: ["Acknowledge the alarm", "Align the antenna and lock the signal"],
  debris_field: ["Acknowledge the alarm", "Take the pilot's controls", "Fly through the debris"],
};

// ----------------------------------------------------------------------------------------------- init
export interface InitArgs {
  type: HurdleType;
  level: number;
  seed: number;
  fx: PerkEffects;
  solo: boolean;
}
export function initD(a: InitArgs): D {
  const r = mulberry(a.seed * 977 + 13);
  const base: D = { step: 0, t: 0, st: 0, _help: {} as Record<string, number>, prep: [0, 0, 0], need: 0, score: 0 };
  switch (a.type) {
    case "engine_fault": {
      const jam = [1, 3, 2, 4][Math.floor(r() * 4)];
      const valves = [0, 0, 0, 0, 0, 1];
      for (const i of [1, 2, 3, 4]) valves[i] = i !== jam && r() < 0.35 ? 1 : 0;
      if (a.fx.engineFaultTime > 1) valves[0] = 1; // spare parts: one valve already set
      return { ...base, lim: (a.level < 0.3 ? 125 : a.level < 0.6 ? 100 : 80) * a.fx.engineFaultTime, door: 0, valves, jam, wrong: 0, prime: 0, stuckAt: -9, iso: [0, 0], ok: false };
    }
    case "solar_storm":
      return { ...base, lim: (85 - a.level * 28) * a.fx.solarStormTime, wheelA: 0, wheelB: 0, shield: 0, inside: {} as Record<string, number>, npcIn: 0, alarmT: 0, zone: a.fx.solarStormTime > 1 ? 1.3 : 1 };
    case "nav_correction": {
      const T = [0, 1].map((k) => ({ az: (k ? -1 : 1) * (3.2 + r() * 2.2), el: (k ? 1 : -1) * (1.6 + r() * 2.4) }));
      return { ...base, lim: 150, T, p: { ax: 0, ay: 0 }, q: { x: 0, y: 0, vx: 0, vy: 0 }, hold: 0, tol: 0.62 - a.level * 0.2, drift: 0.28 + a.level * 0.3, marks: 0, burn: 0, burning: 0, burnTgt: 0.55 + r() * 0.3, burnTry: 0, imu: [0, 0, 0], err: 99, name: ["Canopus", "Sirius"][Math.floor(r() * 2)] };
    }
    case "comms_blackout":
      return { ...base, lim: 130, az: 22 + r() * 8, el: 70 - r() * 8, azT: 40 + r() * 35, elT: 30 + r() * 35, fr: 18, frT: 55, amp: [0, 0], sig: 0, lock: 0, sigma: (11 - a.level * 4) * a.fx.commsWindow, aligned: 0 };
    case "debris_field":
      return { ...base, lim: DEBRIS_SECONDS + 60, armed: [0, 0], breaches: [0, 0, 0, 0], bt: [0, 0, 0, 0], nb: 0, hits: 0, ft: 0, fx: 0, fy: 0, fin: 0 };
  }
}

// ----------------------------------------------------------------------------------------------- helpers
const held = (d: D, k: string) => now() - (d._help?.[k] ?? -9) < 0.45;
export const isHeld = held;
function assist(d: D, k: string) {
  d._help[k] = now();
}
function auto(d: D, k: string, after = 2.5) {
  // the computer / an AI crewmate covers a missing helper: solo straight away, multiplayer after a long wait
  const wait = H.solo ? after : 20;
  d._needAt ??= {};
  d._needAt[k] ??= now();
  if (now() - d._needAt[k] > wait) assist(d, k);
}
export function npcCovering(k: string) {
  const d = H.d;
  const wait = H.solo ? 2.5 : 20;
  return !!d._needAt?.[k] && now() - d._needAt[k] > wait * 0.4;
}
function nextStep(d: D, s: number) {
  d.step = s;
  d.st = d.t;
  bump();
}

export function engineFlow(d: D) {
  const v = d.valves as number[];
  const A = !!v[0];
  const B = A && !!v[1];
  const C = A && !!v[2];
  const E = (B && !!v[3]) || (C && !!v[4]);
  const leak = B && !!v[5];
  return { A, B, C, E, leak, ok: E && !leak };
}

// ----------------------------------------------------------------------------------------------- actions (actor applies these)
/** Apply an action. `by` is the player id that did it. */
export function applyAct(kind: string, p: Record<string, unknown>, by: string) {
  const d = H.d;
  const type = H.type;
  if (!type || H.stage !== "play") return;
  const num = (k: string) => Number(p[k] ?? 0);
  switch (kind) {
    case "alarm":
      if (d.step === 0) {
        if (type === "solar_storm") d.alarmT = d.t;
        nextStep(d, 1);
      }
      return;
    case "door":
      if (type === "engine_fault" && d.step === 1) {
        d.door = 1;
        nextStep(d, 2);
      }
      return;
    case "valve": {
      if (type !== "engine_fault" || d.step < 2) return;
      const i = num("i");
      if (i === d.jam) {
        d.stuckAt = d.t;
        d.wrong++;
        hurt(d, COST.major, `Valve V${i} is seized: forcing it cracked a fitting`);
      } else d.valves[i] = d.valves[i] ? 0 : 1;
      const f = engineFlow(d);
      d.ok = f.ok;
      if (f.leak && i === 5) {
        d.wrong++;
        hurt(d, COST.minor, "Vent open under pressure: fuel is venting");
      }
      bump();
      return;
    }
    case "iso":
      if (type === "engine_fault") {
        d.iso[num("i")] = 1;
        bump();
      }
      return;
    case "imu":
      d.imu[num("i")] = 1;
      bump();
      return;
    case "arm":
      d.armed[num("i")] = 1;
      bump();
      return;
    case "lever":
      assist(d, "lever");
      return;
    case "prime":
      d._primeAt = now();
      return;
    case "wheel": {
      if (type !== "solar_storm" || d.step < 1) return;
      const k = p.w === "B" ? "wheelB" : "wheelA";
      d[k] = Math.min(1, d[k] + num("dt") / 2.4);
      return;
    }
    case "inside":
      if (type === "solar_storm") d.inside[by] = p.v ? 1 : 0;
      return;
    case "sextant": {
      if (type !== "nav_correction" || (d.step !== 1 && d.step !== 2)) return;
      d.sighting = p.on ? 1 : 0;
      return;
    }
    case "attitude":
      assist(d, "att");
      return;
    case "burn":
      d._burnAt = now();
      return;
    case "dish":
      if (type === "comms_blackout" && d.step === 1) {
        const dt = num("dt");
        const ax = p.axis === "az" ? "az" : "el";
        const tgt = ax === "az" ? d.azT : d.elT;
        const wrong = (tgt - d[ax]) * num("dir") < -2;
        d[ax] = Math.max(0, Math.min(100, d[ax] + num("dir") * dt * 22));
        d._wrong = wrong ? (d._wrong ?? 0) + dt : Math.max(0, (d._wrong ?? 0) - dt);
        if (d._wrong > 1.6) {
          d._wrong = 0;
          hurt(d, COST.minor, "Antenna turned away from Earth: signal dropping");
        }
      }
      return;
    case "freq":
      if (type === "comms_blackout") {
        d.fr = Math.max(0, Math.min(100, d.fr + num("dir") * num("dt") * 26));
        assist(d, "freq");
      }
      return;
    case "amp":
      d.amp[num("i")] = 1;
      bump();
      return;
    case "fly":
      if (type === "debris_field" && d.step === 1) {
        rt.t = 0;
        rt.hits = 0;
        rt.x = rt.y = 0;
        rt.playing = true;
        nextStep(d, 2);
      }
      return;
    case "patch": {
      const i = num("i");
      if (type === "debris_field" && d.armed[0] && d.armed[1] && d.breaches[i]) {
        d.breaches[i] = 0;
        bump();
      }
      return;
    }
  }
}

// ----------------------------------------------------------------------------------------------- per-frame logic (actor only)
export function tick(dt: number) {
  const d = H.d;
  const type = H.type;
  if (!type || H.stage !== "play" || !H.actor) return;
  d.t += dt;
  const late = d.t > d.lim;
  const fin = (s: number, note: string) => {
    if (d.done) return;
    d.done = 1;
    d.score = Math.round(Math.max(0, Math.min(100, s)));
    H.finish(d.score, note);
  };
  switch (type) {
    case "engine_fault": {
      const f = engineFlow(d);
      d.ok = f.ok;
      if (d.step === 2) {
        // the isolation valves are the helper's prep job
        auto(d, "iso", 6);
        if (d._help.iso && !d.iso[1]) {
          d.iso = [1, 1];
          bump();
        }
        if (f.ok && d.iso[0] && d.iso[1]) nextStep(d, 3);
      }
      if (d.step === 3) {
        auto(d, "lever", 2.5);
        if (now() - (d._primeAt ?? -9) < 0.25 && held(d, "lever")) d.prime = Math.min(1, d.prime + dt / 3);
        else d.prime = Math.max(0, d.prime - dt * 0.5);
        if (d.prime >= 1) fin(100 - d.wrong * 8 - Math.min(1, d.t / d.lim) * 30, d.wrong ? `Fixed, after ${d.wrong} wrong turn${d.wrong > 1 ? "s" : ""}.` : "Fixed first time, no wasted turns.");
      }
      if (late && !d.done) {
        hurt(d, COST.severe, "Out of time, the engine fault was never fixed");
        fin(30, "Out of time. The engine limps along on one line.");
      }
      break;
    }
    case "solar_storm": {
      if (d.step === 0) return;
      d.zone = d.zone ?? 1;
      // the other crew in the cabin: the computer moves the AI crewmates to the shelter on the alert
      if (H.solo || H.npcs) d.npcIn = Math.min(1, Math.max(0, (d.t - d.alarmT - 2) / 9));
      if (d.step === 1) {
        auto(d, "wheelB", 4);
        if (held(d, "wheelB") && d._needAt?.wheelB && now() - d._needAt.wheelB > (H.solo ? 3.5 : 20)) d.wheelB = Math.min(1, d.wheelB + dt / 3.2);
        if (d.wheelA >= 1 && d.wheelB >= 1) {
          d.shield = 1;
          nextStep(d, 2);
        }
      }
      const humansIn = H.humans.filter((id) => d.inside[id]).length;
      const total = H.humans.length + (H.solo ? Math.max(0, H.npcs) : 0);
      const inCount = humansIn + (H.solo ? Math.round(d.npcIn * H.npcs) : 0);
      d.inCount = inCount;
      d.total = total;
      if (d.step === 2 && inCount >= total) {
        d.allT = (d.allT ?? 0) + dt;
        if (d.allT > 1.2) {
          const left = Math.max(0, d.lim - (d.t - d.alarmT));
          fin(55 + (left / d.lim) * 45, "Everyone is behind the water shield.");
        }
      } else d.allT = 0;
      if (d.step >= 1 && d.t - d.alarmT > d.lim && !d.done) {
        const out = total - inCount;
        if (out > 0) hurt(d, COST.major * out, `${out} crew member${out > 1 ? "s" : ""} left outside the shield when the storm hit`);
        else hurt(d, COST.minor, "The shield was late");
        fin(15 + 35 * (total ? inCount / total : 0), `${inCount} of ${total} crew made it inside in time.`);
      }
      break;
    }
    case "nav_correction": {
      if (d.step === 1 || d.step === 2) {
        const k = d.step - 1;
        const T = d.T[k];
        const holdingAtt = held(d, "att");
        if (H.solo || d.step >= 1) auto(d, "att", 3);
        const q = d.q;
        const rate = d.drift * (held(d, "att") || holdingAtt ? 0.12 : 1);
        q.vx += (Math.random() - 0.5) * rate * dt * 3.4;
        q.vy += (Math.random() - 0.5) * rate * dt * 3.4;
        q.vx = Math.max(-rate, Math.min(rate, q.vx));
        q.vy = Math.max(-rate, Math.min(rate, q.vy));
        q.x = Math.max(-4, Math.min(4, q.x + q.vx * dt));
        q.y = Math.max(-4, Math.min(4, q.y + q.vy * dt));
        const ex = T.az + q.x - d.p.ax;
        const ey = T.el + q.y - d.p.ay;
        d.err = Math.hypot(ex, ey);
        d.ex = ex;
        d.ey = ey;
        const tol = d.tol * (late ? 2.2 : 1);
        if (d.sighting && d.err < tol) d.hold += dt / 2.2;
        else d.hold = Math.max(0, d.hold - dt * 0.8);
        if (late && !d._lateHurt) {
          d._lateHurt = 1;
          hurt(d, COST.minor, "Sextant sights took too long, the platform drifted");
        }
        if (d.hold >= 1) {
          d.hold = 0;
          d.sighting = 0;
          d.marks++;
          if (d.step === 2) {
            nextStep(d, 3);
          } else nextStep(d, 2);
        }
      }
      if (d.step >= 1 && d.step <= 2) {
        auto(d, "imu", 5);
        if (d._help.imu && !(d.imu[0] && d.imu[1] && d.imu[2])) {
          d.imu = [1, 1, 1];
          bump();
        }
      }
      if (d.step === 3) {
        // fire the trim burn: hold, release inside the band
        if (d.burn < 1 && !d._cool) d.burning = now() - (d._burnAt ?? -9) < 0.25 ? 1 : 0;
        if (d.burning) {
          d.burn = Math.min(1, d.burn + dt * 0.3);
          if (d.burn >= 1) {
            d.burning = 0;
            d.burnTry++;
            d._cool = 1.5;
            hurt(d, COST.major, "Burn overshot the target: wasted propellant");
          }
        } else if (d.burn > 0) {
          if (d._cool > 0) {
            d._cool -= dt;
            if (d._cool <= 0) {
              d.burn = 0;
              d._cool = 0;
            }
          } else {
            if (Math.abs(d.burn - d.burnTgt) <= 0.09) {
              fin(100 - (d.burnTry + Math.max(0, d.marks - 2)) * 8 - Math.min(1, d.t / 220) * 22, d.burnTry ? `Burn on target after ${d.burnTry + 1} tries.` : "Sights and trim burn on target.");
            } else {
              d.burnTry++;
              d._cool = 1.2;
              hurt(d, COST.minor, d.burn < d.burnTgt ? "Burn cut early: off the planned trajectory" : "Burn ran long: off the planned trajectory");
            }
          }
        }
      }
      break;
    }
    case "comms_blackout": {
      if (d.step === 1) {
        const ampOn = d.amp[0] && d.amp[1];
        if (!ampOn && d.t - d.st > 8) auto(d, "amp", 3);
        if (d._help.amp && !ampOn && H.solo) d.amp = [1, 1];
        // the carrier drifts slowly: the receiver needs re-tuning now and then
        d.frT = 55 + Math.sin(d.t * 0.25) * 14;
        if (H.solo || (d._needAt?.freq && now() - d._needAt.freq > 20)) {
          // AI tunes with a lag
          auto(d, "freq", 3);
          if (held(d, "freq")) d.fr += (d.frT - d.fr) * Math.min(1, dt * 1.6);
        } else if (!H.solo) {
          d._needAt ??= {};
          d._needAt.freq ??= now();
        }
        const e = (v: number, t: number, s: number) => Math.exp(-((v - t) ** 2) / (2 * s * s));
        const al = e(d.az, d.azT, d.sigma) * e(d.el, d.elT, d.sigma);
        d.aligned = al;
        d.sig = al * e(d.fr, d.frT, d.sigma * 1.5) * (ampOn ? 1 : 0.2);
        if (d.sig > 0.8) d.lock = Math.min(1, d.lock + dt / 3);
        else d.lock = Math.max(0, d.lock - dt * 0.6);
        if (d.lock >= 1) fin(100 - Math.min(1, Math.max(0, d.t - d.st - 20) / 90) * 45, "Link locked with Houston.");
      }
      if (late && !d.done) {
        hurt(d, COST.severe, "Link never restored");
        fin(35, "Weak link only. Houston can hear you, barely.");
      }
      break;
    }
    case "debris_field": {
      if (d.step === 2) {
        d.ft = rt.t;
        d.fx = rt.x;
        d.fy = rt.y;
        d.hits = rt.hits;
        while (d.nb < rt.hits) {
          hurt(d, COST.major, "Debris struck the hull");
          const i = d.nb % 4;
          d.breaches[i] = 1;
          d.bt[i] = d.t;
          d.nb++;
        }
        // an AI crewmate (or the computer) patches a breach a few seconds after it opens
        for (let i = 0; i < 4; i++) if (d.breaches[i] && d.armed[0] && d.armed[1] && H.solo && d.t - d.bt[i] > 4) d.breaches[i] = 0;
        if (!(d.armed[0] && d.armed[1])) auto(d, "arm", 3);
        if (rt.t >= DEBRIS_SECONDS) {
          rt.playing = false;
          const open = (d.breaches as number[]).filter(Boolean).length;
          if (open) hurt(d, COST.minor * open, `${open} hull breach${open > 1 ? "es" : ""} left unpatched`);
          fin(Math.max(20, 100 - d.hits * 18 - open * 8), d.hits === 0 ? "Clean flight, not a scratch." : `${d.hits} hit${d.hits > 1 ? "s" : ""} on the hull${open ? `, ${open} breach${open > 1 ? "es" : ""} left open` : ", all patched"}.`);
        }
      }
      if (d.step === 0 || d.step === 1) {
        if (!(d.armed[0] && d.armed[1]) && d.t > 6) auto(d, "arm", 3);
        if (d._help.arm && !(d.armed[0] && d.armed[1])) {
          d.armed = [1, 1];
          bump();
        }
        if (late && !d.done) {
          hurt(d, COST.severe, "Never took the controls");
          fin(30, "Never took the controls.");
        }
      }
      break;
    }
  }
}

/** The keys the actor streams (no actor-local `_` fields). */
export function snapshot(): D {
  const out: D = {};
  for (const k of Object.keys(H.d)) if (k[0] !== "_") out[k] = H.d[k];
  out._held = { lever: held(H.d, "lever"), att: held(H.d, "att"), freq: held(H.d, "freq"), wheelB: held(H.d, "wheelB") };
  return out;
}
export function adopt(snap: D) {
  const d = H.d;
  const mine = { _help: d._help, _needAt: d._needAt };
  const stepChanged = snap.step !== d.step;
  Object.assign(d, snap, mine);
  if (stepChanged) bump();
}

// ----------------------------------------------------------------------------------------------- checks (routine jobs between hurdles)
export function checksFor(idx: number): CheckItem[] {
  return [0, 1, 2].map((k) => CHECKS[(idx * 3 + k * 2 + (idx % 2)) % CHECKS.length]);
}
export function checkItemsLeft(idx: number) {
  return checksFor(idx).filter((c) => !H.checks.includes(`${idx}:${c.id}`));
}
export function resetH(idx: number, type: HurdleType | null) {
  H.idx = idx;
  H.type = type;
  H.d = {};
  H.checks = [];
  cam.mode = "walk";
  sx.ax = sx.ay = 0;
}
