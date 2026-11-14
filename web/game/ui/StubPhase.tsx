"use client";
// Placeholder used until a phase owner replaces it. Keeps the game playable end to end.
import { useGame } from "../core/useGame";
import type { PhaseId } from "../types";

export function StubHud({ id, title }: { id: PhaseId; title: string }) {
  const { complete } = useGame();
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto rounded-lg border border-white/15 bg-black/60 p-6 text-center text-white backdrop-blur">
        <div className="text-xs tracking-wide text-white/50">PHASE · {id}</div>
        <div className="mt-1 text-2xl font-semibold">{title}</div>
        <button className="mt-4 rounded bg-white px-4 py-2 text-black" onClick={() => complete(id, 50)}>
          Continue
        </button>
      </div>
    </div>
  );
}
