"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../../core/useGame";
import { Button, Meter, Panel, PhaseTitle } from "../../ui/kit";
import type { MissionPlan } from "../../types";
import { ArLayer } from "./explore/ArLayer";
import { useAr } from "./explore/arStore";
import { loadHeritage } from "./explore/heritage";
import { ROLE_COLOR, rt, useSurface } from "./store";
import { activeTasks, finished, hintLevel, surfaceScore } from "./Tasks";
import { phaseLabel } from "../../ui/phaseLabel";

const LIMIT: Record<MissionPlan["difficulty"], number> = { easy: 360, normal: 420, hard: 540 };

function Compass() {
  const guides = useSurface((s) => s.guides);
  if (!guides.length) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center gap-1">
      {guides.slice(0, 2).map((g, i) => (
        <div key={i} className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs backdrop-blur-md">
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ transform: `rotate(${(g.angle * 180) / Math.PI}deg)` }}>
            <path d="M12 2 L19 20 L12 16 L5 20 Z" fill="#ffb547" />
          </svg>
          <span className="num text-white">{Math.round(g.dist)} m</span>
          <span className="text-dim">{g.label}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ n }: { n: number }) {
  return (
    <div className="flex items-end gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`w-2 rounded-sm ${i < n ? (n >= 3 ? "bg-go" : "bg-amber") : "bg-white/15"}`} style={{ height: 8 + i * 5 }} />
      ))}
    </div>
  );
}

