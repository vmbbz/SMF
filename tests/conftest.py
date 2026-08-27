from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def isolate_deployed_lifespan_services(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never let unit tests inherit deployed Redis/Postgres credentials."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
