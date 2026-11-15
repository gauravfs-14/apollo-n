// Mission radio. Every line describes something that is happening in this game, right now:
// the player's results, numbers from the simulation, the crew's names, the chosen site.
//
// Lines vary: each event has several phrasings, picked by the mission's seed (so every mission
// sounds different, and the same event keeps its voice within a mission), in the tone of the
// mission's difficulty: easy is warm and explains, normal is crisp flight-loop talk, hard is
// clipped and urgent. The launch count is a fixed procedure and does not vary.
import { getCommStyle, type CommLine, type Tone } from "../core/comms";
import type { HurdleType, Role, SurfaceTask } from "../types";

const lc = (text: string, maxDelay?: number): CommLine => ({ who: "pao", text, label: "Launch Control", maxDelay });
const count = (text: string): CommLine => ({ ...lc(text, 0.6), cut: true });
const cc = (text: string, maxDelay?: number): CommLine => ({ who: "capcom", text, maxDelay });
const cdr = (text: string, maxDelay?: number): CommLine => ({ who: "cdr", text, maxDelay });
const lmp = (text: string, maxDelay?: number): CommLine => ({ who: "lmp", text, maxDelay });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (x: number) => `${Math.round(x)} percent`;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One of `options`, fixed for this mission and event key. */
function pick<T>(key: string, options: T[]): T {
  return options[hash(`${getCommStyle().seed}:${key}`) % options.length];
}

type Toned<T> = Partial<Record<Tone, T[]>> & { normal: T[] };
/** A phrasing in the mission's tone (falls back to normal). */
function say<T>(key: string, v: Toned<T>): T {
  const tone = getCommStyle().tone;
  return pick(key, v[tone] ?? v.normal);
}

export const SITE_BASES: Record<string, string> = {
  site_a: "Shackleton Base",
  site_b: "Ridge Base",
  site_c: "Gerlache Base",
};

// ---------------------------------------------------------------- checklist
export function checklistDone(r: { correct: number; total: number; mistakes: number }): CommLine[] {
  const clean = r.mistakes === 0;
  const result = say("checklist.result", {
    easy: [
      clean ? `Checklist complete, ${r.correct} of ${r.total}, and not a single slip. Nicely done.` : `Checklist complete. ${r.correct} of ${r.total}, with ${plural(r.mistakes, "correction")} along the way. That's what checklists are for.`,
      clean ? `That's every item, ${r.correct} of ${r.total}, clean. You made that look easy.` : `All ${r.total} items closed out. ${plural(r.mistakes, "slip")}, caught in time. Good catch.`,
    ],
    normal: [
      clean ? `Checklist complete. ${r.correct} of ${r.total}, clean.` : `Checklist complete. ${r.correct} of ${r.total}, ${plural(r.mistakes, "correction")}.`,
      clean ? `All ${r.total} items closed out. No discrepancies.` : `${r.correct} of ${r.total} items closed. ${plural(r.mistakes, "discrepancy", "discrepancies")} logged.`,
      clean ? `Final checklist is complete, ${r.total} for ${r.total}.` : `Final checklist is complete. We logged ${plural(r.mistakes, "correction")}.`,
    ],
    hard: [
      clean ? `Checklist, ${r.total} for ${r.total}. Clean.` : `Checklist closed. ${plural(r.mistakes, "error")}. Noted.`,
      clean ? `Checklist complete. No errors.` : `${plural(r.mistakes, "error")} on the checklist. Logged against the flight.`,
    ],
  });
  const go = say("checklist.go", {
    easy: ["All stations are GO. We're on the automatic sequence now, so sit back for the count.", "Every station reports GO. The automatic sequence has it from here."],
    normal: ["All stations are GO. We are on the automatic sequence.", "Launch director gives a GO. Automatic sequence is running.", "Polling complete, all GO. Sequencer is armed."],
    hard: ["All stations GO. Automatic sequence.", "GO from all stations. Sequencer running."],
  });
  return [lc(result), lc(go)];
}

