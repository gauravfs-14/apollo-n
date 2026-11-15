"use client";
// Ship-integrity hits from flying mistakes: every client shows what cost integrity, only the pilot's client reports it.
import { create } from "zustand";
import { damage } from "../core/hp";

interface Notes {
  list: { id: number; text: string; amount: number }[];
}
const useNotes = create<Notes>(() => ({ list: [] }));
let nextId = 1;

/** Show the hit on this screen; `report` is true only on the client that flies (no double counting). */
export function flightDamage(amount: number, reason: string, report: boolean) {
  if (report) damage(amount, reason);
  const id = nextId++;
  useNotes.setState((s) => ({ list: [...s.list.slice(-3), { id, text: reason, amount }] }));
  setTimeout(() => useNotes.setState((s) => ({ list: s.list.filter((n) => n.id !== id) })), 6000);
}

export function DamageNotes() {
  const list = useNotes((s) => s.list);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-28 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {list.map((n) => (
        <div key={n.id} className="rounded-md bg-nogo/85 px-3 py-1 text-sm font-medium text-white">
          Ship integrity −{n.amount}: {n.text}
        </div>
      ))}
    </div>
  );
}
