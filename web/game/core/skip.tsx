"use client";
// Crew skip vote for shared cinematics. Solo: Skip acts at once. Multiplayer: Skip asks the crew;
// the others get a small prompt, and only when every connected player agrees does the scene skip,
// on every screen at the same time. A "keep watching" or no answer within VOTE_MS lets it play on.
//
//   const skip = useSkipVote("board", () => boardClock.skip());
//   <Button onClick={skip.request}>{skip.label}</Button>
//
// Votes live in phaseData[phase] under one key per player (skipYes_<id>), so simultaneous votes
// never overwrite each other.
import { useEffect, useRef, useState } from "react";
import type { PhaseId } from "../types";
import { Button } from "../ui/kit";
import { useStore } from "./store";
import { useGame } from "./useGame";

const VOTE_MS = 10000;

interface SkipRequest {
  by: string;
  at: number;
}

function readVote(phase: PhaseId) {
  const st = useStore.getState().state;
  const pd = (st?.phaseData[phase] ?? {}) as Record<string, unknown>;
  const req = (pd.skipReq ?? null) as SkipRequest | null;
  const crew = (st?.players ?? []).filter((p) => p.connected);
  const yes = req ? crew.filter((p) => Number(pd[`skipYes_${p.id}`] ?? 0) >= req.at) : [];
  return { req, crew, yes, agreed: !!req && crew.length > 0 && yes.length === crew.length };
}

export function useSkipVote(phase: PhaseId, onSkip: () => void) {
  const { state, me, patch } = useGame();
  const solo = !state || state.mode === "solo" || (state.players.filter((p) => p.connected).length ?? 0) <= 1;
  const pd = (state?.phaseData[phase] ?? {}) as Record<string, unknown>;
  const req = (pd.skipReq ?? null) as SkipRequest | null;
  const { crew, yes, agreed } = readVote(phase);
  const done = useRef(false);
  const cb = useRef(onSkip);
  useEffect(() => {
    cb.current = onSkip;
  });

  // everyone agreed: skip here (every client sees the same state and skips together)
  useEffect(() => {
    if (agreed && !done.current) {
      done.current = true;
      cb.current();
    }
  }, [agreed]);

  // the requester lets an unanswered request lapse
  useEffect(() => {
    if (!req || req.by !== me?.id || agreed) return;
    const t = setTimeout(() => {
      const now = readVote(phase);
      if (now.req?.at === req.at && !now.agreed) patch(phase, { skipReq: null });
    }, VOTE_MS);
    return () => clearTimeout(t);
  }, [req, me?.id, agreed, phase, patch]);

  const request = () => {
    if (solo) {
      if (!done.current) {
        done.current = true;
        cb.current();
      }
      return;
    }
    if (!me) return;
    const at = Date.now();
    patch(phase, { skipReq: { by: me.id, at }, [`skipYes_${me.id}`]: at });
  };

  const waiting = !!req && !agreed && req.by === me?.id;
  return {
    request,
    pending: !!req && !agreed,
    label: waiting ? `Waiting for crew ${yes.length}/${crew.length}` : "Skip",
    disabled: waiting,
  };
}

/** The small prompt other crew members see when someone wants to skip. Mounted once by the runner. */
export function SkipPrompt({ phase }: { phase: PhaseId }) {
  const { state, me, patch } = useGame();
  const pd = (state?.phaseData[phase] ?? {}) as Record<string, unknown>;
  const req = (pd.skipReq ?? null) as SkipRequest | null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!req) return;
    const iv = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(iv);
  }, [req]);
  if (!req || !me || req.by === me.id || state?.mode === "solo") return null;
  if (Number(pd[`skipYes_${me.id}`] ?? 0) >= req.at) return null; // already agreed
  const who = state?.players.find((p) => p.id === req.by)?.name ?? "A crew member";
  // eslint-disable-next-line react-hooks/purity -- countdown display only
  const left = Math.max(0, Math.ceil((req.at + VOTE_MS - Date.now()) / 1000));
  if (left <= 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm shadow-xl backdrop-blur-md">
        <span>
          <span className="text-white">{who}</span> <span className="text-dim">wants to skip</span> <span className="num text-xs text-dim">{left}s</span>
        </span>
        <Button className="px-3 py-1" onClick={() => patch(phase, { [`skipYes_${me.id}`]: req.at })}>
          Skip
        </Button>
        <Button variant="ghost" className="px-3 py-1" onClick={() => patch(phase, { skipReq: null })}>
          Keep watching
        </Button>
      </div>
    </div>
  );
}
