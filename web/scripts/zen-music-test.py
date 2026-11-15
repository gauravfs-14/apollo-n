"""Drive Zen (Firefox engine) over WebDriver BiDi to check that stage music starts after a click.
Uses a throwaway profile with Firefox's default autoplay blocking, muted (media.volume_scale 0). Run from api/: uv run python ../web/scripts/zen-music-test.py"""
import asyncio, itertools, json, os, shutil, subprocess, tempfile, time
import websockets

ZEN = os.environ.get("ZEN", "/Applications/Zen.app/Contents/MacOS/zen")
BASE = os.environ.get("WEB_URL", "http://localhost:3000")
ids = itertools.count(1)

async def cmd(ws, method, params):
    i = next(ids)
    await ws.send(json.dumps({"id": i, "method": method, "params": params}))
    while True:
        m = json.loads(await ws.recv())
        if m.get("id") == i:
            if m.get("type") == "error":
                raise RuntimeError(m)
            return m["result"]

async def main():
    prof = tempfile.mkdtemp(prefix="zen-apollo-")
    open(os.path.join(prof, "user.js"), "w").write('user_pref("media.autoplay.default", 1);\nuser_pref("media.autoplay.blocking_policy", 0);\nuser_pref("media.volume_scale", "0.0");\n')
    proc = subprocess.Popen([ZEN, "--headless", "--no-remote", "--profile", prof, "--remote-debugging-port", "9333"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                ws = await websockets.connect("ws://127.0.0.1:9333/session", max_size=None)
                break
            except OSError:
                await asyncio.sleep(0.5)
        await cmd(ws, "session.new", {"capabilities": {}})
        tree = await cmd(ws, "browsingContext.getTree", {})
        ctx = tree["contexts"][0]["context"]
        await cmd(ws, "browsingContext.setViewport", {"context": ctx, "viewport": {"width": 1280, "height": 800}})

        async def ev(expr):
            r = await cmd(ws, "script.evaluate", {"expression": expr, "target": {"context": ctx}, "awaitPromise": True, "serializationOptions": {"maxObjectDepth": 2}})
            return r.get("result")

        async def music():
            r = await ev("JSON.stringify(window.__music ? window.__music() : 'no hook')")
            return r.get("value")

        async def click(x, y):
            await cmd(ws, "input.performActions", {"context": ctx, "actions": [{"type": "pointer", "id": "m", "actions": [
                {"type": "pointerMove", "x": x, "y": y}, {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]}]})

        async def go(url, wait=2.0):
            await cmd(ws, "browsingContext.navigate", {"context": ctx, "url": url, "wait": "complete"})
            await asyncio.sleep(wait)

        # count AudioContexts each page opens (each one is an extra output stream)
        await cmd(ws, "script.addPreloadScript", {"functionDeclaration": "() => { window.__ctxCount = 0; const C = window.AudioContext; window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ctxCount++; } }; }"})
        await go(BASE + "/", 3)
        print("menu before click:", await music())
        t0 = time.monotonic()
        await click(1200, 120)
        seen = {}
        while time.monotonic() - t0 < 8:
            m = json.loads(await music() or "null") or {}
            t = round(time.monotonic() - t0, 2)
            if m.get("playing") and "playing" not in seen:
                seen["playing"] = t
            if m.get("t", 0) > 0 and "position>0" not in seen:
                seen["position>0"] = t
            if m.get("gain", 0) > 0.05 and "audible" not in seen:
                seen["audible"] = t
            await asyncio.sleep(0.05)
        print("menu after click:", await music(), "timeline (s after click):", seen)
        print("AudioContexts opened on the menu page:", (await ev("window.__ctxCount"))["value"])
        for phase in ["build", "surface", "report"]:
            await go(f"{BASE}/play/ZEN-{phase.upper()}{int(time.time()) % 1000}?mode=solo&phase={phase}", 3)
            before = await music()
            await click(640, 300)
            await asyncio.sleep(3)
            print(f"{phase}: before click {before} -> after {await music()}; AudioContexts: {(await ev('window.__ctxCount'))['value']}")
        await ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(prof, ignore_errors=True)

asyncio.run(main())
