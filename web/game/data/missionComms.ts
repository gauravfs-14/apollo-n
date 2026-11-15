// Mission radio. Every line describes something that is happening in this game, right now:
// the player's results, numbers from the simulation, the crew's names, the chosen site.
// Lines are built from game state when the event happens (voiced on demand); only the launch
// count is fixed. Style follows real flight-loop phrasing (Houston CAPCOM, Launch Control,
// the crew), short and to the point. No ambient chatter.
import type { CommLine } from "../core/comms";
import type { HurdleType, Role, SurfaceTask } from "../types";

const lc = (text: string, maxDelay?: number): CommLine => ({ who: "pao", text, label: "Launch Control", maxDelay });
const count = (text: string): CommLine => ({ ...lc(text, 0.6), cut: true });
const cc = (text: string, maxDelay?: number): CommLine => ({ who: "capcom", text, maxDelay });
const cdr = (text: string, maxDelay?: number): CommLine => ({ who: "cdr", text, maxDelay });
const lmp = (text: string, maxDelay?: number): CommLine => ({ who: "lmp", text, maxDelay });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (x: number) => `${Math.round(x)} percent`;

export const SITE_BASES: Record<string, string> = {
  site_a: "Shackleton Base",
  site_b: "Ridge Base",
  site_c: "Gerlache Base",
};

// ---------------------------------------------------------------- checklist
export function checklistDone(r: { correct: number; total: number; mistakes: number }): CommLine[] {
  const verdict = r.mistakes === 0 ? "Clean run." : `${plural(r.mistakes, "correction")} on the way.`;
  return [lc(`Checklist complete. ${r.correct} of ${r.total} correct. ${verdict}`), lc("All stations are GO. We are on the automatic sequence.")];
}

// ---------------------------------------------------------------- launch (seconds on the launch clock)
export function launchCues(L: number): { t: number; lines: CommLine[] }[] {
  const n = (t: number, text: string) => ({ t: L - t, lines: [count(text)] });
  return [
    n(10, "T minus ten."),
    { t: L - 9.2, lines: [count("Nine. Ignition sequence start.")] },
    n(6, "Six."),
    n(5, "Five."),
    n(4, "Four."),
    n(3, "Three."),
    n(2, "Two."),
    n(1, "One."),
    { t: L - 0.3, lines: [count("Zero. All engines running.")] },
    { t: L + 1.2, lines: [lc("Liftoff. We have liftoff of Apollo {N}.", 1.5)] },
    { t: L + 6, lines: [lc("The tower is clear.", 2)] },
  ];
}

/** Calls for the staging and burn moments shown in the space part of the launch. */
export const LAUNCH_EVENTS = {
  staging: cdr("Staging. Second stage ignition.", 2),
  stage2: cc("Apollo {N}, Houston. Second stage is good. You are GO for translunar injection.", 3),
};

// ---------------------------------------------------------------- cruise hurdles
const HURDLE_GOOD: Record<HurdleType, string> = {
  debris_field: "You're clear of the debris field.",
  solar_storm: "The crew is safe behind the shielding.",
  engine_fault: "Fuel is flowing again. The engine is GO.",
  nav_correction: "Course correction is good. You're right on track.",
  comms_blackout: "We have you loud and clear again.",
};
const HURDLE_ROUGH: Record<HurdleType, string> = {
  debris_field: "You took some hits, but the hull is holding.",
  solar_storm: "Some of the crew took a dose. We'll keep an eye on it.",
  engine_fault: "The engine is running rough, but it will get you there.",
  nav_correction: "You're a little off course. We'll trim it on the next burn.",
  comms_blackout: "Signal is weak, but we can hear you.",
};

export function hurdleResult(type: HurdleType, score: number, name?: string): CommLine {
  const good = score >= 60;
  const who = name ? `${name}, ` : "";
  return cc(good ? `${who}nice work. ${HURDLE_GOOD[type]}` : `${who}copy. ${HURDLE_ROUGH[type]}`);
}

export function cruiseArrival(): CommLine {
  return cc("Apollo {N}, Houston. You're approaching the Moon. Pick us a landing site.");
}

