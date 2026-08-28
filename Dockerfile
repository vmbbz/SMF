FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application
COPY server.py .
COPY arena_director.py .
COPY arena_telemetry.py .
COPY alchemy_stream.py .
COPY alchemy_pubsub.py .
COPY auth.py .
COPY birdeye_service.py .
COPY dexscreener_service.py .
COPY characters.py .
COPY competition.py .
COPY economy.py .
COPY elo.py .
COPY game_loop.py .
COPY matchmaking.py .
COPY room_cleanup.py .
COPY room_manager.py .
COPY signaling.py .
COPY game_engine/ game_engine/
COPY yellowstone_proto/ yellowstone_proto/
COPY vendor/yellowstone/v15.1.2/ vendor/yellowstone/v15.1.2/
COPY index.html wallet-connect.js manifest.json favicon.ico ./
COPY .well-known/ .well-known/
COPY src/ src/
COPY assets/ assets/
COPY public/ public/

EXPOSE 8080

CMD [".venv/bin/uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
