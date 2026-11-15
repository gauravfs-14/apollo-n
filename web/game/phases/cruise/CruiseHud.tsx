"use client";
/* eslint-disable react-hooks/purity, react-hooks/exhaustive-deps, react-hooks/immutability -- timers, refs and three.js state are intentionally imperative here */
// Cruise HUD. The hurdles are played inside the cabin (see cabin/); this overlay only tells you what to do next:
// objective + where, aim prompt, readouts for the current problem, the sextant view, the journey strip, the score card.
// Shared state: phaseData.cruise = { idx, stage: brief (routine checks) | play (the problem) | done, results, checks, hs }.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { say, traceEvent } from "../../core/comms";
import { useRevealed } from "../../core/loading";
import { setMusicOverride } from "../../core/music";
import { onServerEvent } from "../../core/store";
import { rolesOf } from "../../core/roles";
import { useGame } from "../../core/useGame";
import { perkEffects, PERKS, usePerk } from "../../data/perks";
import { COST, damage } from "../../core/hp";
import { phaseLabel } from "../../ui/phaseLabel";
import { Button, Panel, PhaseTitle } from "../../ui/kit";
import { useAim } from "../../three/interior/interact";
import { zg } from "../../three/interior/zerog";
import { ROLE_INFO } from "../crew/data";
import { act } from "./cabin/act";
import { checkJobs, helpJob, mainJob, type Job } from "./cabin/objectives";
import { H, STEP_TEXT, adopt, applyAct, bump, cam, checksFor, initD, resetH, snapshot, useHv } from "./cabin/model";
import { SEXTANT_FOV } from "./cabin/Stations2";
import { J, JOBS, JOB_ORDER, available, diagLimit, photoPos, photoWidth, shoot, useJob } from "./cabin/jobs";
import { jobPos } from "./cabin/objectives";
import { earn } from "../../core/economy";
import { useEventGuard } from "../../core/events";
import { award, grade, miss } from "../../core/juice";
import { useUpgrades } from "../../progress/effects";
import { checksDone, debrisHit, hurdleOutcome, hurdleStep } from "./comms";
import { type CruiseData, HURDLE_META, levelOf, useSeconds } from "./flow";
import { DEBRIS_SECONDS, rt, setDebris } from "./rt";

const PERK_FOR: Partial<Record<string, import("../../data/perks").PerkId>> = { solar_storm: "water_shield", engine_fault: "spare_parts", comms_blackout: "high_gain_antenna" };

