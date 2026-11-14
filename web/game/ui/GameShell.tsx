"use client";
// Persistent game chrome on the play page: top bar (room, connection, crew), error toasts,
// pause/settings menu and the multiplayer lobby card. Sits above every phase HUD.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { disconnect, send } from "../core/net";
import { useStore } from "../core/store";
import { PHASE_ORDER, type Player, type Role } from "../types";
import { Button, Panel } from "./kit";
import { SettingsPanel } from "./Settings";

export const ROLE_TEXT: Record<Role, string> = {
  commander: "text-amber",
  pilot: "text-cyan",
  engineer: "text-go",
  scientist: "text-white",
};
export const ROLE_LABEL: Record<Role, string> = { commander: "Commander", pilot: "Pilot", engineer: "Engineer", scientist: "Scientist" };

const CONN: Record<string, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-go" },
  connecting: { label: "Connecting", dot: "bg-amber animate-pulse" },
  lost: { label: "Reconnecting", dot: "bg-nogo animate-pulse" },
  local: { label: "Offline solo", dot: "bg-cyan" },
  missing: { label: "Room not found", dot: "bg-nogo" },
  idle: { label: "Not connected", dot: "bg-white/30" },
};

function inviteUrl(room: string) {
  return `${location.origin}/play/${room}?mode=multi`;
}

function useCopy(text: () => string) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = useCallback(async () => {
    const t = text();
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  }, [text]);
  return [done, copy] as const;
}

function PlayerChip({ p, isMe }: { p: Player; isMe: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${isMe ? "bg-white/10" : "bg-white/5"} ${p.connected ? "text-white" : "text-white/40"}`}
      title={p.connected ? "Connected" : "Disconnected"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${p.connected ? "bg-go" : "bg-white/30"}`} />
      <span className="max-w-24 truncate">{p.name}</span>
      {p.role && <span className={`${ROLE_TEXT[p.role]} ${p.connected ? "" : "opacity-50"}`}>{ROLE_LABEL[p.role]}</span>}
      {p.isHost && <span className="rounded bg-amber/20 px-1 text-[10px] font-medium text-amber">Host</span>}
    </span>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const state = useStore((s) => s.state);
  const meId = useStore((s) => s.meId);
  const conn = useStore((s) => s.connection);
  const multi = state?.mode === "multi";
  const room = state?.room;
  const [copied, copy] = useCopy(() => (room ? inviteUrl(room) : ""));
  const c = CONN[conn] ?? CONN.idle;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-2">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-line bg-panel px-2 py-1 shadow-xl shadow-black/30 backdrop-blur-md">
        {room && multi ? (
          <button onClick={copy} className="num flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white hover:bg-white/10" title="Copy invite link">
            {room}
            <span className="text-[10px] text-dim">{copied ? "Link copied" : "Copy link"}</span>
          </button>
        ) : (
          <span className="px-2 text-xs text-dim">Solo mission</span>
        )}
        <span className="flex items-center gap-1.5 px-1 text-xs text-white/80" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
          {c.label}
        </span>
        {multi && state && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {state.players.map((p) => (
              <PlayerChip key={p.id} p={p} isMe={p.id === meId} />
            ))}
          </div>
        )}
        <button onClick={onMenu} className="rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white" aria-label="Open menu (Esc)">
          Menu
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  const err = useStore((s) => s.lastError);
  const setError = useStore((s) => s.setError);
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setError(null), 4500);
    return () => clearTimeout(t);
  }, [err, setError]);
  if (!err) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-4" role="alert">
      <button
        onClick={() => setError(null)}
        className="pointer-events-auto max-w-md rounded-lg border border-nogo/40 bg-black/80 px-4 py-2 text-left text-sm text-white shadow-xl backdrop-blur"
      >
        <span className="mr-2 font-medium text-nogo">Heads up</span>
        {err}
      </button>
    </div>
  );
}

function PauseMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const state = useStore((s) => s.state);
  const meId = useStore((s) => s.meId);
  const me = state?.players.find((p) => p.id === meId);
  const [copied, copy] = useCopy(() => (state ? inviteUrl(state.room) : ""));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const idx = state ? PHASE_ORDER.indexOf(state.phase) : -1;
  const next = idx >= 0 ? PHASE_ORDER[idx + 1] : undefined;

  const skip = () => {
    if (!state || !next) return;
    send({ type: "action", phase: state.phase, kind: "goto", data: { phase: next } });
    onClose();
  };
  const leave = () => {
    disconnect();
    router.push("/");
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <Panel className="w-full max-w-sm" >
        <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Game menu">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Menu</h2>
            <button onClick={onClose} className="text-sm text-dim hover:text-white">Resume</button>
          </div>
          <SettingsPanel />
          <div className="mt-5 space-y-2 border-t border-line pt-4">
            {state?.mode === "multi" && (
              <Button variant="ghost" className="w-full" onClick={copy}>
                {copied ? "Invite link copied" : "Copy invite link"}
              </Button>
            )}
            {me?.isHost && next && (
              <Button variant="ghost" className="w-full" onClick={skip}>
                Skip this phase (host)
              </Button>
            )}
            {!confirmLeave ? (
              <Button variant="ghost" className="w-full" onClick={() => setConfirmLeave(true)}>
                Leave mission
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="danger" className="flex-1" onClick={leave}>
                  {state?.mode === "multi" ? "Leave room" : "Quit to menu"}
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => setConfirmLeave(false)}>
                  Stay
                </Button>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** Multi mode, mission select: who is in the room before the host picks the mission. */
function Lobby() {
  const state = useStore((s) => s.state);
  const meId = useStore((s) => s.meId);
  const [copied, copy] = useCopy(() => (state ? inviteUrl(state.room) : ""));
  if (!state || state.mode !== "multi" || state.phase !== "select") return null;
  const me = state.players.find((p) => p.id === meId);
  return (
    <div className="pointer-events-none absolute left-5 top-[7.5rem] z-20 w-64">
      <Panel className="space-y-3">
        <div>
          <div className="text-xs text-dim">Crew room</div>
          <div className="num text-xl text-white">{state.room}</div>
        </div>
        <ul className="space-y-1.5">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-go" : "bg-white/30"}`} />
              <span className={p.connected ? "text-white" : "text-white/40"}>{p.name}</span>
              {p.id === meId && <span className="text-xs text-dim">you</span>}
              {p.isHost && <span className="ml-auto rounded bg-amber/20 px-1.5 text-[11px] font-medium text-amber">Host</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 4 - state.players.length) }, (_, i) => (
            <li key={`e${i}`} className="flex items-center gap-2 text-sm text-white/30">
              <span className="h-2 w-2 rounded-full border border-white/20" />
              Waiting for a crew member
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="w-full" onClick={copy}>
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
        <p className="text-xs text-dim">{me?.isHost ? "You choose the mission. Everyone sees it live." : "The host is choosing the mission."}</p>
      </Panel>
    </div>
  );
}

function Connecting() {
  const state = useStore((s) => s.state);
  const conn = useStore((s) => s.connection);
  const router = useRouter();
  if (state) return null;
  const missing = conn === "missing";
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-black/70 backdrop-blur-sm">
      <Panel className="max-w-sm text-center">
        {missing ? (
          <>
            <div className="text-lg font-semibold">Room not found</div>
            <p className="mt-1 text-sm text-dim">Check the code with whoever invited you. Rooms close after two idle hours.</p>
            <Button className="mt-4" onClick={() => { disconnect(); router.push("/"); }}>Back to menu</Button>
          </>
        ) : (
          <>
            <div className="text-lg font-semibold">Connecting to mission control</div>
            <p className="mt-1 text-sm text-dim">{conn === "lost" ? "Connection lost. Retrying..." : "One moment..."}</p>
          </>
        )}
      </Panel>
    </div>
  );
}

export function GameShell() {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <TopBar onMenu={() => setMenu(true)} />
      <Toasts />
      <Lobby />
      <Connecting />
      {menu && <PauseMenu onClose={() => setMenu(false)} />}
    </div>
  );
}
