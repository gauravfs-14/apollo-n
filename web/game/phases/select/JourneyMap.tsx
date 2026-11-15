"use client";
// The winding level path. Level 1 at the bottom, the final level at the top.
import { useEffect, useRef } from "react";
import { LEVELS, LEVEL_COUNT } from "../../journey/levels";

export type NodeState = "locked" | "available" | "done";

const W = 440;
const GAP = 124;
const PAD = 90;
const H = LEVEL_COUNT * GAP + PAD * 2;

const pos = (n: number) => ({ x: W / 2 + Math.sin((n - 1) * 0.9) * W * 0.24, y: H - PAD - (n - 1) * GAP });

const PATH_D = LEVELS.map((l, i) => {
  const p = pos(l.n);
  if (i === 0) return `M${p.x} ${p.y}`;
  const q = pos(l.n - 1);
  const my = (p.y + q.y) / 2;
  return `C${q.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
}).join(" ");

function pathUpTo(n: number) {
  return LEVELS.slice(0, n)
    .map((l, i) => {
      const p = pos(l.n);
      if (i === 0) return `M${p.x} ${p.y}`;
      const q = pos(l.n - 1);
      const my = (p.y + q.y) / 2;
      return `C${q.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
    })
    .join(" ");
}

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill={on ? "#ffcf5a" : "rgb(255 255 255 / 0.12)"} stroke={on ? "#ffcf5a" : "rgb(255 255 255 / 0.3)"} strokeWidth="1.4">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" />
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function JourneyMap({
  stateOf,
  starsOf,
  current,
  selected,
  onSelect,
  crewLevel,
}: {
  stateOf: (n: number) => NodeState;
  starsOf: (n: number) => number;
  current: number;
  selected: number;
  onSelect: (n: number) => void;
  crewLevel?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const focus = crewLevel ?? selected;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const top = pos(focus).y - el.clientHeight / 2;
    el.scrollTo({ top, behavior: "smooth" });
  }, [focus]);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = pos(current).y - el.clientHeight / 2; // first paint: no animation
  }, [current]);

  return (
    <div
      ref={box}
      className="pointer-events-auto h-full overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: "linear-gradient(to bottom, transparent, black 9%, black 91%, transparent)" }}
    >
      <div className="relative mx-auto" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="absolute inset-0" aria-hidden>
          <path d={PATH_D} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />
          <path d={pathUpTo(Math.min(LEVEL_COUNT, current))} fill="none" stroke="#ffb547" strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round" />
        </svg>
        {LEVELS.map((l) => {
          const st = stateOf(l.n);
          const p = pos(l.n);
          const isSel = l.n === selected;
          const isCur = l.n === current;
          const base =
            st === "locked"
              ? "border-white/20 bg-black/60 text-white/50"
              : st === "done"
                ? "border-cyan/60 bg-[#0b2230]/90 text-cyan"
                : "border-amber bg-amber text-black";
          return (
            <div key={l.n} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: p.x, top: p.y }}>
              <button
                onClick={() => onSelect(l.n)}
                aria-label={`Level ${l.n}, ${l.title}, ${st === "locked" ? "locked" : st === "done" ? `completed, ${starsOf(l.n)} stars` : "available"}`}
                aria-current={isCur ? "step" : undefined}
                data-level={l.n}
                data-state={st}
                className={`relative grid h-16 w-16 place-items-center rounded-full border-2 backdrop-blur-md transition active:scale-95 ${base} ${
                  isSel ? "ring-4 ring-white/70 ring-offset-2 ring-offset-black/60" : isCur ? "ring-4 ring-amber/30" : "hover:border-white/50"
                } ${isCur ? "h-[4.5rem] w-[4.5rem]" : ""}`}
              >
                <span className="num text-xl font-semibold">{l.n}</span>
                {st === "locked" && (
                  <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/80 text-white/60">
                    <Lock />
                  </span>
                )}
                {crewLevel === l.n && (
                  <span className="num absolute -left-14 top-1/2 -translate-y-1/2 rounded-md bg-cyan px-1.5 py-0.5 text-[10px] font-semibold text-black">CREW</span>
                )}
              </button>
              <div className="pointer-events-none absolute left-1/2 top-full mt-1 flex -translate-x-1/2 flex-col items-center whitespace-nowrap">
                {st === "done" && (
                  <div className="flex gap-0.5" aria-hidden>
                    {[1, 2, 3].map((i) => (
                      <Star key={i} on={i <= starsOf(l.n)} />
                    ))}
                  </div>
                )}
                <span className={`mt-0.5 text-[12.5px] font-medium [text-shadow:0_1px_6px_rgb(0_0_0/0.9)] ${st === "locked" ? "text-white/60" : "text-white/90"}`}>{l.title}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
