// Local mirror of api/app/game/state.py `apply()`. Used only when the server is
// unreachable in solo mode. Keep the two in sync.
import { PHASE_ORDER, type ClientMsg, type GameState } from "../types";

export function newState(room: string, mode: GameState["mode"]): GameState {
  return { room, mode, phase: "select", players: [], scores: {}, phaseData: {}, version: 0 };
}

export function apply(s: GameState, playerId: string, msg: ClientMsg): GameState | string {
  const st: GameState = structuredClone(s);
  const me = st.players.find((p) => p.id === playerId);

  switch (msg.type) {
    case "join": {
      if (me) {
        me.connected = true;
        me.name = msg.name || me.name;
      } else {
        if (st.mode === "solo" && st.players.length >= 1) {
          // A new tab/device takes over a solo game whose player has left.
          if (st.players[0].connected) return "Solo room is full";
          st.players[0] = { ...st.players[0], id: msg.id, name: msg.name, connected: true };
          break;
        }
        if (st.players.length >= 4) return "Room is full (4 astronauts max)";
        st.players.push({ id: msg.id, name: msg.name, connected: true, isHost: st.players.length === 0 });
      }
      break;
    }
    case "pick_role": {
      if (!me) return "Join first";
      if (msg.role && st.players.some((p) => p.id !== me.id && p.role === msg.role)) return "Role already taken";
      me.role = msg.role ?? undefined;
      break;
    }
    case "action": {
      if (!me) return "Join first";
      if (msg.phase !== st.phase) return `Not in phase ${msg.phase}`;
      const data = msg.data ?? {};
      if (msg.kind === "patch") {
        st.phaseData[st.phase] = { ...(st.phaseData[st.phase] ?? {}), ...data };
      } else if (msg.kind === "set_plan") {
        st.plan = data.plan as GameState["plan"];
      } else if (msg.kind === "complete") {
        st.scores[st.phase] = Math.max(0, Math.min(100, Number(data.score ?? 0)));
        const i = PHASE_ORDER.indexOf(st.phase);
        if (i < PHASE_ORDER.length - 1) st.phase = PHASE_ORDER[i + 1];
      } else if (msg.kind === "goto") {
        if (!me.isHost) return "Only the host can jump phases";
        const target = data.phase as GameState["phase"];
        if (!PHASE_ORDER.includes(target)) return "Unknown phase";
        st.phase = target;
      } else if (msg.kind === "reset") {
        if (!me.isHost) return "Only the host can reset";
        return { ...newState(st.room, st.mode), players: st.players, version: st.version + 1 };
      } else {
        return `Unknown action ${msg.kind}`;
      }
      break;
    }
    default:
      return s; // emit/pos don't change state
  }
  st.version += 1;
  return st;
}
