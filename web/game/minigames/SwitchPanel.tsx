"use client";
// Timed switch flipping on a cockpit panel: read the command on the display, flip the matching switch.
// The panel is drawn with CSS (bezel, brushed metal, guarded toggles, LEDs).
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../core/audio";
import { GameHeader, useLatest, hintsUnlocked, scoreOf, shuffle, timeLimit, useCountdown } from "./common";
import type { MinigameProps } from "./types";

const DECOYS = ["Cabin lights", "Aux power", "Cooling fans", "Telemetry relay", "Cabin heater", "Video feed"];

function Toggle({ on, label, state, hint, onFlip, disabled }: { on: boolean; label: string; state: "idle" | "ok" | "bad"; hint: boolean; onFlip: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onFlip}
      disabled={disabled}
      className={`pointer-events-auto group flex w-full flex-col items-center gap-2 rounded-md px-1 pb-2 pt-3 text-center transition ${hint ? "ring-2 ring-amber" : ""}`}
      aria-pressed={on}
    >
      {/* status LED */}
      <span
        className={`h-2.5 w-2.5 rounded-full border border-black/60 transition ${
          state === "ok" ? "bg-go shadow-[0_0_10px_2px_rgba(74,222,128,.7)]" : state === "bad" ? "bg-nogo shadow-[0_0_10px_2px_rgba(255,90,79,.7)]" : on ? "bg-amber shadow-[0_0_8px_1px_rgba(255,181,71,.6)]" : "bg-[#3a2a1a]"
        }`}
      />
      {/* toggle housing */}
      <span className="relative block h-16 w-9 rounded-md border border-black/70 bg-gradient-to-b from-[#0d0f12] to-[#1b1f24] shadow-[inset_0_2px_6px_rgba(0,0,0,.9)]">
        <span className="absolute left-1/2 top-1/2 h-3 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-[#50565d] to-[#22262b]" />
        <span
          className="absolute left-1/2 top-1/2 h-9 w-2.5 origin-top rounded-b-full bg-gradient-to-r from-[#7c838b] via-[#e4e8ec] to-[#6b727a] shadow-[2px_3px_4px_rgba(0,0,0,.6)] transition-transform duration-150"
          style={{ transform: `translateX(-50%) rotate(${on ? 0 : 180}deg)`, transformOrigin: "50% 0%" }}
        />
        <span
          className="absolute left-1/2 h-3 w-3.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#f2f4f6] to-[#8a9199] shadow-[0_2px_3px_rgba(0,0,0,.6)] transition-all duration-150"
          style={{ top: on ? "calc(50% + 28px)" : "calc(50% - 38px)" }}
        />
      </span>
      <span className="min-h-[2.4em] text-[10px] font-semibold uppercase leading-tight tracking-wide text-[#c8ccd1] [text-shadow:0_1px_0_rgba(0,0,0,.8)]">{label}</span>
    </button>
  );
}

