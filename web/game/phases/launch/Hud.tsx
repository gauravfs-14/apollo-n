"use client";
import { useEffect, useState } from "react";
import { useGame } from "../../core/useGame";
import { Button } from "../../ui/kit";
import { T, captionAt, useLaunchClock } from "./clock";
import { phaseLabel } from "../../ui/phaseLabel";

export function LaunchHud() {
  const t = useLaunchClock((s) => s.t);
  const skip = useLaunchClock((s) => s.skip);
  const { plan } = useGame();
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShowSkip(true), 1500);
    return () => clearTimeout(id);
  }, []);

  const tMinus = T.liftoff - t;
  const counting = t >= T.countStart && tMinus > 0;
  const fadeIn = t > T.spaceCut - 0.5 && t < T.spaceCut + 0.4 ? 1 - Math.abs(t - T.spaceCut) / 0.5 : 0;
  const fadeEnd = t > T.end - 1.4 ? Math.min(1, (t - (T.end - 1.4)) / 1.2) : 0;
  const fadeStart = t < 1.2 ? 1 - t / 1.2 : 0;
  const black = Math.max(fadeIn, fadeEnd, fadeStart);
  const clock = t < T.liftoff ? `T-${Math.max(0, Math.ceil(tMinus)).toString().padStart(2, "0")}` : `T+${Math.floor(t - T.liftoff).toString().padStart(2, "0")}`;

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
      <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm text-white/90 [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">{captionAt(t)}</div>
      {showSkip && t < T.end - 2 && (
        <div className="absolute bottom-6 right-6">
          <Button variant="ghost" onClick={skip}>Skip</Button>
        </div>
      )}
    </div>
  );
}