// ---------------------------------------------------------------- launch (seconds on the launch clock)
export function launchCues(L: number): { t: number; lines: CommLine[] }[] {
  const n = (t: number, text: string) => ({ t: L - t, lines: [count(text)] });
  const liftoff = say("launch.liftoff", {
    easy: ["Liftoff! We have liftoff of Apollo {N}. Good luck, crew.", "And liftoff! Apollo {N} is on its way."],
    normal: ["Liftoff. We have liftoff of Apollo {N}.", "Liftoff. Apollo {N} has cleared the hold-down arms.", "We have liftoff. Apollo {N} is climbing."],
    hard: ["Liftoff. Apollo {N}.", "Liftoff. Clock is running."],
  });
  const tower = say("launch.tower", {
    easy: ["The tower is clear. Beautiful start.", "Tower cleared. She's flying straight and true."],
    normal: ["The tower is clear.", "Tower cleared. Roll program.", "Clear of the tower."],
    hard: ["Tower clear.", "Clear of the tower. Roll program."],
  });
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
    { t: L + 1.2, lines: [lc(liftoff, 1.5)] },
    { t: L + 6, lines: [lc(tower, 2)] },
  ];
}

/** Calls for the staging and burn moments shown in the space part of the launch. */
export const LAUNCH_EVENTS = {
  get staging() {
    return cdr(
      say("launch.staging", {
        easy: ["Staging! First stage is away, second stage is lit.", "There's staging. Second stage is burning nicely."],
        normal: ["Staging. Second stage ignition.", "First stage away. Second stage is lit.", "Staging and ignition."],
        hard: ["Staging. Ignition.", "Stage one away. Two is lit."],
      }),
      2,
    );
  },
  get stage2() {
    return cc(
      say("launch.tli", {
        easy: ["Apollo {N}, Houston. Second stage did its job. You are GO for translunar injection, next stop the Moon.", "Apollo {N}, Houston. Everything looks great down here. You're GO for translunar injection."],
        normal: ["Apollo {N}, Houston. Second stage is good. You are GO for translunar injection.", "Apollo {N}, Houston. Good stage. GO for T-L-I.", "Houston, Apollo {N}. Trajectory is nominal. You are GO for translunar injection."],
        hard: ["Apollo {N}, Houston. GO for T-L-I.", "Apollo {N}, GO for translunar injection. Watch your numbers."],
      }),
      3,
    );
  },
};

// ---------------------------------------------------------------- cruise hurdles
const HURDLE_GOOD: Record<HurdleType, Toned<string>> = {
  debris_field: {
    easy: ["You threaded every gap. You're clear of the debris.", "Clean run through the debris. Lovely flying."],
    normal: ["You're clear of the debris field.", "Debris field is behind you. No hits that matter.", "Clear of the debris."],
    hard: ["Clear of the debris.", "Debris behind you. Stay sharp."],
  },
  solar_storm: {
    easy: ["Everyone made it behind the shielding. The crew is safe.", "The whole crew is in the shelter. The storm can't touch you now."],
    normal: ["The crew is safe behind the shielding.", "All crew in the shelter. Dose is nominal.", "Shielding holds. Crew dose is within limits."],
    hard: ["Crew sheltered. Dose nominal.", "Everyone's shielded. Hold there."],
  },
  engine_fault: {
    easy: ["Fuel is flowing again, and the engine is GO. Great fix.", "That reroute worked. The engine is happy again."],
    normal: ["Fuel is flowing again. The engine is GO.", "Fuel pressure is back. Engine is GO for the next burn.", "Reroute confirmed. Engine is GO."],
    hard: ["Fuel's flowing. Engine GO.", "Pressure back. Engine GO."],
  },
  nav_correction: {
    easy: ["That correction was spot on. You're right on track for the Moon.", "Perfect course correction. We couldn't have planned it better."],
    normal: ["Course correction is good. You're right on track.", "Trajectory is back on the line. Good correction.", "Nav update looks good. You're on track."],
    hard: ["Correction good. On track.", "On the line. Good burn."],
  },
  comms_blackout: {
    easy: ["There you are! We have you loud and clear again.", "Good to hear you again, crew. Signal is strong."],
    normal: ["We have you loud and clear again.", "Signal is back, five by five.", "Comms restored. Reading you loud and clear."],
    hard: ["Loud and clear.", "Comms back. Five by five."],
  },
};
const HURDLE_ROUGH: Record<HurdleType, Toned<string>> = {
  debris_field: {
    easy: ["You took a few knocks, but the hull is holding. Don't worry about it.", "A couple of hits, nothing we can't live with."],
    normal: ["You took some hits, but the hull is holding.", "Some damage from the debris. Hull is holding.", "We saw those hits. Hull integrity is holding."],
    hard: ["Hull took hits. It's holding, for now.", "Damage logged. Hull holding."],
  },
  solar_storm: {
    easy: ["Some of the crew took a dose. Nothing serious, we'll keep an eye on it.", "Not everyone made it in time, but the doses are manageable."],
    normal: ["Some of the crew took a dose. We'll keep an eye on it.", "Partial exposure. We're tracking the dose.", "Not all of the crew got shielded in time. Dose is logged."],
    hard: ["Crew took a dose. Logged.", "Exposure on part of the crew. Don't repeat that."],
  },
  engine_fault: {
    easy: ["The engine is running rough, but it'll get you there.", "Not perfect, but the engine will do the job."],
    normal: ["The engine is running rough, but it will get you there.", "Engine's degraded. Still GO for the next burn.", "We're seeing rough pressure. It'll hold."],
    hard: ["Engine degraded. It'll have to do.", "Rough engine. You're GO, barely."],
  },
  nav_correction: {
    easy: ["You're a little off course. No problem, we'll trim it on the next burn.", "Close enough. We'll tidy up the trajectory later."],
    normal: ["You're a little off course. We'll trim it on the next burn.", "Trajectory is off the line. We'll correct midcourse.", "Correction was short. We'll fix it on the next burn."],
    hard: ["Off course. We'll trim it.", "Correction missed. Midcourse burn required."],
  },
  comms_blackout: {
    easy: ["We can hear you, just faintly. That'll do for now.", "Signal is weak, but we've got you."],
    normal: ["Signal is weak, but we can hear you.", "Reading you two by five. Workable.", "Weak signal. We'll manage."],
    hard: ["Weak signal. Barely readable.", "Two by five. Fix it when you can."],
  },
};

