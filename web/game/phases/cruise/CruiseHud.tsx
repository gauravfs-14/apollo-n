"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Cruise HUD: runs plan.cruise hurdles in order. Briefing -> play -> score card, driven by phaseData.cruise.
import { useCallback, useEffect, useRef } from "react";
import { commsIdle, onlyChatter, say } from "../../core/comms";
import { chatterAt, CRUISE_START, HURDLE_MISS, HURDLE_OK } from "../../data/missionComms";
import { setMusicOverride } from "../../core/music";
import { usePhaseData, useGame } from "../../core/useGame";
import { perkEffects, PERKS, type PerkId } from "../../data/perks";
import { Button, Panel, PhaseTitle } from "../../ui/kit";
import { ROLE_INFO } from "../crew/data";
import { type CruiseData, HURDLE_META, levelOf, useLive, useSeconds, type HurdleCtx } from "./flow";
import { CommsBlackout } from "./hurdles/CommsBlackout";
import { DebrisHud } from "./hurdles/DebrisHud";
import { EngineFault } from "./hurdles/EngineFault";
import { NavCorrection } from "./hurdles/NavCorrection";
import { SolarStorm } from "./hurdles/SolarStorm";
import { rt, setDebris } from "./rt";
import { phaseLabel } from "../../ui/phaseLabel";
import { useRevealed } from "../../core/loading";

const PERK_FOR: Partial<Record<string, PerkId>> = { solar_storm: "water_shield", engine_fault: "spare_parts", comms_blackout: "high_gain_antenna" };

function SkipButton({ after, onSkip, label }: { after: number; onSkip: () => void; label: string }) {
  const s = useSeconds();
  if (s < after) return null;
  return (
    <button onClick={onSkip} className="pointer-events-auto rounded-md border border-line bg-black/50 px-3 py-1.5 text-xs text-white/80 backdrop-blur hover:text-white">
      {label}
    </button>
  );
}

