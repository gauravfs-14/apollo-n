"use client";
// Multiplayer flight sync. The player who flies (actsAs "pilot") runs the physics and broadcasts the flight state at ~10 Hz;
// everyone else renders it. Crew commands (staging by the commander, "autoland" by the host) go the other way as one-off events.
import { useEffect, useRef } from "react";
import { onServerEvent, useStore } from "../core/store";
import { useGame } from "../core/useGame";

export const FLIGHT_HZ = 10;

/** Does this room have other players to talk to? (solo rooms do not need the traffic) */
const shared = () => useStore.getState().state?.mode === "multi";

/**
 * `acting`: this client runs the simulation. `snapshot()` is called ~10x/s while acting; `onRemote` receives the pilot's
 * snapshots on the other clients, `onCmd` receives crew commands on the acting client. Returns `sendCmd`.
 */
export function useFlightSync<S, C = { k: string }>(
  kind: string,
  acting: boolean,
  snapshot: () => S,
  onRemote: (s: S, at: number) => void,
  onCmd: (c: C) => void,
) {
  const { emit } = useGame();
  const snap = useRef(snapshot);
  const rem = useRef(onRemote);
  const cmd = useRef(onCmd);
  const act = useRef(acting);
  useEffect(() => {
    snap.current = snapshot;
    rem.current = onRemote;
    cmd.current = onCmd;
    act.current = acting;
  });
  useEffect(() => {
    const me = useStore.getState().meId;
    const off = onServerEvent((m) => {
      if (m.type !== "event" || m.from === me) return;
      if (m.kind === `${kind}:state` && !act.current) rem.current(m.data as S, performance.now());
      else if (m.kind === `${kind}:cmd` && act.current) cmd.current(m.data as C);
    });
    const iv = setInterval(() => {
      if (act.current && shared()) emit(`${kind}:state`, snap.current() as unknown as Record<string, unknown>);
    }, 1000 / FLIGHT_HZ);
    return () => {
      off();
      clearInterval(iv);
    };
  }, [kind, emit]);
  return {
    /** Send a crew command to the pilot's client (or run it here when this client flies). */
    sendCmd: (c: C) => {
      if (act.current) cmd.current(c);
      else emit(`${kind}:cmd`, c as unknown as Record<string, unknown>);
    },
  };
}
