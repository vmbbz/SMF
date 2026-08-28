from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from alchemy_pubsub import AlchemySolanaPubSubStream, create_alchemy_stream
from alchemy_stream import AlchemyStreamConfig, AlchemyStreamStore, AlchemyYellowstoneStream


MINT_A = "11111111111111111111111111111111"
MINT_B = "So11111111111111111111111111111111111111112"
SIGNATURE_A = "2" * 88


def pubsub_stream(**overrides) -> AlchemySolanaPubSubStream:
    values = {
        "enabled": True,
        "api_key": "test-only-secret",
        "transport": "solana_pubsub",
    }
    values.update(overrides)
    return AlchemySolanaPubSubStream(AlchemyStreamConfig(**values))


def test_free_tier_pubsub_is_the_safe_default_and_factory_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALCHEMY_STREAM_ENABLED", "1")
    monkeypatch.setenv("ALCHEMY_API_KEY", "never-print-this-key")

    config = AlchemyStreamConfig.from_env()
    stream = create_alchemy_stream(config)

    assert config.transport == "solana_pubsub"
    assert config.configured is True
    assert config.endpoint_host == "solana-mainnet.g.alchemy.com"
    assert isinstance(stream, AlchemySolanaPubSubStream)
    assert "never-print-this-key" not in repr(config)
    assert "never-print-this-key" not in str(stream.__dict__)

    paid = create_alchemy_stream(
        AlchemyStreamConfig(
            enabled=True,
            api_key="test-only-secret",
            transport="yellowstone_grpc",
        )
    )
    assert type(paid) is AlchemyYellowstoneStream


@pytest.mark.asyncio
async def test_pubsub_configuration_rejects_credentials_in_endpoint_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALCHEMY_STREAM_ENABLED", "1")
    monkeypatch.setenv("ALCHEMY_API_KEY", "never-print-this-key")
    monkeypatch.setenv(
        "ALCHEMY_SOLANA_WS_ENDPOINT",
        "wss://solana-mainnet.g.alchemy.com/v2/never-print-this-key",
    )

    config = AlchemyStreamConfig.from_env()
    stream = create_alchemy_stream(config)

    assert config.configured is False
    assert config.endpoint_host is None
    assert "never-print-this-key" not in repr(config)
    assert "never-print-this-key" not in str(await stream.public_health())


@pytest.mark.asyncio
async def test_candidate_filters_use_one_confirmed_logs_subscription_per_mint() -> None:
    stream = pubsub_stream(max_candidates=2)
    stream._backfill_candidates = AsyncMock()
    stream._connected = True
    stream._request_queue = asyncio.Queue(maxsize=8)

    selected = await stream.set_candidates([MINT_B, MINT_A, MINT_B])
    requests = [await stream._request_queue.get() for _ in range(2)]
    await asyncio.gather(*stream._backfill_tasks)

    assert selected == tuple(sorted([MINT_A, MINT_B]))
    assert all(request["method"] == "logsSubscribe" for request in requests)
    assert all(request["params"][1] == {"commitment": "confirmed"} for request in requests)
    assert {tuple(request["params"][0]["mentions"]) for request in requests} == {
        (MINT_A,),
        (MINT_B,),
    }


@pytest.mark.asyncio
async def test_unsupported_root_subscription_falls_back_to_slot_root_heartbeat() -> None:
    stream = pubsub_stream()
    stream._connected = True
    stream._request_queue = asyncio.Queue(maxsize=8)
    root_request = stream._request("root_subscribe", "rootSubscribe", [])

    await stream._handle_response(
        {
            "jsonrpc": "2.0",
            "id": root_request["id"],
            "error": {"code": -32601, "message": "Method not found"},
        }
    )
    slot_request = await stream._request_queue.get()

    assert slot_request["method"] == "slotSubscribe"
    assert slot_request["params"] == []
    assert stream._heartbeat_fallback is True
    assert stream._last_error_code == "root_subscribe_unsupported_slot_fallback"

    await stream._handle_response(
        {"jsonrpc": "2.0", "id": slot_request["id"], "result": 77}
    )
    await stream._handle_notification(
        {
            "jsonrpc": "2.0",
            "method": "slotNotification",
            "params": {
                "subscription": 77,
                "result": {"parent": 900, "root": 899, "slot": 901},
            },
        },
        datetime.now(timezone.utc),
    )
    envelope = await stream._updates.get()
    await stream._process_update(envelope)
    stream._updates.task_done()
    health = await stream.public_health()

    assert stream._last_slot == 899
    assert stream._last_error_code is None
    assert health["subscription"]["heartbeatMethod"] == "slotSubscribe"
    assert health["subscription"]["heartbeatSource"] == "slot_notification_finalized_root"
    assert health["subscription"]["heartbeatFallback"] is True
    assert health["subscription"]["rootSubscriptionActive"] is True

    stream._connection_closed()
    stream._connected = True
    stream._request_queue = asyncio.Queue(maxsize=8)
    await stream._queue_root_subscription()
    reconnect_request = await stream._request_queue.get()

    assert reconnect_request["method"] == "slotSubscribe"


