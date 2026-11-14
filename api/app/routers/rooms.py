"""Rooms + WebSocket multiplayer. The server holds the one true GameState.

Hardening (see api/tests/test_state.py for the reducer rules):
- reconnect with the same player id keeps the same player (and gets a lost role back if it is still free)
- host migration when the host drops; the (re)joining player becomes host if nobody connected is
- a player gone for more than ROLE_TIMEOUT seconds loses the role (unclaimed -> the host plays it via actsAs)
- rooms idle for ROOM_TTL seconds with nobody connected are deleted by a janitor task
- messages: size cap, per-socket token bucket, malformed JSON tolerated, unknown multiplayer rooms rejected (4404)
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.game.state import apply, disconnect, new_state, release_role

router = APIRouter()

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROLE_TIMEOUT = 30.0  # seconds disconnected before the role is released
ROOM_TTL = 2 * 3600.0  # idle seconds (nobody connected) before a room is deleted
MAX_MSG_BYTES = 256 * 1024  # a mission plan is ~20 KB; this is generous
MAX_ROOMS = 500
RATE_PER_SEC = 40.0
RATE_BURST = 80.0
JANITOR_EVERY = 5.0


class Bucket:
    """Token bucket: `rate` messages/second sustained, `burst` at once."""

    def __init__(self, rate: float = RATE_PER_SEC, burst: float = RATE_BURST):
        self.rate, self.burst = rate, burst
        self.tokens = burst
        self.t = time.monotonic()

    def allow(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        self.tokens = min(self.burst, self.tokens + (now - self.t) * self.rate)
        self.t = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class Room:
    def __init__(self, code: str, mode: str):
        self.state = new_state(code, mode)
        self.sockets: dict[str, WebSocket] = {}
        self.lock = asyncio.Lock()
        self.last_active = time.monotonic()
        self.disconnected_at: dict[str, float] = {}  # player id -> monotonic time they dropped
        self.lost_roles: dict[str, str] = {}  # player id -> role released after a timeout

    def touch(self) -> None:
        self.last_active = time.monotonic()

    async def broadcast(self, msg: dict, exclude: str | None = None) -> None:
        data = json.dumps(msg)
        for pid, ws in list(self.sockets.items()):
            if pid == exclude:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                self.sockets.pop(pid, None)


rooms: dict[str, Room] = {}


def sweep_room(room: Room, now: float) -> bool:
    """Release roles of players gone longer than ROLE_TIMEOUT. Returns True if the state changed."""
    changed = False
    for pid, since in list(room.disconnected_at.items()):
        p = next((p for p in room.state["players"] if p["id"] == pid), None)
        if p is None or p["connected"]:
            room.disconnected_at.pop(pid, None)
        elif now - since >= ROLE_TIMEOUT and p.get("role"):
            room.lost_roles[pid] = p["role"]
            room.state = release_role(room.state, pid)
            changed = True
    return changed


def expired(room: Room, now: float) -> bool:
    return not room.sockets and now - room.last_active >= ROOM_TTL


async def janitor() -> None:
    while True:
        await asyncio.sleep(JANITOR_EVERY)
        now = time.monotonic()
        for code, room in list(rooms.items()):
            if expired(room, now):
                rooms.pop(code, None)
                continue
            async with room.lock:
                changed = sweep_room(room, now)
            if changed:
                await room.broadcast({"type": "state", "state": room.state})


_janitor_task: asyncio.Task | None = None


def ensure_janitor() -> None:
    global _janitor_task
    if _janitor_task is None or _janitor_task.done():
        _janitor_task = asyncio.get_running_loop().create_task(janitor())


class NewRoom(BaseModel):
    mode: str = "solo"


def _new_code() -> str:
    code = "APOLLO-" + "".join(secrets.choice(ALPHABET) for _ in range(3))
    while code in rooms:
        code = "APOLLO-" + "".join(secrets.choice(ALPHABET) for _ in range(3))
    return code


@router.post("/rooms")
async def create_room(body: NewRoom) -> dict:
    ensure_janitor()
    if len(rooms) >= MAX_ROOMS:
        # drop the oldest empty room rather than refusing a new game
        empties = sorted((r for r in rooms.values() if not r.sockets), key=lambda r: r.last_active)
        if not empties:
            from fastapi import HTTPException

            raise HTTPException(503, "Server is full, try again in a few minutes")
        rooms.pop(empties[0].state["room"], None)
    code = _new_code()
    rooms[code] = Room(code, "multi" if body.mode == "multi" else "solo")
    return {"room": code}


@router.get("/rooms/{code}")
def room_exists(code: str) -> dict:
    room = rooms.get(code)
    return {"exists": room is not None, "players": len(room.state["players"]) if room else 0}


async def _err(ws: WebSocket, message: str) -> None:
    try:
        await ws.send_text(json.dumps({"type": "error", "message": message}))
    except Exception:
        pass


@router.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    await ws.accept()
    ensure_janitor()
    code = code[:32]
    room = rooms.get(code)
    solo_q = ws.query_params.get("mode") == "solo"
    player_id: str | None = None
    bucket = Bucket()
    strikes = 0
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MSG_BYTES:
                await _err(ws, "Message too large")
                await ws.close(1009)
                return
            if not bucket.allow():
                strikes += 1
                if strikes in (1, 25):
                    await _err(ws, "Slow down: too many messages")
                if strikes > 200:
                    await ws.close(1008)
                    return
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                await _err(ws, "Bad message")
                continue
            if not isinstance(msg, dict):
                continue
            t = msg.get("type")

            if t == "join":
                if room is None:
                    # Unknown room: solo (dev, offline restarts) and rejoins after a server restart recreate it;
                    # a stranger typing a wrong multiplayer code gets "not found".
                    if solo_q or msg.get("rejoin"):
                        if len(rooms) >= MAX_ROOMS:
                            await _err(ws, "Server is full")
                            await ws.close(1013)
                            return
                        room = rooms[code] = Room(code, "solo" if solo_q else "multi")
                    else:
                        await _err(ws, "Room not found")
                        await ws.close(4404)
                        return
                raw_id = msg.get("id")
                player_id = (str(raw_id)[:16] if raw_id else "") or secrets.token_hex(4)
                msg["id"] = player_id
                old = room.sockets.get(player_id)
                if old is not None and old is not ws:  # same player opened a second tab: newest wins
                    try:
                        await old.close(4000)
                    except Exception:
                        pass
                room.sockets[player_id] = ws
                room.disconnected_at.pop(player_id, None)
            if room is None or player_id is None:
                await _err(ws, "Join first")
                continue
            room.touch()

            if t == "emit":
                await room.broadcast({"type": "event", "kind": msg.get("kind"), "data": msg.get("data"), "from": player_id})
                continue
            if t == "pos":
                await room.broadcast({"type": "pos", "playerId": player_id, **{k: msg.get(k) for k in ("x", "y", "z", "rotY")}}, exclude=player_id)
                continue
            async with room.lock:
                result = apply(room.state, player_id, msg)
                if isinstance(result, str):
                    if t == "join":
                        room.sockets.pop(player_id, None)
                    await _err(ws, result)
                    if t == "join":
                        await ws.close(4403)
                        return
                    continue
                room.state = result
                if t == "join":
                    # reconnecting within/after the timeout: give a released role back if it is still free
                    role = room.lost_roles.pop(player_id, None)
                    if role:
                        again = apply(room.state, player_id, {"type": "pick_role", "role": role})
                        if not isinstance(again, str):
                            room.state = again
            await room.broadcast({"type": "state", "state": room.state})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if room is not None and player_id and room.sockets.get(player_id) is ws:
            room.sockets.pop(player_id, None)
            room.touch()
            room.disconnected_at[player_id] = time.monotonic()
            async with room.lock:
                room.state = disconnect(room.state, player_id)
            await room.broadcast({"type": "state", "state": room.state})
