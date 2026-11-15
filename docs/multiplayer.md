# Multiplayer

Up to four players share one mission. The server holds the state and broadcasts it; clients send actions. Solo games use the same protocol, or run the reducer locally when there is no server.

## Rooms

- `POST /rooms {mode: "multi"}` creates a room and returns its code, `APOLLO-` plus three characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Players join at `/play/APOLLO-XXX?mode=multi`. The menu's join box normalizes what people type.
- A room is deleted after 2 hours with nobody connected. The server holds at most 500 rooms; when full it evicts the oldest empty one, or refuses with 503.
- Rooms live in memory and are lost when the API restarts. A rejoining client (`rejoin: true`) or a solo client recreates an unknown room empty; a fresh multiplayer join to an unknown room is closed with code 4404.

Code: `api/app/routers/rooms.py`.

## WebSocket protocol

Connect to `/ws/rooms/{code}?mode=solo|multi` and send `join` first. Nothing else is processed until then.

**Client to server**

| Message | Effect |
|---|---|
| `{type: "join", id, name, rejoin?}` | Join or reconnect. `id` is the stable player id (max 16 chars) |
| `{type: "pick_role", role}` | Claim a role, or `null` to drop the claim |
| `{type: "action", phase, kind, data}` | Run a reducer action (below) |
| `{type: "emit", kind, data}` | Relay a transient event to everyone, sender included |
| `{type: "pos", x, y, z, rotY}` | Relay a position to everyone else (surface walking) |

**Server to client**

| Message | When |
|---|---|
| `{type: "state", state}` | After every reducer message |
| `{type: "event", kind, data, from}` | Relayed `emit` |
| `{type: "pos", playerId, x, y, z, rotY}` | Relayed `pos` |
| `{type: "error", message}` | A rejected message |

**Limits.** Messages over 256 KB close the socket (1009). Each socket gets 40 messages a second with bursts of 80; extra messages are dropped and repeated abuse closes the socket (1008). A second socket with the same player id closes the first (4000). A rejected join closes with 4403.

## The reducer

`api/app/game/state.py` and `web/game/core/reducer.ts` implement the same rules and must stay identical. The client copy runs solo games offline. Every successful change increments `state.version`.

| Message / action | Rules |
|---|---|
| `join` | Up to 4 players. The first player is host; if no host is connected, the joiner becomes host. In a solo room a new id may take over the player only if that player is disconnected. Names are trimmed to 24 characters |
| `pick_role` | A role is blocked only by another player's explicit pick |
| `patch` | Shallow-merge `data` into `phaseData[phase]` |
| `set_plan` | Set the mission plan |
| `complete` | Store `data.score` (clamped 0-100) for the phase and advance. On `report` it only stores the score |
| `damage` | Reduce `hp` by `data.amount`. At 0, set `failed` and jump to `report`. Ignored once failed |
| `goto` | Host only. Jump to any phase |
| `reset` | Host only. Fresh state with the same players |

An action whose `phase` is not the current phase is rejected with `Not in phase X`, which stops late messages from a previous phase from leaking into the next.

The server also handles connection loss, which the client reducer does not need:

- On disconnect the player is marked disconnected, and host passes to the first connected player.
- After 30 seconds disconnected, the player's roles are released and dealt to the others. Their explicit pick is remembered and given back on reconnect if still free.

## Roles

`rebalance` (`web/game/core/roles.ts`, mirrored in `state.py`) deals the four roles among active players:

- Each player gets 4 / n roles (rounded down). Leftovers go first to players who already hold the most, then to non-hosts, then to later joiners.
- Explicit picks are always kept. Other roles stay where they were when possible.

So two players hold two roles each, three players split 2-1-1, four players one each.

`actsAs(role)` decides who may act:

- Solo: always true.
- Multiplayer: true if this player holds the role, or if this player is host and nobody connected holds it.

## Shared work patterns

- **Role-gated actions.** The role holder acts; everyone else sees progress through `phaseData` or `emit` events.
- **Live streams.** The cruise hurdle player emits its state about every 90 ms; the pilot's client broadcasts the landing at 10 Hz (`web/game/flight/sync.ts`). Watchers interpolate.
- **Skip votes.** `useSkipVote` in `web/game/core/skip.tsx` writes a request into `phaseData` and one vote per player. The skip happens when every connected player agrees within 10 seconds.
- **Host fallbacks.** Where a phase waits on one player, the host gets a skip or continue button after a timeout.

## Testing

```bash
cd api && uv run python tests/test_state.py      # reducer and room rules
cd api && uv run python tests/ws_smoke.py         # two WebSocket clients against a running API
cd web && node scripts/e2e-multi.mjs              # two browsers through the real UI
```
