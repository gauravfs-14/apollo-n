// Crew role balancing. Exact mirror of rebalance() in api/app/game/state.py. Keep the two in sync.
import { ROLES, type GameState, type Player, type Role } from "../types";

/** Roles this player holds (tolerates old states that only had a single `role`). */
export function rolesOf(p: Player | undefined): Role[] {
  if (!p) return [];
  return p.roles ?? (p.role ? [p.role] : []);
}

/** The connected holder of a role (falls back to a disconnected one so names still show). */
export function holderOf(players: Player[], role: Role): Player | undefined {
  return players.find((p) => rolesOf(p).includes(role) && p.connected) ?? players.find((p) => rolesOf(p).includes(role));
}

/** "Pilot + Engineer" */
export function rolesText(roles: Role[], label: Record<Role, string>): string {
  return roles.map((r) => label[r]).join(" + ");
}

/**
 * Deal the four roles evenly among the players in the room (in place).
 * In the room = not `released` (connected, or inside the 30 s reconnect grace).
 * Quota 4 / n each; the 4 % n extras go to whoever holds the most roles already (stable), then non-hosts, then later joiners.
 * Explicit picks stay, previously held roles stay up to the quota, the rest go to the biggest deficit.
 */
export function rebalance(st: GameState): void {
  for (const p of st.players) {
    if (p.released) {
      p.roles = [];
      delete p.picked;
      delete p.role;
    }
  }
  const active = st.players.filter((p) => !p.released);
  const n = active.length;
  if (n === 0) return;
  const owner = new Map<Role, number>();
  active.forEach((p, i) => {
    if (p.picked && ROLES.includes(p.picked) && !owner.has(p.picked)) owner.set(p.picked, i);
    else delete p.picked;
  });
  const prev = active.map((p) => ROLES.filter((r) => rolesOf(p).includes(r)));
  const base = Math.floor(ROLES.length / n);
  const extra = ROLES.length % n;
  const idx = active.map((_, i) => i);
  const byKeep = [...idx].sort((a, b) => prev[b].length - prev[a].length || Number(active[a].isHost) - Number(active[b].isHost) || b - a);
  const quota = idx.map((i) => base + (byKeep.slice(0, extra).includes(i) ? 1 : 0));
  active.forEach((p, i) => {
    if (p.picked) quota[i] = Math.max(quota[i], 1);
  });
  const held: Set<Role>[] = idx.map(() => new Set<Role>());
  for (const [r, i] of owner) held[i].add(r);
  for (const i of idx)
    for (const r of prev[i]) if (!owner.has(r) && held[i].size < quota[i] && !held.some((h) => h.has(r))) held[i].add(r);
  for (const r of ROLES) {
    if (held.some((h) => h.has(r))) continue;
    let best = 0;
    for (const k of idx) if (held[k].size - quota[k] < held[best].size - quota[best]) best = k;
    held[best].add(r);
  }
  active.forEach((p, i) => {
    p.roles = ROLES.filter((r) => held[i].has(r));
    p.role = p.picked ?? p.roles[0];
  });
}