// ---------------------------------------------------------------- landing site
export function probeReport(r: { score: number; slope_deg: number; sun_pct: number }): CommLine {
  return cc(`Probe is down. Slope ${Math.round(r.slope_deg)} degrees, sunlight ${pct(r.sun_pct)}. Site score ${Math.round(r.score)}.`);
}

export function simReport(safePct: number): CommLine[] {
  const safe = Math.round(safePct);
  if (safe >= 60) return [cc(`Three hundred test landings: ${pct(safe)} landed safely. That's a good spot. You are GO for descent.`)];
  if (safe >= 30) return [cc(`Three hundred test landings: ${pct(safe)} landed safely. It's marginal. A flatter spot would be safer.`)];
  return [cc(`Three hundred test landings: only ${pct(safe)} landed safely. Recommend you pick another spot.`)];
}

// ---------------------------------------------------------------- powered descent
export function descentStart(siteName: string): CommLine[] {
  return [cc(`{LM}, Houston. You are GO for powered descent to ${siteName}.`)];
}

export function goForLanding(): CommLine {
  return cc("{LM}, Houston. You're GO for landing.", 4);
}

/** Altitude call with the lander's real sink rate at that height. */
export function altitudeCall(feet: number, downFps: number, last = false): CommLine {
  const tail = last ? " Kicking up some dust." : "";
  return lmp(`${feet} feet, down at ${Math.round(downFps)}.${tail}`, 2);
}

export function contact(): CommLine[] {
  return [lmp("Contact light. Engine stop.")];
}

export function landed(reason: "ok" | "boulder" | "tipped", tiltDeg: number): CommLine[] {
  const tilt = `${Math.round(tiltDeg)} degrees`;
  if (reason === "ok")
    return [cdr(`Houston, {BASE} here. The {LM} has landed. Tilt ${tilt}, she's stable.`), cc("Roger, {BASE}. We copy you on the ground. Great flying.")];
  if (reason === "boulder") return [cdr(`Houston, we're down, but a leg hit a boulder. Tilt ${tilt}.`), cc("Copy. Stand by while we check the lander.")];
  return [cdr(`Houston, the lander is tipping over. Tilt ${tilt}.`), cc("Copy. Crew, secure yourselves and report status.")];
}

// ---------------------------------------------------------------- surface
export function egress(): CommLine[] {
  return [cdr("At the foot of the ladder."), cdr("Stepping off the {LM} now.")];
}

export function firstStep(): CommLine[] {
  return [cc("We see you on the surface, {BASE}. Your first objective is marked.")];
}

const TASK_DONE: Record<SurfaceTask["type"], string> = {
  navigate_to: "You've reached the marker.",
  deploy_relay: "Relay is up. We have signal.",
  scan: "That's the signal we were looking for. Ice confirmed.",
  collect_sample: "Sample sealed and stowed.",
  repair: "Repair complete. Telemetry is green.",
};

export function taskDone(task: SurfaceTask, next?: SurfaceTask): CommLine[] {
  return [cc(`${task.title}: done. ${TASK_DONE[task.type]}${next ? ` Next: ${next.title.toLowerCase()}.` : ""}`)];
}

export function goalAchieved(goal: string): CommLine[] {
  return [cc(`Mission goal achieved. ${goal.replace(/\.$/, "")}. Outstanding work, crew.`)];
}

// ---------------------------------------------------------------- report
export function missionSummary(total: number, rank: string): CommLine[] {
  return [cc(`Apollo {N}, Houston. Mission complete. Final score ${Math.round(total)}, rank ${rank}.`)];
}

// ---------------------------------------------------------------- flown launch (lines built from what the player did)
const kms = (v: number) => (v / 1000).toFixed(1);

/** Stage separation, said when it actually happens. `delay`: seconds after burnout. */
export function stagingDone(n: 1 | 2, delay: number): CommLine[] {
  const late = delay > 1.6;
  if (n === 1) return [cdr(late ? "Staging, a little late. Second stage ignition." : "Staging. Second stage ignition.", 2.5)];
  return [cdr(late ? "Second stage is away, a little late. S-IVB is ready." : "Staging. S-IVB is ready.", 2.5)];
}
/** Both variants, for preloading before the call is known. */
export const stagingVariants = (n: 1 | 2) => [stagingDone(n, 0.5)[0], stagingDone(n, 3)[0]];

