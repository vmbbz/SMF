from __future__ import annotations

import time
from unittest.mock import AsyncMock

import pytest
from litestar.testing import TestClient

import server
from server import app


@pytest.fixture(autouse=True)
def disable_external_lifespan_services(monkeypatch: pytest.MonkeyPatch):
    """Endpoint tests must never inherit deployed Redis/Postgres credentials."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ALCHEMY_STREAM_ENABLED", raising=False)
    monkeypatch.delenv("ALCHEMY_API_KEY", raising=False)
    monkeypatch.delenv("ALCHEMY_STREAM_TRANSPORT", raising=False)


@pytest.mark.asyncio
async def test_cached_discovery_reports_original_snapshot_age(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot_at = time.time() - 12
    monkeypatch.setattr(
        server.birdeye_service,
        "list_cache",
        {"trending": ([{"mint": "cached-mint"}], snapshot_at)},
    )
    monkeypatch.setattr(
        server.birdeye_service,
        "list_provenance",
        {"trending": {"state": "birdeye_fetch", "snapshotTimestamp": snapshot_at}},
    )

    tokens = await server.birdeye_service.fetch_trending_tokens(1)
    provenance = server.birdeye_service.get_list_provenance("trending")

    assert tokens == [{"mint": "cached-mint"}]
    assert provenance["state"] == "cached_snapshot"
    assert provenance["freshness"] == "fresh"
    assert provenance["ageSeconds"] >= 12


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
    assert payload["telemetry"]["recorded"] is True
    assert payload["telemetry"]["persistence"] == "process_memory"
    assert [snapshot["channel"] for snapshot in payload["providerSnapshots"]] == [
        "trending",
        "graduated",
        "solana_http_candidate_activity",
    ]
    assert payload["providerSnapshots"][2]["state"] == "disabled"


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
    assert payload["marketDataState"] in {"degraded", "unverified"}


def test_arena_status_counts_director_responses_without_calling_them_fights(monkeypatch) -> None:
    monkeypatch.setattr(
        server,
        "_fetch_market_trending",
        AsyncMock(
            return_value=[
                {
                    "mint": "mint-status",
                    "symbol": "STATUS",
                    "volume24h": 300_000,
                    "priceChange24h": 20,
                    "liquidity": 70_000,
                }
            ]
        ),
    )
    monkeypatch.setattr(server, "_fetch_market_graduates", AsyncMock(return_value=[]))

    with TestClient(app=app) as client:
        decision_response = client.get("/api/arena/director/next")
        status_response = client.get("/api/arena/status")

    assert decision_response.status_code == 200
    assert status_response.status_code == 200
    status = status_response.json()
    assert status["schemaVersion"] == "2026-08-28.v5"
    assert status["arenaDirector"]["decisionsReturned"] == 1
    assert status["arenaDirector"]["selectedDecisions"] == 1
    assert status["matches"]["authoritativeMultiplayerRounds"] == 0
    assert "not completed fights" in status["arenaDirector"]["definition"]
    assert status["onchain"]["verifiedTransactions"] is None
    assert status["marketStream"]["status"] == "disabled"
    assert status["marketStream"]["activity"]["observedConfirmedTransactions"] is None


def test_arena_director_endpoint_uses_fresh_alchemy_enrichment_without_replacing_birdeye(monkeypatch) -> None:
    base = {
        "mint": "mint-enriched",
        "symbol": "RICH",
        "volume24h": 350_000,
        "priceChange24h": 22,
        "liquidity": 90_000,
    }
    enriched = {
        **base,
        "alchemyActivity": {
            "provider": "alchemy",
            "transport": "solana_http_polling",
            "scoreEligible": True,
            "observedConfirmedTransactions": 7,
        },
    }
    monkeypatch.setattr(server, "_fetch_market_trending", AsyncMock(return_value=[base]))
    monkeypatch.setattr(server, "_fetch_market_graduates", AsyncMock(return_value=[]))

    with TestClient(app=app) as client:
        monkeypatch.setattr(
            server.alchemy_stream,
            "enrich_candidate_lists",
            AsyncMock(return_value=([enriched], [])),
        )
        monkeypatch.setattr(
            server.alchemy_stream,
            "provider_snapshot",
            AsyncMock(
                return_value={
                    "provider": "alchemy",
                    "channel": "solana_http_candidate_activity",
                    "state": "live",
                    "freshness": "fresh",
                    "snapshotAt": "2026-08-28T12:00:00+00:00",
                    "observedAt": "2026-08-28T12:00:01+00:00",
                    "ageSeconds": 1,
                    "tokenCount": 1,
                    "requiredForSelection": False,
                    "scoreEligible": True,
                    "cursorDurable": True,
                    "lastSlot": 123,
                }
            ),
        )
        response = client.get("/api/arena/director/next")

    assert response.status_code == 200
    payload = response.json()
    assert "alchemy_solana_http_candidate_activity" in payload["inputSources"]
    assert payload["candidates"][0]["metrics"]["alchemyConfirmedTransactions"] == 7
    assert payload["providerSnapshots"][2]["state"] == "live"
    assert payload["providerSnapshots"][2]["requiredForSelection"] is False
    assert payload["marketDataState"] in {"fresh", "unverified"}
