"""Rooms + WebSocket multiplayer. The server holds the one true GameState."""

from __future__ import annotations

import asyncio
import json
import secrets

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.game.state import apply, disconnect, new_state

router = APIRouter()

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class Room:
    def __init__(self, code: str, mode: str):
        self.state = new_state(code, mode)
        self.sockets: dict[str, WebSocket] = {}
        self.lock = asyncio.Lock()

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


class NewRoom(BaseModel):
    mode: str = "solo"


@router.post("/rooms")
def create_room(body: NewRoom) -> dict:
    code = "APOLLO-" + "".join(secrets.choice(ALPHABET) for _ in range(3))
    while code in rooms:
        code = "APOLLO-" + "".join(secrets.choice(ALPHABET) for _ in range(3))
    rooms[code] = Room(code, "multi" if body.mode == "multi" else "solo")
    return {"room": code}


@router.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    await ws.accept()
    room = rooms.get(code)
    if room is None:  # joining an unknown code creates it (handy for dev + server restarts)
        room = rooms[code] = Room(code, "multi")
    player_id: str | None = None
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            t = msg.get("type")
            if t == "join":
                player_id = str(msg.get("id", ""))[:16] or secrets.token_hex(4)
                msg["id"] = player_id
                room.sockets[player_id] = ws
            if player_id is None:
                await ws.send_text(json.dumps({"type": "error", "message": "Join first"}))
                continue
            if t == "emit":
                await room.broadcast({"type": "event", "kind": msg.get("kind"), "data": msg.get("data"), "from": player_id})
                continue
            if t == "pos":
                await room.broadcast({"type": "pos", "playerId": player_id, **{k: msg.get(k) for k in ("x", "y", "z", "rotY")}}, exclude=player_id)
                continue
            async with room.lock:
                result = apply(room.state, player_id, msg)
                if isinstance(result, str):
                    await ws.send_text(json.dumps({"type": "error", "message": result}))
                    continue
                room.state = result
            await room.broadcast({"type": "state", "state": room.state})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if player_id and room.sockets.get(player_id) is ws:
            room.sockets.pop(player_id, None)
            async with room.lock:
                room.state = disconnect(room.state, player_id)
            await room.broadcast({"type": "state", "state": room.state})
