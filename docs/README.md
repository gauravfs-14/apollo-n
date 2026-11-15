# Apollo N documentation

Apollo N is a browser game about flying a Moon mission. The frontend is Next.js with React Three Fiber in `web/`. The backend is FastAPI in `api/`. Contracts both sides share live in `shared/`.

| Document | What it covers |
|---|---|
| [Getting started](getting-started.md) | Installing, configuring and running the game locally |
| [Architecture](architecture.md) | How the pieces fit: routes, game state, phases, the shared canvas, quality tiers |
| [Gameplay](gameplay.md) | Every phase in order: what the player does, controls, scoring, difficulty |
| [Missions](missions.md) | The mission plan format, how plans are generated from the news, fallbacks and levels |
| [Multiplayer](multiplayer.md) | Rooms, the WebSocket protocol, roles, the reducer, reconnection |
| [API reference](api.md) | Every HTTP and WebSocket endpoint |
| [Science and data](science.md) | NASA datasets, the terrain frame, the landing-site score and the Monte Carlo landings |
| [Audio](audio.md) | Music, sound effects, voice lines and the radio chain |
| [Development](development.md) | Repo layout, conventions, test and QA scripts, performance, assets |
| [Known issues](known-issues.md) | Behaviour that differs from what the code or UI intends |

Screenshots and the gameplay preview used by the top-level README are in [`media/`](media/).
