"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { say } from "../../core/comms";
import { SPLASHDOWN } from "../../data/missionComms";
import { useGame } from "../../core/useGame";
import { Button, Meter } from "../../ui/kit";
import { RANK_COLOR, computeResult, type Result } from "./score";
import { renderShareCard } from "./shareCard";
import { ROLES } from "../../types";
import { ROLE_INFO, type CrewData } from "../crew/data";
import { phaseLabel } from "../../ui/phaseLabel";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function summaryTemplate(r: Result, title: string) {
  const best = [...r.rows].filter((x) => x.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  return `${title} is complete. The crew finished with ${r.total} out of 100 and earned ${r.rank}.${best ? ` The strongest phase was ${best.label.toLowerCase()}.` : ""}`;
}

function useDebrief(r: Result, title: string) {
  const [text, setText] = useState<string | null>(null);
  const key = JSON.stringify(r.rows.map((x) => x.score));
  useEffect(() => {
    let alive = true;
    const numbers: Record<string, number | string> = { total_score: r.total, rank: r.rank, phases_skipped: r.skipped };
    for (const row of r.rows) if (row.score !== null) numbers[row.label.toLowerCase().replace(/\s+/g, "_")] = Math.round(row.score);
    api<{ text: string }>("/director", {
      phase: "mission report",
      numbers,
      question: "Give the crew a short debrief of how the mission went.",
    })
      .then((d) => alive && setText(d.text))
      .catch(() => alive && setText(summaryTemplate(r, title)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return text;
}

export function ReportHud() {
  const { state, plan, isHost, action } = useGame();
  const result = useMemo(() => computeResult(state?.scores), [state?.scores]);
  const summary = useDebrief(result, plan?.title ?? "The mission");
  const spoke = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (spoke.current || !plan) return;
    spoke.current = true;
    // the real Apollo 11 recovery loop, then Houston's sign-off for this mission
    const line = plan.voice_lines.find((v) => v.id === "success_1");
    say([...SPLASHDOWN, ...(line ? [{ who: "capcom" as const, text: line.text }] : [])]);
  }, [plan]);

  if (!plan || !state) return null;
  const crew = state.phaseData.crew as Partial<CrewData> | undefined;
  const multi = state.mode === "multi";
  const color = RANK_COLOR[result.rank];

  const download = async () => {
    setBusy(true);
    try {
      const blob = await renderShareCard(plan, result, state.players);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${plan.id}-${result.rank.toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[34rem] bg-gradient-to-r from-black/55 to-transparent" />

      {/* left: result */}
      <div className="pointer-events-auto absolute bottom-20 left-6 top-5 w-[min(25rem,calc(100vw-3rem))] overflow-y-auto pr-1">
        <div className="num text-[11px] text-amber">{phaseLabel("report")} · Apollo {plan.number}</div>
        <h2 className="text-2xl font-semibold leading-tight">{plan.title.replace(/^Apollo \d+:\s*/, "")}</h2>
        <div className="mt-3 flex items-end gap-4">
          <div className="text-5xl font-bold leading-none" style={{ color }}>
            {result.rank}
          </div>
          <div className="pb-0.5">
            <div className="num text-lg">{result.total} / 100</div>
            <div className="flex gap-0.5" aria-label={`${result.stars} of 5 stars`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <svg key={i} viewBox="0 0 24 24" className="h-4 w-4" fill={i < result.stars ? color : "none"} stroke={color} strokeWidth="1.6">
                  <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" />
                </svg>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel p-3 backdrop-blur-md">
          <div className="mb-2 text-[11px] text-dim">Score by phase</div>
          <ul className="space-y-1.5">
            {result.rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[8.5rem_1fr_3.4rem] items-center gap-2 text-[13px]">
                <span className={r.score === null ? "text-dim" : "text-white/90"}>{r.label}</span>
                <Meter value={(r.score ?? 0) / 100} tone={r.score === null ? "data" : r.score >= 70 ? "go" : r.score >= 40 ? "amber" : "nogo"} />
                <span className="num text-right text-white/80">{r.score === null ? "skipped" : Math.round(r.score)}</span>
              </li>
            ))}
          </ul>
          {result.skipped > 0 && <p className="mt-2 text-[11px] text-dim">Skipped phases count as zero.</p>}
        </div>
      </div>

      {/* right: debrief + what was real */}
      <div className="pointer-events-auto absolute bottom-20 right-6 top-5 w-[min(27rem,calc(100vw-3rem))] space-y-3 overflow-y-auto">
        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-go" /> Flight Director debrief
          </div>
          {summary ? (
            <p className="text-[14px] leading-relaxed text-white/90">{summary}</p>
          ) : (
            <div className="animate-pulse space-y-2">
              <div className="h-3 w-full rounded bg-white/10" />
              <div className="h-3 w-5/6 rounded bg-white/10" />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <h3 className="text-sm font-semibold">What was real</h3>
          <p className="mt-0.5 text-[12px] text-dim">This mission was written from real news. Every fact below links to its source.</p>
          <a
            href={plan.inspired_by.source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block rounded-lg border border-line bg-white/5 p-2.5 text-[12.5px] leading-snug hover:bg-white/10"
          >
            <span className="text-[11px] text-dim">Inspired by</span>
            <span className="block text-white/90">{plan.inspired_by.name}</span>
            <span className="num text-[11px] text-cyan">
              {host(plan.inspired_by.source_url)}
              {plan.inspired_by.date ? ` / ${plan.inspired_by.date}` : ""}
            </span>
          </a>
          <ul className="mt-2.5 space-y-2.5">
            {plan.facts.map((f) => (
              <li key={f.id} className="text-[13px] leading-snug text-white/85">
                {f.text}{" "}
                <a href={f.source_url} target="_blank" rel="noreferrer" className="num whitespace-nowrap text-[11px] text-cyan hover:underline">
                  {f.source_name}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
          <h3 className="text-sm font-semibold">Crew</h3>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
            {ROLES.map((r) => {
              const name = crew?.names?.[r];
              const human = state.players.find((p) => p.role === r);
              const isAi = crew?.ai?.includes(r) ?? !human;
              return (
                <li key={r} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-white/90">{human?.name ?? name ?? "Astronaut"}</span>
                  <span className="shrink-0 text-[11px] text-dim">
                    {ROLE_INFO[r].label}
                    {multi && isAi ? " · AI" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* actions */}
      <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-3">
        <Button variant="ghost" onClick={download} disabled={busy}>
          {busy ? "Drawing card..." : "Download share card"}
        </Button>
        {isHost ? (
          <Button onClick={() => action("report", "reset")}>New mission</Button>
        ) : (
          <span className="pointer-events-auto rounded-lg border border-line bg-panel px-4 py-2 text-sm text-dim">
            Waiting for the commander to start a new mission
          </span>
        )}
      </div>
    </div>
  );
}
