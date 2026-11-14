"use client";
// One question at a time, big answer buttons, instant feedback and a "did you know" fact.
import { useMemo, useState } from "react";
import { sfx } from "../core/audio";
import { Button } from "../ui/kit";
import { GameHeader, useLatest, answerLabel, hintsUnlocked, scoreOf, shuffle, timeLimit, useCountdown } from "./common";
import type { MinigameProps } from "./types";

export function Quiz({ items, difficulty, facts = [], seed = 1, watching, onProgress, onDone }: MinigameProps) {
  const qs = useMemo(
    () =>
      items.map((it, i) => {
        let opts = it.options?.length ? [...it.options] : [];
        const right = answerLabel(it);
        const synthesized = opts.length === 0;
        if (synthesized) {
          const others = items.filter((_, j) => j !== i).map(answerLabel);
          opts = [right, ...shuffle(others, seed + i).slice(0, 3)];
        }
        // resolve the answer to an option text (exact, index, or fuzzy)
        let ans = synthesized ? right : opts.find((o) => o === it.answer);
        if (!ans && /^\d+$/.test(it.answer)) ans = opts[Math.min(opts.length - 1, Math.max(0, parseInt(it.answer) - 1))] ?? right;
        if (!ans) ans = opts.find((o) => o.toLowerCase().includes(it.answer.toLowerCase())) ?? right;
        if (!opts.includes(ans)) opts = [ans, ...opts.slice(0, 3)];
        return { prompt: it.prompt, opts: shuffle(opts, seed * 7 + i), ans, fact: facts.find((f) => f.id === it.fact_id) };
      }),
    [items, facts, seed],
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [right, setRight] = useState(0);
  const [removed, setRemoved] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const total = timeLimit(difficulty, qs.length * 20);
  const finish = (r: number, m: number, secs: number) => {
    setFinished(true);
    onDone({ score: scoreOf({ correct: r, total: qs.length, mistakes: m, seconds: secs, limit: total }), correct: r, total: qs.length, mistakes: m, seconds: Math.round(secs) });
  };
  const state = useLatest({ r: right, m: mistakes });
  const { elapsed, left } = useCountdown(total, !finished && !watching, () => finish(state.current.r, qs.length - state.current.r, total ?? 0));

  const q = qs[Math.min(i, qs.length - 1)];
  const answer = (o: string) => {
    if (picked || watching || finished) return;
    setPicked(o);
    const ok = o === q.ans;
    sfx(ok ? "chime" : "buzz", { volume: 0.4 });
    const r = right + (ok ? 1 : 0), m = mistakes + (ok ? 0 : 1);
    if (ok) setRight(r); else setMistakes(m);
    onProgress?.({ done: i + 1, total: qs.length, mistakes: m });
  };
  const next = () => {
    if (i + 1 >= qs.length) return finish(right, mistakes, elapsed);
    setI(i + 1);
    setPicked(null);
    setRemoved([]);
  };
  const hint = () => {
    const wrong = q.opts.filter((o) => o !== q.ans && !removed.includes(o));
    setRemoved([...removed, ...wrong.slice(0, 2)]);
  };

  if (!q) return null;
  return (
    <div>
      <GameHeader goal="Pick the right answer for each question." left={left} limit={total} mistakes={mistakes} done={i + (picked ? 1 : 0)} total={qs.length} />
      <div className="num text-[11px] text-dim">Question {i + 1} of {qs.length}</div>
      <h3 className="mt-1 text-xl font-semibold leading-snug">{q.prompt}</h3>
      <div className="mt-4 grid gap-2">
        {q.opts.map((o) => {
          const gone = removed.includes(o);
          const state = picked ? (o === q.ans ? "ok" : o === picked ? "bad" : "dim") : "idle";
          return (
            <button
              key={o}
              disabled={gone || !!picked || watching}
              onClick={() => answer(o)}
              className={`pointer-events-auto rounded-lg border px-4 py-3 text-left text-sm transition ${gone ? "opacity-20" : ""} ${
                state === "ok" ? "border-go bg-go/15" : state === "bad" ? "border-nogo bg-nogo/15" : state === "dim" ? "border-line opacity-50" : "border-line bg-white/5 hover:bg-white/10"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="mt-4 rounded-lg border border-line bg-white/5 p-3 text-xs text-white/80">
          {q.fact ? (
            <>
              <span className="text-cyan">Did you know: </span>
              {q.fact.text} <span className="text-dim">({q.fact.source_name})</span>
            </>
          ) : picked === q.ans ? (
            "Correct."
          ) : (
            `The answer was: ${q.ans}`
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between">
        {!watching && hintsUnlocked(difficulty, mistakes) && !picked && removed.length === 0 ? (
          <Button variant="ghost" onClick={hint}>
            Remove two wrong answers
          </Button>
        ) : (
          <span />
        )}
        {picked && !watching && <Button onClick={next}>{i + 1 >= qs.length ? "Finish" : "Next"}</Button>}
      </div>
      {watching && <p className="mt-3 text-xs text-dim">Your crewmate is answering.</p>}
    </div>
  );
}
