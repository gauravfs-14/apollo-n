"""Run one authoritative game API, the website, and their public reverse proxy."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    port = int(os.environ.get("PORT", "10000"))
    if not 1024 <= port <= 65535:
        raise ValueError("PORT must be between 1024 and 65535")
    config = Path("/app/deploy/nginx.conf").read_text().replace("@PORT@", str(port))
    Path("/tmp/apollo-nginx.conf").write_text(config)
    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    code = 0
    try:
        children.append(subprocess.Popen([
            "/app/api/.venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1",
            "--port", "8000", "--workers", "1", "--proxy-headers",
            "--forwarded-allow-ips", "127.0.0.1",
        ], cwd="/app/api"))
        children.append(subprocess.Popen(["node", "server.js"], cwd="/app/web", env={
            **os.environ, "PORT": "3000", "HOSTNAME": "127.0.0.1",
        }))
        children.append(subprocess.Popen([
            "nginx", "-c", "/tmp/apollo-nginx.conf", "-g", "daemon off;",
        ]))
        while not stopping:
            exited = next((p for p in children if p.poll() is not None), None)
            if exited is not None:
                code = exited.returncode or 1
                print(f"Game service exited ({code}); restarting the whole instance", flush=True)
                break
            time.sleep(0.5)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 10
        for child in children:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    return code


if __name__ == "__main__":
    sys.exit(main())
