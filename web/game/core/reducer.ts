// Local mirror of api/app/game/state.py `apply()`. Used only when the server is
// unreachable in solo mode. Keep the two in sync.
import { PHASE_ORDER, ROLES, type ClientMsg, type GameState } from "../types";
import { rebalance } from "./roles";

/** Names are trimmed, capped at 24 chars and never empty (mirrors state.py clean_name). */
export function cleanName(raw: unknown, fallback = "Astronaut"): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, 24) : "";
  return name || fallback;
}

/** 0..100, NaN/garbage -> 0 (mirrors state.py clean_score). */
export function cleanScore(raw: unknown): number {
  const v = Number(raw ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

export function newState(room: string, mode: GameState["mode"]): GameState {
  return { room, mode, phase: "select", players: [], scores: {}, phaseData: {}, hp: 100, failed: null, version: 0 };
}

export function apply(s: GameState, playerId: string, msg: ClientMsg): GameState | string {
  const st: GameState = structuredClone(s);
  const me = st.players.find((p) => p.id === playerId);

  switch (msg.type) {
    case "join": {
      if (me) {
        me.connected = true;
        delete me.released;
        me.name = cleanName(msg.name, me.name);
      } else {
        if (st.mode === "solo" && st.players.length >= 1) {
          // A new tab/device takes over a solo game whose player has left.
          if (st.players[0].connected) return "Solo room is full";
          st.players[0] = { ...st.players[0], id: msg.id, name: cleanName(msg.name), connected: true };
          rebalance(st);
          break;
        }
        if (st.players.length >= 4) return "Room is full (4 astronauts max)";
        st.players.push({ id: msg.id, name: cleanName(msg.name), connected: true, isHost: st.players.length === 0, roles: [] });
      }
      // Never leave a room without a connected host: the (re)joining player takes over.
      if (!st.players.some((p) => p.isHost && p.connected)) for (const p of st.players) p.isHost = p.id === msg.id;
      rebalance(st);
      break;
    }
    case "pick_role": {
      if (!me) return "Join first";
      if (msg.role && !ROLES.includes(msg.role)) return "Unknown role";
      // only another player's explicit pick blocks it; automatically dealt roles move
      if (msg.role && st.players.some((p) => p.id !== me.id && !p.released && p.picked === msg.role)) return "Role already taken";
      if (msg.role) me.picked = msg.role;
      else delete me.picked;
      rebalance(st);
      break;
    }
    case "action": {
      if (!me) return "Join first";
      if (msg.phase !== st.phase) return `Not in phase ${msg.phase}`;
      const raw = msg.data as unknown;
      const data = (!raw || (Array.isArray(raw) && raw.length === 0) ? {} : raw) as Record<string, unknown>;
      if (typeof data !== "object" || Array.isArray(data)) return "Bad action data";
      if (msg.kind === "patch") {
        st.phaseData[st.phase] = { ...(st.phaseData[st.phase] ?? {}), ...data };
      } else if (msg.kind === "set_plan") {
        st.plan = data.plan as GameState["plan"];
      } else if (msg.kind === "complete") {
        st.scores[st.phase] = cleanScore(data.score);
        const i = PHASE_ORDER.indexOf(st.phase);
        if (i < PHASE_ORDER.length - 1) st.phase = PHASE_ORDER[i + 1];
      } else if (msg.kind === "damage") {
        // ship integrity: at 0 the mission fails and everyone goes to the report
        if (st.failed) return s;
        const amount = Math.max(0, Math.min(100, Number(data.amount) || 0));
        st.hp = Math.max(0, (st.hp ?? 100) - amount);
        if (st.hp <= 0) {
          st.failed = String(data.reason ?? "The ship was lost.").slice(0, 160);
          st.phase = "report";
        }
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
