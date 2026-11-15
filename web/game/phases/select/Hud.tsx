"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { say } from "../../core/comms";
import { useGame, usePhaseData } from "../../core/useGame";
import { Button, PhaseTitle } from "../../ui/kit";
import type { Difficulty } from "../../types";
import { CardSkeleton, MissionCardView } from "./MissionCard";
import { useMissions, useSharedCards, type MissionCard } from "./useMissions";

const LEVELS: { id: Difficulty; label: string; line: string }[] = [
  { id: "easy", label: "Easy", line: "No pressure. Generous timers, hints always on, 2 hazards on the way, wide landing margin." },
  { id: "normal", label: "Normal", line: "Standard timers, hints after a mistake, 3 hazards, the lander's real limits." },
  { id: "hard", label: "Hard", line: "Tight timers, few hints, 4 to 5 hazards, real limits and worse luck." },
];

interface SelectData {
  difficulty?: Difficulty;
  cardIds?: string[];
}

export function SelectHud() {
  const { isHost, patch, action, complete } = useGame();
  const shared = usePhaseData<SelectData>("select");
  const [localDiff, setLocalDiff] = useState<Difficulty>("normal");
  const difficulty = isHost ? localDiff : (shared.difficulty ?? localDiff);
  const choosing = useRef(false);

  const share = useCallback(
    (cards: MissionCard[]) => isHost && patch("select", { difficulty, cardIds: cards.map((c) => c.plan.id) }),
    [isHost, patch, difficulty],
  );
  const mine = useMissions(difficulty, isHost, share);
  const theirs = useSharedCards(shared.cardIds, !isHost);
  const cards = isHost ? mine.cards : theirs;

  // keep the commander's difficulty visible to the crew even before cards load
  useEffect(() => {
    if (isHost) patch("select", { difficulty: localDiff });
  }, [isHost, localDiff, patch]);

  const choose = (card: MissionCard) => {
    if (choosing.current) return;
    choosing.current = true;
    const plan = card.plan;
    action("select", "set_plan", { plan });
    api(`/missions/${plan.id}/chosen`, {}).catch(() => {});
    const brief = plan.voice_lines.find((v) => v.id === "brief_1");
    if (brief) say({ who: "capcom", text: brief.text }, { interrupt: true });
    complete("select", 100);
  };

  const level = LEVELS.find((l) => l.id === difficulty)!;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/70 to-transparent" />
      <PhaseTitle
        step="APOLLO N / MISSION SELECT"
        title="Choose tonight's mission"
        subtitle="Each mission is written from real, recent lunar news. Pick one and mission control will brief your crew."
      />

      <div className="pointer-events-none absolute right-6 top-5 w-[min(380px,calc(100vw-3rem))]">
        <div className="pointer-events-auto rounded-xl border border-line bg-panel p-3 backdrop-blur-md">
          <div role="radiogroup" aria-label="Difficulty" className="grid grid-cols-3 gap-1 rounded-lg bg-black/30 p-1">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={difficulty === l.id}
                disabled={!isHost}
                onClick={() => setLocalDiff(l.id)}
                className={`rounded-md py-1.5 text-sm font-medium transition ${
                  difficulty === l.id ? "bg-amber text-black" : "text-white/70 hover:bg-white/10 disabled:hover:bg-transparent"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-snug text-dim">{level.line}</p>
        </div>
      </div>

      <div className="mt-auto max-h-[66vh] overflow-y-auto px-6 pb-5 pt-10">
        <div className="mx-auto mb-3 flex max-w-[1240px] items-center justify-between gap-4">
          <div className="pointer-events-none text-sm">
            {isHost ? (
              <span className="text-white/80">
                {mine.offlineMode ? "Mission control is offline. Showing a saved mission." : "Select one mission for the crew."}
                {mine.generating && !mine.offlineMode && <span className="text-dim"> More missions are being written.</span>}
              </span>
            ) : (
              <span className="num text-cyan">The commander is choosing a mission...</span>
            )}
          </div>
          {isHost && (
            <div className="flex gap-2">
              {mine.error && <Button variant="ghost" onClick={() => mine.reload()}>Retry</Button>}
              <Button variant="ghost" onClick={() => mine.reload(true)} disabled={!mine.cards}>
                Show other missions
              </Button>
            </div>
          )}
        </div>

        <div
          className="mx-auto grid max-w-[1240px] gap-4 md:grid-cols-3"
          onPointerEnter={() => mine.setHover(true)}
          onPointerLeave={() => mine.setHover(false)}
        >
          {cards
            ? cards.map((c, i) => (
                <MissionCardView key={c.plan.id} card={c} index={i} disabled={!isHost} canChoose={isHost} onChoose={() => choose(c)} />
              ))
            : [0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    </div>
  );
}