export function hurdleResult(type: HurdleType, score: number, name?: string): CommLine {
  const good = score >= 60;
  const body = say(`hurdle.${type}.${good ? "ok" : "rough"}`, (good ? HURDLE_GOOD : HURDLE_ROUGH)[type]);
  const opener = name
    ? say(`hurdle.opener.${good}`, {
        easy: good ? [`${name}, nice work.`, `Great job, ${name}.`, `${name}, that was textbook.`] : [`${name}, no worries.`, `${name}, copy.`],
        normal: good ? [`${name}, nice work.`, `Good job, ${name}.`, `Copy, ${name}.`] : [`${name}, copy.`, `Copy that, ${name}.`],
        hard: good ? [`${name}, good.`, `Copy, ${name}.`] : [`${name}.`, `Copy, ${name}.`],
      })
    : "";
  return cc(`${opener} ${body}`.trim());
}

export function cruiseArrival(): CommLine {
  return cc(
    say("cruise.arrival", {
      easy: ["Apollo {N}, Houston. You're coming up on the Moon. Take a look around and pick us a good landing site.", "Apollo {N}, Houston. Welcome to the Moon's neighborhood. Time to choose where you'll land."],
      normal: ["Apollo {N}, Houston. You're approaching the Moon. Pick us a landing site.", "Apollo {N}, Houston. Lunar approach. We need a landing site from you.", "Apollo {N}, you're in lunar orbit. Survey the sites and pick one."],
      hard: ["Apollo {N}, Houston. Lunar approach. Pick a site.", "Apollo {N}. Site selection. Make it a good one."],
    }),
  );
}

// ---------------------------------------------------------------- landing site
export function probeReport(r: { score: number; slope_deg: number; sun_pct: number }): CommLine {
  const slope = Math.round(r.slope_deg);
  const sun = pct(r.sun_pct);
  const score = Math.round(r.score);
  return cc(
    say("site.probe", {
      easy: [`Probe is down. The ground slopes ${slope} degrees and gets sunlight ${sun} of the time. That spot scores ${score}.`, `Got your probe. ${slope} degrees of slope, ${sun} sunlight. We'd call that a ${score}.`],
      normal: [`Probe is down. Slope ${slope} degrees, sunlight ${sun}. Site score ${score}.`, `Probe reports ${slope} degrees, ${sun} sun. That's a ${score}.`, `Probe telemetry: slope ${slope}, sunlight ${sun}. Score ${score}.`],
      hard: [`Probe: slope ${slope}, sun ${sun}. Score ${score}.`, `${slope} degrees, ${sun} sun. ${score}.`],
    }),
  );
}

