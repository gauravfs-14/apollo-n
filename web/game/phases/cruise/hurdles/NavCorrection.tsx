"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Navigation correction: two dials move your ring; line it up with the target ring and hold steady.
import { useEffect, useMemo, useState } from "react";
import { Panel } from "../../../ui/kit";
import { lerp, mulberry, useCountdown, type HurdleCtx } from "../flow";
import { Dial, Notice, TimerBar } from "./shared";

const SX = 2.3, SY = 1.9; // px per dial unit
const R = 54;

export function NavCorrection({ ctx }: { ctx: HurdleCtx }) {
  const total = lerp(75, 38, ctx.level);
  const tol = lerp(15, 6.5, ctx.level);
  const holdNeeded = lerp(1.1, 2.0, ctx.level);
  const { target, start } = useMemo(() => {
    const r = mulberry(ctx.seed * 17 + ctx.idx * 5);
    const away = (min: number, max: number) => (r() < 0.5 ? -1 : 1) * (min + r() * (max - min));
    return {
      target: [50 + away(14, 32), 50 + away(14, 32)] as [number, number],
      start: [50 + away(10, 40), 50 + away(10, 40)] as [number, number],
    };
  }, [ctx.seed, ctx.idx]);
  const [v, setV] = useState<[number, number]>([Math.max(0, Math.min(100, start[0])), Math.max(0, Math.min(100, start[1]))]);
  const [hold, setHold] = useState(0);
  const [done, setDone] = useState(false);

  const dist = (a: [number, number]) => Math.hypot((a[0] - target[0]) * SX, (a[1] - target[1]) * SY);
  const left = useCountdown(total, ctx.actor && !done, () => {
    if (done) return;
    setDone(true);
    ctx.finish(Math.round(15 + 35 * (1 - Math.min(1, dist(v) / 160))), "Time ran out before the rings lined up.");
  });

  // hold timer
  useEffect(() => {
    if (!ctx.actor || done) return;
    const id = setInterval(() => {
      setHold((h) => (dist(v) < tol ? Math.min(holdNeeded, h + 0.05) : Math.max(0, h - 0.08)));
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ctx.actor, done, tol, holdNeeded]);

  useEffect(() => {
    if (!ctx.actor) return;
    ctx.push({ v, hold, left, total });
    if (!done && hold >= holdNeeded) {
      setDone(true);
      ctx.finish(Math.round(65 + 35 * Math.min(1, left / total)), "Course corrected.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, hold, left]);

  const sv = ctx.actor ? v : ((ctx.live.v as [number, number] | undefined) ?? v);
  const sh = ctx.actor ? hold : (ctx.live.hold as number | undefined) ?? 0;
  const sl = ctx.actor ? left : (ctx.live.left as number | undefined) ?? total;
  const d = dist(sv);
  const near = Math.max(0, Math.min(1, 1 - (d - tol) / 140));
  const color = d < tol ? "#4ade80" : `hsl(${lerp(32, 190, near)} 90% 62%)`;
  const cx = 200, cy = 150;
  const tx = cx + (target[0] - 50) * SX, ty = cy - (target[1] - 50) * SY;
  const mx = cx + (sv[0] - 50) * SX, my = cy - (sv[1] - 50) * SY;

  return (
    <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">
      <Panel className="w-full max-w-3xl space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
          <Notice>{ctx.actor ? "Turn the dials (drag them, or use the arrow keys) until your ring covers the white target ring." : "Watching the pilot correct the course."}</Notice>
          <TimerBar left={sl} total={total} />
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr_auto]">
          <Dial label="Dial A: left / right" value={sv[0]} onChange={(x) => setV((p) => [x, p[1]])} disabled={!ctx.actor || done} />
          <svg viewBox="0 0 400 300" className="w-full rounded-lg bg-[#07090d]">
            {Array.from({ length: 40 }, (_, i) => <circle key={i} cx={(i * 97) % 400} cy={(i * 53) % 300} r={(i % 3) * 0.5 + 0.7} fill="white" opacity="0.35" />)}
            <line x1={cx} x2={cx} y1="0" y2="300" stroke="rgb(255 255 255 / 0.08)" />
            <line y1={cy} y2={cy} x1="0" x2="400" stroke="rgb(255 255 255 / 0.08)" />
            <circle cx={tx} cy={ty} r={R} fill="none" stroke="#ffffff" strokeWidth="5" opacity="0.9" />
            <circle cx={tx} cy={ty} r={tol} fill="none" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.6" />
            <line x1={mx} y1={my} x2={tx} y2={ty} stroke={color} strokeWidth="2" strokeDasharray="4 5" opacity="0.7" />
            <circle cx={mx} cy={my} r={R} fill={d < tol ? "rgb(74 222 128 / 0.12)" : "none"} stroke={color} strokeWidth="6" />
            <circle cx={mx} cy={my} r="4" fill={color} />
            {/* hold ring */}
            <circle cx={cx} cy="278" r="0" />
            <rect x="120" y="282" width="160" height="6" rx="3" fill="rgb(255 255 255 / 0.12)" />
            <rect x="120" y="282" width={160 * (sh / holdNeeded)} height="6" rx="3" fill="#4ade80" />
          </svg>
          <Dial label="Dial B: up / down" value={sv[1]} onChange={(y) => setV((p) => [p[0], y])} disabled={!ctx.actor || done} />
        </div>
        <div className="text-sm text-white/80">{d < tol ? "Hold steady..." : d < tol * 3 ? "Almost there." : "Off course."}</div>
      </Panel>
    </div>
  );
}
