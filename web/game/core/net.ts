"use client";
// Transport: WebSocket to the authoritative server; falls back to a local
// in-browser reducer for solo play if the server can't be reached.
import type { ClientMsg, GameState, ServerMsg } from "../types";
import { WS_BASE } from "./api";
import { apply, newState } from "./reducer";
import { emitLocal, useStore } from "./store";

let ws: WebSocket | null = null;
let local: GameState | null = null;
let retry = 0;
let closedByUs = false;
let current: { room: string; mode: GameState["mode"]; name: string } | null = null;

function handle(msg: ServerMsg) {
  const st = useStore.getState();
  if (msg.type === "state") st.setState(msg.state);
  else if (msg.type === "error") st.setError(msg.message);
  else emitLocal(msg);
}

export function connect(room: string, mode: GameState["mode"], name: string) {
  current = { room, mode, name };
  closedByUs = false;
  const { setConnection, meId } = useStore.getState();
  setConnection("connecting");

  try {
    ws = new WebSocket(`${WS_BASE}/ws/rooms/${room}?mode=${mode}`);
  } catch {
    return goLocal();
  }
  const sock = ws;
  let opened = false;
  const timeout = setTimeout(() => !opened && sock.close(), 3000);

  sock.onopen = () => {
    opened = true;
    retry = 0;
    clearTimeout(timeout);
    setConnection("online");
    sock.send(JSON.stringify({ type: "join", id: meId, name } satisfies ClientMsg));
  };
  sock.onmessage = (e) => handle(JSON.parse(e.data) as ServerMsg);
  sock.onclose = () => {
    clearTimeout(timeout);
    if (closedByUs || ws !== sock) return;
    if (!opened && mode === "solo") return goLocal();
    setConnection("lost");
    const delay = Math.min(8000, 500 * 2 ** retry++);
    setTimeout(() => current && !closedByUs && connect(current.room, current.mode, current.name), delay);
  };
}

function goLocal() {
  const { meId, setConnection } = useStore.getState();
  ws = null;
  local = newState(current!.room, "solo");
  setConnection("local");
  send({ type: "join", id: meId, name: current!.name });
}

export function send(msg: ClientMsg) {
  const st = useStore.getState();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  if (local) {
    if (msg.type === "emit") return emitLocal({ type: "event", kind: msg.kind, data: msg.data, from: st.meId });
    if (msg.type === "pos") return;
    const next = apply(local, st.meId, msg);
    if (typeof next === "string") return st.setError(next);
    local = next;
    st.setState(next);
  }
}

export function disconnect() {
  closedByUs = true;
  ws?.close();
  ws = null;
  local = null;
  current = null;
  useStore.getState().setConnection("idle");
}
