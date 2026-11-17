# Render deployment

This packages the latest game as one free Docker web service in Singapore.
Nginx serves Next.js at `/` and proxies `/api/` (including WebSockets) to one
Uvicorn worker. Everyone uses the same server and room state.

Deploy `render.yaml` as a Render Blueprint, or create a Docker web service using
the root Dockerfile. Set the health check to `/api/health`. Never scale beyond one
instance without moving the game's in-memory room state to shared storage.

The image excludes local `.env` files, cache files, and authentication data.
It defaults to bundled missions, template director commentary, and browser speech,
so it works without a paid LLM API. The Mac's Codex login is never uploaded.
Optional SerpAPI and ElevenLabs keys belong in Render environment secrets only.
To enable ElevenLabs set `VOICE_PROVIDER=elevenlabs` alongside its key. Live
AI-written missions additionally require `LLM_PROVIDER=openai` and an OpenAI API key.

Free instances sleep after 15 idle minutes and can take around one minute to wake.
Rooms and newly generated cache/media files are lost on sleep, restart, or deploy.
Create a new room after a restart and share its code. The public URL stays stable.

## Local container check

```sh
docker build -t apollo-n .
docker run --rm -p 10000:10000 --memory=512m apollo-n
```

Open `http://localhost:10000`, create a multiplayer room, and join it from a second
browser. Health: `http://localhost:10000/api/health`.
