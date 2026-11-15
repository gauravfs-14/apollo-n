"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { missionTime, skyAt, loadEphemeris, type OverlayMode } from "../../three/terrain";
import { useGame } from "../../core/useGame";
import { Button, Meter, Panel, PhaseTitle, Stat } from "../../ui/kit";
import { suggestSpot, type Breakdown } from "./api";
import { useSiteActions, useSiteState } from "./actions";
import { useSiteUi } from "./ui";
import { phaseLabel } from "../../ui/phaseLabel";
import { say } from "../../core/comms";
import { SITE_CONFIRMED } from "../../data/missionComms";

const MODES: { id: OverlayMode; label: string; text: (tilt: number) => string }[] = [
  { id: "none", label: "Off", text: () => "Natural view. Black areas are in shadow from the low Sun right now." },
  { id: "slope", label: "Slope", text: (t) => `Steepness of the ground. Blue is flat, red is steep. Your legs hold up to ${t} degrees.` },
  { id: "sun", label: "Sunlight", text: () => "How often the Sun reaches the ground over many years. Blue is sunny, red is dark. Sun means power." },
  { id: "earth", label: "Radio", text: () => "How often Earth is in view. Blue means a steady radio link, red means mostly hidden." },
  { id: "hazard", label: "Rough", text: () => "Rocks and bumps. Red ground is rough and can break a landing leg." },
  { id: "risk", label: "Overall", text: () => "Everything combined: slope, rocks, sunlight and radio. Aim for blue." },
];

function Legend({ mode, tilt }: { mode: OverlayMode; tilt: number }) {
  const m = MODES.find((x) => x.id === mode)!;
  return (
    <div className="mt-3">
      {mode !== "none" && (
        <>
          <div className="h-2 rounded-full" style={{ background: "linear-gradient(to right,#0a4df2,#0dccd9,#ffd12e,#ff2914)" }} />
          <div className="mt-1 flex justify-between text-[11px] text-dim">
            <span>Cool: safe</span>
            <span>Hot: risky</span>
          </div>
        </>
      )}
      <p className="mt-2 text-xs leading-snug text-white/75">{m.text(tilt)}</p>
    </div>
  );
}

function Compass() {
  const camAz = useSiteUi((s) => s.camAz);
  const { plan, siteId } = useSiteState();
  const sunDay = useSiteUi((s) => s.sunDay);
  const [sky, setSky] = useState<ReturnType<typeof skyAt> | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadEphemeris(), fetch(`/terrain/${siteId}/meta.json`).then((r) => r.json())]).then(([e, meta]) => {
      if (alive) setSky(skyAt(e, meta.center.lat, meta.center.lon, missionTime(plan) + sunDay * 86400, sunDay === 0 ? undefined : -90));
    });
    return () => {
      alive = false;
    };
  }, [siteId, plan, sunDay]);
  const rot = (az: number) => az - camAz;
  const dot = (az: number, r: number) => ({ left: 36 + Math.sin((rot(az) * Math.PI) / 180) * r - 6, top: 36 - Math.cos((rot(az) * Math.PI) / 180) * r - 6 });
  return (
    <div className="pointer-events-none relative h-[72px] w-[72px] rounded-full border border-line bg-panel backdrop-blur">
      <span className="num absolute text-[10px] text-white/80" style={{ left: 36 + Math.sin((rot(0) * Math.PI) / 180) * 25 - 3, top: 36 - Math.cos((rot(0) * Math.PI) / 180) * 25 - 6 }}>N</span>
      {sky && <span className="absolute h-3 w-3 rounded-full bg-amber shadow-[0_0_8px_#ffb547]" style={dot(sky.sunAzDeg, 28)} title="Sun" />}
    </div>
  );
}

function SunSlider() {
  const set = useSiteUi((s) => s.set);
  const [v, setV] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { plan, siteId } = useSiteState();
  const [label, setLabel] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([loadEphemeris(), fetch(`/terrain/${siteId}/meta.json`).then((r) => r.json())]).then(([e, meta]) => {
      if (!alive) return;
      const s = skyAt(e, meta.center.lat, meta.center.lon, missionTime(plan) + v * 86400, v === 0 ? undefined : -90);
      setLabel(`Sun ${s.sunElDeg.toFixed(1)} deg above the horizon, ${new Date(s.t * 1000).toUTCString().slice(5, 16)}`);
    });
    return () => {
      alive = false;
    };
  }, [v, plan, siteId]);
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="text-[11px] text-dim">Time of the lunar day</div>
      <input
        type="range"
        min={0}
        max={29.5}
        step={0.25}
        value={v}
        className="pointer-events-auto mt-1 w-full accent-amber"
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => set({ sunDay: n }), 140);
        }}
      />
      <div className="num text-[11px] text-white/70">{label}</div>
      <p className="mt-1 text-[11px] leading-snug text-dim">The Sun circles the horizon once a month. Drag to see how the shadows move.</p>
    </div>
  );
}

