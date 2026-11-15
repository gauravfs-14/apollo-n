"use client";
// Journey map: pick a level, read a short briefing, play. The host's journey decides the level for the crew.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { say } from "../../core/comms";
import { useGame, usePhaseData } from "../../core/useGame";
import fallbackPlan from "../../data/fallback-plan.json";
import { LEVEL_COUNT, fitPlanToLevel, levelDef } from "../../journey/levels";
import { useJourney, useJourneyStore } from "../../journey/progress";
import type { MissionPlan } from "../../types";
import { Button } from "../../ui/kit";
import { JourneyMap, type NodeState } from "./JourneyMap";

interface SelectData {
  level?: number;
  current?: number;
  stars?: Record<number, number>;
}

const DIFF_LABEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;
const DIFF_TONE = { easy: "text-go border-go/40", normal: "text-cyan border-cyan/40", hard: "text-nogo border-nogo/40" } as const;

/** The plan stored for this level, else a fresh one from the API (then remembered), else the offline plan. */
async function loadPlan(level: number): Promise<MissionPlan> {
  const store = useJourneyStore.getState();
  const id = store.plans[level];
  if (id) {
    try {
      return await api<MissionPlan>(`/missions/${id}`);
    } catch {
      /* forgotten by the server: make a new one */
    }
  }
  try {
    const plan = await api<MissionPlan>("/missions", { difficulty: levelDef(level).difficulty, level });
    store.setPlan(level, plan.id);
    return plan;
  } catch {
    return fitPlanToLevel(fallbackPlan as unknown as MissionPlan, level);
  }
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SelectHud() {
  const { isHost, patch, action, complete, state } = useGame();
  const shared = usePhaseData<SelectData>("select");
  const j = useJourney();
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [peek, setPeek] = useState<{ level: number; plan: MissionPlan } | null>(null);
  const started = useRef(false);

  const hostView = isHost;
  const current = hostView ? j.current : (shared.current ?? 1);
  const crewLevel = hostView ? undefined : shared.level;
  const selected = hostView ? (picked ?? j.current) : (shared.level ?? current);
  const starsOf = (n: number) => (hostView ? (j.done[n]?.stars ?? 0) : (shared.stars?.[n] ?? 0));
  const stateOf = (n: number): NodeState => (starsOf(n) > 0 ? "done" : n <= current ? "available" : "locked");
  const def = levelDef(selected);
  const st = stateOf(selected);
  const playable = hostView && st !== "locked" && j.hydrated;
  const starsKey = JSON.stringify(j.done);

  // crew sees what the commander is looking at
  useEffect(() => {
    if (!isHost || !j.hydrated) return;
    const stars: Record<number, number> = {};
    for (const [k, v] of Object.entries(j.done)) stars[Number(k)] = v.stars;
    patch("select", { level: selected, current: j.current, stars });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, j.hydrated, selected, j.current, starsKey, patch]);

  // load (and remember) the mission for the level being looked at, so the briefing can cite its source
  useEffect(() => {
    if (!isHost || !j.hydrated || st === "locked") return;
    let alive = true;
    void loadPlan(selected).then((plan) => alive && setPeek({ level: selected, plan }));
    return () => {
      alive = false;
    };
  }, [isHost, j.hydrated, selected, st]);

  const play = useCallback(
    async (level: number) => {
      if (started.current) return;
      started.current = true;
      setBusy(true);
      const cached = peek?.level === level ? peek.plan : null;
      const plan = cached ?? (await loadPlan(level));
      patch("select", { level });
      action("select", "set_plan", { plan });
      api(`/missions/${plan.id}/chosen`, {}).catch(() => {});
      const brief = plan.voice_lines.find((v) => v.id === "brief_1");
      if (brief) say({ who: "capcom", text: brief.text }, { interrupt: true });
      complete("select", 100);
    },
    [peek, patch, action, complete],
  );

  // Next level / Retry level from the report: start straight away
  const auto = j.autoPlay;
  useEffect(() => {
    if (!isHost || !j.hydrated || auto === null || state?.phase !== "select") return;
    useJourneyStore.getState().setAutoPlay(null);
    void play(auto);
  }, [auto, isHost, j.hydrated, state?.phase, play]);

  const plan = peek?.level === selected ? peek.plan : null;
  const best = hostView ? j.done[selected] : undefined;
  const lead = selected > 1 ? levelDef(selected - 1).title : "";

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[40rem] bg-gradient-to-r from-black/70 via-black/35 to-transparent" />

      <header className="pointer-events-none absolute left-6 top-5 w-[28rem]">
        <div className="num text-[11px] text-amber">APOLLO N / JOURNEY</div>
        <h2 className="text-2xl font-semibold leading-tight">{hostView ? `Level ${Math.min(j.current, LEVEL_COUNT)} of ${LEVEL_COUNT}` : "Your commander picks the level"}</h2>
        {hostView && (
          <div className="mt-1 flex items-center gap-3 text-sm text-dim">
            <span>
              <span className="num text-[#ffcf5a]">{j.stars}</span> of {LEVEL_COUNT * 3} stars
            </span>
          </div>
        )}
      </header>

      <div className="absolute bottom-3 left-[max(0.5rem,5vw)] top-24 w-[440px] max-w-[46vw]">
        <JourneyMap stateOf={stateOf} starsOf={starsOf} current={current} selected={selected} onSelect={(n) => hostView && setPicked(n)} crewLevel={crewLevel} />
      </div>

      <aside className="pointer-events-auto absolute right-6 top-1/2 w-[min(23rem,calc(100vw-3rem))] -translate-y-1/2 rounded-2xl border border-line bg-panel p-5 shadow-2xl shadow-black/50 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <span className="num text-[11px] text-amber">LEVEL {def.n}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${DIFF_TONE[def.difficulty]}`}>{DIFF_LABEL[def.difficulty]}</span>
        </div>
        <h3 className="mt-1 text-2xl font-semibold leading-tight">{def.title}</h3>
        <p className="mt-2 text-[15px] leading-snug text-white/85">{def.goal}</p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-dim">New here</dt>
          <dd className="text-white/90">{def.fresh}</dd>
          <dt className="text-dim">Hazards</dt>
          <dd className="num text-white/90">{def.hazards}</dd>
          {best && (
            <>
              <dt className="text-dim">Best</dt>
              <dd className="num text-white/90">
                {best.stars} of 3 stars, {Math.round(best.score)} points
              </dd>
            </>
          )}
        </dl>

        <div className="mt-5">
          {hostView ? (
            st === "locked" ? (
              <>
                <Button disabled className="w-full py-3 text-base">
                  Locked
                </Button>
                <p className="mt-2 text-center text-[12px] text-dim">Finish level {selected - 1}{lead ? `, ${lead}` : ""}, to open this one.</p>
              </>
            ) : (
              <Button onClick={() => play(selected)} disabled={busy || !playable} className="w-full py-3 text-base">
                {busy ? "Starting..." : st === "done" ? `Replay level ${selected}` : `Play level ${selected}`}
              </Button>
            )
          ) : (
            <p className="num rounded-lg border border-line bg-black/30 px-3 py-2.5 text-center text-sm text-cyan">
              {crewLevel ? `Crew is on level ${crewLevel}. Waiting for the commander.` : "Waiting for the commander..."}
            </p>
          )}
        </div>

        <div className="mt-3 border-t border-line pt-2.5">
          <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="text-[12.5px] text-cyan hover:underline">
            {more ? "Hide details" : "Learn more"}
          </button>
          {more && (
            <div className="mt-2 text-[12.5px] leading-snug text-white/80">
              {plan ? (
                <>
                  <p>{plan.tagline}</p>
                  <a href={plan.inspired_by.source_url} target="_blank" rel="noreferrer" className="mt-1.5 block text-cyan hover:underline">
                    Based on: {plan.inspired_by.name} ({host(plan.inspired_by.source_url)})
                  </a>
                </>
              ) : (
                <p className="text-dim">Every mission is written from recent real lunar news. {st === "locked" ? "Its source is shown once the level opens." : "Loading the source..."}</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
