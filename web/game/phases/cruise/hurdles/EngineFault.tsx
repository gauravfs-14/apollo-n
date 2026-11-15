"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Engine fault: rotate pipe tiles until fuel flows from the tank (left) to the engine (right).
import { useEffect, useMemo, useState } from "react";
import { Panel } from "../../../ui/kit";
import { lerp, mulberry, useCountdown, type HurdleCtx } from "../flow";
import { Notice, TimerBar } from "./shared";

const N = 1, E = 2, S = 4, W = 8;
const rotMask = (m: number, r: number) => {
  for (let i = 0; i < ((r % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
};
type Kind = "straight" | "corner" | "tee";
const BASE: Record<Kind, number> = { straight: N | S, corner: N | E, tee: N | E | W };

interface Board {
  cols: number;
  rows: number;
  kinds: Kind[];
  solution: (number | null)[]; // rotation that makes the path tile fit, null for decoys
  start: number[];
  rs: number; // tank row
  re: number; // engine row
  path: number[]; // cell indices along the intended route
}

function makeBoard(seed: number, level: number): Board {
  const rnd = mulberry(seed);
  const cols = Math.round(lerp(4, 6, level));
  const rows = Math.round(lerp(3, 4, level));
  const kinds: Kind[] = Array.from({ length: cols * rows }, () => (["straight", "corner", "tee"] as const)[Math.floor(rnd() * 3)]);
  const solution: (number | null)[] = Array(cols * rows).fill(null);
  // random route from the tank on the left edge to the engine on the right edge
  const rs = Math.floor(rnd() * rows);
  let r = rs;
  const route: [number, number][] = [[0, r]];
  const seen = new Set<string>(["0," + r]);
  let c = 0;
  while (c < cols - 1) {
    const opts: [number, number][] = [[c + 1, r]];
    if (r > 0 && !seen.has(`${c},${r - 1}`)) opts.push([c, r - 1]);
    if (r < rows - 1 && !seen.has(`${c},${r + 1}`)) opts.push([c, r + 1]);
    const lastVertical = route.length > 1 && route[route.length - 2][0] === c;
    const pool = lastVertical ? [[c + 1, r] as [number, number]] : opts;
    const weights = pool.map((o) => (o[0] > c ? 3 : 1));
    let pick = rnd() * weights.reduce((a, b) => a + b, 0);
    let ch = pool[0];
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        ch = pool[i];
        break;
      }
    }
    [c, r] = ch;
    seen.add(`${c},${r}`);
    route.push([c, r]);
  }
  const re = r;
  const path: number[] = [];
  route.forEach(([cc, rr], i) => {
    const prev = route[i - 1], next = route[i + 1];
    const side = (a: [number, number], b: [number, number]) => (b[0] > a[0] ? E : b[0] < a[0] ? W : b[1] > a[1] ? S : N);
    const m = (prev ? side([cc, rr], prev) : W) | (next ? side([cc, rr], next) : E);
    const idx = rr * cols + cc;
    const opposite = m === (N | S) || m === (E | W);
    kinds[idx] = opposite ? "straight" : "corner";
    for (let k = 0; k < 4; k++) if (rotMask(BASE[kinds[idx]], k) === m) { solution[idx] = k; break; }
    path.push(idx);
  });
  const start = kinds.map((k, i) => {
    const sol = solution[i];
    if (sol === null) return Math.floor(rnd() * 4);
    let s = Math.floor(rnd() * 4);
    while (rotMask(BASE[k], s) === rotMask(BASE[k], sol)) s = (s + 1) % 4;
    return s;
  });
  return { cols, rows, kinds, solution, start, rs, re, path };
}

/** Cells reached by fuel starting at the tank. */
function flow(b: Board, rot: number[]): Set<number> {
  const masks = b.kinds.map((k, i) => rotMask(BASE[k], rot[i]));
  const out = new Set<number>();
  const startIdx = b.rs * b.cols;
  if (!(masks[startIdx] & W)) return out;
  const q = [startIdx];
  out.add(startIdx);
  while (q.length) {
    const i = q.pop()!;
    const x = i % b.cols, y = Math.floor(i / b.cols);
    const m = masks[i];
    const tryGo = (nx: number, ny: number, bit: number, need: number) => {
      if (!(m & bit) || nx < 0 || ny < 0 || nx >= b.cols || ny >= b.rows) return;
      const j = ny * b.cols + nx;
      if (masks[j] & need && !out.has(j)) {
        out.add(j);
        q.push(j);
      }
    };
    tryGo(x + 1, y, E, W);
    tryGo(x - 1, y, W, E);
    tryGo(x, y + 1, S, N);
    tryGo(x, y - 1, N, S);
  }
  return out;
}

const SEG: Record<number, string> = { [N]: "M50 50V0", [E]: "M50 50H100", [S]: "M50 50V100", [W]: "M50 50H0" };

export function EngineFault({ ctx }: { ctx: HurdleCtx }) {
  const board = useMemo(() => makeBoard(ctx.seed * 13 + ctx.idx * 101, ctx.level), [ctx.seed, ctx.idx, ctx.level]);
  const total = lerp(85, 38, ctx.level) * ctx.fx.engineFaultTime;
  const initial = useMemo(() => {
    const rot = [...board.start];
    if (ctx.fx.engineFaultTime > 1) {
      // spare_parts perk: one pipe on the route is already fitted
      const mid = board.path[Math.floor(board.path.length / 2)];
      rot[mid] = board.solution[mid] ?? rot[mid];
    }
    return rot;
  }, [board, ctx.fx.engineFaultTime]);
  const [rot, setRot] = useState<number[]>(initial); // cumulative quarter turns (for smooth animation)
  const [done, setDone] = useState(false);

  const shownRot = ctx.actor ? rot : ((ctx.live.rot as number[] | undefined) ?? initial);
  const lit = useMemo(() => flow(board, shownRot), [board, shownRot]);
  const endIdx = board.re * board.cols + board.cols - 1;
  const solved = lit.has(endIdx) && (rotMask(BASE[board.kinds[endIdx]], shownRot[endIdx]) & E) !== 0;

  const left = useCountdown(total, ctx.actor && !done, () => {
    if (done) return;
    setDone(true);
    const reach = Math.max(...board.path.map((p, i) => (lit.has(p) ? i + 1 : 0))) / board.path.length;
    ctx.finish(Math.round(15 + 35 * reach), "Out of time before the fuel line was clear.");
  });

  useEffect(() => {
    if (!ctx.actor) return;
    ctx.push({ rot, left, total });
    if (solved && !done) {
      setDone(true);
      const t = setTimeout(() => ctx.finish(Math.round(60 + 40 * Math.min(1, left / total)), "Fuel is flowing again."), 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rot, left, ctx.actor, solved]);

  const shownLeft = ctx.actor ? left : (ctx.live.left as number | undefined) ?? total;
  const CELL = 78;
  const bw = board.cols * CELL, bh = board.rows * CELL;
  const PAD = 70;

  return (
    <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">
      <Panel className="w-full max-w-3xl space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
          <Notice>{ctx.actor ? "Click a tile to turn it. Connect the tank to the engine." : "Watching the engineer reroute the fuel line."}</Notice>
          <TimerBar left={shownLeft} total={total} />
        </div>
        <div className="mx-auto" style={{ width: "min(100%, 640px)" }}>
          <svg viewBox={`${-PAD} -10 ${bw + PAD * 2} ${bh + 20}`} className="w-full select-none rounded-lg bg-[#07090d]">
            {/* tank */}
            <g transform={`translate(${-PAD + 6} ${board.rs * CELL + CELL / 2 - 26})`}>
              <rect width="54" height="52" rx="10" fill="#10161d" stroke={lit.size ? "#6fd3ff" : "#5b6573"} strokeWidth="3" />
              <text x="27" y="31" textAnchor="middle" fill="#cfd8e3" fontSize="12">Tank</text>
            </g>
            <path d={`M${-PAD + 60} ${board.rs * CELL + CELL / 2}H0`} stroke={lit.size ? "#6fd3ff" : "#5b6573"} strokeWidth="14" />
            {/* engine */}
            <path d={`M${bw} ${board.re * CELL + CELL / 2}H${bw + 10}`} stroke={solved ? "#6fd3ff" : "#5b6573"} strokeWidth="14" />
            <g transform={`translate(${bw + 10} ${board.re * CELL + CELL / 2 - 26})`}>
              <rect width="54" height="52" rx="10" fill={solved ? "#15324a" : "#10161d"} stroke={solved ? "#4ade80" : "#5b6573"} strokeWidth="3" />
              <text x="27" y="31" textAnchor="middle" fill="#cfd8e3" fontSize="12">Engine</text>
            </g>
            {board.kinds.map((k, i) => {
              const x = (i % board.cols) * CELL, y = Math.floor(i / board.cols) * CELL;
              const on = lit.has(i);
              const stroke = on ? "#6fd3ff" : "#5b6573";
              return (
                <foreignObject key={i} x={x + 3} y={y + 3} width={CELL - 6} height={CELL - 6}>
                  <button
                    aria-label={`Pipe tile ${i + 1}, ${on ? "carrying fuel" : "empty"}. Turn it.`}
                    disabled={!ctx.actor || done}
                    onClick={() => setRot((r) => r.map((v, j) => (j === i ? v + 1 : v)))}
                    className="pointer-events-auto block h-full w-full rounded-lg border border-white/10 bg-[#10161d] outline-none transition hover:border-white/30 focus-visible:ring-2 focus-visible:ring-amber disabled:cursor-default"
                  >
                    <svg viewBox="0 0 100 100" className="h-full w-full" style={{ transform: `rotate(${shownRot[i] * 90}deg)`, transition: "transform 0.18s ease-out" }}>
                      {[N, E, S, W].filter((b) => BASE[k] & b).map((b) => <path key={b} d={SEG[b]} stroke={stroke} strokeWidth="18" strokeLinecap="butt" fill="none" />)}
                      <circle cx="50" cy="50" r="12" fill={stroke} />
                    </svg>
                  </button>
                </foreignObject>
              );
            })}
          </svg>
        </div>
        <div className="text-sm text-white/80">{solved ? "Fuel is reaching the engine." : "No fuel at the engine yet."}</div>
      </Panel>
    </div>
  );
}