@pytest.mark.asyncio
async def test_non_capability_root_errors_still_fail_closed() -> None:
    stream = pubsub_stream()
    root_request = stream._request("root_subscribe", "rootSubscribe", [])

    with pytest.raises(RuntimeError, match="root_subscribe_rpc_neg32000"):
        await stream._handle_response(
            {
                "jsonrpc": "2.0",
                "id": root_request["id"],
                "error": {"code": -32000, "message": "provider error"},
            }
        )


@pytest.mark.asyncio
async def test_notifications_are_attributed_and_duplicate_signatures_merge_mints() -> None:
    stream = pubsub_stream()
    await stream.set_candidates([MINT_A, MINT_B])
    stream._connected = True
    now = datetime.now(timezone.utc)

    for mint, subscription_id in ((MINT_A, 101), (MINT_B, 102)):
        request = stream._request(
            "logs_subscribe",
            "logsSubscribe",
            [{"mentions": [mint]}, {"commitment": "confirmed"}],
            mint=mint,
        )
        await stream._handle_response(
            {"jsonrpc": "2.0", "id": request["id"], "result": subscription_id}
        )

    for subscription_id in (101, 102):
        await stream._handle_notification(
            {
                "jsonrpc": "2.0",
                "method": "logsNotification",
                "params": {
                    "subscription": subscription_id,
                    "result": {
                        "context": {"slot": 777},
                        "value": {"signature": SIGNATURE_A, "err": None, "logs": []},
                    },
                },
            },
            now,
        )
        envelope = await stream._updates.get()
        await stream._process_update(envelope)
        stream._updates.task_done()

    snapshot = await stream.store.activity_snapshot(
        [MINT_A, MINT_B],
        since=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )

    assert snapshot["totalTransactions"] == 1
    assert snapshot["byMint"][MINT_A]["observedConfirmedTransactions"] == 1
    assert snapshot["byMint"][MINT_B]["observedConfirmedTransactions"] == 1
    assert stream._candidate_transactions == 1


@pytest.mark.asyncio
async def test_enrichment_waits_for_complete_acknowledged_candidate_coverage() -> None:
    stream = pubsub_stream()
    await stream.set_candidates([MINT_A, MINT_B])
    stream._connected = True
    stream._last_received_at = datetime.now(timezone.utc)
    stream._mint_subscriptions[MINT_A] = 101
    stream._subscriptions[101] = ("logs", MINT_A)
    stream._root_subscription_id = 100
    stream._subscriptions[100] = ("root", None)
    stream._backfill_coverage_complete = True
    await stream.store.record_activity("a" * 64, 500, stream._last_received_at, [MINT_A])

    (incomplete,) = await stream.enrich_candidate_lists(
        [{"mint": MINT_A}, {"mint": MINT_B}]
    )
    incomplete_health = await stream.public_health()

    assert "alchemyActivity" not in incomplete[0]
    assert "alchemyActivity" not in incomplete[1]
    assert incomplete_health["activity"]["availability"] == "stream_coverage_incomplete"
    assert incomplete_health["activity"]["observedConfirmedTransactions"] is None

    stream._mint_subscriptions[MINT_B] = 102
    stream._subscriptions[102] = ("logs", MINT_B)
    (enriched,) = await stream.enrich_candidate_lists(
        [{"mint": MINT_A}, {"mint": MINT_B}]
    )
    health = await stream.public_health()

    assert enriched[0]["alchemyActivity"]["transport"] == "solana_pubsub"
    assert enriched[0]["alchemyActivity"]["scoreEligible"] is True
    assert enriched[1]["alchemyActivity"]["observedConfirmedTransactions"] == 0
    assert health["status"] == "degraded"
    assert health["subscription"]["candidateCount"] == 2
    assert health["subscription"]["activeCandidateCount"] == 2
    assert health["subscription"]["transactionFilter"] == "one_mentions_pubkey_per_candidate"
    assert health["replay"]["nativeProviderReplay"] is False


