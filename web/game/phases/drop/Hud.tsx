"use client";
import { useEffect, useState } from "react";
import { sfx } from "../../core/audio";
import { useGame, usePhaseData } from "../../core/useGame";
import { Button, Panel } from "../../ui/kit";
import { PERKS, crateTier, rollPerk, type PerkId } from "../../data/perks";
import { phaseLabel } from "../../ui/phaseLabel";

const TIER_TEXT = { common: "Standard crate", rare: "Reinforced crate", legendary: "Gold-seal crate" } as const;
const TIER_CLASS = { common: "text-cyan", rare: "text-amber", legendary: "text-pink-300" } as const;

export function DropHud() {
  const { plan, state, patch, complete, isHost, actsAs } = useGame();
  const d = usePhaseData<{ opened: boolean; perk: PerkId }>("drop");
  const score = state?.scores.build ?? 50;
  const [landed, setLanded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [late, setLate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLanded(true), 3800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!d.opened) return;
    const a = setTimeout(() => { setReveal(true); sfx("chime", { volume: 0.5 }); }, 2200);
    const b = setTimeout(() => setLate(true), 9000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [d.opened]);

  if (!plan) return <div className="absolute inset-0 grid place-items-center"><Panel className="text-sm text-dim">Loading the drop zone...</Panel></div>;
  const tier = crateTier(score);
  const perk = d.perk ? PERKS[d.perk] : null;
  const open = () => {
    if (d.opened) return;
    sfx("click", { volume: 0.5 });
    patch("drop", { opened: true, perk: rollPerk(score, plan.seed) });
  };
  const canContinue = isHost || actsAs("commander") || late;

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute left-6 top-5 max-w-md [text-shadow:0_1px_10px_rgba(0,0,0,0.7)]">
        <div className="num text-[11px] text-amber">{phaseLabel("drop")}</div>
        <h2 className="text-2xl font-semibold leading-tight">A crate for your crew</h2>
        <p className="mt-1 text-sm text-dim">Your build score of {score} earned this drop. Rewards are earned, never bought.</p>
      </div>

      {!d.opened && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <Panel className="flex items-center gap-4">
            <div>
              <div className={`num text-xs ${TIER_CLASS[tier]}`}>{TIER_TEXT[tier]}</div>
              <div className="text-sm text-white/80">{landed ? "The crate has landed. Open it to see what is inside." : "Crate descending on its parachute..."}</div>
            </div>
            <Button onClick={open} disabled={!landed}>Open crate</Button>
          </Panel>
        </div>
      )}

      {reveal && perk && (
        <div className="absolute right-8 top-1/2 w-80 -translate-y-1/2 animate-[fadein_.5s_ease-out]">
          <Panel className="p-5">
            <div className={`num text-[11px] uppercase tracking-wide ${perk.rarity === "legendary" ? "text-pink-300" : perk.rarity === "rare" ? "text-amber" : "text-cyan"}`}>{perk.rarity} find</div>
            <div className="mt-1 text-xl font-semibold">{perk.name}</div>
            <p className="mt-2 text-sm text-white/80">{perk.desc}</p>
            <div className="mt-3 rounded-lg border border-go/40 bg-go/10 p-3 text-sm text-go">{perk.effect}</div>
            <div className="mt-4">
              {canContinue ? (
                <Button className="w-full" onClick={() => complete("drop", 100)}>Continue</Button>
              ) : (
                <div className="text-xs text-dim">Waiting for the commander to continue.</div>
              )}
            </div>
          </Panel>
        </div>
      )}
      {d.opened && !reveal && <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-sm text-dim">Opening...</div>}
      <style>{`@keyframes fadein{from{opacity:0;transform:translate(24px,-50%)}to{opacity:1;transform:translate(0,-50%)}}`}</style>
    </div>
  );
}
