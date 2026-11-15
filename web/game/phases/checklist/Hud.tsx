"use client";
import { useEffect, useRef, useState } from "react";
import { rolesOf } from "../../core/roles";
import { MINIGAMES, type MinigameResult } from "../../minigames";
import { clearComms, say } from "../../core/comms";
import { COST, damage } from "../../core/hp";
import { useGame, usePhaseData } from "../../core/useGame";
import { checklistDone } from "../../data/missionComms";
import { Button, Panel, Stat } from "../../ui/kit";
import { phaseLabel } from "../../ui/phaseLabel";

const GOAL = {
  order_steps: "Order the steps",
  quiz: "Quick quiz",
  memory_match: "Match the pairs",
  switch_panel: "Flip the switches",
} as const;

export function ChecklistHud() {
  const { plan, state, patch, complete, isHost, actsAs } = useGame();
  const d = usePhaseData<{ progress: { done: number; total: number; mistakes: number }; result: MinigameResult }>("checklist");
  const [skip, setSkip] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSkip(true), 45000);
    return () => clearTimeout(t);
  }, []);
  // every wrong step costs ship integrity (reported once, by whoever is doing the checklist)
  const mistakes = d.progress?.mistakes ?? 0;
  const seenMistakes = useRef(0);
  useEffect(() => {
    if (!actsAs("commander") || mistakes <= seenMistakes.current) return;
    damage(COST.minor * (mistakes - seenMistakes.current), "A pre-launch checklist step was done out of order.");
    seenMistakes.current = mistakes;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new mistakes only
  }, [mistakes]);

  // checklist done: Launch Control reads the result, then the game moves on to launch by itself
  const finished = !!d.result;
  const advance = useRef(false);
  const goLaunch = () => {
    if (advance.current || !d.result) return;
    advance.current = true;
    if (actsAs("commander") || isHost) complete("checklist", d.result.score);
  };
  useEffect(() => {
    if (!finished || !d.result) return;
    say(checklistDone(d.result), { once: `checklist-done:${plan?.id}`, onDone: () => setTimeout(goLaunch, 600) });
    const fallback = setTimeout(goLaunch, 15000); // never wait on the radio forever
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the result appears
  }, [finished]);

  if (!plan) return <div className="absolute inset-0 grid place-items-center"><Panel className="text-sm text-dim">Loading checklist...</Panel></div>;
  // dev only: ?style=quiz|order_steps|memory_match|switch_panel previews a minigame
  const dev = typeof window !== "undefined" && process.env.NODE_ENV !== "production" ? new URLSearchParams(location.search).get("style") : null;
  const style = (dev && dev in MINIGAMES ? dev : plan.checklist.style) as keyof typeof MINIGAMES;
  const Game = MINIGAMES[style] ?? MINIGAMES.order_steps;
  const actor = actsAs("commander");
  const wide = style === "switch_panel";
  const result = d.result;
  const actorName = state?.players.find((p) => rolesOf(p).includes("commander"))?.name ?? "The commander";

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute left-6 top-5 max-w-[min(28rem,calc(50vw-18rem))]">
        <div className="num text-[11px] text-amber">{phaseLabel("checklist")}</div>
        <h2 className="text-2xl font-semibold leading-tight">{GOAL[style]}</h2>
        <p className="mt-1 text-sm text-dim">Every item has to be right before mission control gives the go.</p>
      </div>

      <div className="absolute inset-0 grid place-items-center overflow-auto p-6 pt-36">
        <Panel className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} bg-[rgb(10_13_18/0.82)]`}>
          {result ? (
            <div>
              <div className="num text-[11px] text-go">CHECKLIST COMPLETE</div>
              <div className="mt-2 grid grid-cols-4 gap-4">
                <Stat label="Score" value={result.score} tone="go" />
                <Stat label="Correct" value={`${result.correct}/${result.total}`} />
                <Stat label="Mistakes" value={result.mistakes} tone={result.mistakes ? "nogo" : "default"} />
                <Stat label="Time" value={`${result.seconds}s`} tone="data" />
              </div>
              <div className="mt-4 flex justify-end">
                <span className="mr-auto self-center text-xs text-dim">Launch sequence starts when Launch Control is done.</span>
                {(actor || isHost) && (
                  <Button variant="ghost" onClick={() => { clearComms(); goLaunch(); }}>
                    Skip
                  </Button>
                )}
              </div>
            </div>
          ) : actor ? (
            <Game
              items={plan.checklist.items}
              difficulty={plan.difficulty}
              facts={plan.facts}
              seed={plan.seed}
              onProgress={(p) => patch("checklist", { progress: p })}
              onDone={(r) => patch("checklist", { result: r, progress: { done: r.total, total: r.total, mistakes: r.mistakes } })}
            />
          ) : (
            <div>
              <div className="text-sm">{actorName} is running the checklist.</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-amber transition-[width] duration-300" style={{ width: `${d.progress ? (d.progress.done / Math.max(1, d.progress.total)) * 100 : 0}%` }} />
              </div>
              <div className="num mt-1 text-[11px] text-dim">
                {d.progress ? `${d.progress.done} / ${d.progress.total} done · ${d.progress.mistakes} mistakes` : "Waiting to start"}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {isHost && skip && !result && (
        <div className="absolute bottom-6 right-6">
          <Button variant="ghost" onClick={() => complete("checklist", 40)}>Skip checklist (host)</Button>
        </div>
      )}
    </div>
  );
}
