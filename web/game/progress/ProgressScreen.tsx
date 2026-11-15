"use client";
// Hangar (spend credits) and collection log (patches, discoveries, achievements, records, titles).
// Used as an overlay on the journey map and as the /hangar page opened from the main menu.
import { PERKS } from "../data/perks";
import { LEVELS, LEVEL_COUNT } from "../journey/levels";
import { useJourneyStore } from "../journey/progress";
import { Button, Meter } from "../ui/kit";
import { ACHIEVEMENTS, POIS, completion, earnedTitles, isEarned, titleOf, type Ctx } from "./collection";
import { useCtx, useProgress } from "./store";
import { PERK_CHOICES, UPGRADES, type Upgrade, type UpgradeGroup } from "./upgrades";

export type Tab = "hangar" | "collection";

const GROUPS: { id: UpgradeGroup; label: string; sub: string }[] = [
  { id: "ship", label: "Ship", sub: "Shared with your crew when you host" },
  { id: "parts", label: "New ship parts", sub: "Appear in the build phase" },
  { id: "suit", label: "Suit", sub: "Always your own" },
];

function UpgradeCard({ up }: { up: Upgrade }) {
  const p = useProgress();
  const done = useJourneyStore((s) => s.done);
  const have = p.owned[up.id] ?? 0;
  const tier = up.tiers[have];
  const prev = have > 0 ? up.tiers[have - 1] : null;
  const gate = tier && tier.req && !done[tier.req] ? tier.req : 0;
  const poor = tier ? p.credits < tier.cost : false;
  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel p-3.5 backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[15px] font-semibold leading-tight">{up.name}</h4>
        <div className="flex shrink-0 gap-1 pt-1" aria-label={`${have} of ${up.tiers.length} owned`}>
          {up.tiers.map((_, i) => (
            <span key={i} className={`h-1.5 w-4 rounded-full ${i < have ? "bg-amber" : "bg-white/15"}`} />
          ))}
        </div>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-white/70">{up.effect}</p>
      <div className="num mt-2 text-[12px]">
        <span className="text-dim">{prev ? up.show(prev.value) : "stock"}</span>
        {tier && (
          <>
            <span className="text-dim"> {"->"} </span>
            <span className="text-cyan">{up.show(tier.value)}</span>
          </>
        )}
      </div>
      <div className="mt-auto pt-3">
        {!tier ? (
          <div className="rounded-lg border border-go/40 bg-go/10 py-1.5 text-center text-[13px] text-go">{up.partId ? "Unlocked" : "Maxed"}</div>
        ) : gate ? (
          <Button disabled variant="ghost" className="w-full py-1.5">Clear level {gate}</Button>
        ) : (
          <Button disabled={poor} onClick={() => p.buy(up.id)} className="w-full py-1.5">
            {poor ? `Need ${tier.cost - p.credits} more` : `Buy for ${tier.cost}`}
          </Button>
        )}
      </div>
    </div>
  );
}

function PerkPicker() {
  const p = useProgress();
  if (!(p.owned.perk_slot ?? 0)) return null;
  return (
    <div className="mt-3 rounded-xl border border-line bg-panel p-3.5 backdrop-blur-md">
      <div className="text-[13px] font-medium">Your starting perk</div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {PERK_CHOICES.map((id) => {
          const sel = p.perk === id;
          return (
            <button key={id} onClick={() => p.setPerk(sel ? null : id)} aria-pressed={sel}
              className={`pointer-events-auto rounded-lg border p-2 text-left transition ${sel ? "border-amber bg-amber/10" : "border-line bg-white/5 hover:bg-white/10"}`}>
              <div className="text-[12.5px] font-medium leading-tight">{PERKS[id].name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-dim">{PERKS[id].effect}</div>
            </button>
          );
        })}
      </div>
      {!p.perk && <div className="mt-2 text-[11.5px] text-amber">None chosen: the build phase will draw one at random.</div>}
    </div>
  );
}

function Hangar() {
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <section key={g.id}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="text-sm font-semibold">{g.label}</h3>
            <span className="text-[12px] text-dim">{g.sub}</span>
          </div>
          <div className={`grid gap-3 ${g.id === "parts" ? "grid-cols-5" : "grid-cols-4"}`}>
            {UPGRADES.filter((u) => u.group === g.id).map((u) => (
              <UpgradeCard key={u.id} up={u} />
            ))}
          </div>
          {g.id === "ship" && <PerkPicker />}
        </section>
      ))}
    </div>
  );
}