function ScoreRow({ b }: { b: Breakdown }) {
  const r = b.weight ? b.points / b.weight : 0;
  return (
    <div title={b.text}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/85">{b.label}</span>
        <span className="num text-dim">
          {b.points.toFixed(0)} / {b.weight}
        </span>
      </div>
      <Meter value={r} tone={r > 0.66 ? "go" : r > 0.33 ? "amber" : "nogo"} />
      <div className="mt-0.5 text-[11px] leading-snug text-dim">{b.text}</div>
    </div>
  );
}

function Report() {
  const { sd, lander } = useSiteState();
  const { isPilot, runSim, confirm } = useSiteActions();
  const busy = useSiteUi((s) => s.busy);
  const error = useSiteUi((s) => s.error);
  const { plan } = useGame();
  const sc = sd.report;
  const sim = sd.sim;
  useEffect(() => {
    if (sd.director) say({ who: "capcom", text: sd.director }, { once: `director:${sd.director}` });
  }, [sd.director]);
  useEffect(() => {
    if (sim) say(SITE_CONFIRMED, { once: `doi:${plan?.id}` });
  }, [sim, plan?.id]);
  const tone = !sc ? "default" : sc.score >= 70 ? "go" : sc.score >= 45 ? "default" : "nogo";
  if (!sd.probe)
    return (
      <Panel className="w-80">
        <div className="text-sm font-medium">Drop a probe</div>
        <p className="mt-1 text-xs leading-snug text-dim">
          {isPilot
            ? "Click anywhere on the ground. The probe measures the slope, sunlight, radio view and rocks at that exact spot."
            : "The pilot is choosing the landing spot. You can look around and use the scanner, and you will see the probe and the results live."}
        </p>
      </Panel>
    );
  return (
    <Panel className="max-h-[calc(100vh-9rem)] w-80 overflow-y-auto">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] text-dim">Spot score</div>
          <div className={`num text-4xl leading-none ${tone === "go" ? "text-go" : tone === "nogo" ? "text-nogo" : "text-amber"}`}>{sc ? sc.score : "..."}</div>
        </div>
        {sc && (
          <div className="text-right text-[11px] text-dim">
            <div className="num">{sc.lat.toFixed(3)}, {sc.lon.toFixed(2)}</div>
            <div className="num">{Math.round(sc.elevation_m)} m high</div>
          </div>
        )}
      </div>
      {!sc && <p className="mt-2 text-xs text-dim">Measuring the ground...</p>}
      {sc && (
        <>
          {sc.hazards.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sc.hazards.map((h, i) => (
                <span key={i} title={h.text} className={`rounded px-1.5 py-0.5 text-[11px] ${h.severity > 0.6 ? "bg-nogo/25 text-nogo" : "bg-amber/20 text-amber"}`}>
                  {h.text.length > 44 ? h.kind.replace(/_/g, " ") : h.text}
                </span>
              ))}
            </div>
          )}
          {sd.director && (
            <p className="mt-3 border-l-2 border-cyan/60 pl-2 text-xs leading-snug text-white/85">
              <span className="text-[11px] text-cyan">Flight Director</span>
              <br />
              {sd.director}
            </p>
          )}
          <div className="mt-3 space-y-2.5">{sc.breakdown.map((b) => <ScoreRow key={b.key} b={b} />)}</div>
          {sc.offline && <p className="mt-2 text-[11px] text-amber">On-board estimate (mission computer unreachable).</p>}
        </>
      )}

      {sc && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-sm font-medium">Practice landings</div>
          {!sim && (
            <>
              <p className="mt-1 text-xs leading-snug text-dim">
                Real landers never touch down exactly on target. Run 300 practice landings to see how many stay upright.
              </p>
              {isPilot ? (
                <Button className="mt-2 w-full" variant="ghost" disabled={busy === "sim"} onClick={() => runSim(300)}>
                  {busy === "sim" ? "Landing 300 spacecraft..." : "Run 300 test landings"}
                </Button>
              ) : (
                <p className="mt-2 text-xs text-dim">Waiting for the pilot to run the test.</p>
              )}
            </>
          )}
          {sim && (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="Safe landings" value={`${sim.safe_pct.toFixed(0)}%`} tone={sim.safe_pct >= 75 ? "go" : sim.safe_pct >= 40 ? "default" : "nogo"} />
                <Stat label="Avg tilt" value={`${sim.mean_tilt_deg.toFixed(1)}°`} tone="data" />
                <Stat label="Legs hold" value={`${sim.tilt_limit_deg.toFixed(0)}°`} />
              </div>
              <div className="mt-2 flex gap-3 text-[11px] text-white/80">
                <span><i className="mr-1 inline-block h-2 w-2 rotate-45 bg-go" />Upright {sim.breakdown.ok}</span>
                <span><i className="mr-1 inline-block h-2 w-2 rotate-45 bg-nogo" />Tipped {sim.breakdown.tipped}</span>
                <span><i className="mr-1 inline-block h-2 w-2 rotate-45 bg-nogo" />Rock {sim.breakdown.boulder}{sim.breakdown.oob ? ` · off map ${sim.breakdown.oob}` : ""}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-dim">
                Green and red diamonds on the map are where each practice landing ended. The ring holds 95 of every 100 (radius {Math.round(sim.ellipse.radius95_m)} m).
              </p>
            </>
          )}
          {error && <p className="mt-2 text-[11px] text-amber">{error}</p>}
          {isPilot && (
            <>
              <Button className="mt-3 w-full" disabled={busy !== null || sd.confirmed} onClick={() => confirm()}>
                Confirm landing site
              </Button>
              <p className="mt-1 text-[11px] text-dim">
                Step score: spot score × safe landings{sc && sim ? ` = ${Math.round((sc.score * sim.safe_pct) / 100)}` : ""}. Legs on this ship: {lander.max_tilt_deg} degrees{plan?.difficulty === "easy" ? " (easy mode adds margin)" : ""}.
              </p>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function SiteHud() {
  const { plan, sd, sites, siteId, lander } = useSiteState();
  const { isPilot, chooseSite, autoPick, terrain } = useSiteActions();
  const { isHost } = useGame();
  const overlay = useSiteUi((s) => s.overlay);
  const set = useSiteUi((s) => s.set);
  const loaded = useSiteUi((s) => s.loaded);
  const hover = useSiteUi((s) => s.hover);
  const drops = useSiteUi((s) => s.drops);
  const hint = useSiteUi((s) => s.hint);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = plan?.difficulty ?? "normal";
  const hintOk = diff === "easy" || drops >= (diff === "normal" ? 2 : 4);
  const cur = useMemo(() => sites.find((s) => s.id === siteId), [sites, siteId]);

  async function toggleHint() {
    if (hint) return set({ hint: null });
    set({ hint: suggestSpot(await terrain()) });
  }

  return (
    <div className="absolute inset-0">
      <PhaseTitle step={phaseLabel("site")} title="Find a safe landing spot" subtitle="Scan the ground, drop a probe, then test-land 300 times." />

      <div className="absolute left-6 top-28 flex w-72 flex-col gap-3">
        <Panel>
          <div className="mb-2 text-[11px] text-dim">Candidate sites{isPilot ? "" : " (pilot chooses)"}</div>
          <div className="flex flex-col gap-1.5">
            {sites.map((s) => (
              <button
                key={s.id}
                disabled={!isPilot}
                onClick={() => chooseSite(s.id)}
                className={`pointer-events-auto rounded-lg border px-3 py-2 text-left transition ${s.id === siteId ? "border-amber bg-amber/10" : "border-line bg-white/[0.03] hover:bg-white/10"} disabled:cursor-default`}
              >
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-[11px] leading-snug text-dim">{s.why}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="mb-2 text-[11px] text-dim">Ground scanner</div>
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => set({ overlay: m.id })}
                className={`pointer-events-auto rounded-md border px-2 py-1.5 text-xs transition ${overlay === m.id ? "border-amber bg-amber/15 text-amber" : "border-line bg-white/5 text-white/85 hover:bg-white/10"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Legend mode={overlay} tilt={lander.max_tilt_deg} />
          <SunSlider />
        </Panel>

        {isPilot && (
          <div className="flex gap-2">
            {hintOk ? (
              <Button variant="ghost" className="flex-1" onClick={toggleHint}>
                {hint ? "Hide hint" : "Show a good area"}
              </Button>
            ) : (
              <p className="px-1 text-[11px] text-dim">A hint unlocks after a couple of probes.</p>
            )}
          </div>
        )}
        {isHost && elapsed > 150 && !sd.confirmed && (
          <Button variant="ghost" onClick={() => autoPick()}>
            Skip: let mission control pick
          </Button>
        )}
      </div>

      <div className="absolute right-6 top-5 flex flex-col items-end gap-3">
        <Compass />
        <Report />
      </div>

      {hover && (
        <div className="num absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-white/85 backdrop-blur">
          slope {hover.slopeDeg.toFixed(0)}° · sun {Math.round(hover.sunPct)}% · Earth {Math.round(hover.earthPct)}%{hover.psr ? " · permanent shadow (ice-trap ground)" : ""}
        </div>
      )}
      {!hover && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-dim">
          {cur ? `${cur.name} · ` : ""}drag to look around · scroll to zoom · {isPilot ? "click to drop a probe" : "pilot drops the probe"}
        </div>
      )}

      {!loaded && (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          <div className="text-sm text-white/80">Loading real lunar terrain (NASA LOLA)...</div>
        </div>
      )}
    </div>
  );
}
