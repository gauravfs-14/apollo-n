"use client";
import { DamageNotes } from "../../flight/damage";
import { press } from "../../flight/input";
import { ControlsHelp, TiltPad } from "../../flight/ui";
import { useSkipVote } from "../../core/skip";
import { rolesOf } from "../../core/roles";
import { grade } from "../../core/juice";
import { useGame } from "../../core/useGame";
import { Button, Meter, Panel, PhaseTitle, Stat } from "../../ui/kit";
import { phaseLabel } from "../../ui/phaseLabel";
import { flags, useLanding } from "./store";
import { useEffect } from "react";

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={`h-9 w-9 ${i < n ? "fill-amber text-amber" : "fill-white/10 text-white/25"}`}>
          <path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.6 5.9 21.1l1.4-6.8L2.2 9.6l6.9-.8z" stroke="currentColor" strokeWidth="1" />
        </svg>
      ))}
    </div>
  );
}

// Feet and ft/s, the units the crew call out.
const FT = 3.281;
const ft = (m: number) => Math.round(Math.abs(m) * FT);

export function LandingHud() {
  const { complete, actsAs, isHost, state, plan } = useGame();
  const s = useLanding((x) => x.s);
  const info = useLanding((x) => x.info);
  const request = useLanding((x) => x.request);
  const isPilot = actsAs("pilot");
  const autoVote = useSkipVote("landing", () => request("auto")); // crew vote in multiplayer
  const down = !!s?.down;
  const result = s?.result ?? null;
  const showResult = down && !!result && (s?.since ?? 0) > 2.2;

  const waited = s?.since ?? 0;
  const flown = s?.t ?? 0;
  const anyPilot = state?.players.some((p) => rolesOf(p).includes("pilot") && p.connected) ?? false;
  const canContinue = isPilot || (isHost && (!anyPilot || waited > 20));
  const diff = plan?.difficulty ?? "normal";

  // grade banner when the result card shows (a PERFECT touchdown already showed its own, at contact)
  const att = s?.att ?? 0;
  const resultScore = result ? Math.max(0, Math.min(100, result.score.total)) : -1;
  useEffect(() => {
    if (!showResult || resultScore < 0 || flags.perfect === att) return;
    grade("landing", resultScore, { title: "Landing grade", once: `landing:${plan?.id}:${att}` });
  }, [showResult, resultScore, att, plan?.id]);

  if (!s || !info) {
    return <div className="absolute inset-0"><PhaseTitle step={phaseLabel("landing")} title="Touchdown" /></div>;
  }
  const tooFast = !down && s.alt < 60 && -s.vy > info.vSafe * 1.4;
  const lowFuel = s.fuelPct < 20 && s.fuelPct > 0;
  const sink = Math.max(0, -s.vy);
  const score = result ? Math.max(0, Math.min(s.assisted && diff !== "easy" ? 60 : 100, result.score.total - (diff === "normal" ? 8 : 0) * s.retries)) : 0;

  return (
    <div className="absolute inset-0">
      <PhaseTitle step={phaseLabel("landing")} title="Touchdown" subtitle="Land on the amber ring. Slow and level wins." />
      <DamageNotes />

      {!down && (
        <div className="absolute bottom-6 left-6 w-64">
          <Panel>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Stat label="Altitude (ft)" value={ft(s.alt)} tone="data" />
              <Stat label="Down (ft/s)" value={(sink * FT).toFixed(0)} tone={tooFast ? "nogo" : sink > info.vSafe ? "default" : "go"} />
              <Stat label="Forward (ft/s)" value={(s.vf * FT).toFixed(0)} tone="data" />
              <Stat label="Sideways (ft/s)" value={(s.vr * FT).toFixed(0)} tone="data" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <TiltPad lean={[s.leanF, s.leanR]} slope={[s.slopeF, s.slopeR]} limit={info.limit} vel={[s.vf, s.vr]} />
              <div className="flex-1 space-y-2 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] text-dim"><span>Fuel</span><span className={`num ${lowFuel ? "text-nogo" : "text-white"}`}>{Math.round(s.fuelPct)}%</span></div>
                  <Meter value={s.fuelPct / 100} tone={lowFuel ? "nogo" : s.fuelPct < 40 ? "amber" : "go"} />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-dim"><span>Engine</span><span className="num text-white">{Math.round(s.thr * 100)}%</span></div>
                  <Meter value={s.thr} tone="amber" />
                </div>
                <div className="text-[11px] leading-snug text-dim">
                  Zone: {ft(s.tgtF)} ft {s.tgtF >= 0 ? "ahead" : "behind"}, {ft(s.tgtR)} ft {s.tgtR >= 0 ? "right" : "left"}
                </div>
              </div>
            </div>
            <div className={`mt-3 rounded-md px-2 py-1 text-center text-xs font-medium ${s.contact ? "bg-cyan/20 text-cyan" : s.auto ? "bg-amber/15 text-amber" : "bg-white/5 text-dim"}`}>
              {s.contact ? "CONTACT LIGHT" : s.auto ? "Autopilot flying" : s.hover ? `Hover assist: holding ${(Math.max(-s.vt, 0) * FT).toFixed(0)} ft/s down` : "Manual throttle"}
            </div>
          </Panel>
        </div>
      )}

      {!down && (tooFast || lowFuel || s.fuelPct <= 0) && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-md bg-nogo/80 px-3 py-1 text-sm font-medium text-white">
          {s.fuelPct <= 0 ? "OUT OF FUEL" : tooFast ? "TOO FAST: add throttle" : "LOW FUEL"}
        </div>
      )}

      {!down && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          {isPilot && (info.hoverAvail || info.autoAvail) && (
            <div className="flex gap-2">
              {info.hoverAvail && <Button variant={s.hover && !s.auto ? "primary" : "ghost"} onClick={() => press("KeyH")} className="!px-3 !py-1.5">Hover assist (H)</Button>}
              {info.autoAvail && <Button variant={s.auto ? "primary" : "ghost"} onClick={() => press("KeyP")} className="!px-3 !py-1.5">Autopilot (P)</Button>}
            </div>
          )}
          {flown > 40 && !s.auto && (
            <Button variant="ghost" onClick={autoVote.request} disabled={autoVote.disabled}>{autoVote.pending ? autoVote.label : "Let the autopilot land"}</Button>
          )}
          {isPilot ? (
            <ControlsHelp
              rows={[
                [["W", "S"], s.hover || s.auto ? "Sink rate: less / more" : "Throttle up / down"],
                [["Shift"], "Full throttle (hold)"],
                [["X"], "Engine cut"],
                [["Up", "Down"], "Lean forward / back"],
                [["Left", "Right"], "Lean left / right"],
                ...(info.hoverAvail ? [[["H"], "Hover assist"] as [string[], string]] : []),
                ...(info.autoAvail ? [[["P"], "Autopilot (any key takes over)"] as [string[], string]] : []),
              ]}
              note="Leaning tilts the thrust, so lean toward where you want to go and the other way to stop. Touch down slowly, level, on the ring."
            />
          ) : (
            <Panel className="w-64 !p-3 text-xs text-dim">The pilot is flying the lander.</Panel>
          )}
        </div>
      )}

      {showResult && result && (
        <div className="absolute right-6 top-1/2 w-[22rem] -translate-y-1/2">
          <Panel>
            <div className="text-[11px] text-dim">Landing score</div>
            <div className="flex items-center justify-between">
              <div className={`num text-5xl leading-none ${score >= 65 ? "text-go" : score >= 35 ? "text-amber" : "text-nogo"}`}>{score}</div>
              <Stars n={result.score.stars} />
            </div>
            <p className="mt-2 text-sm leading-snug text-white/90">{result.score.status}</p>
            <div className="mt-3 space-y-2">
              {result.score.parts.map((p) => (
                <div key={p.label}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-white/85">{p.label}</span>
                    <span className="num text-dim">{p.points} / {p.max}</span>
                  </div>
                  <Meter value={p.points / p.max} tone={p.points / p.max > 0.66 ? "go" : p.points / p.max > 0.33 ? "amber" : "nogo"} />
                  <div className="mt-0.5 text-[11px] leading-snug text-dim">{p.text}</div>
                </div>
              ))}
            </div>
            {s.retries > 0 && diff === "normal" && <p className="mt-2 text-[11px] text-dim">Each retry costs 8 points on normal.</p>}
            {s.assisted && diff !== "easy" && <p className="mt-2 text-[11px] text-dim">The autopilot flew part of this landing: score capped at 60.</p>}
            <div className="mt-3 flex gap-2">
              {isPilot && info.retryAllowed && result.reason !== "ok" && (
                <Button variant="ghost" className="flex-1" onClick={() => press("KeyR")}>Try again (R)</Button>
              )}
              {canContinue ? (
                <Button className="flex-1" onClick={() => complete("landing", score)}>Continue to the surface</Button>
              ) : (
                <p className="flex-1 self-center text-xs text-dim">Waiting for the pilot to open the hatch.</p>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