export function SwitchPanel({ items, difficulty, seed = 1, watching, onProgress, onDone }: MinigameProps) {
  const order = useMemo(() => [...items.keys()].sort((a, b) => (parseInt(items[a].answer) || a + 1) - (parseInt(items[b].answer) || b + 1)), [items]);
  const switches = useMemo(() => {
    const real = items.map((it, i) => ({ key: `r${i}`, idx: i as number | null, label: it.prompt }));
    const extra = Math.max(0, 8 - real.length);
    const dec = shuffle(DECOYS, seed).slice(0, extra).map((l, i) => ({ key: `d${i}`, idx: null, label: l }));
    return shuffle([...real, ...dec], seed + 99);
  }, [items, seed]);
  const [step, setStep] = useState(0);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ key: string; ok: boolean } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [missed, setMissed] = useState(0);
  const [finished, setFinished] = useState(false);
  const perCmd = timeLimit(difficulty, 12);
  const [cmdLeft, setCmdLeft] = useState<number | null>(perCmd);
  const total = order.length;
  const limit = perCmd === null ? null : perCmd * total;
  const st = useLatest({ step, mistakes });

  const finish = (correct: number, m: number, secs: number) => {
    if (finished) return;
    setFinished(true);
    onDone({ score: scoreOf({ correct, total, mistakes: m, seconds: secs, limit }), correct, total, mistakes: m, seconds: Math.round(secs) });
  };
  const { elapsed } = useCountdown(null, !finished && !watching, () => {});

  const doneOk = useRef(0);
  const advance = (ok: boolean) => {
    if (ok) doneOk.current += 1;
    const ns = st.current.step + 1;
    onProgress?.({ done: ns, total, mistakes: st.current.mistakes });
    if (ns >= total) {
      setTimeout(() => finish(doneOk.current, st.current.mistakes + (ok ? 0 : 0), elapsed), 500);
      setStep(ns);
    } else setStep(ns);
  };

  // per-command timer: expiring a command counts as a miss and moves on
  useEffect(() => {
    if (finished || watching || perCmd === null) return;
    const t0 = performance.now();
    const t = setInterval(() => {
      const l = perCmd - (performance.now() - t0) / 1000;
      setCmdLeft(Math.max(0, l));
      if (l <= 0) {
        clearInterval(t);
        sfx("buzz", { volume: 0.4 });
        setMissed((x) => x + 1);
        setMistakes((m) => m + 1);
        advance(false);
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, finished]);

  const targetIdx = order[Math.min(step, total - 1)];
  const flip = (s: (typeof switches)[number]) => {
    if (watching || finished || step >= total) return;
    const right = s.idx === targetIdx;
    sfx("click", { volume: 0.5 });
    setFlash({ key: s.key, ok: right });
    setTimeout(() => setFlash(null), 500);
    if (right) {
      setOn((o) => ({ ...o, [s.key]: true }));
      sfx("chime", { volume: 0.3 });
      advance(true);
    } else {
      setOn((o) => ({ ...o, [s.key]: true }));
      setTimeout(() => setOn((o) => ({ ...o, [s.key]: false })), 350);
      sfx("buzz", { volume: 0.4 });
      setMistakes((m) => m + 1);
    }
  };

  const hintKey = hintsUnlocked(difficulty, mistakes) ? switches.find((s) => s.idx === targetIdx)?.key : undefined;
  void missed;

  return (
    <div>
      <GameHeader goal="Flip the switch named on the display before time runs out." left={cmdLeft} limit={perCmd} mistakes={mistakes} done={Math.min(step, total)} total={total} />
      <div className="rounded-xl border border-black bg-gradient-to-b from-[#3b4046] via-[#2a2e33] to-[#1d2024] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.15),0_10px_30px_rgba(0,0,0,.6)]">
        {/* command display */}
        <div className="mb-4 rounded-md border border-black bg-[#0a0d08] px-4 py-3 shadow-[inset_0_2px_8px_rgba(0,0,0,.9)]">
          <div className="num text-[10px] tracking-widest text-[#6b8a4a]">COMMAND {Math.min(step + 1, total)}/{total}</div>
          <div className="num mt-1 text-lg text-[#ffb547] [text-shadow:0_0_8px_rgba(255,181,71,.6)]">{step >= total ? "ALL SYSTEMS GO" : `FLIP: ${items[targetIdx].prompt.toUpperCase()}`}</div>
        </div>
        <div className="grid grid-cols-4 gap-x-1 gap-y-2 rounded-md border border-black/70 bg-[#15181b]/60 p-2 sm:grid-cols-8">
          {switches.map((s) => (
            <Toggle
              key={s.key}
              on={!!on[s.key]}
              label={s.label}
              state={flash?.key === s.key ? (flash.ok ? "ok" : "bad") : on[s.key] && s.idx !== null ? "ok" : "idle"}
              hint={hintKey === s.key}
              onFlip={() => flip(s)}
              disabled={!!watching || finished}
            />
          ))}
        </div>
        {/* rivets */}
        <div className="mt-2 flex justify-between px-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-[#9aa1a8] to-[#30343a]" />
          ))}
        </div>
      </div>
      {watching && <p className="mt-3 text-xs text-dim">Your crewmate is on the panel.</p>}
    </div>
  );
}
