"use client";
import { useEffect, useState } from "react";
import { useSkipVote } from "../../core/skip";
import { useGame } from "../../core/useGame";
import { Button } from "../../ui/kit";
import { BOARD_END, boardCaption, useBoardClock } from "./clock";
import { phaseLabel } from "../../ui/phaseLabel";

export function BoardHud() {
  const t = useBoardClock((s) => s.t);
  const skip = useSkipVote("board", useBoardClock.getState().skip); // multiplayer: the crew votes
  const { plan } = useGame();
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShowSkip(true), 1200);
    return () => clearTimeout(id);
  }, []);
  const black = Math.max(t < 0.8 ? 1 - t / 0.8 : 0, t > BOARD_END - 1.1 ? Math.min(1, (t - (BOARD_END - 1.1)) / 1) : 0, Math.abs(t - 9) < 0.25 ? 1 - Math.abs(t - 9) / 0.25 : 0, Math.abs(t - 4.5) < 0.2 ? 0.6 * (1 - Math.abs(t - 4.5) / 0.2) : 0);
  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: black }} />
      <div className="pointer-events-none absolute left-6 top-5 [text-shadow:0_1px_10px_rgba(0,0,0,0.7)]">
        <div className="num text-[11px] text-amber">{phaseLabel("board")}</div>
        <h2 className="text-2xl font-semibold leading-tight">{plan?.title ?? "Boarding"}</h2>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm text-white/90 [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">{boardCaption(t)}</div>
      {showSkip && t < BOARD_END - 1.5 && (
        <div className="absolute bottom-6 right-6">
          <Button variant="ghost" onClick={skip.request} disabled={skip.disabled}>{skip.label}</Button>
        </div>
      )}
    </div>
  );
}