export function simReport(safePct: number): CommLine[] {
  const safe = Math.round(safePct);
  const band = safe >= 60 ? "good" : safe >= 30 ? "marginal" : "bad";
  const lines: Record<string, Toned<string>> = {
    good: {
      easy: [`We ran three hundred test landings and ${pct(safe)} came down safely. That's a great spot. You're GO for descent.`, `${pct(safe)} of our test landings were safe. We like it. GO for descent.`],
      normal: [`Three hundred test landings: ${pct(safe)} landed safely. Good spot. You are GO for descent.`, `Test landings ${pct(safe)} safe. That works. GO for descent.`, `${pct(safe)} safe across three hundred runs. GO for descent.`],
      hard: [`${pct(safe)} safe. GO for descent.`, `Test landings ${pct(safe)} safe. GO.`],
    },
    marginal: {
      easy: [`Only ${pct(safe)} of the test landings went well. It's a bit risky. A flatter spot would be kinder to your legs.`, `${pct(safe)} safe in testing. You could try it, but a flatter spot would help.`],
      normal: [`Three hundred test landings: ${pct(safe)} landed safely. It's marginal. A flatter spot would be safer.`, `${pct(safe)} safe in testing. Marginal. Consider somewhere flatter.`],
      hard: [`${pct(safe)} safe. Marginal. Your call.`, `${pct(safe)}. Risky. Your call.`],
    },
    bad: {
      easy: [`Just ${pct(safe)} of the test landings were safe. That's too risky. Let's find you another spot.`, `Only ${pct(safe)} safe. We'd really like you to pick somewhere flatter.`],
      normal: [`Three hundred test landings: only ${pct(safe)} landed safely. Recommend another spot.`, `${pct(safe)} safe. That's a NO-GO from us. Pick another spot.`],
      hard: [`${pct(safe)} safe. NO-GO. Move.`, `Only ${pct(safe)}. Find another spot.`],
    },
  };
  return [cc(say(`site.sim.${band}`, lines[band]))];
}

// ---------------------------------------------------------------- powered descent
export function descentStart(siteName: string): CommLine[] {
  return [
    cc(
      say("descent.start", {
        easy: [`{LM}, Houston. You are GO for powered descent to ${siteName}. Nice and gentle, crew.`, `{LM}, Houston. GO for powered descent. ${siteName} is waiting for you.`],
        normal: [`{LM}, Houston. You are GO for powered descent to ${siteName}.`, `{LM}, Houston. GO for P-D-I, target ${siteName}.`, `{LM}, Houston. Powered descent is GO. Target ${siteName}.`],
        hard: [`{LM}, GO for powered descent. ${siteName}.`, `{LM}, Houston. P-D-I is GO. Watch your fuel.`],
      }),
    ),
  ];
}

export function goForLanding(): CommLine {
  return cc(
    say("descent.landing", {
      easy: ["{LM}, Houston. You're GO for landing. Take your time.", "{LM}, you're GO for landing. Looking good from here."],
      normal: ["{LM}, Houston. You're GO for landing.", "{LM}, GO for landing.", "{LM}, Houston. Landing is GO."],
      hard: ["{LM}, GO for landing.", "GO for landing. Fuel is tight."],
    }),
    4,
  );
}

/** Altitude call with the lander's real sink rate at that height. */
export function altitudeCall(feet: number, downFps: number, last = false): CommLine {
  const down = Math.round(downFps);
  const text = say(`descent.alt.${feet}`, {
    normal: [`${feet} feet, down at ${down}.`, `${feet} feet, ${down} down.`, `${feet}, down ${down}.`],
    hard: [`${feet}, down ${down}.`, `${feet} feet. ${down} down.`],
  });
  const tail = last ? say("descent.dust", { normal: [" Kicking up some dust.", " Picking up dust.", " Dust's coming up."], hard: [" Dust."] }) : "";
  return lmp(text + tail, 2);
}

export function contact(): CommLine[] {
  return [lmp(say("descent.contact", { normal: ["Contact light. Engine stop.", "Contact. Engine stop.", "Contact light. Engine off."] }))];
}