/** Mission patch: a round embroidered badge, dim until the level is complete. */
export function Patch({ level, stars, got }: { level: number; stars: number; got: boolean }) {
  const def = LEVELS[level - 1];
  const ring = got ? (stars >= 3 ? "#ffcf5a" : stars === 2 ? "#cfd6df" : "#d28a55") : "rgb(255 255 255 / 0.18)";
  return (
    <div className="flex flex-col items-center gap-1" title={`${def.title}${got ? `, ${stars} of 3 stars` : ", not earned"}`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-label={`Patch ${level}`}>
        <circle cx="32" cy="32" r="29" fill={got ? "#0b1220" : "#0a0d12"} stroke={ring} strokeWidth="3" strokeDasharray={got ? "0" : "3 3"} />
        <circle cx="32" cy="32" r="23" fill="none" stroke={got ? "#6fd3ff" : "rgb(255 255 255 / 0.1)"} strokeWidth="0.8" />
        {got && <circle cx="32" cy="40" r="9" fill="#cfd6df" />}
        {got && <path d="M10 46 Q32 32 54 46" fill="none" stroke="#ffb547" strokeWidth="1.5" />}
        <text x="32" y={got ? 27 : 37} textAnchor="middle" fontSize="13" fontWeight="600" fill={got ? "#fff" : "rgb(255 255 255 / 0.3)"} fontFamily="ui-monospace, monospace">{level}</text>
        {got && <text x="32" y="56" textAnchor="middle" fontSize="7" fill={ring}>{"*".repeat(stars)}</text>}
      </svg>
      <span className={`max-w-[5.5rem] truncate text-[11px] ${got ? "text-white/85" : "text-dim"}`}>{got ? def.title : "Locked"}</span>
    </div>
  );
}

function Pct({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-dim">{label}</span>
        <span className="num text-white/90">{n}/{of}</span>
      </div>
      <div className="mt-1"><Meter value={n / of} tone="amber" /></div>
    </div>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-[13px]">
      <span className="text-white/80">{label}</span>
      <span className="num text-cyan">{value}</span>
    </li>
  );
}

function Collection({ c }: { c: Ctx }) {
  const comp = completion(c);
  const r = c.records;
  const title = titleOf(c);
  const titles = earnedTitles(c);
  const none = (v: number) => (v > 0 ? String(v) : "--");
  return (
    <div className="grid grid-cols-[1fr_22rem] gap-5">
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Mission patches</h3>
            <span className="num text-[12px] text-dim">{comp.patches} of {LEVEL_COUNT}</span>
          </div>
          <div className="grid grid-cols-8 gap-x-2 gap-y-3">
            {LEVELS.map((l) => (
              <Patch key={l.n} level={l.n} got={!!c.done[l.n]} stars={c.done[l.n]?.stars ?? 0} />
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Discoveries</h3>
            <span className="num text-[12px] text-dim">{comp.found} of {POIS.length}</span>
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
            {POIS.map((p) => {
              const got = c.discovered.includes(p.id);
              return (
                <li key={p.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${got ? "bg-cyan" : "bg-white/20"}`} />
                  <span className={`truncate ${got ? "text-white/90" : "text-dim"}`}>{got ? p.title : "Not found yet"}</span>
                  <span className="ml-auto text-[10.5px] text-dim">{p.kind}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Title</h3>
            <span className="text-[13px] text-amber">{title ?? "None yet"}</span>
          </div>
          <div className="mt-2 flex gap-3">
            <Pct label="Patches" n={comp.patches} of={LEVEL_COUNT} />
            <Pct label="Finds" n={comp.found} of={POIS.length} />
            <Pct label="Awards" n={comp.ach} of={ACHIEVEMENTS.length} />
          </div>
          <div className="num mt-2 text-[12px] text-dim">Collection {comp.pct}% complete{titles.length ? `, ${titles.length} ${titles.length === 1 ? "title" : "titles"}` : ""}</div>
        </section>
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <h3 className="mb-2 text-sm font-semibold">Personal records</h3>
          <ul className="space-y-1">
            <RecordRow label="Best mission score" value={none(r.bestScore)} />
            <RecordRow label="Best build" value={none(r.bestBuild)} />
            <RecordRow label="Best launch" value={none(r.bestLaunch)} />
            <RecordRow label="Best cruise" value={none(r.bestCruise)} />
            <RecordRow label="Best landing" value={none(r.bestLanding)} />
            <RecordRow label="Best surface work" value={none(r.bestSurface)} />
            <RecordRow label="Softest touchdown" value={r.softestLanding === null ? "--" : `${r.softestLanding.toFixed(2)} m/s`} />
            <RecordRow label="Closest burn" value={r.bestBurnError === null ? "--" : `${r.bestBurnError.toFixed(1)} m/s off`} />
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <h3 className="mb-2 text-sm font-semibold">Achievements</h3>
          <ul className="space-y-2">
            {ACHIEVEMENTS.map((a) => {
              const v = Math.min(a.goal, a.value(c));
              const got = isEarned(a, c);
              return (
                <li key={a.id} title={a.desc}>
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className={got ? "text-white" : "text-white/65"}>{a.name}{a.title && got ? <span className="ml-1.5 text-[10.5px] text-amber">{a.title}</span> : null}</span>
                    <span className="num text-[11px] text-dim">{got ? "done" : `${Math.round(v)} / ${a.goal}`}</span>
                  </div>
                  <div className="mt-0.5"><Meter value={v / a.goal} tone={got ? "go" : "data"} /></div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function ProgressScreen({ tab, onTab, onClose }: { tab: Tab; onTab: (t: Tab) => void; onClose: () => void }) {
  const p = useProgress();
  const c = useCtx();
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 overflow-y-auto bg-black/70 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 pb-10 pt-16">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <div className="num text-[11px] text-amber">APOLLO N / {tab === "hangar" ? "HANGAR" : "COLLECTION"}</div>
            <h2 className="text-3xl font-semibold leading-tight">{tab === "hangar" ? "Upgrade your program" : "Your collection"}</h2>
            {tab === "hangar" && <p className="mt-1 text-sm text-dim">Earn credits on every mission. Upgrades are yours for good.</p>}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[11px] text-dim">Credits</div>
              <div className="num text-3xl leading-none text-amber">{p.credits}</div>
            </div>
            <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
              {(["hangar", "collection"] as Tab[]).map((t) => (
                <button key={t} onClick={() => onTab(t)} aria-pressed={tab === t}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${tab === t ? "bg-amber text-black" : "text-white/80 hover:bg-white/10"}`}>
                  {t === "hangar" ? "Hangar" : "Collection"}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </header>
        {tab === "hangar" ? <Hangar /> : <Collection c={c} />}
      </div>
    </div>
  );
}
