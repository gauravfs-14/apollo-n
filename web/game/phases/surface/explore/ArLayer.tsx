"use client";
// DOM half of the AR overlay: one glass tag per target (moved by ExploreAr every frame), the detail card opened with E
// or a click, and the atlas of heritage sites. Plain DOM over the canvas, so tags are never hidden behind geometry.
import { useEffect, useRef } from "react";
import { rt, useSurface } from "../store";
import { arEls, arGaze, useAr, type ArInfo } from "./arStore";
import { enrich } from "./heritage";

const KIND_COLOR: Record<string, string> = { lander: "#6fd3ff", flag: "#ffb547", task: "#ffb547", nature: "#4ade80", sky: "#c9d6ff", heritage: "#ff9f6b" };

function Tag({ id, info }: { id: string; info: ArInfo }) {
  const root = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const r = root.current;
    const s = sub.current;
    if (!r || !s) return;
    arEls.set(id, { root: r, sub: s });
    return () => void arEls.delete(id);
  }, [id]);
  const c = KIND_COLOR[info.kind];
  const open = () => {
    useAr.setState({ open: info.id });
    void enrich(info.id);
  };
  return (
    <div ref={root} data-on="0" data-focus="0" className="group absolute left-0 top-0 will-change-transform" style={{ visibility: "hidden", opacity: 0 }}>
      <button
        type="button"
        onClick={open}
        className="pointer-events-auto absolute bottom-3 left-0 w-max max-w-[17rem] -translate-x-1/2 cursor-pointer rounded-md border border-white/15 bg-[rgb(8_14_22/0.5)] px-2.5 py-1.5 text-left shadow-[0_6px_24px_rgb(0_0_0/0.35)] backdrop-blur-md transition-[max-width] group-data-[focus=1]:border-white/30 group-data-[focus=1]:bg-[rgb(8_14_22/0.66)]"
        style={{ borderLeft: `2px solid ${c}` }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium leading-tight text-white">{info.title}</span>
          <span ref={sub} className="num whitespace-nowrap text-[11px] text-white/55" />
        </div>
        <div className="hidden group-data-[focus=1]:block">
          <div className="mt-1 text-[12px] leading-snug text-white/75">{info.blurb}</div>
          <div className="mt-1.5 text-[11px] text-white/50">
            <kbd className="mr-1 rounded border border-white/25 px-1 text-[10px] text-white/80">E</kbd>more
          </div>
        </div>
      </button>
      <div className="absolute bottom-0 left-0 h-3 w-px -translate-x-1/2" style={{ background: c, opacity: 0.7 }} />
      <div className="absolute left-0 top-[-3px] h-[7px] w-[7px] -translate-x-1/2 rounded-full border" style={{ borderColor: c, background: "rgb(8 14 22 / 0.6)" }} />
    </div>
  );
}

function Detail({ info, onClose }: { info: ArInfo; onClose: () => void }) {
  const online = useAr((s) => s.online);
  const sites = useAr((s) => s.sites);
  const site = sites.find((s) => s.id === info.id);
  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-white/15 bg-[rgb(8_14_22/0.72)] p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        {info.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.image.url} alt={info.image.title ?? info.title} className="h-24 w-32 shrink-0 rounded-md object-cover" referrerPolicy="no-referrer" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold text-white">{info.title}</h3>
            <button onClick={onClose} className="shrink-0 text-xs text-white/55 hover:text-white">
              Close (E)
            </button>
          </div>
          <div className="mt-0.5 text-xs text-white/55">
            {[info.agency, info.year].filter(Boolean).join(" ")}
            {site && (
              <span className="num">
                {info.agency || info.year ? " - " : ""}
                {site.distKm >= 100 ? Math.round(site.distKm).toLocaleString("en-US") : site.distKm.toFixed(1)} km, bearing {String(Math.round(site.bearing) % 360).padStart(3, "0")}
              </span>
            )}
          </div>
          {info.left && info.left.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {info.left.map((l) => (
                <span key={l} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/80">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
        {info.facts.map((f, i) => (
          <li key={i} className="text-[13px] leading-snug text-white/85">
            {f.text}
            {f.source_url && (
              <a href={f.source_url} target="_blank" rel="noreferrer" className="ml-1.5 whitespace-nowrap text-[11px] text-cyan hover:underline">
                {f.source_name ?? "source"}
                {f.via === "SerpApi" ? " (web)" : ""}
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
        <span>{online === false ? "Offline notes" : "NASA, SerpApi and curated sources"}</span>
        {info.image?.page && (
          <a href={info.image.page} target="_blank" rel="noreferrer" className="hover:text-white/70">
            Picture: {info.image.credit ?? "web"}
          </a>
        )}
      </div>
    </div>
  );
}

function Atlas() {
  const sites = useAr((s) => s.sites);
  const infos = useAr((s) => s.infos);
  return (
    <div className="pointer-events-auto absolute right-5 top-[15.5rem] w-72 rounded-xl border border-line bg-panel p-3 backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[11px] tracking-wide text-dim">LEFT ON THE MOON</div>
        <div className="num text-[11px] text-dim">{sites.length}</div>
      </div>
      <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
        {sites.map((s) => (
          <li key={s.id}>
            <button
              className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[13px] hover:bg-white/10"
              onClick={() => {
                rt.camYaw = (s.bearing * Math.PI) / 180;
                rt.camPitch = 0.12;
                arGaze.pin = s.id;
                arGaze.until = performance.now() + 8000;
                useAr.setState({ atlas: false });
              }}
              title="Face this site"
            >
              <span className="truncate text-white">{infos[s.id]?.title ?? s.id}</span>
              <span className="num shrink-0 text-[11px] text-dim">{s.distKm >= 100 ? Math.round(s.distKm).toLocaleString("en-US") : s.distKm.toFixed(1)} km</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[11px] text-dim">Click one to turn toward it.</div>
    </div>
  );
}

export function ArLayer() {
  const explore = useSurface((s) => s.explore);
  const targets = useAr((s) => s.targets);
  const infos = useAr((s) => s.infos);
  const open = useAr((s) => s.open);
  const atlas = useAr((s) => s.atlas);
  if (!explore) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {targets.map((t) => infos[t.info] && <Tag key={t.id} id={t.id} info={infos[t.info]} />)}
      {atlas && <Atlas />}
      {open && infos[open] && <Detail info={infos[open]} onClose={() => useAr.setState({ open: null })} />}
    </div>
  );
}
