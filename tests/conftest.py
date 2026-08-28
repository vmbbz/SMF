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
        "ALCHEMY_YELLOWSTONE_ENDPOINT",
        "ALCHEMY_STREAM_FRESHNESS_SECONDS",
        "ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS",
        "ALCHEMY_STREAM_MAX_CANDIDATES",
        "ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS",
        "ALCHEMY_STREAM_REWIND_SLOTS",
        "ALCHEMY_STREAM_MAX_REPLAY_SLOTS",
    ):
        monkeypatch.delenv(name, raising=False)
