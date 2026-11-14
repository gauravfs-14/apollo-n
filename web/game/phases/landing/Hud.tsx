"use client";
import { useEffect, useMemo, useState } from "react";
import { useGame, usePhaseData } from "../../core/useGame";
import { Button, Meter, Panel, PhaseTitle, Stat } from "../../ui/kit";
import type { SimOut } from "../site/api";
import { landerFromBuild } from "../site/api";
import { pickOutcome, scoreLanding } from "./outcome";
import { TOTAL, useLanding } from "./store";
import { loadTerrain } from "../../three/terrain";

interface SiteData {
  site_id: string;
  probe: { x: number; z: number };
  sim: SimOut;
  score: number;
  safe_pct: number;
}

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

export function LandingHud() {
  const { plan, complete, actsAs, isHost, state } = useGame();
  const sd = usePhaseData<SiteData>("site");
  const build = usePhaseData<{ parts: Record<string, string> }>("build");
  const t = useLanding((s) => s.t);
  const tele = useLanding((s) => s.tele);
  const contact = useLanding((s) => s.contact);
  const ready = useLanding((s) => s.ready);
  const skip = useLanding((s) => s.skip);
  const isPilot = actsAs("pilot");
  const lander = useMemo(() => landerFromBuild(build.parts), [build.parts]);
  const [outcomeScore, setOutcome] = useState<ReturnType<typeof scoreLanding> | null>(null);
  const [waited, setWaited] = useState(0);
  const [out, setOut] = useState<ReturnType<typeof pickOutcome> | null>(null);

  useEffect(() => {
    let alive = true;
    const siteId = sd.site_id ?? plan?.destination.candidate_sites[0]?.id ?? "site_a";
    loadTerrain(siteId).then((d) => {
      if (!alive) return;
      const o = pickOutcome(sd.sim, sd.probe, plan?.seed ?? 1, d, lander.leg_span_m / 2);
      setOutcome(scoreLanding(o, sd.sim?.ellipse?.radius95_m ?? 150));
      setOut(o);
    });
    return () => {
      alive = false;
    };
  }, [sd.site_id, sd.sim, sd.probe, plan, lander.leg_span_m]);

  const done = t >= TOTAL - 2.4;
  useEffect(() => {
    if (!done) return;
    const i = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(i);
  }, [done]);
  const anyPilot = state?.players.some((p) => p.role === "pilot" && p.connected) ?? false;
  const canContinue = isPilot || (isHost && (!anyPilot || waited > 20));

  return (
    <div className="absolute inset-0">
      <PhaseTitle step="PHASE 8 · POWERED DESCENT" title="Touchdown" subtitle={sd.probe ? "Landing on the spot you chose." : undefined} />

      {!done && ready && (
        <div className="absolute bottom-6 left-6 w-60">
          <Panel>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Height (m)" value={tele.alt >= 100 ? Math.round(tele.alt) : tele.alt.toFixed(1)} tone="data" />
              <Stat label="Sinking (m/s)" value={Math.max(0, -tele.vs).toFixed(1)} tone="data" />
              <Stat label="Sideways (m/s)" value={tele.hs.toFixed(1)} tone="data" />
              <Stat label="Engine" value={`${Math.round(tele.thr * 100)}%`} tone="data" />
            </div>
            <div className="mt-3">
              <Meter value={tele.thr} tone="amber" />
            </div>
            <div className={`mt-3 rounded-md px-2 py-1 text-center text-xs font-medium ${contact ? "bg-cyan/20 text-cyan" : "bg-white/5 text-dim"}`}>
              {contact ? "CONTACT LIGHT" : "Searching for ground"}
            </div>
          </Panel>
        </div>
      )}

      {!done && t > 3 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <Button variant="ghost" onClick={skip}>
            Skip
          </Button>
        </div>
      )}

      {done && outcomeScore && out && (
        <div className="absolute right-6 top-1/2 w-[22rem] -translate-y-1/2">
          <Panel>
            <div className="text-[11px] text-dim">Landing score</div>
            <div className="flex items-center justify-between">
              <div className={`num text-5xl leading-none ${outcomeScore.total >= 65 ? "text-go" : outcomeScore.total >= 35 ? "text-amber" : "text-nogo"}`}>{outcomeScore.total}</div>
              <Stars n={outcomeScore.stars} />
            </div>
            <p className="mt-2 text-sm leading-snug text-white/90">{outcomeScore.status}</p>
            <div className="mt-3 space-y-2.5">
              {outcomeScore.parts.map((p) => (
                <div key={p.label}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-white/85">{p.label}</span>
                    <span className="num text-dim">{p.points} / {p.max}</span>
                  </div>
                  <Meter value={p.points / p.max} tone={p.points / p.max > 0.66 ? "go" : p.points / p.max > 0.33 ? "amber" : "nogo"} />
                  <div className="mt-0.5 text-[11px] text-dim">{p.text}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-dim">
              This touchdown was one of your 300 practice landings, picked by the mission seed. Spot score {sd.score ?? "-"} and {sd.safe_pct != null ? Math.round(sd.safe_pct) : "-"}% safe landings
              decided the odds.
            </p>
            {canContinue ? (
              <Button className="mt-3 w-full" onClick={() => complete("landing", outcomeScore.total)}>
                Continue to the surface
              </Button>
            ) : (
              <p className="mt-3 text-xs text-dim">Waiting for the pilot to open the hatch.</p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
