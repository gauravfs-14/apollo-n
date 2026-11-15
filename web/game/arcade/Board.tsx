"use client";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "../ui/kit";
import { getBoard, getMissionBoard, type Board as BoardData, type MissionEntry } from "./api";
import type { ChallengeId } from "./seed";

type Tab = "seed" | "week" | "all" | "crews";
const TABS: [Tab, string][] = [["seed", "This seed"], ["week", "This week"], ["all", "All time"], ["crews", "Crews"]];
const GRADE_TONE: Record<string, string> = { S: "text-amber", A: "text-go", B: "text-cyan", C: "text-white", D: "text-amber", F: "text-nogo" };

export function Board({ challenge, seed, name, refreshKey, className = "" }: { challenge: ChallengeId; seed: number; name: string; refreshKey: number; className?: string }) {
  const [tab, setTab] = useState<Tab>("seed");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [crews, setCrews] = useState<MissionEntry[] | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      setErr(false);
      if (tab === "crews") setCrews((await getMissionBoard("week")).entries);
      else setBoard(await getBoard(challenge, tab === "all" ? "all" : "week", tab === "seed" ? seed : null, name));
    } catch {
      setErr(true);
    }
  }, [tab, challenge, seed, name]);
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- fetch on tab / seed / new score
  }, [load, refreshKey]);
  const mine = name.trim().toLowerCase();
  return (
    <Panel className={className}>
      <div className="mb-3 flex gap-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-xs ${tab === k ? "bg-white/15 text-white" : "text-dim hover:bg-white/5 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {err && <p className="py-6 text-center text-sm text-dim">The leaderboard is offline. Your runs still count locally.</p>}
      {!err && tab !== "crews" && (
        <>
          <div className="mb-1 flex px-1 text-[11px] text-dim"><span className="w-7">#</span><span className="flex-1">Pilot</span>{tab !== "seed" && <span className="w-14 text-right">Seed</span>}<span className="w-14 text-right">Score</span><span className="w-7 text-right">Gr</span></div>
          <ol data-testid="board-list" className="space-y-0.5">
            {board?.entries.map((e) => (
              <li key={`${e.rank}-${e.name}`} className={`flex items-center rounded px-1 py-1 text-sm ${e.name.toLowerCase() === mine ? "bg-amber/15" : ""}`}>
                <span className="num w-7 text-dim">{e.rank}</span>
                <span className="flex-1 truncate">{e.name}</span>
                {tab !== "seed" && <span className="num w-14 text-right text-xs text-dim">{e.seed}</span>}
                <span className="num w-14 text-right text-cyan">{e.score}</span>
                <span className={`num w-7 text-right ${GRADE_TONE[e.grade] ?? ""}`}>{e.grade}</span>
              </li>
            ))}
          </ol>
          {board && board.entries.length === 0 && <p className="py-6 text-center text-sm text-dim">No runs yet. Be first.</p>}
          {board?.me && !board.entries.some((e) => e.name.toLowerCase() === mine) && (
            <p className="mt-2 border-t border-line pt-2 text-xs text-dim">You: #{board.me.rank} with {board.me.score}</p>
          )}
        </>
      )}
      {!err && tab === "crews" && (
        <>
          <p className="mb-2 text-[11px] text-dim">Best full mission this week, per room.</p>
          <ol className="space-y-0.5">
            {crews?.map((e) => (
              <li key={e.room} className="flex items-center rounded px-1 py-1 text-sm">
                <span className="num w-7 text-dim">{e.rank}</span>
                <span className="flex-1 truncate">{e.crew.join(", ")}<span className="num ml-2 text-[11px] text-dim">{e.room}</span></span>
                <span className="num w-14 text-right text-cyan">{e.score}</span>
              </li>
            ))}
          </ol>
          {crews && crews.length === 0 && <p className="py-6 text-center text-sm text-dim">No crew has posted a mission this week.</p>}
        </>
      )}
    </Panel>
  );
}
