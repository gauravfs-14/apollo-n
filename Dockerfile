# Build the browser app without copying local environment files or credentials.
FROM node:24-bookworm-slim AS web-build
WORKDIR /app/web
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
COPY shared/ /app/shared/
ENV NEXT_PUBLIC_API_URL=/api NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS api-build
WORKDIR /app/api
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-editable

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends nginx libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 astronaut
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY --from=api-build /app/api/.venv /app/api/.venv
COPY --from=web-build /app/web/.next/standalone /app/web/
COPY --from=web-build /app/web/.next/static /app/web/.next/static/
COPY --from=web-build /app/web/public /app/web/public/
COPY api/app/ /app/api/app/
COPY api/data/ /app/api/data/
COPY shared/ /app/shared/
COPY deploy/ /app/deploy/
RUN chown -R astronaut:astronaut /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 PORT=10000 LLM_PROVIDER=disabled VOICE_PROVIDER=system \
    PUBLIC_API_URL=/api OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER astronaut
WORKDIR /app
EXPOSE 10000
CMD ["python", "/app/deploy/start.py"]
