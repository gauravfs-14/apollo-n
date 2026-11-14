"use client";
import type { MissionCard } from "./useMissions";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function MissionCardView({
  card,
  index,
  disabled,
  canChoose,
  onChoose,
}: {
  card: MissionCard;
  index: number;
  disabled: boolean;
  canChoose: boolean;
  onChoose: () => void;
}) {
  const { plan, image, kind } = card;
  const facts = plan.facts.slice(0, 2);
  return (
    <article
      className={`pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50 backdrop-blur-md transition ${
        disabled ? "opacity-55 saturate-50" : "hover:border-white/25"
      }`}
    >
      {image && (
        <div className="relative h-14 shrink-0 overflow-hidden bg-black/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.title} className="h-full w-full object-cover opacity-80" loading="lazy" />
          <a
            href={image.page}
            target="_blank"
            rel="noreferrer"
            className="num absolute bottom-1 right-2 text-[10px] text-white/70 hover:text-white"
          >
            NASA image / {image.credit}
          </a>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3.5">
        <header>
          <div className="num flex items-center justify-between text-[11px] text-amber">
            <span>OPTION {index + 1} / APOLLO {plan.number}</span>
            <span className={kind === "live" ? "text-cyan" : "text-dim"}>{kind === "live" ? "From today's news" : "Mission archive"}</span>
          </div>
          <h3 className="mt-1 text-lg font-semibold leading-snug">{plan.title.replace(/^Apollo \d+:\s*/, "")}</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-dim">{plan.tagline}</p>
        </header>

        <section className="text-[13px] leading-snug">
          <div className="text-[11px] text-dim">Goal</div>
          <p className="line-clamp-2">{plan.goal.text}</p>
          <div className="mt-1 text-[11px] text-dim">Why it matters</div>
          <p className="line-clamp-2 text-white/80">{plan.goal.why}</p>
        </section>

        <section className="min-h-0 space-y-1 border-t border-line pt-2">
          {facts.map((f) => (
            <p key={f.id} className="text-[12px] leading-snug text-white/80">
              <span className="line-clamp-2">{f.text}</span>
              <a href={f.source_url} target="_blank" rel="noreferrer" className="num text-[10.5px] text-cyan hover:underline">
                {f.source_name}
              </a>
            </p>
          ))}
        </section>

        <footer className="mt-auto flex items-end justify-between gap-3 pt-1">
          <a
            href={plan.inspired_by.source_url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 text-[11px] leading-tight text-dim hover:text-white"
            title={plan.inspired_by.name}
          >
            Inspired by
            <span className="block truncate text-white/75 underline decoration-white/20 underline-offset-2">
              {host(plan.inspired_by.source_url)}
              {plan.inspired_by.date ? `, ${plan.inspired_by.date}` : ""}
            </span>
          </a>
          {canChoose && (
            <button
              onClick={onChoose}
              disabled={disabled}
              className="pointer-events-auto shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
            >
              Select
            </button>
          )}
        </footer>
      </div>
    </article>
  );
}

export function CardSkeleton() {
  return (
    <div className="h-[330px] animate-pulse rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
      <div className="h-3 w-24 rounded bg-white/10" />
      <div className="mt-3 h-6 w-3/4 rounded bg-white/10" />
      <div className="mt-2 h-3 w-full rounded bg-white/5" />
      <div className="mt-6 space-y-2">
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-5/6 rounded bg-white/5" />
        <div className="h-3 w-4/6 rounded bg-white/5" />
      </div>
      <div className="mt-8 space-y-2">
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-3/4 rounded bg-white/5" />
      </div>
    </div>
  );
}
