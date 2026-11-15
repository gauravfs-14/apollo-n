"use client";
import { useMemo, useRef, useState } from "react";
import { sfx } from "../../core/audio";
import { useGame, usePhaseData } from "../../core/useGame";
import { Button, Meter, Panel } from "../../ui/kit";
import { SLOTS, SLOT_LABEL, evaluateBuild, partsFor, shipStats, type BuildCheck, type BuildParts, type ShipPart } from "../../data/parts";
import type { Difficulty, Role, ShipSlot } from "../../types";
import { phaseLabel } from "../../ui/phaseLabel";

const SLOT_ROLE: Record<ShipSlot, Role> = { engine: "engineer", power: "engineer", legs: "pilot", comms: "pilot", payload: "scientist" };
const ROLE_LABEL: Record<Role, string> = { commander: "Commander", pilot: "Pilot", engineer: "Engineer", scientist: "Scientist" };
const HINT_AFTER: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 3 };

function Bar({ c, show }: { c: BuildCheck; show: boolean }) {
  const num = typeof c.value === "number" && typeof c.target === "number";
  let value = c.ratio, target = 1;
  if (num) {
    const v = c.value as number, t = c.target as number;
    if (c.id === "mass") {
      const sc = t * 1.4;
      value = v / sc; target = t / sc;
    } else {
      const sc = Math.max(t, c.id === "power" ? v : 0) * (c.id === "power" ? 1.25 : 1.6);
      value = v / sc; target = t / sc;
    }
  }
  const dirText = c.id === "mass" ? "max" : "min";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-white/80">{c.label}</span>
        <span className={`num ${c.pass ? "text-go" : "text-nogo"}`}>
          {c.value}
          {c.unit && ` ${c.unit}`}
          <span className="text-dim"> / {c.id === "payload" ? "needs" : dirText === "max" ? "max" : c.id === "power" ? "draw" : "min"} {c.target}{c.unit && ` ${c.unit}`}</span>
        </span>
      </div>
      {num ? <Meter value={value} target={target} tone={c.pass ? "go" : "nogo"} /> : <Meter value={c.pass ? 1 : 0.05} tone={c.pass ? "go" : "nogo"} />}
      {show && !c.pass && <div className="mt-1 text-[11px] text-amber">{c.hint}</div>}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="num rounded bg-white/8 px-1.5 py-0.5 text-[11px] text-white/80">{children}</span>;
}

function partChips(p: ShipPart) {
  const out: string[] = [`${p.massKg} kg`];
  if (p.deltaV) out.push(`${p.deltaV} m/s`);
  if (p.batteryHours) out.push(`${p.batteryHours} h battery`);
  if (p.powerW) out.push(`+${p.powerW} W`);
  if (p.drawW) out.push(`-${p.drawW} W`);
  if (p.tiltTolerance) out.push(`${p.tiltTolerance} deg slope`);
  if (p.radioQuality) out.push(`radio ${Math.round(p.radioQuality * 100)}%`);
  if (p.tags) out.push(...p.tags);
  return out;
}

