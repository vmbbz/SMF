from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def isolate_deployed_lifespan_services(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never let unit tests inherit deployed Redis/Postgres credentials."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for name in (
        "ALCHEMY_STREAM_ENABLED",
        "ALCHEMY_API_KEY",
        "ALCHEMY_STREAM_TRANSPORT",
        "ALCHEMY_YELLOWSTONE_ENDPOINT",
        "ALCHEMY_SOLANA_WS_ENDPOINT",
        "ALCHEMY_SOLANA_HTTP_ENDPOINT",
        "ALCHEMY_STREAM_FRESHNESS_SECONDS",
        "ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS",
        "ALCHEMY_STREAM_MAX_CANDIDATES",
        "ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS",
        "ALCHEMY_STREAM_REWIND_SLOTS",
        "ALCHEMY_STREAM_MAX_REPLAY_SLOTS",
        "ALCHEMY_STREAM_BACKFILL_MAX_SLOTS",
        "ALCHEMY_STREAM_BACKFILL_LIMIT_PER_CANDIDATE",
        "ALCHEMY_STREAM_BACKFILL_MIN_INTERVAL_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
