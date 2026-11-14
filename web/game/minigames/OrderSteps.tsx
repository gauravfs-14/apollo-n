"use client";
// Drag the cards into the right order. "Check order" marks correct slots; wrong ones jiggle.
import { useMemo, useRef, useState } from "react";
import { sfx } from "../core/audio";
import { Button } from "../ui/kit";
import { GameHeader, hintsUnlocked, useLatest, scoreOf, shuffle, timeLimit, useCountdown } from "./common";
import type { MinigameProps } from "./types";

export function OrderSteps({ items, difficulty, seed = 1, watching, onProgress, onDone }: MinigameProps) {
  // correct order: sort by numeric answer, else array order
  const correct = useMemo(() => [...items.keys()].sort((a, b) => (parseInt(items[a].answer) || a + 1) - (parseInt(items[b].answer) || b + 1)), [items]);
  const [order, setOrder] = useState<number[]>(() => {
    let o = shuffle([...items.keys()], seed);
    if (o.every((v, i) => v === correct[i]) && o.length > 1) o = [...o.slice(1), o[0]];
    return o;
  });
  const [mistakes, setMistakes] = useState(0);
  const [checked, setChecked] = useState<boolean[] | null>(null);
  const [finished, setFinished] = useState(false);
  const drag = useRef<number | null>(null);
  const limit = timeLimit(difficulty, 20 + items.length * 14);
  const latest = useLatest({ order, mistakes });

  const finish = (o: number[], m: number, elapsed: number) => {
    if (finished) return;
    setFinished(true);
    const ok = o.filter((v, i) => v === correct[i]).length;
    onDone({ score: scoreOf({ correct: ok, total: o.length, mistakes: m, seconds: elapsed, limit }), correct: ok, total: o.length, mistakes: m, seconds: Math.round(elapsed) });
  };
  const { elapsed, left } = useCountdown(limit, !finished && !watching, () => finish(latest.current.order, latest.current.mistakes, limit ?? 0));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const o = [...order];
    const [x] = o.splice(from, 1);
    o.splice(to, 0, x);
    setOrder(o);
    setChecked(null);
    sfx("click", { volume: 0.3 });
  };

  const check = () => {
    const res = order.map((v, i) => v === correct[i]);
    setChecked(res);
    const okN = res.filter(Boolean).length;
    onProgress?.({ done: okN, total: order.length, mistakes });
    if (okN === order.length) {
      sfx("chime", { volume: 0.5 });
      finish(order, mistakes, elapsed);
    } else {
      sfx("buzz", { volume: 0.4 });
      setMistakes((m) => m + 1);
    }
  };

  const showHint = hintsUnlocked(difficulty, mistakes) && checked && !checked.every(Boolean);
  const firstWrong = checked?.findIndex((x) => !x) ?? -1;
  const okCount = checked?.filter(Boolean).length ?? 0;

  return (
    <div>
      <GameHeader goal="Put the steps in the right order. Drag a card, or use the arrows." left={left} limit={limit} mistakes={mistakes} done={okCount} total={order.length} />
      <ol className="flex flex-col gap-2">
        {order.map((idx, pos) => {
          const state = checked ? (checked[pos] ? "ok" : "bad") : "idle";
          return (
            <li
              key={idx}
              draggable={!watching && !finished}
              onDragStart={() => (drag.current = pos)}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag.current !== null && drag.current !== pos) {
                  move(drag.current, pos);
                  drag.current = pos;
                }
              }}
              onDragEnd={() => (drag.current = null)}
              className={`pointer-events-auto flex cursor-grab items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition active:cursor-grabbing ${
                state === "ok" ? "border-go/60 bg-go/10" : state === "bad" ? "border-nogo/60 bg-nogo/10" : "border-line bg-white/5 hover:bg-white/10"
              }`}
            >
              <span className="num grid h-6 w-6 place-items-center rounded bg-white/10 text-xs text-dim">{pos + 1}</span>
              <span className="flex-1">{items[idx].prompt}</span>
              <span className="flex gap-1">
                <button className="pointer-events-auto rounded px-1.5 py-0.5 text-dim hover:bg-white/10 hover:text-white" aria-label="Move up" onClick={() => move(pos, pos - 1)}>
                  &uarr;
                </button>
                <button className="pointer-events-auto rounded px-1.5 py-0.5 text-dim hover:bg-white/10 hover:text-white" aria-label="Move down" onClick={() => move(pos, pos + 1)}>
                  &darr;
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {showHint && firstWrong >= 0 && (
        <p className="mt-3 text-xs text-amber">Hint: slot {firstWrong + 1} is not right yet. Think about what has to happen first.</p>
      )}
      {!watching && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-dim">{checked ? `${okCount} of ${order.length} in the right place` : "Order them, then check."}</span>
          <Button onClick={check} disabled={finished}>
            Check order
          </Button>
        </div>
      )}
      {watching && <p className="mt-3 text-xs text-dim">Your crewmate is working through this checklist.</p>}
    </div>
  );
}
