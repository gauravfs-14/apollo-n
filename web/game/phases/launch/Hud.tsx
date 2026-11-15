"use client";
import { useMemo, useSyncExternalStore } from "react";
import { DamageNotes } from "../../flight/damage";
import { devDifficulty } from "../../flight/difficulty";
import { press } from "../../flight/input";
import { ControlsHelp, Needle } from "../../flight/ui";
import { useSkipVote } from "../../core/skip";
import { useGame } from "../../core/useGame";
import { Button, Meter, Panel, Stat } from "../../ui/kit";
import { T, useLaunchClock } from "./clock";
import { TLI, launchParams, needOf, needRole, type Need } from "./flight";
import { phaseLabel } from "../../ui/phaseLabel";

const R2D = 180 / Math.PI;

export function LaunchHud() {
  const t = useLaunchClock((s) => s.t);
  const sim = useLaunchClock((s) => s.sim);
  const skip = useSkipVote("launch", () => useLaunchClock.getState().skip()); // crew vote in multiplayer
  const skipped = useLaunchClock((s) => s.skipped);
  const { plan, actsAs } = useGame();
  const pilot = actsAs("pilot");
  const commander = actsAs("commander");
  const P = useMemo(() => launchParams(devDifficulty(plan?.difficulty)), [plan?.difficulty]);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false); // the flight panels are client-only

  const tMinus = T.liftoff - t;
  const counting = t >= T.countStart && tMinus > 0;
  const flying = t >= T.liftoff;
  const over = sim.endAt >= 0;
  const fadeEnd = over && t > sim.endAt - 1.3 ? Math.min(1, (t - (sim.endAt - 1.3)) / 1.1) : 0;
  const fadeStart = t < 1.2 ? 1 - t / 1.2 : 0;
  const black = Math.max(fadeEnd, fadeStart);
  const clock = t < T.liftoff ? `T-${Math.max(0, Math.ceil(tMinus)).toString().padStart(2, "0")}` : `T+${Math.floor(t - T.liftoff).toString().padStart(2, "0")}`;
  const need: Need = needOf({ ...sim, t });
  const mine = need === "none" ? false : needRole(need) === "commander" ? commander : pilot;
  const errDeg = sim.err * R2D;
  const stageName = sim.burnAt >= 0 ? "Translunar burn" : sim.s2SepAt >= 0 ? "Coast to burn window" : sim.s1SepAt >= 0 ? "Second stage" : sim.s1CutAt >= 0 ? "First stage burnout" : "First stage";
  const showSkip = t > T.liftoff + 22 && !over && !skipped;

  const prompt =
    need === "stage" ? (mine ? "Stage now" : "Waiting for the commander to stage")
    : need === "ignite" ? (mine ? "Start the burn" : "Waiting for the pilot to start the burn")
    : need === "cutoff" ? (mine ? "Cut off at the line" : "Pilot is flying the burn")
    : null;
  const keyHint = need === "stage" ? "Press SPACE to separate the spent stage." : need === "ignite" ? `Press SPACE to light the engine. Target ${(TLI.target / 1000).toFixed(2)} km/s.` : "Press SPACE when the speed reaches the line.";

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: black }} />
      <div className="pointer-events-none absolute left-6 top-5 [text-shadow:0_1px_10px_rgba(0,0,0,0.7)]">
        <div className="num text-[11px] text-amber">{phaseLabel("launch")}</div>
        <h2 className="text-2xl font-semibold leading-tight">{plan?.title ?? "Launch"}</h2>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 text-center [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">
        <div className={`num text-4xl tracking-wider ${counting && tMinus <= 5 ? "text-amber" : "text-white"}`}>{t >= T.countStart ? clock : "T-10"}</div>
      </div>

      <DamageNotes />
      {mounted && flying && !over && (
        <div className="absolute bottom-6 left-6 w-64">
          <Panel>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] text-dim">Flight</span>
              <span className="num text-[11px] text-cyan">{stageName}</span>
            </div>
            <Needle err={errDeg} range={20} good={Math.max(2, P.trajTol * 0.25)} label="Pitch vs guide (deg)" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="Pitch (deg)" value={(sim.p * R2D).toFixed(0)} tone="data" />
              <Stat label="Guide (deg)" value={(sim.g * R2D).toFixed(0)} tone="data" />
              <Stat label="Altitude (km)" value={sim.altKm.toFixed(0)} tone="data" />
              <Stat label="Speed (km/s)" value={(sim.v / 1000).toFixed(2)} tone="data" />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-dim">
              {P.assist > 0.5 ? "Autopilot helps hold the guide. " : ""}
              {P.autoStage ? "Staging and cutoff are automatic." : ""}
            </p>
          </Panel>
        </div>
      )}

      {mounted && prompt && !over && (
        <div className="absolute bottom-44 left-1/2 w-[22rem] -translate-x-1/2">
          <Panel className={mine ? "border-amber/60" : ""}>
            <div className="flex items-center justify-between">
              <div className={`num text-lg ${mine ? "animate-pulse text-amber" : "text-white"}`}>{prompt}</div>
              {mine && !(P.autoStage && need === "stage") && (
                <Button onClick={() => press("Space")} className="!px-3 !py-1.5">{need === "stage" ? "Stage" : need === "ignite" ? "Ignite" : "Cut off"}</Button>
              )}
            </div>
            {mine && <p className="mt-1 text-[11px] text-dim">{P.autoStage && need === "stage" ? "Automatic staging in a moment." : keyHint}</p>}
            {(need === "cutoff" || need === "ignite") && <SpeedTape v={sim.v} tol={P.tol} auto={P.autoCut} />}
          </Panel>
        </div>
      )}

      {mounted && over && sim.result && (
        <div className="absolute right-6 top-1/2 w-[20rem] -translate-y-1/2" style={{ opacity: 1 - fadeEnd }}>
          <Panel>
            <div className="text-[11px] text-dim">Ascent score</div>
            <div className="num text-5xl leading-none text-go">{sim.result.total}</div>
            <div className="mt-3 space-y-2.5">
              {[
                ["Trajectory", sim.result.traj, `${sim.result.rmsDeg.toFixed(1)} deg average error from the guide`],
                ["Staging", sim.result.staging, `${sim.result.stageDelays.map((d) => d.toFixed(1)).join(" s and ")} s after burnout`],
                ["Burn", sim.result.burn, `${(sim.v / 1000).toFixed(2)} km/s, ${sim.result.dv >= 0 ? "+" : ""}${Math.round(sim.result.dv)} m/s from target`],
              ].map(([label, pts, text]) => (
                <div key={label as string}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-white/85">{label}</span>
                    <span className="num text-dim">{pts} / 100</span>
                  </div>
                  <Meter value={(pts as number) / 100} tone={(pts as number) > 66 ? "go" : (pts as number) > 33 ? "amber" : "nogo"} />
                  <div className="mt-0.5 text-[11px] text-dim">{text}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {mounted && t > 1.5 && !over && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          {showSkip && <Button variant="ghost" onClick={skip.request} disabled={skip.disabled}>{skip.label}</Button>}
          <ControlsHelp
            rows={[
              [["Left", "Right"], "Pitch back / over"],
              [["Up", "Down"], "Same, either pair"],
              [["Space"], need === "stage" ? "Stage (commander)" : need === "none" ? "Stage, start burn, cut off" : need === "ignite" ? "Start burn (pilot)" : "Cut off (pilot)"],
            ]}
            note="Keep the needle in the green band. Crew roles: the commander stages, the pilot steers and flies the burn."
          />
        </div>
      )}
    </div>
  );
}

/** Speed from the parking orbit to a bit past the target; the green band is the cutoff window. */
function SpeedTape({ v, tol, auto }: { v: number; tol: number; auto: boolean }) {
  const lo = TLI.v0 - 100, hi = TLI.target + 450;
  const x = (m: number) => `${Math.min(100, Math.max(0, ((m - lo) / (hi - lo)) * 100))}%`;
  const inWin = Math.abs(v - TLI.target) <= tol;
  return (
    <div className="mt-3">
      <div className="relative h-3 rounded-full bg-white/10">
        <div className="absolute inset-y-0 rounded-full bg-go/30" style={{ left: x(TLI.target - tol), width: `${(2 * tol / (hi - lo)) * 100}%` }} />
        <div className="absolute inset-y-[-3px] w-0.5 bg-white" style={{ left: x(TLI.target) }} />
        <div className={`absolute top-[-3px] h-[18px] w-1.5 -translate-x-1/2 rounded-sm ${inWin ? "bg-go" : "bg-amber"}`} style={{ left: x(v) }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-dim">
        <span className="num">{(v / 1000).toFixed(2)} km/s</span>
        <span className="num">target {(TLI.target / 1000).toFixed(2)}{auto ? " (auto cutoff)" : ""}</span>
      </div>
    </div>
  );
}