export function tliGo(targetMs: number): CommLine {
  return cc(`Apollo {N}, Houston. You are GO for translunar injection. Burn to ${kms(targetMs)} kilometers per second.`, 4);
}
export const tliIgnition = (): CommLine => cdr("Ignition. Burn is on.", 1.5);

/** Cutoff report with the speed the player actually reached. */
export function tliCutoff(speedMs: number, dvErrMs: number, tolMs: number): CommLine[] {
  const e = Math.round(Math.abs(dvErrMs));
  const cut = cdr(`Cutoff. ${kms(speedMs)} kilometers per second.`, 2);
  if (Math.abs(dvErrMs) <= tolMs) return [cut, cc(`Roger, cutoff. That's a good burn, within ${e} meters per second. You are on your way to the Moon.`)];
  if (dvErrMs < 0) return [cut, cc(`Roger. You're short by ${e} meters per second. We'll trim it with a midcourse correction.`)];
  return [cut, cc(`Roger. You're long by ${e} meters per second. We'll trim it with a midcourse correction.`)];
}

/** Houston calls a pitch error that has actually persisted. */
export function guidanceCall(errDeg: number): CommLine {
  const n = Math.round(Math.abs(errDeg));
  return cc(`Apollo {N}, Houston. Pitch is ${n} degrees ${errDeg > 0 ? "over" : "under"} the guide. Bring it back.`, 3);
}

// ---------------------------------------------------------------- flown descent
export const fuelCall = (secs: 60 | 30): CommLine => lmp(secs === 60 ? "Sixty seconds of fuel." : "Thirty seconds.", 2.5);
export const fuelOut = (): CommLine => lmp("Fuel is out.", 2);
export const autopilotCall = (on: boolean): CommLine => cdr(on ? "Autopilot engaged." : "Autopilot off. Manual control.", 2);
export function driftCall(dir: "left" | "right" | "forward" | "back", fps: number): CommLine {
  return lmp(`Drifting ${dir}, ${Math.round(fps)} feet per second.`, 2.5);
}
export const contactLight = (): CommLine => lmp("Contact light.", 2);
export const engineStop = (): CommLine => lmp("Engine stop.", 2);

export interface TouchdownFacts {
  reason: "ok" | "hard" | "boulder" | "tipped" | "crashed";
  downFps: number;
  fwdFps: number;
  tiltDeg: number;
  missM: number;
}
/** The report after touchdown: every number is what the player's landing was. */
export function touchdownReport(r: TouchdownFacts): CommLine[] {
  const down = Math.round(r.downFps);
  const tilt = `${Math.round(r.tiltDeg)} degrees`;
  const miss = Math.round(r.missM);
  const where = miss <= 15 ? "right on the spot" : `${miss} meters from the probe`;
  if (r.reason === "ok")
    return [cdr(`Houston, {BASE} here. The {LM} has landed, ${where}. Down at ${down} feet per second, tilt ${tilt}.`), cc("Roger, {BASE}. We copy you on the ground. Great flying.")];
  if (r.reason === "hard")
    return [cdr(`Houston, we're down, but that was hard. ${down} feet per second. Checking the legs.`), cc("Copy. Stand by while we look at your telemetry.")];
  if (r.reason === "boulder") return [cdr(`Houston, we're down, but a foot is on a boulder. Tilt ${tilt}.`), cc("Copy. Stand by while we check the lander.")];
  if (r.reason === "tipped") return [cdr(`Houston, the lander is tipping over. Tilt ${tilt}.`), cc("Copy. Crew, secure yourselves and report status.")];
  return [cdr(`Houston, we hit hard. Impact at ${down} feet per second.`), cc("Copy. Crew, report status.")];
}

export type { Role };

/** Fixed lines (the launch), for prefetching. Everything else is built when it happens. */
export function allScriptLines(): CommLine[] {
  return [...launchCues(0).flatMap((c) => c.lines), ...Object.values(LAUNCH_EVENTS), ...contact(), ...egress(), goForLanding()];
}
