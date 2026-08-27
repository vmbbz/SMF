from __future__ import annotations

from datetime import datetime, timezone

import pytest

from arena_telemetry import ArenaTelemetryStore, TELEMETRY_SCHEMA_SQL


FIXED_TIME = datetime(2026, 8, 28, 10, 0, tzinfo=timezone.utc).isoformat()


def decision(*, decision_id: str = "arena-1", mint: str = "mint-1", state: str = "fresh") -> dict:
    return {
        "status": "selected",
        "decisionId": decision_id,
        "generatedAt": FIXED_TIME,
        "agent": {"version": "0.1.0"},
        "candidateCount": 3,
        "marketDataState": state,
        "providerSnapshots": [
            {
                "provider": "birdeye",
                "channel": "trending",
                "state": "birdeye_fetch",
                "freshness": "fresh",
                "snapshotAt": FIXED_TIME,
                "observedAt": FIXED_TIME,
                "ageSeconds": 0,
                "tokenCount": 3,
            }
        ],
        "opponent": {
            "mint": mint,
            "symbol": "LIVE",
            "volume24h": 1_500_000,
            "priceChange24h": 25,
            "liquidity": 100_000,
            "marketCap": 4_000_000,
            "arenaDirector": {"score": 88.5},
        },
        "explanation": "Selected $LIVE for active market data.",
    }


@pytest.mark.asyncio
async def test_memory_status_counts_only_explicit_event_categories() -> None:
    store = ArenaTelemetryStore(memory_event_limit=20)
    await store.record_director_decision(decision())
    await store.record_director_decision(decision())
    await store.record_director_decision(decision(decision_id="arena-2", mint="mint-2", state="degraded"))

    ranked = {
        "match_id": "match-1",
        "room_code": "room-1",
        "match_type": "ranked_skill",
        "league": "skill",
        "input_category": "keyboard",
        "winner": 1,
        "reason": "ko",
        "p1_health": 20,
        "p2_health": 0,
        "server_tick": 900,
        "p1_boost_charges": 0,
        "p2_boost_charges": 0,
        "p1_wallet": "must-never-be-public",
    }
    await store.record_match_outcome(ranked, ranked=True)
    duplicate = await store.record_match_outcome(ranked, ranked=True)
    await store.record_match_outcome(
        {
            **ranked,
            "match_id": "",
            "telemetry_round_id": "private-round-1",
            "room_code": "private-room",
            "server_tick": 500,
            "match_type": "private_casual",
            "league": "",
        },
        ranked=False,
    )
    await store.record_share_card("share-1", mode="pvp", result="win", symbol="LIVE")

    status = await store.public_status()

    assert duplicate["idempotent"] is True
    assert status["persistence"]["mode"] == "process_memory"
    assert status["persistence"]["durable"] is False
    assert status["arenaDirector"]["decisionsReturned"] == 3
    assert status["arenaDirector"]["uniqueDecisionSnapshots"] == 2
    assert status["arenaDirector"]["uniqueTokensFeatured"] == 2
    assert status["arenaDirector"]["freshMarketSelections"] == 2
    assert status["arenaDirector"]["degradedMarketSelections"] == 1
    assert status["matches"]["authoritativeMultiplayerRounds"] == 2
    assert status["matches"]["skillRankedRounds"] == 1
    assert status["matches"]["privateCasualRounds"] == 1
    assert status["engagement"]["shareCardsGenerated"] == 1
    assert status["engagement"]["uniqueAuthenticatedWallets"] is None
    assert status["onchain"]["verifiedTransactions"] is None
    assert "must-never-be-public" not in str(status)


@pytest.mark.asyncio
async def test_no_candidate_is_not_counted_as_a_featured_token() -> None:
    store = ArenaTelemetryStore()
    await store.record_director_decision(
        {
            "status": "no_candidate",
            "decisionId": "arena-empty",
            "generatedAt": FIXED_TIME,
            "agent": {"version": "0.1.0"},
            "candidateCount": 0,
            "marketDataState": "unavailable",
            "opponent": None,
            "providerSnapshots": [],
        }
    )

    status = await store.public_status()

    assert status["arenaDirector"]["decisionsReturned"] == 1
    assert status["arenaDirector"]["selectedDecisions"] == 0
    assert status["arenaDirector"]["uniqueTokensFeatured"] == 0
    assert status["arenaDirector"]["recentSelections"] == []


def test_schema_enforces_insert_only_telemetry_tables() -> None:
    assert "arena_director_events" in TELEMETRY_SCHEMA_SQL
    assert "arena_match_events" in TELEMETRY_SCHEMA_SQL
    assert "arena_share_events" in TELEMETRY_SCHEMA_SQL
    assert "BEFORE UPDATE OR DELETE" in TELEMETRY_SCHEMA_SQL
    assert "wallet_address" not in TELEMETRY_SCHEMA_SQL
