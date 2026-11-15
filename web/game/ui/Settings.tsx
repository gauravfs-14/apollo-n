"use client";
// Quality / volume / perf-overlay controls. Used by the main menu and the in-game pause menu.
import { useEffect, useState } from "react";
import { getMusicVolume, setMasterVolume, setMusicVolume, speak } from "../core/audio";
import { useStore, type QualityMode } from "../core/store";

const MODES: { id: QualityMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/** Apply the saved master volume once per page. */
export function useApplyVolume() {
  const v = useStore((s) => s.volume);
  useEffect(() => setMasterVolume(v), [v]);
}

export function SettingsPanel() {
  const mode = useStore((s) => s.qualityMode);
  const quality = useStore((s) => s.quality);
  const setMode = useStore((s) => s.setQualityMode);
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const [music, setMusic] = useState(() => getMusicVolume());
  const showPerf = useStore((s) => s.showPerf);
  const togglePerf = useStore((s) => s.togglePerf);

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-white">Graphics quality</span>
          <span className="text-xs text-dim">{mode === "auto" ? `Auto, now ${quality}` : "Fixed"}</span>
        </div>
        <div role="radiogroup" aria-label="Graphics quality" className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-white/5 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`pointer-events-auto rounded-md px-2 py-1.5 transition ${mode === m.id ? "bg-amber font-medium text-black" : "text-white/80 hover:bg-white/10"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-dim">Auto lowers detail if the frame rate drops. Pick a fixed level to stop that.</p>
      </div>

      <div>
        <label htmlFor="vol" className="mb-2 flex items-baseline justify-between text-white">
          <span>Volume</span>
          <span className="num text-xs text-dim">{Math.round(volume * 100)}%</span>
        </label>
        <input
          id="vol"
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="pointer-events-auto h-1.5 w-full cursor-pointer accent-amber"
        />
        <label htmlFor="music" className="mb-2 mt-4 flex items-baseline justify-between text-white">
          <span>Music</span>
          <span className="num text-xs text-dim">{Math.round(music * 100)}%</span>
        </label>
        <input
          id="music"
          type="range"
          min={0}
          max={100}
          value={Math.round(music * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setMusic(v);
            setMusicVolume(v);
          }}
          className="pointer-events-auto h-1.5 w-full cursor-pointer accent-amber"
        />
        <button
          onClick={() => void speak("Houston here. Voice check, loud and clear.", "voice_check")}
          className="pointer-events-auto mt-2 rounded-md border border-line bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
        >
          Test voice
        </button>
      </div>

      <label className="pointer-events-auto flex cursor-pointer items-center justify-between text-white">
        <span>
          Show performance stats
          <span className="block text-xs text-dim">Frame rate, draw calls, triangles. Shortcut: the ` key.</span>
        </span>
        <input type="checkbox" checked={showPerf} onChange={togglePerf} className="h-4 w-4 accent-amber" />
      </label>
      <p className="text-[11px] leading-4 text-dim">
        Music by Kevin MacLeod (
        <a className="pointer-events-auto underline hover:text-white" href="https://incompetech.com" target="_blank" rel="noreferrer">
          incompetech.com
        </a>
        ), licensed under{" "}
        <a className="pointer-events-auto underline hover:text-white" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        .
      </p>
    </div>
  );
}