export function BuildHud() {
  const { plan, state, me, patch, complete, actsAs, isHost } = useGame();
  const bd = usePhaseData<{ parts: BuildParts; by: string }>("build");
  const parts = useMemo(() => (bd.parts ?? {}) as BuildParts, [bd.parts]);
  const by = bd.by;
  const [slot, setSlot] = useState<ShipSlot>("engine");
  const [mistakes, setMistakes] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const lastScore = useRef<number | null>(null);

  const c = plan?.ship.constraints;
  const ev = useMemo(() => (c ? evaluateBuild(parts, c) : null), [parts, c]);
  const options = partsFor(slot);
  const hintsOn = mistakes >= HINT_AFTER[plan?.difficulty ?? "normal"];

  // crew roles are only chosen after the build, so until someone picks one every player may choose parts
  const nobodyPicked = !state?.players.some((p) => p.picked);
  const canPick = (s: ShipSlot) => state?.mode === "solo" || nobodyPicked || actsAs(SLOT_ROLE[s]);
  const canFinal = isHost || actsAs("commander");

  const best = useMemo(() => {
    if (!c) return null;
    let top: string | null = null, topScore = -1, low = 101;
    for (const o of options) {
      const sc = evaluateBuild({ ...parts, [slot]: o.id }, c).score;
      low = Math.min(low, sc);
      if (sc > topScore) { topScore = sc; top = o.id; }
    }
    return topScore > low ? top : null;
  }, [options, parts, slot, c]);

  if (!plan || !c || !ev) {
    return (
      <div className="absolute inset-0 grid place-items-center">
        <Panel className="text-sm text-dim">Preparing the hangar...</Panel>
      </div>
    );
  }

  const choose = (p: ShipPart) => {
    if (!canPick(p.slot) || parts[p.slot] === p.id) return;
    const next = { ...parts, [p.slot]: p.id };
    const sc = evaluateBuild(next, c).score;
    if (ev.stats.complete && lastScore.current !== null && sc < lastScore.current) setMistakes((m) => m + 1);
    lastScore.current = sc;
    setConfirm(false);
    patch("build", { parts: next, stats: shipStats(next), by: me?.name ?? "" });
    sfx("click", { volume: 0.5 });
  };

  const finalize = () => {
    if (!ev.stats.complete) return;
    if (!ev.allPass && !confirm) {
      setConfirm(true);
      setMistakes((m) => m + 1);
      sfx("buzz", { volume: 0.4 });
      return;
    }
    patch("build", { parts, stats: shipStats(parts), final: true, score: ev.score });
    complete("build", ev.score);
    sfx("chime", { volume: 0.5 });
  };

  const nextEmpty = SLOTS.find((s) => !parts[s]);

  return (
    <div className="absolute inset-0">
      {/* left: mission needs + balance bars */}
      <div className="absolute left-6 top-5 flex w-[23rem] flex-col gap-3">
        <div className="pointer-events-none">
          <div className="num text-[11px] text-amber">{phaseLabel("build")}</div>
          <h2 className="text-2xl font-semibold leading-tight">Build the lander</h2>
        </div>
        <Panel>
          <div className="text-[11px] uppercase tracking-wide text-dim">Mission requirement</div>
          <p className="mt-1 text-sm leading-snug text-white/90">{plan.ship.rationale}</p>
          <p className="mt-2 text-xs text-dim">Goal: pick one part per slot so every bar below turns green.</p>
        </Panel>
        <Panel className="flex flex-col gap-3">
          {ev.checks.map((k) => (
            <Bar key={k.id} c={k} show={hintsOn && ev.stats.complete} />
          ))}
        </Panel>
      </div>

      {/* right: score + finalize */}
      <div className="absolute right-6 top-5 w-64">
        <Panel>
          <div className="text-[11px] text-dim">Build score</div>
          <div className="flex items-end justify-between">
            <span className="num text-4xl">{ev.stats.complete ? ev.score : "--"}</span>
            <span className={`num text-xs ${ev.allPass ? "text-go" : "text-amber"}`}>{ev.allPass ? "All needs met" : "Needs unmet"}</span>
          </div>
          <div className="mt-3">
            {canFinal ? (
              <Button className="w-full" onClick={finalize} disabled={!ev.stats.complete}>
                {!ev.stats.complete ? `Choose ${SLOT_LABEL[nextEmpty ?? "engine"]}` : confirm ? "Lock in anyway" : "Lock in build"}
              </Button>
            ) : (
              <div className="text-xs text-dim">The commander or host locks in the build when the crew agrees.</div>
            )}
            {confirm && <div className="mt-2 text-[11px] text-amber">Some needs are not met. Fix them, or lock in anyway for a lower score.</div>}
          </div>
          {state?.mode === "multi" && <div className="mt-3 text-[11px] text-dim">Last change: {by || "nobody"}</div>}
        </Panel>
      </div>

      {/* bottom dock: slot tabs + 3 cards */}
      <div className="absolute inset-x-0 bottom-5 flex justify-center px-6">
        <div className="w-full max-w-4xl">
          <div className="mb-2 flex flex-wrap gap-2">
            {SLOTS.map((s) => {
              const chosen = parts[s];
              const nm = partsFor(s).find((p) => p.id === chosen)?.name;
              return (
                <button
                  key={s}
                  onClick={() => setSlot(s)}
                  className={`pointer-events-auto rounded-lg border px-3 py-1.5 text-left text-xs transition ${
                    slot === s ? "border-amber bg-amber/15" : "border-line bg-panel hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${chosen ? "bg-go" : "bg-white/30"}`} />
                    <span className="font-medium">{SLOT_LABEL[s]}</span>
                    <span className="text-dim">· {ROLE_LABEL[SLOT_ROLE[s]]}</span>
                  </div>
                  <div className="text-dim">{nm ?? "Not chosen"}</div>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {options.map((p) => {
              const sel = parts[slot] === p.id;
              const ok = canPick(slot);
              return (
                <button
                  key={p.id}
                  disabled={!ok}
                  onClick={() => choose(p)}
                  className={`pointer-events-auto relative rounded-xl border p-3 text-left backdrop-blur-md transition active:scale-[0.99] ${
                    sel ? "border-amber bg-amber/10" : "border-line bg-panel hover:bg-white/10"
                  } ${ok ? "" : "opacity-50"}`}
                >
                  {hintsOn && best === p.id && !sel && <span className="absolute right-2 top-2 rounded bg-go/20 px-1.5 py-0.5 text-[10px] text-go">Good fit</span>}
                  {sel && <span className="absolute right-2 top-2 rounded bg-amber px-1.5 py-0.5 text-[10px] font-medium text-black">Fitted</span>}
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-[11px] text-dim">{p.inspiredBy}</div>
                  <p className="mt-1.5 text-xs leading-snug text-white/80">{p.desc}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {partChips(p).map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between gap-2 text-[11px]">
                    <span className="text-go">+ {p.pros}</span>
                    <span className="text-nogo">- {p.cons}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {!canPick(slot) && <div className="mt-2 text-xs text-dim">The {ROLE_LABEL[SLOT_ROLE[slot]]} chooses this part. You can watch it come together.</div>}
        </div>
      </div>
    </div>
  );
}
