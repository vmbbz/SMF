from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from alchemy_stream import (
    ALCHEMY_STREAM_SCHEMA_SQL,
    AlchemyStreamConfig,
    AlchemyStreamStore,
    AlchemyYellowstoneStream,
    _IngressUpdate,
    calculate_replay_start,
)
from yellowstone_proto import geyser_pb2, solana_storage_pb2


MINT_A = "11111111111111111111111111111111"
MINT_B = "So11111111111111111111111111111111111111112"


def configured_stream(*, freshness_seconds: int = 20) -> AlchemyYellowstoneStream:
    return AlchemyYellowstoneStream(
        AlchemyStreamConfig(
            enabled=True,
            api_key="test-only-secret",
            freshness_seconds=freshness_seconds,
        )
    )


def test_replay_cursor_rewinds_and_clamps_to_conservative_window() -> None:
    assert calculate_replay_start(
        None,
        10_000,
        rewind_slots=32,
        max_replay_slots=6_000,
    ) == (None, "no_durable_cursor")
    assert calculate_replay_start(
        9_900,
        10_000,
        rewind_slots=32,
        max_replay_slots=6_000,
    ) == (9_868, "cursor_rewind")
    assert calculate_replay_start(
        100,
        10_000,
        rewind_slots=32,
        max_replay_slots=6_000,
    ) == (4_000, "cursor_clamped_to_replay_window")
    assert calculate_replay_start(
        4_100,
        10_000,
        rewind_slots=32,
        max_replay_slots=6_000,
        provider_first_available=4_500,
    ) == (4_500, "cursor_clamped_to_replay_window")


@pytest.mark.asyncio
async def test_subscription_is_confirmed_narrow_and_replayable() -> None:
    stream = configured_stream()
    await stream.set_candidates([MINT_B, MINT_A, MINT_B, "not-a-mint"])

    request = stream._build_subscription_request(from_slot=123_456)

    assert request.commitment == geyser_pb2.CONFIRMED
    assert request.from_slot == 123_456
    assert request.slots["confirmed_slots"].filter_by_commitment is True
    transaction_filter = request.transactions["candidate_activity"]
    assert transaction_filter.vote is False
    assert transaction_filter.failed is False
    assert transaction_filter.HasField("vote") is True
    assert transaction_filter.HasField("failed") is True
    assert transaction_filter.account_include == sorted([MINT_A, MINT_B])


@pytest.mark.asyncio
async def test_memory_store_deduplicates_and_reports_candidate_window() -> None:
    store = AlchemyStreamStore()
    observed_at = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)

    inserted = await store.record_activity("a" * 64, 100, observed_at, [MINT_A])
    duplicate = await store.record_activity("a" * 64, 100, observed_at, [MINT_A])
    await store.save_cursor(100, observed_at)
    snapshot = await store.activity_snapshot([MINT_A, MINT_B], since=observed_at - timedelta(seconds=1))
    cursor = await store.cursor_status()

    assert inserted is True
    assert duplicate is False
    assert snapshot["totalTransactions"] == 1
    assert snapshot["byMint"][MINT_A]["observedConfirmedTransactions"] == 1
    assert snapshot["byMint"][MINT_A]["lastSlot"] == 100
    assert snapshot["byMint"][MINT_B]["observedConfirmedTransactions"] == 0
    assert cursor == {
        "slot": 100,
        "updatedAt": observed_at.isoformat(),
        "persistence": "process_memory",
        "durable": False,
    }


