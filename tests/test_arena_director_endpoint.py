from __future__ import annotations

from unittest.mock import AsyncMock

from litestar.testing import TestClient

import server
from server import app


def test_arena_director_endpoint_selects_and_explains(monkeypatch) -> None:
    trending = [
        {
            "mint": "mint-live",
            "symbol": "LIVE",
            "volume24h": 1_500_000,
            "priceChange24h": 35,
            "liquidity": 180_000,
        }
    ]
    monkeypatch.setattr(server, "_fetch_market_trending", AsyncMock(return_value=trending))
    monkeypatch.setattr(server, "_fetch_market_graduates", AsyncMock(return_value=[]))

    with TestClient(app=app) as client:
        response = client.get("/api/arena/director/next?count=6")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "selected"
    assert payload["opponent"]["mint"] == "mint-live"
    assert payload["decisionId"].startswith("arena-")
    assert payload["providerErrors"] == []


def test_arena_director_endpoint_degrades_when_one_provider_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        server,
        "_fetch_market_trending",
        AsyncMock(side_effect=RuntimeError("provider unavailable")),
    )
    monkeypatch.setattr(
        server,
        "_fetch_market_graduates",
        AsyncMock(
            return_value=[
                {
                    "mint": "mint-grad",
                    "symbol": "GRAD",
                    "volume24h": 250_000,
                    "priceChange24h": 18,
                    "liquidity": 60_000,
                }
            ]
        ),
    )

    with TestClient(app=app) as client:
        response = client.get("/api/arena/director/next?current_mint=mint-old")

    assert response.status_code == 200
    payload = response.json()
    assert payload["opponent"]["mint"] == "mint-grad"
    assert payload["providerErrors"] == [
        {"provider": "birdeye_trending", "error": "RuntimeError"}
    ]
