// Optional cruise jobs that pay supply points (SP). Each can be done once per mission (phaseData.cruise.act_<id>),
// payouts are earned (wrong answers / timeouts pay nothing, risky bets can cost integrity), and only the client of
// the player who did the job calls earn()/damage(). Hurdles finished cleanly pay too (see CruiseHud).
import { create } from "zustand";
import { say, traceEvent } from "../../../core/comms";
import { COST, damage } from "../../../core/hp";
import { earn } from "../../../core/economy";
import type { MissionPlan } from "../../../types";
import { mulberry } from "../flow";
import { activityResult } from "../comms";

export type JobId = "quiz" | "photo" | "diag" | "eva";
export const JOBS: Record<JobId, { title: string; short: string; reward: string; fail: string; where: string }> = {
  quiz: { title: "Mission facts quiz", short: "Quiz", reward: "6 SP per correct answer, +6 for a perfect round. DOUBLE the last answer: it pays 12.", fail: "A wrong answer pays nothing. A wrong DOUBLE costs 5 integrity.", where: "console, lower left wall, aft" },
  photo: { title: "Photograph Earth", short: "Photo", reward: "4 SP per sharp frame, +6 for three of three.", fail: "A blurred frame pays nothing.", where: "aft window" },
  diag: { title: "Find the failing sensor", short: "Diagnostics", reward: "12 SP. ARM x2 for 24 SP.", fail: "Wrong sensor or out of time pays nothing. A wrong ARM x2 costs 5 integrity.", where: "diagnostics rack, upper right wall" },
  eva: { title: "Hull repair spacewalk", short: "EVA repair", reward: "40 SP standard, 80 SP risky.", fail: "If the risk gauge fills you abort: -12 integrity (standard) or -25 (risky), no pay.", where: "airlock panel, right wall" },
};
export const JOB_ORDER: JobId[] = ["quiz", "photo", "diag", "eva"];

export const useJob = create<{ v: number }>(() => ({ v: 0 }));
const bump = () => useJob.setState((s) => ({ v: s.v + 1 }));

/** Runtime. `acts` is mirrored from phaseData.cruise (act_<id>) by the HUD. */
export const J = {
  acts: {} as Record<string, string>,
  patch: (_d: Record<string, unknown>) => {},
  plan: undefined as MissionPlan | undefined,
  seed: 1,
  streak: 0,
  active: null as JobId | null,
  // quiz
  qs: [] as { text: string; truth: boolean }[],
  qi: 0,
  qOk: 0,
  qBet: false,
  qEarn: 0,
  // photo
  shot: 0,
  shotOk: 0,
  phase: 0,
  t: 0,
  flash: 0,
  // diag
  faulty: 0,
  dVals: [] as number[],
  dArm: false,
  dT: 0,
  // eva
  eMode: "" as "" | "std" | "risky",
  work: 0,
  risk: 0,
  holding: 0,
  surge: 0,
  eT: 0,
  lastMsg: "",
};

export const available = (id: JobId) => !J.acts[id];
export const jobsLeft = () => JOB_ORDER.filter(available).length;

function streakBonus() {
  return Math.min(9, J.streak * 3);
}

function pay(id: JobId, ok: boolean, base: number, detail: string, cost = 0, costWhy = "") {
  let sp = 0;
  if (ok) {
    sp = base + (base > 0 ? streakBonus() : 0);
    J.streak = base > 0 ? J.streak + 1 : J.streak;
    if (sp > 0) earn(sp, `${JOBS[id].title}: ${detail}`);
  } else {
    J.streak = 0;
  }
  if (cost > 0) damage(cost, costWhy);
  J.acts[id] = ok ? `done:${sp}` : "failed";
  J.patch({ [`act_${id}`]: J.acts[id] });
  J.active = null;
  J.lastMsg = ok ? `${JOBS[id].title}: ${detail}. +${sp} SP${J.streak > 1 ? ` (streak x${J.streak})` : ""}` : `${JOBS[id].title}: ${detail}. No SP${cost ? `, -${cost} integrity` : ""}.`;
  traceEvent(`cruise job: ${id} ${ok ? "paid " + sp : "failed"}`);
  say(activityResult(id, ok, detail, sp));
  bump();
}