function SkipButton({ after, onSkip, label }: { after: number; onSkip: () => void; label: string }) {
  const s = useSeconds();
  if (s < after) return null;
  return (
    <button onClick={onSkip} className="pointer-events-auto rounded-md border border-line bg-black/50 px-3 py-1.5 text-xs text-white/80 backdrop-blur hover:text-white">
      {label}
    </button>
  );
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
/** "3.2 m ahead, up, to the left" from where the player is looking. */
function bearing(pos: THREE.Vector3 | null): string {
  if (!pos) return "";
  _v.copy(pos).sub(zg.pos);
  const d = _v.length();
  const f = _v.dot(zg.fwd);
  const r = _v.dot(_r.copy(zg.right));
  const u = _v.y;
  const parts: string[] = [];
  if (f < -0.5 && Math.abs(r) < Math.abs(f)) parts.push("behind you");
  else if (f > 0.4 * Math.abs(r)) parts.push("ahead");
  if (r > 0.9 && Math.abs(r) > Math.abs(f) * 0.5) parts.push("to the right");
  if (r < -0.9 && Math.abs(r) > Math.abs(f) * 0.5) parts.push("to the left");
  if (u > 0.8) parts.push("above");
  if (u < -0.8) parts.push("below");
  return `${d.toFixed(1)} m${parts.length ? ", " + parts.join(", ") : ""}`;
}

function useTick(ms: number) {
  const [, f] = useState(0);
  useEffect(() => {
    const id = setInterval(() => f((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function CruiseHud() {
  const { state, plan, isHost, me, patch, complete, actsAs } = useGame();
  const perkOwned = usePerk();
  const fx = perkEffects(perkOwned);
  const timeMultRef = useRef(1);
  timeMultRef.current = useUpgrades().hurdleTimeMult;
  // dev/test only: ?hurdles=nav_correction,comms_blackout plays those hurdles (cruise scripts use it to cover every type)
  const hurdles = useMemo(() => {
    const q = typeof location !== "undefined" && process.env.NODE_ENV !== "production" ? new URLSearchParams(location.search).get("hurdles") : null;
    const base = plan?.cruise ?? [];
    if (!q || !base.length) return base;
    return q.split(",").map((t, i) => ({ ...base[i % base.length], type: t as never, role: (["pilot", "scientist", "engineer", "commander", "pilot"] as const)[["nav_correction", "comms_blackout", "engine_fault", "solar_storm", "debris_field"].indexOf(t)] ?? "pilot" }));
  }, [plan?.cruise]);
  const n = hurdles.length;
  const data = (state?.phaseData.cruise ?? {}) as Partial<CruiseData> & { checks?: string[]; hs?: { idx: number; d: Record<string, unknown> } };
  const idx = Math.min(data.idx ?? 0, Math.max(0, n - 1));
  const stage = data.stage ?? "brief";
  const results = data.results ?? [];
  const hurdle = hurdles[idx];
  const actor = hurdle ? actsAs(hurdle.role) : false;
  const seed = (plan?.seed ?? 1) * 3 + idx;
  const level = hurdle ? levelOf(plan, hurdle) : 0;
  const revealed = useRevealed("cruise");
  const finished = useRef(-1);
  const v = useHv((s) => s.v);
  const names = (state?.phaseData.crew as { names?: Partial<Record<string, string>> } | undefined)?.names;
  const solo = state?.mode === "solo";
  const humans = useMemo(() => (state?.players ?? []).filter((p) => p.connected).map((p) => p.id), [state?.players]);
  useTick(200);

  // no hurdles in the plan: nothing to do, never dead-end
  useEffect(() => {
    if (plan && n === 0 && isHost) complete("cruise", 100);
  }, [plan, n, isHost, complete]);

  // --- shared runtime for the 3D side
  H.actor = actor;
  H.solo = !!solo;
  H.humans = humans;
  H.me = me?.id ?? "";
  H.fx = fx;
  H.level = level;
  H.seed = seed;
  H.stage = stage;

  const finish = useCallback(
    (score: number, note?: string) => {
      if (finished.current === idx) return;
      finished.current = idx;
      const s = Math.max(0, Math.min(100, Math.round(score)));
      traceEvent(`cruise: ${hurdle?.type} finished ${s}`);
      if (s >= 60) earn(s >= 85 ? 15 : 8, `${hurdle ? HURDLE_META[hurdle.type].title : "Hurdle"} ${s >= 85 ? "handled cleanly" : "solved"}`);
      if (s >= 60) award(s, hurdle ? HURDLE_META[hurdle.type].title : "Hurdle", { tone: s >= 85 ? "amber" : "go" });
      else miss();
      patch("cruise", { idx, stage: "done", results: [...results.slice(0, idx), s], lastScore: s, lastNote: note ?? "" });
    },
    [patch, idx, results, hurdle?.type],
  );
  H.finish = finish;
  // optional supply-point jobs: results live in phaseData.cruise.act_<id>
  J.plan = plan;
  J.seed = plan?.seed ?? 1;
  J.patch = (d) => patch("cruise", d);
  for (const id of JOB_ORDER) {
    const r = (data as Record<string, unknown>)[`act_${id}`];
    if (typeof r === "string") J.acts[id] = r;
  }
  useJob((s) => s.v);
  useEventGuard(J.active !== null); // a supply job in progress is a critical moment

  // --- set up the model whenever the hurdle or stage changes
  useEffect(() => {
    if (!hurdle) return;
    if (H.idx !== idx || H.type !== hurdle.type) resetH(idx, hurdle.type);
    H.checks = stage === "brief" && H.idx === idx ? Array.from(new Set([...H.checks, ...(data.checks ?? [])])) : (data.checks ?? []);
    if (stage === "play") {
      if (!H.d.step && H.d.t === undefined) H.d = initD({ type: hurdle.type, level, seed, fx, solo: !!solo, timeMult: timeMultRef.current });
      if (data.hs && data.hs.idx === idx && !actor) adopt(data.hs.d as never);
      if (hurdle.type === "debris_field") {
        rt.seed = seed;
        rt.level = level;
        rt.actor = actor;
        rt.t = 0;
        rt.hits = 0;
        rt.x = rt.y = 0;
        rt.tAt = 0;
        rt.playing = false;
        if (actor) setDebris(true);
      }
    } else {
      setDebris(false);
      rt.playing = false;
      if (stage === "done") cam.mode = "walk";
      if (stage === "brief") H.d = {};
    }
    bump();
    traceEvent(`cruise: hurdle ${idx + 1} ${stage} (${hurdle.type})`);
  }, [idx, stage, hurdle?.type]);
  useEffect(() => {
    H.checks = Array.from(new Set([...H.checks, ...(data.checks ?? [])])); // union: never drop a tick that arrived by event
    bump();
  }, [data.checks?.length]);
  useEffect(() => () => {
    setDebris(false);
    rt.playing = false;
    rt.progressTarget = 0;
    rt.progress = 0;
    cam.mode = "walk";
    H.stage = "brief";
    H.d = {};
    J.streak = 0;
    J.active = null;
    J.acts = {};
    J.lastMsg = "";
  }, []);

  // --- network: helpers' actions reach the actor, the actor's stream reaches everyone, check-offs reach everyone
  useEffect(() => {
    return onServerEvent((m) => {
      if (m.type !== "event") return;
      const d = m.data as Record<string, unknown> | undefined;
      if (!d || d.idx !== H.idx) return;
      if (m.kind === "cruise_help" && H.actor && H.stage === "play") applyAct(String(d.kind), (d.p as Record<string, unknown>) ?? {}, m.from ?? "");
      else if (m.kind === "cruise_live" && !H.actor && H.stage === "play" && d.snap) adopt(d.snap as never);
      else if (m.kind === "cruise_check" && H.stage === "brief") {
        const key = `${d.idx}:${d.id}`;
        if (!H.checks.includes(key)) {
          H.checks = [...H.checks, key];
          traceEvent(`cruise: check ${d.id}`);
          bump();
          if (H.actor) patch("cruise", { checks: H.checks });
        }
      }
    });
  }, [patch]);

  // --- checks done -> the problem appears (actor starts it)
  const left = checksFor(idx).filter((c) => !H.checks.includes(`${idx}:${c.id}`));
  useEffect(() => {
    if (stage !== "brief" || !actor || !hurdle || left.length > 0 || !revealed) return;
    const t = setTimeout(() => patch("cruise", { idx, stage: "play", results }), 1200);
    return () => clearTimeout(t);
  }, [stage, actor, left.length, idx, revealed, hurdle?.type]);
  useEffect(() => {
    if (stage !== "brief" || left.length > 0 || !revealed || !hurdle) return;
    say(checksDone(checksFor(idx).map((c) => c.done)), { once: `checks:${plan?.id}:${idx}` });
  }, [stage, left.length, idx, revealed]);

  // --- the problem: story once, then Houston narrates each step as it happens
  const step = (H.d.step ?? 0) as number;
  useEffect(() => {
    if (!revealed || !hurdle || stage !== "play") return;
    say({ who: "capcom", text: hurdle.story }, { once: `story:${plan?.id}:${idx}` });
  }, [revealed, hurdle, idx, stage]);
  useEffect(() => {
    if (!revealed || !hurdle || stage !== "play" || step < 1) return;
    const line = hurdleStep(hurdle.type, step, H.d, level);
    traceEvent(`cruise: step ${step} (${hurdle.type})`);
    if (line) say(line, { once: `step:${plan?.id}:${idx}:${step}` });
  }, [step, stage, idx, revealed]);
  const hits = (H.d.hits ?? 0) as number;
  useEffect(() => {
    if (hurdle?.type !== "debris_field" || stage !== "play" || hits < 1) return;
    traceEvent(`cruise: hull hit ${hits}`);
    say(debrisHit(hits), { once: `hit:${plan?.id}:${idx}:${hits}` });
  }, [hits, stage]);
  useEffect(() => {
    if (stage !== "done" || !hurdle) return;
    say(hurdleOutcome(hurdle.type, data.lastScore ?? 0, data.lastNote ?? "", names?.[hurdle.role]), { once: `ack:${plan?.id}:${idx}` });
    if (hurdle.type === "debris_field") cam.mode = "walk";
  }, [stage, idx]);
  // leave the exterior view when the flight is over
  useEffect(() => {
    if (hurdle?.type === "debris_field" && cam.mode === "fly" && (stage !== "play" || step > 2 || H.d.done)) cam.mode = "walk";
  });
  // persist the actor's progress so a reload or a late joiner picks up where it was
  useEffect(() => {
    if (stage !== "play" || !actor || !hurdle) return;
    patch("cruise", { hs: { idx, d: snapshot() } });
  }, [v, stage]);

  useEffect(() => {
    setMusicOverride(stage === "play" ? "hurdle" : null);
  }, [stage]);
  useEffect(() => () => setMusicOverride(null), []);

  // journey progress for the scene: Earth shrinks, Moon grows
  const frac = stage === "done" ? 1 : stage === "play" ? 0.45 + 0.5 * Math.min(1, step / Math.max(1, (STEP_TEXT[hurdle?.type ?? "engine_fault"].length - 1))) : 0.4 * (1 - left.length / 3);
  useEffect(() => {
    rt.progressTarget = n ? (idx + frac) / n : 1;
  }, [idx, frac, n]);

  const advance = useCallback(() => {
    if (idx + 1 < n) patch("cruise", { idx: idx + 1, stage: "brief", checks: [], hs: null });
    else {
      const all = results.length ? results : [data.lastScore ?? 50];
      const score = all.reduce((a, b) => a + b, 0) / all.length;
      grade("cruise", score, { title: "Cruise grade", once: `cruise:${plan?.id}` });
      complete("cruise", score);
    }
  }, [patch, complete, idx, n, results, data.lastScore, plan?.id]);
  useEffect(() => {
    if (stage !== "done" || !actor) return;
    const t = setTimeout(advance, 8000);
    return () => clearTimeout(t);
  }, [stage, actor, advance]);

  if (!plan || !hurdle) {
    return <PhaseTitle step={phaseLabel("cruise")} title="Coasting to the Moon" subtitle="Waiting for the mission plan..." />;
  }

  const meta = HURDLE_META[hurdle.type];
  const role = ROLE_INFO[hurdle.role];
  const holder = state?.players.find((p) => rolesOf(p).includes(hurdle.role) && p.connected);
  const actorName = actor ? "You" : (holder?.name ?? state?.players.find((p) => p.isHost)?.name ?? "The host");
  const perkId = PERK_FOR[hurdle.type];
  const perk = perkId && perkOwned === perkId ? PERKS[perkId] : null;
  const fact = hurdle.fact_id ? plan.facts.find((f) => f.id === hurdle.fact_id && f.verified) : undefined;
  const avg = results.length ? Math.round(results.reduce((a, b) => a + b, 0) / results.length) : null;
  const moonKm = Math.round(384400 * (1 - (idx + frac) / n) + 3200);
  const aim = useAim.getState();

  // what to show as the next objective
  let primary: Job | null = null;
  let second: Job | null = null;
  let heading = "";
  if (stage === "brief") {
    const jobs = checkJobs(idx);
    primary = jobs[0] ?? null;
    heading = "Systems check";
  } else if (stage === "play") {
    const m = mainJob(hurdle.type);
    const h = helpJob(hurdle.type);
    if (actor) {
      primary = m;
      second = h && (solo ? null : h);
      heading = `${role.label}: this one is yours`;
    } else {
      primary = h;
      second = null;
      heading = `Help ${actorName}`;
    }
    if (actor && !primary && hurdle.type === "debris_field") heading = "Flying";
  }
  const timed = timeLeft(hurdle.type, stage);

  return (
    <>
      <PhaseTitle step={phaseLabel("cruise", `Hurdle ${idx + 1} of ${n}`)} title={stage === "brief" ? "Routine checks" : meta.title} subtitle={stage === "play" ? undefined : undefined} />

      {/* objective */}
      {stage !== "done" && (
        <div className="pointer-events-none absolute left-5 top-24 w-[min(26rem,calc(100vw-2.5rem))]">
          <Panel className="space-y-2 !p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: stage === "brief" ? "#4ade80" : actor ? role.color : "#6fd3ff" }} />
              <span className="text-dim">{heading}</span>
              {stage === "play" && (
                <span className="ml-auto flex gap-1">
                  {STEP_TEXT[hurdle.type].map((_, i) => (
                    <span key={i} className={`h-1.5 w-5 rounded-full ${i < step ? "bg-go" : i === step ? "bg-amber" : "bg-white/15"}`} />
                  ))}
                </span>
              )}
            </div>
            {stage === "brief" ? (
              <>
                <div className="text-sm text-white">Everyone pitches in. Do the three checks, then Houston calls.</div>
                <ul className="space-y-1 text-sm">
                  {checksFor(idx).map((c) => {
                    const done = H.checks.includes(`${idx}:${c.id}`);
                    return (
                      <li key={c.id} className={`flex items-center gap-2 ${done ? "text-go" : "text-white"}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-sm border ${done ? "border-go bg-go/40" : "border-white/40"}`} />
                        <span className="flex-1">{c.label}</span>
                        {!done && <span className="num text-[11px] text-dim">{bearing(c.pos)}</span>}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : primary ? (
              <>
                <div className={`text-base leading-snug ${primary.waiting ? "text-white/70" : "text-white"}`}>{primary.text}</div>
                {primary.pos && !primary.waiting && (
                  <div className="num text-[11px] text-dim">
                    {primary.where}: {bearing(primary.pos)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-base text-white">{step >= 2 && hurdle.type === "debris_field" ? "Steer through the gaps. Arrow keys, WASD or the mouse." : "Stand by."}</div>
            )}
            {second && (
              <div className="border-t border-line pt-2 text-xs text-cyan">
                Crew help: {second.text}
              </div>
            )}
            {actor && solo && stage === "play" && helpJob(hurdle.type) && (
              <div className="border-t border-line pt-2 text-xs text-dim">An AI crewmate is on: {helpJob(hurdle.type)!.text.toLowerCase()}</div>
            )}
            {stage === "play" && <div className="text-xs text-amber">{STAKES[hurdle.type]}</div>}
            {stage === "play" && H.d.cue && <CueFlash key={H.d.cue.n} text={H.d.cue.text} />}
            {perk && stage === "play" && <div className="text-xs text-go">{perk.name}: {perk.effect}</div>}
            {timed && <TimeBar left={timed.left} total={timed.total} label={timed.label} />}
          </Panel>
        </div>
      )}

      {/* readouts of the current problem */}
      {stage === "play" && <Readouts type={hurdle.type} actor={actor} />}

      {/* crosshair + aim prompt */}
      {cam.mode === "walk" && stage !== "done" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className={`h-2 w-2 rounded-full ${aim.id ? "bg-amber" : "bg-white/50"}`} />
          {aim.label && (
            <div className="mt-6 rounded-md border border-line bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur">
              <span className="num mr-2 rounded bg-amber px-1.5 py-0.5 text-xs font-semibold text-black">{aim.hold ? "HOLD E" : "E"}</span>
              {aim.label}
            </div>
          )}
        </div>
      )}
      {cam.mode === "sextant" && <SextantView />}
      {cam.mode === "fly" && <FlyHud />}

      {stage !== "done" && cam.mode === "walk" && <JobsPanel idx={idx} />}
      <JobOverlay />

      {/* journey strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2 text-xs backdrop-blur-md">
          <span className="text-dim">Earth</span>
          <div className="flex items-center gap-1.5">
            {hurdles.map((h, i) => (
              <span key={i} title={HURDLE_META[h.type].title} className={`h-2.5 w-10 rounded-full ${i < results.length && !(i === idx && stage !== "done") ? "bg-go" : i === idx ? "bg-amber" : "bg-white/15"}`} />
            ))}
          </div>
          <span className="text-dim">Moon</span>
          <span className="num text-white/80">{moonKm.toLocaleString()} km to go</span>
          {avg !== null && <span className="num text-white/80">avg {avg}</span>}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 right-5 hidden max-w-xs text-right text-[11px] leading-relaxed text-dim lg:block">
        WASD fly, Space up, C down, Shift boost. Drag the mouse to look (double-click to lock the pointer). E or click to use. F grabs a handhold.
      </div>

      {stage === "play" && (
        <div className="absolute right-4 top-14">
          {actor ? (
            <SkipButton after={150} label="Stuck? Skip this hurdle (score 30)" onSkip={() => { damage(COST.severe, "Gave up on the hurdle"); finish(30, "Skipped."); }} />
          ) : isHost ? (
            <SkipButton after={180} label="Skip hurdle (host)" onSkip={() => { damage(COST.severe, "Hurdle abandoned"); finish(40, "Skipped by the host."); }} />
          ) : null}
        </div>
      )}
      {stage === "brief" && (
        <div className="absolute right-4 top-14">
          {actor && <SkipButton after={120} label="Skip the checks" onSkip={() => patch("cruise", { idx, stage: "play", results })} />}
        </div>
      )}

      {stage === "done" && (
        <div className="absolute bottom-20 left-5 right-5 sm:right-auto">
          <Panel className="w-full max-w-md space-y-3 text-center">
            <div className="text-sm text-dim">{meta.title} complete</div>
            <div className="num text-6xl font-semibold text-amber">{data.lastScore ?? 0}</div>
            {data.lastNote && <p className="text-white/80">{data.lastNote}</p>}
            {fact && (
              <div className="rounded-lg bg-white/5 p-3 text-left text-sm">
                <div className="mb-1 text-xs text-cyan">Did you know</div>
                <p className="text-white/85">{fact.text}</p>
                <a href={fact.source_url} target="_blank" rel="noreferrer" className="pointer-events-auto mt-1 inline-block text-xs text-dim underline">{fact.source_name}</a>
              </div>
            )}
            {actor ? <Button onClick={advance}>{idx + 1 < n ? "Next: back to routine checks" : "Continue to the Moon"}</Button> : <div className="text-sm text-dim">Next up in a moment...</div>}
          </Panel>
        </div>
      )}
    </>
  );
}

const STAKES: Record<string, string> = {
  engine_fault: `Stakes: a seized valve -${COST.major}, venting fuel -${COST.minor}, out of time -${COST.severe} integrity.`,
  solar_storm: `Stakes: each crew member outside the shield when time runs out -${COST.major} integrity.`,
  nav_correction: `Stakes: a bad burn -${COST.minor} to -${COST.major}, slow sights -${COST.minor} integrity.`,
  comms_blackout: `Stakes: turning the dish the wrong way -${COST.minor}, no link in time -${COST.severe} integrity.`,
  debris_field: `Stakes: each rock hit -${COST.major}, each unpatched breach -${COST.minor} integrity.`,
};
function CueFlash({ text }: { text: string }) {
  return <div className="rounded bg-nogo/25 px-2 py-1 text-xs font-medium text-nogo">{text}</div>;
}

function timeLeft(type: string, stage: string): { left: number; total: number; label: string } | null {
  if (stage !== "play") return null;
  const d = H.d;
  if (type === "engine_fault" && d.lim) return { left: Math.max(0, d.lim - d.t), total: d.lim, label: "Time left" };
  if (type === "solar_storm" && d.step >= 1) return { left: Math.max(0, d.lim - (d.t - d.alarmT)), total: d.lim, label: "Storm arrives in" };
  if (type === "debris_field" && d.step === 2) return { left: Math.max(0, DEBRIS_SECONDS - rt.t), total: DEBRIS_SECONDS, label: "Debris field" };
  return null;
}

function TimeBar({ left, total, label }: { left: number; total: number; label: string }) {
  const f = Math.max(0, Math.min(1, left / total));
  const hot = f < 0.25;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-dim">{label}</span>
        <span className={`num ${hot ? "text-nogo" : "text-white"}`}>{Math.ceil(left)} s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${hot ? "bg-nogo" : "bg-cyan"}`} style={{ width: `${f * 100}%` }} />
      </div>
    </div>
  );
}

function Bar({ label, value, tone = "bg-cyan", note }: { label: string; value: number; tone?: string; note?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-dim">{label}</span>
        {note && <span className="num text-white/80">{note}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
    </div>
  );
}

/** Live numbers for the current problem (read from the shared hurdle state at 5 Hz). */
function Readouts({ type, actor }: { type: string; actor: boolean }) {
  const d = H.d;
  if (!d || d.step === undefined) return null;
  const rows: React.ReactNode[] = [];
  if (type === "engine_fault" && d.valves) {
    rows.push(<Bar key="p" label="Pump prime" value={d.prime} tone="bg-go" note={`${Math.round(d.prime * 100)}%`} />);
    rows.push(
      <div key="v" className="flex gap-1.5 text-[11px]">
        {(d.valves as number[]).map((o, i) => (
          <span key={i} className={`rounded px-1.5 py-0.5 ${o ? (i === 5 ? "bg-nogo/30 text-nogo" : "bg-cyan/25 text-cyan") : "bg-white/10 text-dim"}`}>{i === 5 ? "vent" : `V${i}`} {o ? "open" : "shut"}</span>
        ))}
      </div>,
    );
    rows.push(<div key="i" className="text-[11px] text-dim">Tank isolation {d.iso[0] && d.iso[1] ? "done" : "pending"}. Wrong turns: {d.wrong}.</div>);
  }
  if (type === "solar_storm" && d.step >= 1) {
    rows.push(<Bar key="a" label="Shield valve, right wall" value={d.wheelA} tone="bg-cyan" />);
    rows.push(<Bar key="b" label="Shield valve, left wall" value={d.wheelB} tone="bg-cyan" />);
    rows.push(<div key="c" className="text-sm text-white">Behind the shield: <span className="num text-go">{d.inCount ?? 0}</span> of <span className="num">{d.total ?? "?"}</span> crew</div>);
  }
  if (type === "nav_correction") {
    rows.push(<div key="i" className="text-[11px] text-dim">Gyros: {d.imu.filter(Boolean).length} of 3 aligned. Marks: {d.marks} of 2.</div>);
    if (d.step === 3) rows.push(<Bar key="b" label="Delta-V" value={d.burn} tone="bg-amber" note={`${(d.burn * 5).toFixed(1)} of ${(d.burnTgt * 5).toFixed(1)} m/s`} />);
    rows.push(<div key="t" className="text-[11px] text-dim">Attitude: {d._held?.att || (actor && H.d._help?.att && performance.now() / 1000 - H.d._help.att < 0.45) ? "held steady" : "drifting"}</div>);
  }
  if (type === "comms_blackout" && d.step >= 1) {
    rows.push(<Bar key="s" label="Signal strength" value={d.sig} tone={d.sig > 0.8 ? "bg-go" : "bg-amber"} note={`${Math.round(d.sig * 100)}%`} />);
    rows.push(<Bar key="l" label="Lock" value={d.lock} tone="bg-go" />);
    rows.push(<div key="a" className="text-[11px] text-dim">S-band amplifier {d.amp[0] && d.amp[1] ? "on" : "off"}. Receiver {d._held?.freq || Math.abs(d.fr - d.frT) < 8 ? "tuned" : "off frequency"}.</div>);
  }
  if (type === "debris_field" && d.step >= 1) {
    rows.push(
      <div key="h">
        <div className="mb-1 text-xs text-dim">Hull integrity</div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className={`h-2.5 flex-1 rounded-full ${i < 3 - (d.hits ?? 0) ? "bg-go" : "bg-nogo/40"}`} />)}
        </div>
      </div>,
    );
    rows.push(<div key="b" className="text-[11px] text-dim">Open breaches: {(d.breaches as number[]).filter(Boolean).length}. Patch kits {d.armed[0] && d.armed[1] ? "armed" : "not armed"}.</div>);
  }
  if (!rows.length) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-24 w-64">
      <Panel className="space-y-2.5 !p-3">{rows}</Panel>
    </div>
  );
}

/** Sextant eyepiece: reticle, the star's offset and the hold ring. */
function SextantView() {
  useTick(60);
  const d = H.d;
  const scale = 380 / SEXTANT_FOV; // px per degree at this fov (approx, centre of view)
  const ex = (d.ex ?? 0) * scale;
  const ey = (d.ey ?? 0) * scale;
  const inView = Math.abs(d.ex) < SEXTANT_FOV / 2 && Math.abs(d.ey) < SEXTANT_FOV / 2;
  const ok = (d.err ?? 99) < (d.tol ?? 0.6);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at center, transparent 0, transparent 36vh, rgba(0,0,0,0.92) 37vh)" }} />
      <div className="relative h-[72vh] w-[72vh]">
        <div className={`absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${ok ? "border-go" : "border-white/60"}`} />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-white/25" />
        {!inView && (
          <div className="absolute left-1/2 top-1/2 text-amber" style={{ transform: `translate(-50%,-50%) rotate(${Math.atan2(-d.ey, -d.ex) * -1 + Math.PI}rad) translateX(200px)` }}>
            {"▶"}
          </div>
        )}
      </div>
      <div className="absolute bottom-24 flex flex-col items-center gap-2">
        <div className="rounded-md bg-black/70 px-3 py-1.5 text-sm text-white">
          {d.name ?? "Star"}: off by <span className="num text-amber">{(d.err ?? 0).toFixed(1)}</span> degrees. {ok ? "Hold it there." : "Steer with WASD or the arrow keys until it sits in the circle."}
        </div>
        <div className="h-2 w-64 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-go" style={{ width: `${(d.hold ?? 0) * 100}%` }} />
        </div>
        <button className="pointer-events-auto rounded-md border border-line bg-black/60 px-3 py-1 text-xs text-white/80" onClick={() => { cam.mode = "walk"; act("sextant", { on: 0 }); }}>
          Step back from the sextant (Esc)
        </button>
      </div>
      <EscWatcher />
      <span className="hidden">{ex + ey}</span>
    </div>
  );
}

function EscWatcher() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key.toLowerCase() === "e") {
        cam.mode = "walk";
        act("sextant", { on: 0 });
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  return null;
}

function FlyHud() {
  useTick(100);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
      <div className="rounded-md bg-black/60 px-3 py-1.5 text-sm text-white">Fly through the gap in every wall of rocks. Arrow keys, WASD or the mouse.</div>
    </div>
  );
}

function JobsPanel({ idx }: { idx: number }) {
  useTick(250);
  useJob((s) => s.v);
  return (
    <div className="pointer-events-none absolute bottom-16 left-5 w-[23rem] max-w-[calc(100vw-2.5rem)]">
      <Panel className="space-y-1.5 !p-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-dim">Optional jobs: earn supply points</span>
          {J.streak > 1 && <span className="num text-amber">streak x{J.streak}</span>}
        </div>
        {JOB_ORDER.map((id) => {
          const r = J.acts[id];
          const meta = JOBS[id];
          return (
            <div key={id} className="text-[12px] leading-snug" title={`${meta.reward} ${meta.fail}`}>
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${r ? (r.startsWith("done") ? "bg-go" : "bg-nogo/60") : J.active === id ? "bg-amber" : "border border-white/40"}`} />
                <span className={r ? "text-dim" : "text-white"}>{meta.title}</span>
                <span className="num ml-auto text-cyan">{r ? (r.startsWith("done") ? `+${r.split(":")[1]} SP` : "missed") : id === "quiz" ? "up to 24 SP" : id === "photo" ? "up to 18 SP" : id === "diag" ? "12 SP (x2)" : "40 / 80 SP"}</span>
              </div>
              {!r && (
                <div className="pl-4.5 pl-[18px] text-[11px] text-dim">
                  {meta.where}: {bearing(jobPos(id))}. {meta.fail}
                </div>
              )}
            </div>
          );
        })}
        {J.lastMsg && <div className="border-t border-line pt-1.5 text-xs text-white/80">{J.lastMsg}</div>}
      </Panel>
    </div>
  );
}

/** On-screen aids while a job is running: the photo frame sweep, the quiz question echo. */
function JobOverlay() {
  useTick(40);
  useJob((s) => s.v);
  if (J.active === "photo") {
    const pos = photoPos(J.t, J.shot);
    const w = photoWidth();
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-28 flex flex-col items-center gap-2">
        <div className="rounded-md bg-black/70 px-3 py-1.5 text-sm text-white">Frame {Math.min(3, J.shot + 1)} of 3: press E (or click) when the marker is inside the green window.</div>
        <div className="relative h-4 w-80 overflow-hidden rounded-full bg-white/15">
          <div className="absolute top-0 h-full bg-go/70" style={{ left: `${(0.5 - w / 2) * 100}%`, width: `${w * 100}%` }} />
          <div className="absolute top-0 h-full w-1 bg-white" style={{ left: `${pos * 100}%` }} />
        </div>
        {J.flash > 0.1 && <div className="text-sm text-go">Sharp.</div>}
        {J.flash < -0.1 && <div className="text-sm text-nogo">Blurred.</div>}
      </div>
    );
  }
  if (J.active === "quiz") {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-6">
        <div className="max-w-xl rounded-md bg-black/75 px-4 py-2 text-center text-sm text-white">
          <div className="mb-1 text-xs text-amber">Question {J.qi + 1} of 3{J.qBet ? ", doubled" : ""}. Press the green TRUE or red FALSE button on the console.</div>
          {J.qs[J.qi]?.text}
        </div>
      </div>
    );
  }
  if (J.active === "diag") {
    return <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center"><div className="rounded-md bg-black/70 px-3 py-1.5 text-sm text-white">One bar is out of range. Press the button under it. {Math.max(0, Math.ceil(diagLimit() - J.dT))} s left.</div></div>;
  }
  if (J.active === "eva") {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-28 flex flex-col items-center gap-2">
        <div className="rounded-md bg-black/70 px-3 py-1.5 text-sm text-white">Hold E on the airlock hatch to work. Risk climbs while you work; release to cool down. {J.eMode === "risky" ? "RISKY: 80 SP." : "Standard: 40 SP."}</div>
        <div className="w-80 space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-go" style={{ width: `${J.work * 100}%` }} /></div>
          <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className={`h-full ${J.risk > 0.7 ? "bg-nogo" : "bg-amber"}`} style={{ width: `${Math.min(1, J.risk) * 100}%` }} /></div>
        </div>
      </div>
    );
  }
  return null;
}
void shoot;
void available;
