"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { useGame } from "../../core/useGame";
import { buyRepair, PRICES, useSupply } from "../../core/economy";
import { useMissionHp } from "../../core/hp";
import { useStore } from "../../core/store";
import { Button, Meter, Panel, PhaseTitle } from "../../ui/kit";
import { phaseLabel } from "../../ui/phaseLabel";
import type { MissionPlan, Role } from "../../types";
import { doneSet, poiSet, surf } from "./coop";
import { angDiff } from "./Props";
import { fmtDist, poiInfo, usePoi } from "./fieldnotes";
import { buyHint, hintPrice, hintTier } from "./hints";
import { ROLE_COLOR, rt, useSurface } from "./store";
import { currentTask, hintLevel, myQueue, scoreNow } from "./Tasks";
import { HINT_TEXT, TASKS } from "./tracks";

const LIMIT: Record<MissionPlan["difficulty"], number> = { easy: 480, normal: 540, hard: 660 };
const ROLE_LABEL: Record<Role, string> = { commander: "Commander", pilot: "Pilot", engineer: "Engineer", scientist: "Scientist" };
const SHORT: Record<string, string> = { mip: "MIP", lcross: "LCROSS", lcross_shep: "LCROSS 2", athena: "Athena", odysseus: "Odysseus", vikram2: "Vikram-2", vikram3: "Vikram-3", luna25: "Luna 25" };

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
          <span className="num text-white">{g.rough ? "~" : ""}{Math.round(g.dist)} m</span>
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