export function CruiseHud() {
  const { state, plan, isHost, patch, complete, emit, actsAs } = useGame();
  const drop = usePhaseData<{ perk: PerkId }>("drop");
  const fx = perkEffects(drop.perk);
  const hurdles = plan?.cruise ?? [];
  const n = hurdles.length;
  const data = (state?.phaseData.cruise ?? {}) as Partial<CruiseData>;
  const idx = Math.min(data.idx ?? 0, Math.max(0, n - 1));
  const stage = data.stage ?? "brief";
  const results = data.results ?? [];
  const hurdle = hurdles[idx];
  const actor = hurdle ? actsAs(hurdle.role) : false;
  const live = useLive(idx);
  const seed = plan?.seed ?? 1;
  const level = hurdle ? levelOf(plan, hurdle) : 0;
  const isDebris = hurdle?.type === "debris_field";
  const finished = useRef(-1);

  // no hurdles in the plan: nothing to do, never dead-end
  useEffect(() => {
    if (plan && n === 0 && isHost) complete("cruise", 100);
  }, [plan, n, isHost, complete]);

  // journey progress for the scene (Earth shrinks, Moon grows)
  useEffect(() => {
    rt.progressTarget = n ? (idx + (stage === "done" ? 1 : stage === "play" ? 0.5 : 0)) / n : 1;
  }, [idx, stage, n]);
  useEffect(() => () => {
    rt.progressTarget = 0;
    rt.progress = 0;
    setDebris(false);
    rt.playing = false;
  }, []);

  // debris layer lifetime: whole hurdle (brief + play)
  const debrisOn = isDebris && stage !== "done";
  useEffect(() => {
    if (!debrisOn) {
      setDebris(false);
      rt.playing = false;
      return;
    }
    rt.seed = seed * 3 + idx;
    rt.level = level;
    rt.actor = actor;
    rt.t = 0;
    rt.hits = 0;
    rt.x = rt.y = 0;
    rt.tAt = 0;
    setDebris(true);
  }, [debrisOn, idx, seed, level, actor]);
  useEffect(() => {
    rt.playing = debrisOn && stage === "play";
  }, [debrisOn, stage]);

  // story: Houston calls it up once per briefing; it cuts chatter so what you hear matches the hurdle on screen
  const revealed = useRevealed("cruise");
  useEffect(() => {
    if (!revealed || !hurdle || stage !== "brief") return;
    // the coast opens with Houston's first call, then the first hurdle
    if (idx === 0) say(CRUISE_START, { once: `open:cruise:${plan?.id}` });
    say({ who: "capcom", text: hurdle.story }, { once: `story:${plan?.id}:${idx}`, interrupt: idx > 0 && onlyChatter() && !commsIdle() });
  }, [revealed, hurdle, idx, stage, plan?.id]);

  // after each hurdle: Houston acknowledges, then one exchange from the real coast that fits the journey so far
  useEffect(() => {
    if (stage !== "done") return;
    const pool = (data.lastScore ?? 0) >= 60 ? HURDLE_OK : HURDLE_MISS;
    say(pool[(idx + seed) % pool.length], { once: `ack:${plan?.id}:${idx}` });
    if (idx + 1 < n) say(chatterAt((idx + 1) / n), { once: `chatter:${plan?.id}:${idx}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per result
  }, [stage, idx]);

  useEffect(() => {
    setMusicOverride(stage === "play" ? "hurdle" : null);
  }, [stage]);
  useEffect(() => () => setMusicOverride(null), []);

  const start = useCallback(() => patch("cruise", { idx, stage: "play", results }), [patch, idx, results]);
  const finish = useCallback(
    (score: number, note?: string) => {
      if (finished.current === idx) return;
      finished.current = idx;
      const s = Math.max(0, Math.min(100, Math.round(score)));
      patch("cruise", { idx, stage: "done", results: [...results.slice(0, idx), s], lastScore: s, lastNote: note ?? "" });
    },
    [patch, idx, results],
  );
  const advance = useCallback(() => {
    if (idx + 1 < n) patch("cruise", { idx: idx + 1, stage: "brief" });
    else {
      const all = results.length ? results : [data.lastScore ?? 50];
      complete("cruise", all.reduce((a, b) => a + b, 0) / all.length);
    }
  }, [patch, complete, idx, n, results, data.lastScore]);

  // score card: the acting player moves on after a few seconds (or sooner with Continue)
  useEffect(() => {
    if (stage !== "done" || !actor) return;
    const t = setTimeout(advance, 6500);
    return () => clearTimeout(t);
  }, [stage, actor, advance]);

  // throttled live stream
  const latest = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback(
    (d: Record<string, unknown>) => {
      latest.current = d;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (latest.current) emit("cruise_live", { idx, ...latest.current });
      }, 90);
    },
    [emit, idx],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [idx, stage]);

  if (!plan || !hurdle) {
    return <PhaseTitle step={phaseLabel("cruise")} title="Coasting to the Moon" subtitle="Waiting for the mission plan..." />;
  }

  const meta = HURDLE_META[hurdle.type];
  const role = ROLE_INFO[hurdle.role];
  const holder = state?.players.find((p) => p.role === hurdle.role && p.connected);
  const actorName = actor ? "You" : (holder?.name ?? state?.players.find((p) => p.isHost)?.name ?? "The host");
  const perkId = PERK_FOR[hurdle.type];
  const perk = perkId && drop.perk === perkId ? PERKS[perkId] : null;
  const ctx: HurdleCtx = { hurdle, idx, level, seed: seed * 3 + idx, fx, actor, live, push, finish };
  const fact = hurdle.fact_id ? plan.facts.find((f) => f.id === hurdle.fact_id && f.verified) : undefined;
  const avg = results.length ? Math.round(results.reduce((a, b) => a + b, 0) / results.length) : null;

  return (
    <>
      <PhaseTitle step={phaseLabel("cruise", `Hurdle ${idx + 1} of ${n}`)} title={meta.title} subtitle={stage === "play" ? meta.goal : undefined} />

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
          {avg !== null && <span className="num text-white/80">avg {avg}</span>}
        </div>
      </div>

      {stage === "brief" && (
        <div className="absolute bottom-20 left-5 right-5 sm:right-auto">
          <Panel className="w-full max-w-md space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color }} />
              <span style={{ color: role.color }}>{role.label}</span>
              <span className="text-dim">{actor ? "This one is yours." : `${actorName} is on this one.`}</span>
            </div>
            <p className="text-lg leading-snug text-white">{hurdle.story}</p>
            <p className="text-sm text-dim">Goal: {meta.goal}</p>
            {perk && <p className="rounded-md bg-go/10 px-3 py-2 text-sm text-go">{perk.name} helps here: {perk.effect}</p>}
            <div className="flex items-center gap-3">
              {actor ? (
                <Button onClick={start} autoFocus>Start</Button>
              ) : (
                <span className="text-sm text-dim">Waiting for {actorName} to start. You will see their progress live.</span>
              )}
              {!actor && isHost && <SkipButton after={25} label="Skip hurdle (host)" onSkip={() => { finish(40, "Skipped by the host."); }} />}
            </div>
          </Panel>
        </div>
      )}

      {stage === "play" && (
        <>
          {!actor && (
            <div className="absolute inset-x-0 top-14 flex justify-center">
              <div className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm backdrop-blur-md">
                Watching <span className="font-medium" style={{ color: role.color }}>{actorName} ({role.label})</span>
              </div>
            </div>
          )}
          {hurdle.type === "debris_field" && <DebrisHud ctx={ctx} />}
          {hurdle.type === "solar_storm" && <SolarStorm key={idx} ctx={ctx} />}
          {hurdle.type === "engine_fault" && <EngineFault key={idx} ctx={ctx} />}
          {hurdle.type === "nav_correction" && <NavCorrection key={idx} ctx={ctx} />}
          {hurdle.type === "comms_blackout" && <CommsBlackout key={idx} ctx={ctx} />}
          <div className="absolute right-4 top-14">
            {actor ? (
              <SkipButton after={70} label="Stuck? Skip this hurdle (score 30)" onSkip={() => finish(30, "Skipped.")} />
            ) : isHost ? (
              <SkipButton after={90} label="Skip hurdle (host)" onSkip={() => finish(40, "Skipped by the host.")} />
            ) : null}
          </div>
        </>
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
            {actor ? (
              <Button onClick={advance}>{idx + 1 < n ? "Next hurdle" : "Continue to the Moon"}</Button>
            ) : (
              <div className="text-sm text-dim">Next up in a moment...</div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