// ------------------------------------------------------------------------------------------------ quiz
const SWAPS: [RegExp, string][] = [
  [/south pole/i, "equator"],
  [/\bice\b/i, "sand"],
  [/\bwater\b/i, "oxygen"],
  [/\bancient\b/i, "brand-new"],
  [/permanently shadowed/i, "permanently sunlit"],
  [/billions/i, "a few thousand"],
  [/confirmed/i, "ruled out"],
  [/impacted/i, "missed"],
  [/\b(\d{2,4})\b/, "7"],
];
const FAKE_STEPS = ["Deploy the landing parachute", "Open the lunar dust cover", "Arm the ejection seat", "Fill the swimming tank", "Calibrate the sextant on the pad"];

export function buildQuiz(plan: MissionPlan | undefined, seed: number) {
  const r = mulberry(seed * 31 + 5);
  const out: { text: string; truth: boolean }[] = [];
  const facts = (plan?.facts ?? []).filter((f) => f.verified);
  for (const f of facts) {
    if (out.length >= 2) break;
    const sw = SWAPS.find(([re]) => re.test(f.text));
    const lie = !!sw && r() < 0.5;
    const text = lie ? f.text.replace(sw![0], sw![1]) : f.text;
    out.push({ text: `True or false: ${text}`, truth: !lie });
  }
  const items = plan?.checklist.items ?? [];
  if (items.length) {
    const real = r() < 0.5;
    const it = items[Math.floor(r() * items.length)];
    out.push({ text: real ? `True or false: "${it.prompt}" was on your pre-launch checklist.` : `True or false: "${FAKE_STEPS[Math.floor(r() * FAKE_STEPS.length)]}" was on your pre-launch checklist.`, truth: real });
  }
  while (out.length < 3) out.push({ text: "True or false: the Moon always shows the same face to Earth.", truth: true });
  return out.slice(0, 3);
}

export function startQuiz() {
  if (!available("quiz") || J.active) return;
  J.active = "quiz";
  J.qs = buildQuiz(J.plan, J.seed);
  J.qi = 0;
  J.qOk = 0;
  J.qBet = false;
  J.qEarn = 0;
  bump();
}
export function quizBet() {
  if (J.active === "quiz" && J.qi === 2 && !J.qBet) {
    J.qBet = true;
    bump();
  }
}
export function quizAnswer(v: boolean) {
  if (J.active !== "quiz") return;
  const q = J.qs[J.qi];
  const ok = q.truth === v;
  const last = J.qi === 2;
  if (ok) {
    J.qOk++;
    J.qEarn += last && J.qBet ? 12 : 6;
  }
  const bad = !ok && last && J.qBet;
  J.lastMsg = ok ? "Correct." : "Wrong.";
  if (last) {
    const perfect = J.qOk === 3;
    pay("quiz", J.qEarn > 0 || perfect, J.qEarn + (perfect ? 6 : 0), `${J.qOk} of 3 correct${J.qBet ? ", doubled the last" : ""}`, bad ? COST.minor : 0, "Lost the double-or-nothing bet");
    if (J.qEarn === 0) J.acts.quiz = "failed";
  } else J.qi++;
  bump();
}

// ------------------------------------------------------------------------------------------------ photo
export function startPhoto() {
  if (!available("photo") || J.active) return;
  J.active = "photo";
  J.shot = 0;
  J.shotOk = 0;
  J.t = 0;
  J.flash = 0;
  bump();
}
export const photoWidth = () => [0.2, 0.13, 0.08][Math.min(2, J.shot)];
/** Position of the sweeping frame (0..1) at time t. */
export const photoPos = (t: number, shot: number) => 0.5 + 0.5 * Math.sin(t * (2.2 + shot * 0.9) + shot);
export function shoot() {
  if (J.active !== "photo") return;
  const hit = Math.abs(photoPos(J.t, J.shot) - 0.5) < photoWidth() / 2;
  if (hit) J.shotOk++;
  J.flash = hit ? 1 : -1;
  J.shot++;
  J.t += 0.35;
  if (J.shot >= 3) pay("photo", J.shotOk > 0, J.shotOk * 4 + (J.shotOk === 3 ? 6 : 0), `${J.shotOk} of 3 frames sharp`);
  bump();
}