/** Bearing strip for the heritage hardware: where it really lies from the landing spot (turn to line it up, hold still). */
function HeritageTape({ found }: { found: Set<string> }) {
  const sites = usePoi((s) => s.sites);
  const [yaw, setYaw] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setYaw(rt.camYaw), 90);
    return () => clearInterval(id);
  }, []);
  if (!sites.length) return null;
  const HALF = 1.15; // rad shown either side of the view direction
  return (
    <div className="pointer-events-none absolute left-1/2 top-[4.75rem] w-[34rem] -translate-x-1/2">
      <div className="relative h-9 overflow-hidden rounded-md border border-line bg-black/35 backdrop-blur-sm">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        {sites.map((s, i) => {
          const d = angDiff(yaw, s.az);
          if (Math.abs(d) > HALF) return null;
          const seen = found.has(s.id);
          return (
            <div key={s.id} className="absolute top-0 -translate-x-1/2 text-center leading-tight" style={{ left: `${50 + (d / HALF) * 48}%`, marginTop: (i % 3) * 12 }}>
              <div className={`mx-auto h-1.5 w-1.5 rotate-45 ${seen ? "bg-go" : "bg-cyan"}`} />
              <div className={`whitespace-nowrap text-[9px] ${seen ? "text-go" : "text-cyan"}`}>
                {SHORT[s.id] ?? s.title} {fmtDist(s.dist)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-0.5 text-center text-[10px] text-dim">Hardware left by earlier missions, at its real bearing. Turn to face a marker and hold still to sight it.</div>
    </div>
  );
}

function Radar() {
  const regions = useSurface((s) => s.regions);
  const [t, setT] = useState({ x: 0, z: 0, yaw: 0 });
  useEffect(() => {
    const id = setInterval(() => setT({ x: rt.pos.x, z: rt.pos.z, yaw: rt.camYaw }), 100);
    return () => clearInterval(id);
  }, []);
  if (!regions.length) return null;
  const R = 70; // metres from centre to edge
  const S = 66;
  const proj = (x: number, z: number) => {
    const dx = x - t.x;
    const dz = z - t.z;
    // rotate so the camera forward is up on the screen
    const f = dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw);
    const r = dx * Math.cos(t.yaw) - dz * Math.sin(t.yaw);
    return { x: S + (r / R) * S, y: S - (f / R) * S };
  };
  const lander = proj(0, 0);
  return (
    <div className="pointer-events-none absolute bottom-24 left-5">
      <Panel className="!p-2">
        <svg width={S * 2} height={S * 2} className="block rounded-full bg-black/40" style={{ clipPath: "circle(50%)" }}>
          <circle cx={S} cy={S} r={S - 1} fill="none" stroke="rgba(111,211,255,0.4)" />
          <circle cx={S} cy={S} r={S / 2} fill="none" stroke="rgba(111,211,255,0.15)" />
          {regions.map((g, i) => {
            const p = proj(g.x, g.z);
            return <circle key={i} cx={p.x} cy={p.y} r={Math.max(4, (g.r / R) * S)} fill="rgba(255,181,71,0.18)" stroke="#ffb547" strokeDasharray="3 3" />;
          })}
          <rect x={lander.x - 3} y={lander.y - 3} width="6" height="6" fill="#cfd4da" />
          <path d={`M${S} ${S - 8} L${S + 5} ${S + 5} L${S} ${S + 2} L${S - 5} ${S + 5} Z`} fill="#6fd3ff" />
        </svg>
        <div className="mt-1 text-center text-[10px] text-dim">RADAR: hinted area</div>
      </Panel>
    </div>
  );
}

const TIER_NAME = ["Nudge", "Clear lead", "Exact spot"] as const;

/** Supply points, the hint shop for the current objective, and the field repair. */
function SupplyShop({ taskId, sd }: { taskId: string | null; sd: Record<string, unknown> }) {
  const sp = useSupply();
  const { hp, failed } = useMissionHp();
  const hpMax = useStore((s) => s.state?.hpMax ?? 100);
  const pending = useStore((s) => s.state?.sp);
  void pending;
  const tier = taskId ? hintTier(sd, taskId) : 0;
  const texts = taskId ? HINT_TEXT[taskId] : undefined;
  const canRepair = !failed && hp < hpMax;
  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] tracking-wide text-dim">SUPPLY POINTS</div>
        <div className="num text-sm text-amber">{sp} SP</div>
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-dim">
        Earned on the journey. Hints cost {PRICES.hint.join(" / ")} SP and shared by the whole crew; a field repair costs {PRICES.repair.cost} SP.
      </div>
      {taskId && texts && (
        <ul className="mt-2 space-y-1">
          {([1, 2, 3] as const).map((t) =>
            tier >= t ? (
              <li key={t} className="text-[11px] leading-snug text-cyan">
                <span className="text-dim">{TIER_NAME[t - 1]}:</span> {texts[t - 1]}
              </li>
            ) : (
              <li key={t}>
                <button
                  disabled={t !== tier + 1 || sp < hintPrice(t)}
                  onClick={() => buyHint(taskId, t)}
                  className="pointer-events-auto flex w-full items-center justify-between rounded border border-line bg-white/5 px-2 py-1 text-left text-[11px] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>Hint {t}: {TIER_NAME[t - 1]}</span>
                  <span className="num text-amber">{hintPrice(t)} SP</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {canRepair && (
        <button
          disabled={sp < PRICES.repair.cost}
          onClick={() => buyRepair()}
          className="pointer-events-auto mt-2 flex w-full items-center justify-between rounded border border-go/40 bg-go/10 px-2 py-1.5 text-left text-xs text-go hover:bg-go/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span>Field repair: +{PRICES.repair.amount} integrity</span>
          <span className="num">{PRICES.repair.cost} SP</span>
        </button>
      )}
    </div>
  );
}

export function Hud() {
  const { plan, state, actsAs, complete, isHost } = useGame();
  const h = useSurface();
  const sd = surf(state);
  const done = useMemo(() => doneSet(sd), [sd]);
  const found = useMemo(() => poiSet(sd), [sd]);
  const [toast, setToast] = useState<{ text: string; tone: string } | null>(null);

  useEffect(() => {
    useSurface.getState().reset();
  }, []);
  useEffect(() => {
    if (!h.message) return;
    setToast({ text: h.message, tone: h.tone });
    const t = setTimeout(() => setToast(null), h.tone === "bad" ? 6000 : 4200);
    return () => clearTimeout(t);
  }, [h.messageId, h.message, h.tone]);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!h.flash) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 220);
    return () => clearTimeout(t);
  }, [h.flash]);

  if (!plan) return null;
  const queue = myQueue(done, actsAs);
  const cur = currentTask(done, actsAs);
  const pos = Math.min(queue.length, queue.filter((q) => done.has(q.id)).length + 1);
  const hint = hintLevel(plan.difficulty, h.mistakes);
  const fin = done.has("flag");
  const limit = LIMIT[plan.difficulty];
  const canFinish = h.elapsed > limit && !fin;
  const mm = Math.floor(h.elapsed / 60);
  const ss = String(Math.floor(h.elapsed % 60)).padStart(2, "0");
  const total = TASKS.length;
  const doneN = TASKS.filter((t) => done.has(t.id)).length;
  const left = total - doneN;

  return (
    <div className="absolute inset-0">
      <style>{`@keyframes sfReveal{0%{opacity:0;transform:translateY(-6px);background:rgba(255,181,71,.25)}100%{opacity:1;transform:none;background:transparent}}.sf-reveal{animation:sfReveal .9s ease-out;border-radius:8px}`}</style>
      <div className={`pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black transition-opacity duration-1000 ${h.ready ? "opacity-0" : "opacity-100"}`}>
        <div className="text-center">
          <div className="num text-[11px] text-amber">TOUCHDOWN CONFIRMED</div>
          <div className="mt-1 text-lg">Preparing the surface</div>
        </div>
      </div>
      <div className={`pointer-events-none absolute inset-0 z-30 bg-white transition-opacity ${flash ? "opacity-80 duration-75" : "opacity-0 duration-300"}`} />
      <PhaseTitle step={phaseLabel("surface")} title={plan.title} subtitle={plan.goal.text} />
      <Compass />
      {!h.exiting && !h.finale && <HeritageTape found={found} />}

      <div className="absolute right-5 top-5 w-72">
        <Panel className="max-h-[calc(100vh-2.5rem)] overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] tracking-wide text-dim">{cur ? `TASK ${pos} OF ${queue.length}` : "OBJECTIVE"}</div>
            <div className="num text-xs text-dim">{mm}:{ss}</div>
          </div>
          <div className="mb-3 flex gap-1">
            {queue.map((q) => (
              <span key={q.id} className={`h-1.5 flex-1 rounded-full ${done.has(q.id) ? "bg-go" : q.id === cur?.id ? "bg-amber" : "bg-white/15"}`} />
            ))}
          </div>
          {cur ? (
            <div key={`${cur.id}-${h.reveal}`} className="sf-reveal">
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: ROLE_COLOR[cur.role] }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: ROLE_COLOR[cur.role] }} />
                {ROLE_LABEL[cur.role]}
                {cur.coop && <span className="rounded border border-cyan/40 px-1 text-[9px] text-cyan">CO-OP</span>}
              </div>
              <div className="mt-1 text-base font-medium leading-snug">{cur.title}</div>
              {(hint || cur.kind !== "scan") && <div className="mt-1 text-xs text-cyan">{cur.hint}</div>}
            </div>
          ) : fin ? (
            <div className="text-sm text-go">Mission complete.</div>
          ) : (
            <div className="rounded border border-go/40 bg-go/10 px-2 py-1.5 text-xs text-go">
              Your tasks are done. {left} crew {left === 1 ? "task is" : "tasks are"} still open. Help a crewmate, or look for field notes.
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-[11px] text-dim">
            <span>Crew progress</span>
            <span className="num">{doneN}/{total}</span>
          </div>
          <Meter value={doneN / total} tone="go" />
          {h.inventory.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {h.inventory.map((i, k) => (
                <span key={k} className="rounded border border-line bg-white/5 px-2 py-0.5 text-xs">
                  {i}
                </span>
              ))}
            </div>
          )}
          <SupplyShop taskId={cur?.id ?? null} sd={sd} />
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-xs">
            <span className="text-dim">Field notes</span>
            <span className="num text-cyan">{found.size}/{h.poiTotal || 17}</span>
          </div>
        </Panel>
      </div>

      {h.exiting && (
        <div className="absolute inset-x-0 bottom-14 flex justify-center">
          <Button variant="ghost" onClick={() => (rt.skipExit = true)}>
            Skip ladder (Space)
          </Button>
        </div>
      )}

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

      {h.hazard && !h.finale && (
        <div className="pointer-events-none absolute inset-x-0 top-40 flex justify-center">
          <div className="rounded-lg border border-nogo/60 bg-nogo/15 px-4 py-2 text-sm text-nogo backdrop-blur-md">Steep shadowed slope. Walk slowly, do not sprint or jump, and do not linger.</div>
        </div>
      )}

      {h.sight !== null && h.sightLabel && !h.card && (
        <div className="pointer-events-none absolute inset-x-0 top-[44%] flex flex-col items-center gap-1">
          <div className="rounded-lg border border-cyan/40 bg-panel px-3 py-1 text-xs text-cyan backdrop-blur-md">Sighting {h.sightLabel}</div>
          <div className="w-40">
            <Meter value={h.sight} tone="data" />
          </div>
        </div>
      )}

      {!h.exiting && !h.finale && (h.coop || h.prompt || h.progress !== null || (h.poiNear && !h.card) || h.site) && (
        <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
          {h.coop && <div className="rounded-lg border border-cyan/40 bg-cyan/10 px-4 py-1.5 text-xs text-cyan backdrop-blur-md">{h.coop}</div>}
          {h.site && !h.prompt && <div className={`rounded-lg border px-4 py-1.5 text-xs backdrop-blur-md ${h.site.ok ? "border-go/50 bg-go/10 text-go" : "border-line bg-panel text-dim"}`}>Helmet sensors: slope {Math.round(h.site.slope)} deg. {h.site.note}</div>}
          {h.prompt ? (
            <div className="rounded-lg border border-line bg-panel px-4 py-2 text-sm backdrop-blur-md">{h.prompt}</div>
          ) : h.poiNear && !h.card ? (
            <div className="rounded-lg border border-line bg-panel px-4 py-2 text-sm backdrop-blur-md">Hold F to read the full notes: {poiInfo(h.poiNear).title}</div>
          ) : null}
          {h.progress !== null && (
            <div className="w-64">
              <Meter value={h.progress} tone="amber" />
            </div>
          )}
        </div>
      )}

      <Radar />

      {toast && !h.finale && (
        <div className="absolute inset-x-0 top-28 flex justify-center">
          <div className={`rounded-lg border px-4 py-2 text-sm backdrop-blur-md ${toast.tone === "bad" || h.boundary ? "border-nogo/60 bg-nogo/15" : toast.tone === "good" ? "border-go/50 bg-go/10" : "border-line bg-panel"}`}>{toast.text}</div>
        </div>
      )}

      {h.finale && (
        <div className="absolute inset-x-0 bottom-20 flex flex-col items-center gap-1 text-center">
          <div className="text-xs tracking-widest text-amber">MISSION GOAL REACHED</div>
          <div className="max-w-2xl text-2xl font-semibold">{plan.goal.text}</div>
          <div className="mt-1 max-w-xl text-sm text-dim">{plan.goal.why}</div>
          <div className="num mt-1 text-xs text-cyan">
            {doneN}/{total} tasks - {found.size}/{h.poiTotal || 17} field notes
          </div>
        </div>
      )}

      {!h.exiting && !h.finale && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-dim">
          WASD / arrows move - Shift sprint - Space jump - E interact - hold F field notes - drag to look - wheel to zoom
        </div>
      )}

      {canFinish && !h.finale && (
        <div className="absolute left-5 top-40 w-64">
          <Panel>
            <div className="text-sm">Taking long? You can head back to the lander and wrap up.</div>
            <div className="mt-2">
              {state?.mode === "solo" || isHost || h.elapsed > limit + 90 ? (
                <Button onClick={() => complete("surface", scoreNow(state, h.elapsed, h.mistakes))}>Return to lander and finish</Button>
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