@pytest.mark.asyncio
async def test_transaction_update_records_only_matching_candidate_mint() -> None:
    stream = configured_stream()
    await stream.set_candidates([MINT_A, MINT_B])
    observed_at = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)
    message = geyser_pb2.SubscribeUpdate(
        transaction=geyser_pb2.SubscribeUpdateTransaction(
            slot=777,
            transaction=geyser_pb2.SubscribeUpdateTransactionInfo(
                signature=b"\x07" * 64,
                transaction=solana_storage_pb2.Transaction(
                    message=solana_storage_pb2.Message(account_keys=[b"\0" * 32])
                ),
                meta=solana_storage_pb2.TransactionStatusMeta(),
            ),
        )
    )

    await stream._process_update(
        _IngressUpdate(
            message=message,
            received_at=observed_at,
            candidate_mints=(MINT_A, MINT_B),
        )
    )
    snapshot = await stream.store.activity_snapshot(
        [MINT_A, MINT_B],
        since=observed_at - timedelta(seconds=1),
    )

    assert snapshot["totalTransactions"] == 1
    assert snapshot["byMint"][MINT_A]["observedConfirmedTransactions"] == 1
    assert snapshot["byMint"][MINT_B]["observedConfirmedTransactions"] == 0


@pytest.mark.asyncio
async def test_fresh_stream_enrichment_is_explicit_and_bounded() -> None:
    stream = configured_stream()
    now = datetime.now(timezone.utc)
    await stream.store.record_activity("b" * 64, 888, now, [MINT_B])
    stream._connected = True
    stream._last_received_at = now

    (enriched,) = await stream.enrich_candidate_lists([{"mint": MINT_B, "symbol": "SOL"}])
    activity = enriched[0]["alchemyActivity"]

    assert activity["scoreEligible"] is True
    assert activity["observedConfirmedTransactions"] == 1
    assert activity["lastSlot"] == 888
    assert "not trades, volume, or unique users" in activity["definition"]


@pytest.mark.asyncio
async def test_disabled_or_misconfigured_health_never_leaks_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALCHEMY_STREAM_ENABLED", "1")
    monkeypatch.setenv("ALCHEMY_API_KEY", "never-print-this-key")
    monkeypatch.setenv(
        "ALCHEMY_YELLOWSTONE_ENDPOINT",
        "https://solana-mainnet.g.alchemy.com/v2/never-print-this-key",
    )
    config = AlchemyStreamConfig.from_env()
    stream = AlchemyYellowstoneStream(config)

    assert config.configured is False
    assert "never-print-this-key" not in repr(config)
    assert await stream.start() is False
    health = await stream.public_health()
    assert health["status"] == "misconfigured"
    assert "never-print-this-key" not in str(health)
    assert health["activity"]["observedConfirmedTransactions"] is None


@pytest.mark.asyncio
async def test_health_reports_zero_only_for_a_fresh_active_subscription() -> None:
    stream = configured_stream(freshness_seconds=5)
    await stream.set_candidates([MINT_A])
    stream._connected = True
    stream._last_received_at = datetime.now(timezone.utc) - timedelta(seconds=10)

    stale = await stream.public_health()
    assert stale["status"] == "stale"
    assert stale["activity"]["observedConfirmedTransactions"] is None
    assert stale["activity"]["scoreEligible"] is False

    stream._last_received_at = datetime.now(timezone.utc)
    fresh = await stream.public_health()
    assert fresh["status"] == "degraded"
    assert fresh["freshness"] == "fresh"
    assert fresh["activity"]["observedConfirmedTransactions"] == 0
    assert fresh["activity"]["scoreEligible"] is True
    assert fresh["replay"]["cursorDurable"] is False


@pytest.mark.asyncio
async def test_provider_snapshot_is_optional_for_base_selection() -> None:
    stream = configured_stream()
    snapshot = await stream.provider_snapshot()

    assert snapshot["provider"] == "alchemy"
    assert snapshot["channel"] == "yellowstone_candidate_activity"
    assert snapshot["requiredForSelection"] is False
    assert snapshot["scoreEligible"] is False


def test_operational_schema_is_separate_from_reward_and_gameplay_ledgers() -> None:
    assert "alchemy_stream_cursor" in ALCHEMY_STREAM_SCHEMA_SQL
    assert "alchemy_stream_transactions" in ALCHEMY_STREAM_SCHEMA_SQL
    assert "signature_hash" in ALCHEMY_STREAM_SCHEMA_SQL
    assert "wallet_address" not in ALCHEMY_STREAM_SCHEMA_SQL
    assert "reward" not in ALCHEMY_STREAM_SCHEMA_SQL.lower()