// ------------------------------------------------------------------------------------------------ diagnostics
export const SENSORS = ["CRYO PRESS", "BUS A VOLT", "COOLANT TEMP", "O2 FLOW", "GYRO RATE"];
export function startDiag() {
  if (!available("diag") || J.active) return;
  const r = mulberry(J.seed * 17 + 3);
  J.active = "diag";
  J.faulty = Math.floor(r() * 5);
  J.dVals = SENSORS.map((_, i) => (i === J.faulty ? (r() < 0.5 ? 0.96 : 0.06) : 0.45 + r() * 0.2));
  J.dArm = false;
  J.dT = 0;
  bump();
}
export function diagArm() {
  if (J.active === "diag" && !J.dArm) {
    J.dArm = true;
    J.dT = Math.max(J.dT, 8); // armed: only 12 s left
    bump();
  }
}
export const diagLimit = () => 20;
export function diagPick(i: number) {
  if (J.active !== "diag") return;
  if (i === J.faulty) pay("diag", true, J.dArm ? 24 : 12, `found the failing ${SENSORS[i].toLowerCase()}`);
  else pay("diag", false, 0, `${SENSORS[i].toLowerCase()} was fine, the fault was ${SENSORS[J.faulty].toLowerCase()}`, J.dArm ? COST.minor : 0, "Wrong sensor on a double-or-nothing diagnosis");
}

// ------------------------------------------------------------------------------------------------ EVA
export function startEva(mode: "std" | "risky") {
  if (!available("eva") || J.active) return;
  J.active = "eva";
  J.eMode = mode;
  J.work = 0;
  J.risk = 0;
  J.holding = 0;
  J.surge = 0;
  J.eT = 0;
  bump();
}
export function evaWork(dt: number) {
  if (J.active !== "eva") return;
  J.holding = 0.2;
}
/** Per frame while the EVA is active (any client that is doing it). */
export function evaTick(dt: number) {
  if (J.active !== "eva") return;
  const risky = J.eMode === "risky";
  J.eT += dt;
  const working = J.holding > 0;
  J.holding = Math.max(0, J.holding - dt);
  if (working) {
    J.work = Math.min(1, J.work + dt / (risky ? 7 : 11));
    J.risk += dt * (risky ? 0.2 : 0.11);
  } else J.risk = Math.max(0, J.risk - dt * 0.22);
  // micrometeoroid surges spike the risk; letting go for a moment lets it settle
  J.surge -= dt;
  if (J.surge <= 0) {
    J.surge = 2.6 + Math.random() * 2.2;
    J.risk += working ? (risky ? 0.2 : 0.1) : 0.02;
    J.lastMsg = "Debris surge: ease off and let the risk settle.";
  }
  if (J.work >= 1) pay("eva", true, risky ? 80 : 40, `hull patched ${risky ? "the risky way" : "safely"}`);
  else if (J.risk >= 1) pay("eva", false, 0, "aborted the spacewalk, the risk got too high", risky ? COST.severe : COST.major, "Spacewalk aborted under debris fire");
}
export function diagTick(dt: number) {
  if (J.active !== "diag") return;
  J.dT += dt;
  if (J.dT > diagLimit()) pay("diag", false, 0, "ran out of time on the diagnostics");
}
export function photoTick(dt: number) {
  if (J.active !== "photo") return;
  J.t += dt;
  J.flash *= Math.exp(-dt * 4);
}

export function cancelJob() {
  J.active = null;
  bump();
}
