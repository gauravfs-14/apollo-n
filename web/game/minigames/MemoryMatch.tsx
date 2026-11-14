"use client";
// Flip two cards to match each instruction with its step. Cards flip in 3D (CSS).
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../core/audio";
import { Button } from "../ui/kit";
import { GameHeader, useLatest, answerLabel, hintsUnlocked, scoreOf, shuffle, timeLimit, useCountdown } from "./common";
import type { MinigameProps } from "./types";

export function MemoryMatch({ items, difficulty, seed = 1, watching, onProgress, onDone }: MinigameProps) {
  const cards = useMemo(
    () => shuffle(items.flatMap((it, i) => [{ id: `${i}p`, pair: i, text: it.prompt, kind: "prompt" as const }, { id: `${i}a`, pair: i, text: answerLabel(it), kind: "answer" as const }]), seed),
    [items, seed],
  );
  const [open, setOpen] = useState<string[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [peek, setPeek] = useState(false);
  const [peeks, setPeeks] = useState(0);
  const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const limit = timeLimit(difficulty, items.length * 30);
  const st = useLatest({ matched, mistakes });

  const finish = (m: number[], mis: number, secs: number) => {
    if (finished) return;
    setFinished(true);
    onDone({ score: scoreOf({ correct: m.length, total: items.length, mistakes: mis + peeks, seconds: secs, limit }), correct: m.length, total: items.length, mistakes: mis, seconds: Math.round(secs) });
  };
  const { elapsed, left } = useCountdown(limit, !finished && !watching, () => finish(st.current.matched, st.current.mistakes, limit ?? 0));

  useEffect(() => {
    if (matched.length === items.length && items.length > 0) {
      sfx("chime", { volume: 0.5 });
      const t = setTimeout(() => finish(matched, mistakes, elapsed), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const flip = (id: string) => {
    if (lock.current || watching || finished || open.includes(id)) return;
    const c = cards.find((x) => x.id === id)!;
    if (matched.includes(c.pair)) return;
    sfx("click", { volume: 0.3 });
    const next = [...open, id];
    setOpen(next);
    if (next.length === 2) {
      const [a, b] = next.map((x) => cards.find((c2) => c2.id === x)!);
      lock.current = true;
      if (a.pair === b.pair && a.kind !== b.kind) {
        setTimeout(() => {
          setMatched((m) => {
            const nm = [...m, a.pair];
            onProgress?.({ done: nm.length, total: items.length, mistakes });
            return nm;
          });
          setOpen([]);
          lock.current = false;
        }, 450);
      } else {
        setMistakes((m) => m + 1);
        sfx("buzz", { volume: 0.3 });
        setTimeout(() => {
          setOpen([]);
          lock.current = false;
        }, 900);
      }
    }
  };

  const doPeek = () => {
    setPeek(true);
    setPeeks((p) => p + 1);
    setTimeout(() => setPeek(false), 1600);
  };

  return (
    <div>
      <GameHeader goal="Match each instruction with its step number." left={left} limit={limit} mistakes={mistakes} done={matched.length} total={items.length} />
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {cards.map((c) => {
          const face = peek || open.includes(c.id) || matched.includes(c.pair);
          const done = matched.includes(c.pair);
          return (
            <button
              key={c.id}
              onClick={() => flip(c.id)}
              className="pointer-events-auto relative h-28 [perspective:600px]"
              aria-label={face ? c.text : "Hidden card"}
            >
              <div className="absolute inset-0 transition-transform duration-500 [transform-style:preserve-3d]" style={{ transform: face ? "rotateY(180deg)" : "none" }}>
                <div className="absolute inset-0 grid place-items-center rounded-lg border border-line bg-gradient-to-br from-white/10 to-white/0 [backface-visibility:hidden]">
                  <div className="h-8 w-8 rounded-full border border-amber/60" />
                </div>
                <div
                  className={`absolute inset-0 flex items-center justify-center rounded-lg border p-2 text-center text-xs leading-tight [backface-visibility:hidden] [transform:rotateY(180deg)] ${
                    done ? "border-go/60 bg-go/15" : c.kind === "answer" ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-amber/50 bg-amber/10"
                  }`}
                >
                  {c.text}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex justify-between">
        {!watching && hintsUnlocked(difficulty, mistakes) ? (
          <Button variant="ghost" onClick={doPeek} disabled={peek}>
            Peek at all cards
          </Button>
        ) : (
          <span className="text-xs text-dim">{watching ? "Your crewmate is matching cards." : ""}</span>
        )}
      </div>
    </div>
  );
}
