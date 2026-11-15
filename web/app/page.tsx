"use client";
// Main menu: cinematic Earthrise backdrop, name, solo / host / join, settings.
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/game/core/api";
import { PerfOverlay } from "@/game/core/perf";
import { Button, Panel } from "@/game/ui/kit";
import { setBaseMusic } from "@/game/core/music";
import { LEVEL_COUNT } from "@/game/journey/levels";
import { useJourney } from "@/game/journey/progress";
import { useProgress } from "@/game/progress/store";
import { SettingsPanel, useApplyVolume } from "@/game/ui/Settings";

const MenuScene = dynamic(() => import("@/game/ui/MenuScene"), { ssr: false });

const CODE_RE = /^APOLLO-[A-HJ-NP-Z2-9]{3}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  return "APOLLO-" + Array.from({ length: 3 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
}

/** "apollo-7k3", "APOLLO 7K3", "7k3" -> "APOLLO-7K3". Returns null if it cannot be a valid code. */
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tail = s.startsWith("APOLLO") ? s.slice(6) : s;
  const code = `APOLLO-${tail}`;
  return CODE_RE.test(code) ? code : null;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "solo" | "multi" | "join">(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const journey = useJourney();
  const prog = useProgress();
  useApplyVolume();
  useEffect(() => setBaseMusic("menu"), []);

  useEffect(() => {
    // never overwrite what the player already typed while the page was hydrating
    setName((typed) => typed || (localStorage.getItem("apollo.name") ?? "")); // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only
  }, []);

  const cleanName = () => {
    const n = name.trim().slice(0, 24) || "Astronaut";
    localStorage.setItem("apollo.name", n);
    return n;
  };

  async function start(mode: "solo" | "multi") {
    setError(null);
    cleanName();
    setBusy(mode);
    let room: string | null = null;
    try {
      room = (await api<{ room: string }>("/rooms", { mode })).room;
    } catch {
      /* server unreachable */
    }
    if (!room) {
      if (mode === "multi") {
        setBusy(null);
        setError("Can't reach the game server, so a crew room can't be created. You can still fly a solo mission.");
        return;
      }
      room = randomCode(); // offline solo still works
    }
    router.push(`/play/${room}?mode=${mode}`);
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) {
      setError("That code doesn't look right. Room codes look like APOLLO-7K3.");
      return;
    }
    setError(null);
    cleanName();
    setBusy("join");
    router.push(`/play/${c}?mode=multi`);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <MenuScene />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_60%,rgb(0_0_0/0.62),transparent_60%)]" />

      <div className="absolute inset-0 flex flex-col justify-between p-6 sm:p-10">
        <header className="flex items-center justify-between text-sm text-white/70">
          <span>NASA data, real news, your crew</span>
          <div className="pointer-events-auto flex gap-2">
            <button onClick={() => router.push("/hangar")} className="rounded-lg border border-line bg-black/30 px-3 py-1.5 text-white/90 backdrop-blur transition hover:bg-white/10">
              Hangar <span className="num ml-1 text-amber">{prog.hydrated ? prog.credits : ""}</span>
            </button>
            <button onClick={() => router.push("/hangar?tab=collection")} className="rounded-lg border border-line bg-black/30 px-3 py-1.5 text-white/90 backdrop-blur transition hover:bg-white/10">
              Collection
            </button>
          <button
            onClick={() => setShowSettings(true)}
            className="pointer-events-auto rounded-lg border border-line bg-black/30 px-3 py-1.5 text-white/90 backdrop-blur transition hover:bg-white/10"
          >
            Settings
          </button>
          </div>
        </header>

        <section className="max-w-md pb-6 sm:pb-12">
          <h1 className="text-6xl font-semibold leading-none tracking-tight sm:text-8xl">
            Apollo <span className="text-amber">N</span>
          </h1>
          <p className="mt-4 max-w-sm text-lg text-white/75">Fifteen missions from the pad to the lunar south pole. Finish one to open the next.</p>

          <div className="mt-8 space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-white/70">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder="Astronaut"
                autoComplete="nickname"
                className="pointer-events-auto w-full rounded-lg border border-line bg-black/40 px-3.5 py-2.5 text-white outline-none backdrop-blur placeholder:text-white/35 focus:border-amber/70"
              />
            </label>

            <Button onClick={() => start("solo")} disabled={busy !== null} className="w-full py-3.5 text-left text-base">
              <span className="flex items-center justify-between gap-3">
                <span>
                  {busy === "solo" ? "Starting..." : !journey.hydrated || Object.keys(journey.done).length === 0 ? "Start journey" : journey.finished ? "Replay journey" : "Continue journey"}
                </span>
                <span className="num text-sm opacity-75">
                  {journey.hydrated && Object.keys(journey.done).length > 0 ? `Level ${journey.current} of ${LEVEL_COUNT}` : "Level 1"}
                </span>
              </span>
            </Button>

            <Button variant="ghost" onClick={() => router.push("/challenge")} className="w-full py-2.5 text-left backdrop-blur">
              <span className="flex items-center justify-between gap-3">
                <span>Challenges</span>
                <span className="text-xs text-dim">2 minute landing, 1 minute launch, leaderboards</span>
              </span>
            </Button>

            <div className="pt-3">
              <div className="mb-1.5 text-sm text-white/70">Crew room</div>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => start("multi")} disabled={busy !== null} className="py-2.5 backdrop-blur">
                  {busy === "multi" ? "Creating..." : "Host a room"}
                </Button>
                <form onSubmit={join} className="flex min-w-0 flex-1 gap-3">
                  <input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setError(null);
                    }}
                    aria-label="Room code"
                    aria-invalid={!!error && !!code}
                    maxLength={14}
                    placeholder="Room code"
                    spellCheck={false}
                    className="num pointer-events-auto min-w-0 flex-1 rounded-lg border border-line bg-black/40 px-3.5 py-2.5 text-white uppercase outline-none backdrop-blur placeholder:normal-case placeholder:text-white/35 focus:border-cyan/70"
                  />
                  <Button type="submit" variant="ghost" disabled={busy !== null || !code.trim()} className="backdrop-blur">
                    Join
                  </Button>
                </form>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-nogo/40 bg-nogo/10 px-3 py-2 text-sm text-nogo">
                {error}
              </p>
            )}
          </div>
        </section>
      </div>

      {showSettings && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <Panel className="w-full max-w-sm" >
            <div onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-sm text-dim hover:text-white">Close</button>
              </div>
              <SettingsPanel />
            </div>
          </Panel>
        </div>
      )}
      <PerfOverlay />
    </main>
  );
}
