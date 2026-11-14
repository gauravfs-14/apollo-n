"""Two-client multiplayer smoke test against a running API.  uv run python tests/ws_smoke.py [http://localhost:8000]"""

import asyncio
import json
import sys
import urllib.request

import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
WS = BASE.replace("http", "ws")


def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req))


async def recv_until(ws, pred, timeout=3):
    async def go():
        while True:
            m = json.loads(await ws.recv())
            if pred(m):
                return m
    return await asyncio.wait_for(go(), timeout)


def state_with(pred):
    return lambda m: m["type"] == "state" and pred(m["state"])


async def main():
    code = post("/rooms", {"mode": "multi"})["room"]
    url = f"{WS}/ws/rooms/{code}?mode=multi"

    # unknown multiplayer room is rejected
    async with websockets.connect(f"{WS}/ws/rooms/APOLLO-ZZZ?mode=multi") as bad:
        await bad.send(json.dumps({"type": "join", "id": "x", "name": "X"}))
        err = await recv_until(bad, lambda m: m["type"] == "error")
        assert err["message"] == "Room not found", err
        try:
            await bad.recv()
        except websockets.ConnectionClosed as e:
            assert e.rcvd.code == 4404, e.rcvd.code
    print("ok unknown room -> 4404")

    a = await websockets.connect(url)
    await a.send(json.dumps({"type": "join", "id": "aaaa", "name": "Ann"}))
    s = (await recv_until(a, state_with(lambda s: len(s["players"]) == 1)))["state"]
    assert s["players"][0]["isHost"]

    b = await websockets.connect(url)
    await b.send(json.dumps({"type": "join", "id": "bbbb", "name": "Bob"}))
    s = (await recv_until(b, state_with(lambda s: len(s["players"]) == 2)))["state"]
    print("ok two players joined, host =", [p["name"] for p in s["players"] if p["isHost"]])

    await b.send(json.dumps({"type": "pick_role", "role": "pilot"}))
    await recv_until(a, state_with(lambda s: any(p.get("role") == "pilot" for p in s["players"])))
    await a.send(json.dumps({"type": "pick_role", "role": "pilot"}))
    err = await recv_until(a, lambda m: m["type"] == "error")
    assert err["message"] == "Role already taken"
    print("ok live role pick + conflict")

    await a.send(json.dumps({"type": "emit", "kind": "hurdle_progress", "data": {"p": 0.5}}))
    ev = await recv_until(b, lambda m: m["type"] == "event")
    assert ev["data"] == {"p": 0.5} and ev["from"] == "aaaa"
    print("ok emit relayed")

    # garbage tolerated
    await a.send("not json")
    await a.send(json.dumps([1, 2, 3]))
    await a.send(json.dumps({"type": "action", "phase": "select", "kind": "patch", "data": [1]}))
    err = await recv_until(a, lambda m: m["type"] == "error" and m["message"] == "Bad action data")
    print("ok garbage tolerated")

    # host drops -> migration; same id returns -> same player, not host
    await a.close()
    s = (await recv_until(b, state_with(lambda s: not s["players"][0]["connected"])))["state"]
    assert s["players"][1]["isHost"], s["players"]
    a = await websockets.connect(url)
    await a.send(json.dumps({"type": "join", "id": "aaaa", "name": "Ann"}))
    s = (await recv_until(a, state_with(lambda s: all(p["connected"] for p in s["players"]))))["state"]
    assert len(s["players"]) == 2 and not s["players"][0]["isHost"] and s["players"][1]["isHost"]
    print("ok reconnect keeps player id, host migrated")

    # flood -> rate limited, server survives
    for _ in range(300):
        await a.send(json.dumps({"type": "emit", "kind": "spam"}))
    await recv_until(a, lambda m: m["type"] == "error" and "Slow down" in m["message"], timeout=5)
    print("ok flood rate-limited")

    # oversized message closes the socket
    c = await websockets.connect(url)
    await c.send(json.dumps({"type": "join", "id": "cccc", "name": "Cy"}))
    await c.send("x" * (300 * 1024))
    try:
        while True:
            await asyncio.wait_for(c.recv(), 3)
    except websockets.ConnectionClosed as e:
        assert e.rcvd.code == 1009, e.rcvd.code
    print("ok oversized message -> 1009")
    await a.close()
    await b.close()
    print("ALL OK")


asyncio.run(main())
