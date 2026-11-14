"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Comms blackout: tune the frequency and turn the dish until the signal is clear, then keep it there.
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../../ui/kit";
import { lerp, mulberry, useCountdown, useSeconds, type HurdleCtx } from "../flow";
import { Dial, Notice, TimerBar } from "./shared";

export function CommsBlackout({ ctx }: { ctx: HurdleCtx }) {
  const total = lerp(70, 36, ctx.level);
  const win = ctx.fx.commsWindow; // high_gain_antenna: wider sweet spot
  const w1 = lerp(11, 6, ctx.level) * win, w2 = lerp(14, 8, ctx.level) * win;
  const holdNeeded = lerp(2.2, 3.2, ctx.level);
  const drift = ctx.level > 0.55;
  const { tf0, td, start } = useMemo(() => {
    const r = mulberry(ctx.seed * 29 + ctx.idx * 3);
    return { tf0: 25 + r() * 50, td: 22 + r() * 56, start: [r() < 0.5 ? 8 : 92, r() < 0.5 ? 10 : 90] as [number, number] };
  }, [ctx.seed, ctx.idx]);
  const [f, setF] = useState(start[0]);
  const [d, setD] = useState(start[1]);
  const [tick, setTick] = useState(0);
  const [hold, setHold] = useState(0);
  const [done, setDone] = useState(false);
  const best = useRef(0);
  const secs = useSeconds();

  const t0 = useRef(performance.now());
  const tf = (now: number) => tf0 + (drift ? Math.sin(((now - t0.current) / 1000) * 0.45) * 5 : 0);
  const strengthOf = (ff: number, dd: number, now: number) => Math.exp(-(((ff - tf(now)) / w1) ** 2)) * Math.exp(-(((dd - td) / w2) ** 2));

  const left = useCountdown(total, ctx.actor && !done, () => {
    if (done) return;
    setDone(true);
    ctx.finish(Math.round(15 + 35 * best.current), "The link never held. Mission control is still on the line.");
  });

  useEffect(() => {
    if (!ctx.actor || done) return;
    const id = setInterval(() => {
      const s = strengthOf(f, d, performance.now());
      best.current = Math.max(best.current, s);
      setHold((h) => (s > 0.88 ? Math.min(holdNeeded, h + 0.08) : Math.max(0, h - 0.12)));
      setTick((n) => n + 1);
    }, 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, d, ctx.actor, done]);

  useEffect(() => {
    if (!ctx.actor) return;
    ctx.push({ f, d, hold, left, total });
    if (!done && hold >= holdNeeded) {
      setDone(true);
      ctx.finish(Math.round(60 + 40 * Math.min(1, left / total)), "Link restored.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, d, hold, left]);

  const sf = ctx.actor ? f : (ctx.live.f as number | undefined) ?? f;
  const sd = ctx.actor ? d : (ctx.live.d as number | undefined) ?? d;
  const sh = ctx.actor ? hold : (ctx.live.hold as number | undefined) ?? 0;
  const sl = ctx.actor ? left : (ctx.live.left as number | undefined) ?? total;
  const s = strengthOf(sf, sd, performance.now());
  const hint = ctx.level < 0.3 || secs > 14;

  // waveform: noise shrinks as the signal improves
  const sBucket = Math.round(s * 20);
  const path = useMemo(() => {
    const r = mulberry(tick * 7 + 1);
    const amp = 38, noise = (1 - s) * 70;
    const pts: string[] = [];
    for (let x = 0; x <= 400; x += 4) {
      const y = 60 + Math.sin(x * 0.09 + tick * 0.6) * amp * (0.25 + 0.75 * s) + (r() - 0.5) * noise;
      pts.push(`${x},${y.toFixed(1)}`);
    }
    return `M${pts.join("L")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, sBucket]);

  const dir = (v: number, target: number) => (Math.abs(v - target) < 4 ? "" : v < target ? "Higher" : "Lower");
  const tone = s > 0.88 ? "#4ade80" : s > 0.4 ? "#ffb547" : "#ff5a4f";

  return (
    <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">
      <Panel className="w-full max-w-3xl space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
          <Notice>{ctx.actor ? "Slide the frequency and turn the dish until the wave is smooth and the bar is full. Then hold it." : "Watching the crew tune the link."}</Notice>
          <TimerBar left={sl} total={total} />
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <svg viewBox="0 0 400 120" className="w-full rounded-lg bg-[#07090d]">
              <line x1="0" x2="400" y1="60" y2="60" stroke="rgb(255 255 255 / 0.08)" />
              <path d={path} fill="none" stroke={tone} strokeWidth="2.5" />
            </svg>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-dim">Signal strength</span>
                <span className="num" style={{ color: tone }}>{Math.round(s * 100)}%</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full transition-[width] duration-100" style={{ width: `${s * 100}%`, background: tone }} />
                <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: "88%" }} />
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-go" style={{ width: `${(sh / holdNeeded) * 100}%` }} /></div>
            </div>
            <label className="block">
              <span className="mb-1 flex justify-between text-sm text-white">
                Frequency <span className="num text-xs text-dim">{(2200 + sf * 4).toFixed(0)} MHz {hint && ctx.actor ? `· ${dir(sf, tf(performance.now()))}` : ""}</span>
              </span>
              <input type="range" min={0} max={100} step={0.5} value={sf} disabled={!ctx.actor || done} onChange={(e) => setF(Number(e.target.value))} className="pointer-events-auto h-2 w-full cursor-pointer accent-amber disabled:cursor-default" />
            </label>
          </div>
          <div className="flex flex-col items-center">
            <Dial label={`Dish direction${hint && ctx.actor && dir(sd, td) ? ` · ${dir(sd, td)}` : ""}`} value={sd} onChange={setD} disabled={!ctx.actor || done} color="#ffb547" />
          </div>
        </div>
      </Panel>
    </div>
  );
}
