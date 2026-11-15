"use client";
// In-flight screens of the two challenges (telemetry, prompts, controls).
// clock.ts must load before flight.ts (they import each other; the other order fails at module init)
import "../phases/launch/clock";
import { ControlsHelp, Needle, TiltPad } from "../flight/ui";
import { press } from "../flight/input";
import { TLI } from "../phases/launch/flight";
import { Button, Meter, Panel, Stat } from "../ui/kit";
import { TOL, V_SAFE } from "./scoring";
import { useArcade } from "./store";

const FT = 3.281;
const ft = (m: number) => Math.round(Math.abs(m) * FT);
const R2D = 180 / Math.PI;

export function LandingHud() {
  const s = useArcade((x) => x.land);
  const limit = useArcade((x) => x.limit);
  if (!s || s.down) return null;
  const sink = Math.max(0, -s.vy);
  const tooFast = s.alt < 60 && sink > V_SAFE * 1.4;
  const lowFuel = s.fuelPct < 20;
  return (
    <>
      <div className="absolute bottom-6 left-6 w-64">
        <Panel>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Altitude (ft)" value={ft(s.alt)} tone="data" />
            <Stat label="Down (ft/s)" value={(sink * FT).toFixed(0)} tone={tooFast ? "nogo" : sink > V_SAFE ? "default" : "go"} />
            <Stat label="Forward (ft/s)" value={(s.vf * FT).toFixed(0)} tone="data" />
            <Stat label="Sideways (ft/s)" value={(s.vr * FT).toFixed(0)} tone="data" />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <TiltPad lean={[s.leanF, s.leanR]} slope={[s.slopeF, s.slopeR]} limit={limit} vel={[s.vf, s.vr]} />
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
                Ring: {ft(s.tgtF)} ft {s.tgtF >= 0 ? "ahead" : "behind"}, {ft(s.tgtR)} ft {s.tgtR >= 0 ? "right" : "left"}
              </div>
            </div>
          </div>
          <div className={`mt-3 rounded-md px-2 py-1 text-center text-xs font-medium ${s.contact ? "bg-cyan/20 text-cyan" : "bg-white/5 text-dim"}`}>
            {s.contact ? "CONTACT LIGHT" : s.hover ? `Hover assist: holding ${(Math.max(-s.vt, 0) * FT).toFixed(0)} ft/s down` : "Manual throttle"}
          </div>
        </Panel>
      </div>
      {(tooFast || lowFuel) && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-md bg-nogo/80 px-3 py-1 text-sm font-medium text-white">
          {s.fuelPct <= 0 ? "OUT OF FUEL" : tooFast ? "TOO FAST: add throttle" : "LOW FUEL"}
        </div>
      )}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
        <Button variant={s.hover ? "primary" : "ghost"} onClick={() => press("KeyH")} className="!px-3 !py-1.5">Hover assist (H)</Button>
        <ControlsHelp
          rows={[
            [["W", "S"], s.hover ? "Sink rate: less / more" : "Throttle up / down"],
            [["Shift"], "Full throttle (hold)"],
            [["X"], "Engine cut"],
            [["Up", "Down"], "Lean forward / back"],
            [["Left", "Right"], "Lean left / right"],
            [["H"], "Hover assist"],
            [["R"], "Instant retry"],
          ]}
          note="Leaning tilts the thrust: lean toward where you want to go, the other way to stop. A steady drift pushes you sideways. Touch down slow, level, on the ring."
        />
      </div>
    </>
  );
}

export function LaunchHud() {
  const s = useArcade((x) => x.launch);
  if (!s) return null;
  const prompt = s.need === "stage" ? "Stage now" : s.need === "ignite" ? "Start the translunar burn" : s.need === "cutoff" ? "Cut off at target speed" : "";
  const key = s.need === "stage" ? "Stage" : s.need === "ignite" ? "Ignite" : "Cut off";
  return (
    <>
      {s.countdown > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <div className="num text-8xl text-amber">{Math.ceil(s.countdown)}</div>
          <div className="mt-2 text-sm text-dim">Follow the pitch guide with the arrow keys</div>
        </div>
      )}
      {!s.over && (
        <div className="absolute bottom-6 left-6 w-64">
          <Panel>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] text-dim">Flight</span>
              <span className="num text-[11px] text-cyan">{s.stage}</span>
            </div>
            <Needle err={s.err * R2D} range={20} good={2} label="Pitch vs guide (deg)" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="Pitch (deg)" value={(s.p * R2D).toFixed(0)} tone="data" />
              <Stat label="Guide (deg)" value={(s.g * R2D).toFixed(0)} tone="data" />
              <Stat label="Altitude (km)" value={s.altKm.toFixed(0)} tone="data" />
              <Stat label="Speed (km/s)" value={(s.v / 1000).toFixed(2)} tone="data" />
            </div>
          </Panel>
        </div>
      )}
      {!s.over && prompt && (
        <div className="absolute bottom-44 left-1/2 w-[22rem] -translate-x-1/2">
          <Panel className="border-amber/60">
            <div className="flex items-center justify-between">
              <div className="num animate-pulse text-lg text-amber">{prompt}</div>
              <Button onClick={() => press("Space")} className="!px-3 !py-1.5">{key} (Space)</Button>
            </div>
            {(s.need === "cutoff" || s.need === "ignite") && <SpeedTape v={s.v} />}
          </Panel>
        </div>
      )}
      {!s.over && (
        <div className="absolute bottom-6 right-6">
          <ControlsHelp
            rows={[
              [["Left", "Right"], "Pitch back / over"],
              [["Space"], "Stage, start burn, cut off"],
              [["R"], "Instant retry"],
            ]}
            note="Keep the needle in the green band. Stage right after burnout. Cut the burn inside the green window at the target speed."
          />
        </div>
      )}
    </>
  );
}

function SpeedTape({ v }: { v: number }) {
  const lo = TLI.v0 - 100, hi = TLI.target + 450;
  const x = (m: number) => `${Math.min(100, Math.max(0, ((m - lo) / (hi - lo)) * 100))}%`;
  const inWin = Math.abs(v - TLI.target) <= TOL;
  return (
    <div className="mt-3">
      <div className="relative h-3 rounded-full bg-white/10">
        <div className="absolute inset-y-0 rounded-full bg-go/30" style={{ left: x(TLI.target - TOL), width: `${((2 * TOL) / (hi - lo)) * 100}%` }} />
        <div className="absolute inset-y-[-3px] w-0.5 bg-white" style={{ left: x(TLI.target) }} />
        <div className={`absolute top-[-3px] h-[18px] w-1.5 -translate-x-1/2 rounded-sm ${inWin ? "bg-go" : "bg-amber"}`} style={{ left: x(v) }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-dim">
        <span className="num">{(v / 1000).toFixed(2)} km/s</span>
        <span className="num">target {(TLI.target / 1000).toFixed(2)}</span>
      </div>
    </div>
  );
}