export function Hud() {
  const { plan, state, actsAs, complete, isHost } = useGame();
  const h = useSurface();
  const done = useMemo(() => new Set((state?.phaseData.surface?.done as string[] | undefined) ?? []), [state?.phaseData.surface?.done]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    useSurface.getState().reset();
    useAr.getState().reset();
  }, []);
  // score time stops when the goal is reached; exploring afterwards costs nothing
  const frozen = useRef<number | null>(null);
  useEffect(() => {
    if (h.finale && !h.explore && frozen.current === null) frozen.current = useSurface.getState().elapsed;
  }, [h.finale, h.explore]);
  const canEnd = state?.mode === "solo" || isHost;
  const finish = useCallback(() => {
    if (plan) complete("surface", surfaceScore(plan, done, frozen.current ?? h.elapsed, h.mistakes));
  }, [plan, done, complete, h.elapsed, h.mistakes]);
  useEffect(() => {
    useSurface.setState({ finish: h.explore && canEnd ? finish : null });
    return () => useSurface.setState({ finish: null });
  }, [h.explore, canEnd, finish]);
  const [choice, setChoice] = useState(false);
  useEffect(() => {
    if (!h.finale || h.explore) return;
    const t = setTimeout(() => setChoice(true), 6500);
    return () => clearTimeout(t);
  }, [h.finale, h.explore]);
  const siteId = ((state?.phaseData.site ?? state?.phaseData.landing) as { site_id?: string } | undefined)?.site_id ?? plan?.destination.candidate_sites[0]?.id ?? "site_a";
  const report = (state?.phaseData.site as { report?: { lat?: number; lon?: number } } | undefined)?.report;
  const startExplore = async () => {
    useSurface.setState({ explore: true });
    let lat = report?.lat;
    let lon = report?.lon;
    if (lat == null || lon == null) {
      try {
        const meta = await fetch(`/terrain/${siteId}/meta.json`).then((r) => r.json());
        lat = meta.center.lat;
        lon = meta.center.lon;
      } catch {
        lat = -89.77;
        lon = 0;
      }
    }
    void loadHeritage(lat as number, lon as number);
  };
  useEffect(() => {
    if (!h.message) return;
    setToast(h.message);
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [h.messageId, h.message]);

  if (!plan) return null;
  const act = activeTasks(plan, done);
  const hint = hintLevel(plan.difficulty, h.mistakes);
  const fin = finished(plan, done);
  const limit = LIMIT[plan.difficulty];
  const canFinish = h.elapsed > limit && !fin && !h.explore;
  const mm = Math.floor(h.elapsed / 60);
  const ss = String(Math.floor(h.elapsed % 60)).padStart(2, "0");

  return (
    <div className="absolute inset-0">
      <div className={`pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black transition-opacity duration-1000 ${h.ready ? "opacity-0" : "opacity-100"}`}>
        <div className="text-center">
          <div className="num text-[11px] text-amber">TOUCHDOWN CONFIRMED</div>
          <div className="mt-1 text-lg">Preparing the surface</div>
        </div>
      </div>
      <PhaseTitle step={phaseLabel("surface")} title={plan.title} subtitle={plan.goal.text} />
      <ArLayer />
      <Compass />

      {h.explore && (
        <div className="absolute right-5 top-5 w-72">
          <Panel>
            <div className="text-[11px] tracking-wide text-dim">FREE EXPLORATION</div>
            <div className="mt-1 text-sm">The mission is done. Walk as far as you like. Look at a tag and press E for more.</div>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => useAr.setState((a) => ({ atlas: !a.atlas }))}>
                Atlas
              </Button>
              {canEnd ? (
                <Button className="flex-1 whitespace-nowrap" onClick={finish}>
                  Finish mission
                </Button>
              ) : null}
            </div>
            {!canEnd && <div className="mt-2 text-xs text-dim">The host ends the mission for everyone.</div>}
          </Panel>
        </div>
      )}
      {!h.explore && (
      <div className="absolute right-5 top-5 w-72">
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] tracking-wide text-dim">OBJECTIVES</div>
            <div className="num text-xs text-dim">{mm}:{ss}</div>
          </div>
          <ul className="space-y-2">
            {plan.surface.tasks.map((t) => {
              const isDone = done.has(t.id);
              const isActive = act.some((a) => a.id === t.id);
              const mine = actsAs(t.role);
              return (
                <li key={t.id} className={isActive ? "" : "opacity-50"}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${isDone ? "border-go bg-go" : isActive ? "border-amber" : "border-white/30"}`} />
                    <div className="min-w-0">
                      <div className={`text-sm leading-snug ${isDone ? "line-through decoration-white/40" : ""}`}>{t.title}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-dim">
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ROLE_COLOR[t.role] }} />
                        {t.role}
                        {isActive && !mine && <span>- waiting for them</span>}
                        {!isActive && !isDone && <span>- locked</span>}
                      </div>
                      {isActive && mine && hint && <div className="mt-1 text-xs text-cyan">{t.hint}</div>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {h.inventory.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="text-[11px] text-dim">CARRYING</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {h.inventory.map((i, k) => (
                  <span key={k} className="rounded border border-line bg-white/5 px-2 py-0.5 text-xs">
                    {i}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
      )}

      {h.exiting && (
        <div className="absolute inset-x-0 bottom-14 flex justify-center">
          <Button variant="ghost" onClick={() => (rt.skipExit = true)}>
            Skip ladder (Space)
          </Button>
        </div>
      )}

      {/* scanner gauge */}
      {h.signal !== null && !h.exiting && !h.finale && (
        <div className="absolute bottom-6 right-5 w-60">
          <Panel>
            <div className="flex items-baseline justify-between">
              <div className="text-[11px] tracking-wide text-dim">ICE SCANNER</div>
              <div className="num text-xs text-cyan">{h.scanDist !== null && h.signal > 0.02 ? `${Math.round(h.scanDist)} m` : "no signal"}</div>
            </div>
            <div className="mt-2 flex h-14 items-end gap-[3px]">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="flex-1 rounded-sm" style={{ height: `${20 + (i / 23) * 80}%`, background: i / 23 <= (h.signal ?? 0) ? (i > 17 ? "#4ade80" : "#6fd3ff") : "rgba(255,255,255,0.1)" }} />
              ))}
            </div>
            <div className="mt-1 text-[11px] text-dim">Faster beeps = closer</div>
          </Panel>
        </div>
      )}

      {h.bars !== null && (
        <div className="absolute bottom-6 left-1/2 ml-[-9rem] mb-24 w-72">
          <Panel className="flex items-center justify-between">
            <div>
              <div className="text-[11px] tracking-wide text-dim">LINK TO EARTH</div>
              <div className="text-sm">{h.bars >= 3 ? "Clear view of Earth" : "Blocked by terrain"}</div>
            </div>
            <Bars n={h.bars} />
          </Panel>
        </div>
      )}

      {/* prompts */}
      {!h.exiting && (h.prompt || h.progress !== null) && !h.finale && (
        <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
          {h.prompt && <div className="rounded-lg border border-line bg-panel px-4 py-2 text-sm backdrop-blur-md">{h.prompt}</div>}
          {h.progress !== null && (
            <div className="w-64">
              <Meter value={h.progress} tone="amber" />
            </div>
          )}
        </div>
      )}

      {toast && !h.finale && (
        <div className="absolute inset-x-0 top-24 flex justify-center">
          <div className={`rounded-lg border px-4 py-2 text-sm backdrop-blur-md ${h.boundary ? "border-nogo/60 bg-nogo/15" : "border-line bg-panel"}`}>{toast}</div>
        </div>
      )}

      {h.finale && (
        <div className="absolute inset-x-0 bottom-20 flex flex-col items-center gap-1 text-center">
          <div className="text-xs tracking-widest text-amber">MISSION GOAL REACHED</div>
          <div className="max-w-2xl text-2xl font-semibold">{plan.goal.text}</div>
          <div className="mt-1 max-w-xl text-sm text-dim">{plan.goal.why}</div>
          {choice && (
            <div className="pointer-events-auto mt-4 flex flex-col items-center gap-2">
              <div className="flex gap-3">
                <Button onClick={startExplore}>Explore the Moon</Button>
                {canEnd && (
                  <Button variant="ghost" onClick={finish}>
                    Finish mission
                  </Button>
                )}
              </div>
              {!canEnd && <div className="text-xs text-dim">The host ends the mission for everyone.</div>}
            </div>
          )}
        </div>
      )}

      {!h.exiting && !h.finale && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-dim">
          WASD / arrows move - Shift sprint - Space jump - E {h.explore ? "open a tag" : "interact"} - drag to look - wheel to zoom
        </div>
      )}

      {canFinish && !h.finale && (
        <div className="absolute left-5 top-40 w-64">
          <Panel>
            <div className="text-sm">Taking long? You can head back to the lander and wrap up.</div>
            <div className="mt-2">
              {state?.mode === "solo" || isHost || h.elapsed > limit + 90 ? (
                <Button onClick={() => complete("surface", surfaceScore(plan, done, h.elapsed, h.mistakes))}>Return to lander and finish</Button>
              ) : (
                <div className="text-xs text-dim">Waiting for the host to end the mission.</div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