@pytest.mark.asyncio
async def test_incomplete_backfill_becomes_complete_only_after_a_full_live_window() -> None:
    stream = pubsub_stream(activity_window_seconds=180)
    await stream.set_candidates([MINT_A])
    now = datetime.now(timezone.utc)
    stream._connected = True
    stream._last_received_at = now
    stream._root_subscription_id = 100
    stream._subscriptions[100] = ("root", None)
    stream._mint_subscriptions[MINT_A] = 101
    stream._subscriptions[101] = ("logs", MINT_A)
    stream._backfill_truncated_candidates = 1
    stream._replay_reason = "partial_backfill"
    stream._refresh_live_coverage_start(now)

    incomplete = await stream.public_health()

    assert incomplete["activity"]["availability"] == "stream_coverage_incomplete"
    assert incomplete["activity"]["observedConfirmedTransactions"] is None
    assert incomplete["replay"]["coverageComplete"] is False
    assert incomplete["replay"]["coverageBasis"] == "incomplete"

    stream._live_coverage_started_at = now - timedelta(seconds=181)
    complete = await stream.public_health()

    assert complete["activity"]["availability"] == "observed"
    assert complete["activity"]["observedConfirmedTransactions"] == 0
    assert complete["activity"]["scoreEligible"] is True
    assert complete["replay"]["coverageComplete"] is True
    assert complete["replay"]["coverageBasis"] == "continuous_live_window"
    assert complete["replay"]["truncatedCandidates"] == 1


@pytest.mark.asyncio
async def test_root_subscription_is_required_for_score_eligible_coverage() -> None:
    stream = pubsub_stream()
    await stream.set_candidates([MINT_A])
    stream._connected = True
    stream._last_received_at = datetime.now(timezone.utc)
    stream._mint_subscriptions[MINT_A] = 101
    stream._subscriptions[101] = ("logs", MINT_A)
    stream._backfill_coverage_complete = True

    health = await stream.public_health()

    assert health["subscription"]["rootSubscriptionActive"] is False
    assert health["replay"]["coverageComplete"] is False
    assert health["activity"]["availability"] == "stream_coverage_incomplete"


@pytest.mark.asyncio
async def test_public_enrichment_cannot_replace_filters_or_trigger_backfill() -> None:
    stream = pubsub_stream()
    await stream.set_candidates([MINT_A])
    stream._connected = True
    stream._last_received_at = datetime.now(timezone.utc)
    stream._root_subscription_id = 100
    stream._subscriptions[100] = ("root", None)
    stream._mint_subscriptions[MINT_A] = 101
    stream._subscriptions[101] = ("logs", MINT_A)
    stream._backfill_coverage_complete = True

    (enriched,) = await stream.enrich_candidate_lists([{"mint": MINT_B}])

    assert stream._candidate_mints == (MINT_A,)
    assert stream._backfill_tasks == set()
    assert "alchemyActivity" not in enriched[0]


@pytest.mark.asyncio
async def test_http_backfill_is_slot_bounded_deduplicated_and_publicly_disclosed() -> None:
    store = AlchemyStreamStore()
    now = datetime.now(timezone.utc)
    await store.save_cursor(100, now)
    stream = AlchemySolanaPubSubStream(
        AlchemyStreamConfig(
            enabled=True,
            api_key="test-only-secret",
            transport="solana_pubsub",
            replay_rewind_slots=10,
            backfill_max_slots=64,
            backfill_limit_per_candidate=25,
        ),
        store,
    )
    stream._rpc_call = AsyncMock(
        side_effect=[
            120,
            [
                {
                    "signature": SIGNATURE_A,
                    "slot": 110,
                    "err": None,
                    "blockTime": int(now.timestamp()),
                }
            ],
        ]
    )

    await stream._backfill_candidates((MINT_A,))
    snapshot = await store.activity_snapshot(
        [MINT_A],
        since=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    health = await stream.public_health()

    assert snapshot["totalTransactions"] == 1
    assert stream._replay_from_slot == 90
    assert stream._replay_reason == "backfill_complete"
    assert health["replay"]["mode"] == "http_signature_backfill"
    assert health["replay"]["nativeProviderReplay"] is False
    assert health["replay"]["basis"] == "cursor_rewind"
    assert health["replay"]["signaturesScanned"] == 1
    assert health["replay"]["limitPerCandidate"] == 25


@pytest.mark.asyncio
async def test_first_activation_backfills_the_full_bounded_candidate_window() -> None:
    stream = pubsub_stream(
        backfill_max_slots=64,
        backfill_limit_per_candidate=25,
    )
    stream._rpc_call = AsyncMock(side_effect=[120, []])

    await stream._backfill_candidates((MINT_A,), cursor_slot=None, full_window=True)

    assert stream._replay_from_slot == 56
    assert stream._replay_reason == "backfill_complete"
    assert stream._backfill_basis == "candidate_window"
    assert stream._backfill_coverage_complete is True