export function landed(reason: "ok" | "boulder" | "tipped", tiltDeg: number): CommLine[] {
  const tilt = `${Math.round(tiltDeg)} degrees`;
  if (reason === "ok")
    return [
      cdr(say("landed.ok.cdr", { normal: [`Houston, {BASE} here. The {LM} has landed. Tilt ${tilt}, she's stable.`, `Houston, {BASE}. We're down. Tilt ${tilt}, steady.`, `{BASE} here. Touchdown, tilt ${tilt}. We're stable.`], hard: [`{BASE}. Down. Tilt ${tilt}.`] })),
      cc(say("landed.ok.cc", { easy: ["Roger, {BASE}. We copy you on the ground. Wonderful flying, crew.", "We see you down, {BASE}. That was lovely."], normal: ["Roger, {BASE}. We copy you on the ground. Great flying.", "Copy you down, {BASE}. Nice work.", "We copy, {BASE}. Welcome to the Moon."], hard: ["Copy, {BASE}.", "Copy you down."] })),
    ];
  if (reason === "boulder")
    return [
      cdr(say("landed.boulder.cdr", { normal: [`Houston, we're down, but a leg hit a boulder. Tilt ${tilt}.`, `We're down. One foot's on a rock. Tilt ${tilt}.`] })),
      cc(say("landed.boulder.cc", { normal: ["Copy. Stand by while we check the lander.", "Copy. We're looking at your leg loads."] })),
    ];
  return [
    cdr(say("landed.tipped.cdr", { normal: [`Houston, the lander is tipping over. Tilt ${tilt}.`, `We're going over. Tilt ${tilt}.`] })),
    cc(say("landed.tipped.cc", { normal: ["Copy. Crew, secure yourselves and report status.", "Copy. Hold on and report when you can."] })),
  ];
}

// ---------------------------------------------------------------- surface
export function egress(): CommLine[] {
  return [
    cdr(say("egress.foot", { normal: ["At the foot of the ladder.", "Bottom of the ladder.", "Last rung."] })),
    cdr(say("egress.step", { normal: ["Stepping off the {LM} now.", "Going down onto the surface.", "Stepping off."] })),
  ];
}

export function firstStep(): CommLine[] {
  return [
    cc(
      say("surface.first", {
        easy: ["We see you on the surface, {BASE}. Have a look around, your first objective is marked.", "Welcome to the surface, {BASE}. Your first objective is waiting."],
        normal: ["We see you on the surface, {BASE}. Your first objective is marked.", "Copy you on the surface. First objective is up.", "{BASE}, we have you on the surface. Go to your first objective."],
        hard: ["{BASE}, on the surface. First objective. Move.", "Copy. First objective is marked."],
      }),
    ),
  ];
}

const TASK_DONE: Record<SurfaceTask["type"], Toned<string>> = {
  navigate_to: { normal: ["You've reached the marker.", "You're on the mark.", "Position confirmed."] },
  deploy_relay: { normal: ["Relay is up. We have signal.", "Relay deployed. Signal is strong.", "We're getting data through the relay."], hard: ["Relay up. Signal good."] },
  scan: { normal: ["That's the signal we were looking for. Ice confirmed.", "Strong reading. That's ice.", "Scan confirms it. There's ice there."], easy: ["That's it! That's the ice signal we came for.", "Beautiful reading. You found the ice."] },
  collect_sample: { normal: ["Sample sealed and stowed.", "Sample's in the container.", "Good sample. Stowed."] },
  repair: { normal: ["Repair complete. Telemetry is green.", "Fixed. All green.", "Repair checks out."] },
};

export function taskDone(task: SurfaceTask, next?: SurfaceTask): CommLine[] {
  const body = say(`task.${task.id}`, TASK_DONE[task.type]);
  const nextLine = next ? say(`task.next.${task.id}`, { normal: [` Next: ${next.title.toLowerCase()}.`, ` Moving on: ${next.title.toLowerCase()}.`, ` Up next, ${next.title.toLowerCase()}.`] }) : "";
  return [cc(`${task.title}: done. ${body}${nextLine}`)];
}

export function goalAchieved(goal: string): CommLine[] {
  const g = goal.replace(/\.$/, "");
  return [
    cc(
      say("goal", {
        easy: [`Mission goal achieved. ${g}. You should be very proud, crew.`, `That's the goal. ${g}. Outstanding work, everyone.`],
        normal: [`Mission goal achieved. ${g}. Outstanding work, crew.`, `Goal complete. ${g}. Well done.`, `That's the mission. ${g}. Great work.`],
        hard: [`Goal achieved. ${g}.`, `Mission goal complete. ${g}. Good.`],
      }),
    ),
  ];
}

