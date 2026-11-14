"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Debris dodge, 2D part: integrity, clock, and the stream between actor and spectators. The 3D game is DebrisField.
import { useEffect, useState } from "react";
import { Panel } from "../../../ui/kit";
import type { HurdleCtx } from "../flow";
import { DEBRIS_SECONDS, rt } from "../rt";
import { Notice, TimerBar } from "./shared";

const LIVES = 3;

export function DebrisHud({ ctx }: { ctx: HurdleCtx }) {
  const [, force] = useState(0);
  const [done, setDone] = useState(false);

  // actor: run the clock, broadcast, finish at the end
  useEffect(() => {
    if (!ctx.actor) return;
    const id = setInterval(() => {
      ctx.push({ x: rt.x, y: rt.y, t: rt.t, hits: rt.hits });
      force((n) => n + 1);
      if (rt.t >= DEBRIS_SECONDS && !done) {
        setDone(true);
        rt.playing = false;
        const hits = rt.hits;
        ctx.finish(Math.max(25, 100 - hits * 20), hits === 0 ? "Clean flight, not a scratch." : `${hits} hit${hits > 1 ? "s" : ""} on the hull.`);
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.actor, done]);

  // spectators: mirror the stream into the shared runtime the 3D scene reads
  useEffect(() => {
    if (ctx.actor) return;
    const d = ctx.live as { x?: number; y?: number; t?: number; hits?: number };
    if (typeof d.t !== "number") return;
    rt.x = d.x ?? 0;
    rt.y = d.y ?? 0;
    rt.t = d.t;
    rt.tAt = performance.now();
    rt.hits = d.hits ?? 0;
    force((n) => n + 1);
  }, [ctx.actor, ctx.live]);

  const hits = rt.hits;
  return (
    <div className="absolute right-4 top-14 w-[22rem] max-w-[calc(100vw-2rem)]">
      <Panel className="space-y-3">
        <Notice>{ctx.actor ? "Fly through the gap in every wall of rocks. Arrow keys, WASD or the mouse." : "Watching the pilot fly through the debris."}</Notice>
        <div className="grid gap-3">
          <TimerBar left={Math.max(0, DEBRIS_SECONDS - rt.t)} total={DEBRIS_SECONDS} />
          <div>
            <div className="mb-1 text-xs text-dim">Hull integrity</div>
            <div className="flex gap-1.5">
              {Array.from({ length: LIVES }, (_, i) => <span key={i} className={`h-2.5 flex-1 rounded-full ${i < LIVES - hits ? "bg-go" : "bg-nogo/40"}`} />)}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