// ---------------------------------------------------------------- report
export function missionSummary(total: number, rank: string): CommLine[] {
  return [cc(say("summary", { normal: [`Apollo {N}, Houston. Mission complete. Final score ${Math.round(total)}, rank ${rank}.`, `Apollo {N}, mission complete. ${Math.round(total)} points, ${rank}.`] }))];
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
export const fuelCall = (secs: 60 | 30): CommLine =>
  lmp(say(`fuel.${secs}`, { normal: secs === 60 ? ["Sixty seconds of fuel.", "Sixty seconds.", "Fuel, sixty seconds."] : ["Thirty seconds.", "Thirty seconds of fuel.", "Fuel, thirty."] }), 2.5);
export const fuelOut = (): CommLine => lmp(say("fuel.out", { normal: ["Fuel is out.", "We're out of fuel.", "Tanks are dry."] }), 2);
export const autopilotCall = (on: boolean): CommLine =>
  cdr(on ? say("ap.on", { normal: ["Autopilot engaged.", "Autopilot has it.", "Going to auto."] }) : say("ap.off", { normal: ["Autopilot off. Manual control.", "Manual. I have it.", "Taking it manual."] }), 2);
export function driftCall(dir: "left" | "right" | "forward" | "back", fps: number): CommLine {
  const v = Math.round(fps);
  return lmp(say(`drift.${dir}`, { normal: [`Drifting ${dir}, ${v} feet per second.`, `${v} ${dir}.`, `We're sliding ${dir}, ${v}.`] }), 2.5);
}
export const contactLight = (): CommLine => lmp("Contact light.", 2);
export const engineStop = (): CommLine => lmp(say("engine.stop", { normal: ["Engine stop.", "Engine off.", "Shutdown."] }), 2);

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
  const where = miss <= 15 ? say("td.where.on", { normal: ["right on the spot", "dead on the mark", "on the probe"] }) : `${miss} meters from the probe`;
  if (r.reason === "ok")
    return [
      cdr(say("td.ok.cdr", { normal: [`Houston, {BASE} here. The {LM} has landed, ${where}. Down at ${down} feet per second, tilt ${tilt}.`, `{BASE} here. We're down, ${where}. ${down} feet per second, tilt ${tilt}.`, `Houston, touchdown ${where}. ${down} down, tilt ${tilt}. She's stable.`] })),
      cc(say("td.ok.cc", { easy: ["Roger, {BASE}. We copy you on the ground. Wonderful flying.", "We see you down, {BASE}. Beautiful landing."], normal: ["Roger, {BASE}. We copy you on the ground. Great flying.", "Copy you down, {BASE}. Nice landing.", "We copy, {BASE}. Welcome to the Moon."], hard: ["Copy, {BASE}. Down.", "Copy. Good landing."] })),
    ];
  if (r.reason === "hard")
    return [
      cdr(say("td.hard.cdr", { normal: [`Houston, we're down, but that was hard. ${down} feet per second. Checking the legs.`, `Hard landing, Houston. ${down} feet per second. Checking structure.`] })),
      cc(say("td.hard.cc", { normal: ["Copy. Stand by while we look at your telemetry.", "Copy. We're looking at the loads."] })),
    ];
  if (r.reason === "boulder")
    return [
      cdr(say("td.boulder.cdr", { normal: [`Houston, we're down, but a foot is on a boulder. Tilt ${tilt}.`, `Down, but we're sitting on a rock. Tilt ${tilt}.`] })),
      cc(say("td.boulder.cc", { normal: ["Copy. Stand by while we check the lander.", "Copy. Hold while we check the leg."] })),
    ];
  if (r.reason === "tipped")
    return [
      cdr(say("td.tipped.cdr", { normal: [`Houston, the lander is tipping over. Tilt ${tilt}.`, `We're going over, Houston. Tilt ${tilt}.`] })),
      cc(say("td.tipped.cc", { normal: ["Copy. Crew, secure yourselves and report status.", "Copy. Hold on, report when you can."] })),
    ];
  return [cdr(say("td.crash.cdr", { normal: [`Houston, we hit hard. Impact at ${down} feet per second.`, `Impact, Houston. ${down} feet per second.`] })), cc(say("td.crash.cc", { normal: ["Copy. Crew, report status.", "Copy. Talk to us, crew."] }))];
}

export type { Role };

/** Fixed lines (the launch count), for prefetching. Everything else is built when it happens. */
export function allScriptLines(): CommLine[] {
  return launchCues(0).flatMap((c) => c.lines);
}
