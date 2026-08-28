from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
import httpx

from alchemy_pubsub import (
    AlchemySolanaHttpPollingStream,
    AlchemySolanaPubSubStream,
    create_alchemy_stream,
)
from alchemy_stream import AlchemyStreamConfig, AlchemyStreamStore, AlchemyYellowstoneStream


MINT_A = "11111111111111111111111111111111"
MINT_B = "So11111111111111111111111111111111111111112"
SIGNATURE_A = "2" * 88
SIGNATURE_B = "3" * 88
SIGNATURE_C = "4" * 88


def pubsub_stream(**overrides) -> AlchemySolanaPubSubStream:
    values = {
        "enabled": True,
        "api_key": "test-only-secret",
        "transport": "solana_pubsub",
    }
    values.update(overrides)
    return AlchemySolanaPubSubStream(AlchemyStreamConfig(**values))


def polling_stream(**overrides) -> AlchemySolanaHttpPollingStream:
    values = {
        "enabled": True,
        "api_key": "test-only-secret",
        "transport": "solana_http_polling",
        "backfill_min_interval_seconds": 30,
    }
    values.update(overrides)
    stream = AlchemySolanaHttpPollingStream(AlchemyStreamConfig(**values))
    stream._http_request_spacing_seconds = lambda: 0
    return stream


def test_free_tier_http_polling_is_the_safe_default_and_factory_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALCHEMY_STREAM_ENABLED", "1")
    monkeypatch.setenv("ALCHEMY_API_KEY", "never-print-this-key")

    config = AlchemyStreamConfig.from_env()
    stream = create_alchemy_stream(config)

    assert config.transport == "solana_http_polling"
    assert config.configured is True
    assert config.endpoint_host == "solana-mainnet.g.alchemy.com"
    assert config.http_retry_budget == 4
    assert isinstance(stream, AlchemySolanaHttpPollingStream)
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

    pubsub = create_alchemy_stream(
        AlchemyStreamConfig(
            enabled=True,
            api_key="test-only-secret",
            transport="solana_pubsub",
        )
    )
    assert type(pubsub) is AlchemySolanaPubSubStream


@pytest.mark.asyncio
async def test_pubsub_configuration_rejects_credentials_in_endpoint_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALCHEMY_STREAM_ENABLED", "1")
    monkeypatch.setenv("ALCHEMY_API_KEY", "never-print-this-key")
    monkeypatch.setenv("ALCHEMY_STREAM_TRANSPORT", "solana_pubsub")
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
async def test_http_poll_cycle_is_bounded_fresh_and_cost_disclosed() -> None:
    now = datetime.now(timezone.utc)
    stream = polling_stream(
        backfill_max_slots=64,
        backfill_limit_per_candidate=100,
        poll_interval_seconds=180,
        max_candidates=32,
    )
    await stream.set_candidates([MINT_A, MINT_B])
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
            [],
        ]
    )

    assert await stream._poll_once() is True
    health = await stream.public_health()
    (enriched,) = await stream.enrich_candidate_lists(
        [{"mint": MINT_A}, {"mint": MINT_B}]
    )

    assert health["transport"] == "solana_http_polling"
    assert health["protocolVersion"] == "solana_json_rpc_http_poll_v1"
    assert health["freshness"] == "fresh"
    assert health["subscription"]["candidateCount"] == 2
    assert health["subscription"]["activeCandidateCount"] == 2
    assert health["subscription"]["connectionCount"] == 0
    assert health["subscription"]["activeSubscriptionCount"] == 0
    assert health["subscription"]["transactionMethod"] == "getSignaturesForAddress"
    assert health["subscription"]["heartbeatMethod"] == "getSlot"
    assert health["subscription"]["heartbeatActive"] is True
    assert health["replay"]["mode"] == "http_signature_polling"
    assert health["replay"]["nativeProviderReplay"] is False
    assert health["replay"]["coverageComplete"] is True
    assert health["activity"]["scoreEligible"] is True
    assert health["lastSlot"] == 120
    assert enriched[0]["alchemyActivity"]["observedConfirmedTransactions"] == 1
    assert enriched[1]["alchemyActivity"]["observedConfirmedTransactions"] == 0
    cost = health["reliability"]["costGuard"]
    assert cost["baselineRequestsPerCycle"] == 3
    assert cost["requestsPerCycle"] == 9
    assert cost["baselineComputeUnitsPerCycle"] == 100
    assert cost["estimatedComputeUnitsPerCycle"] == 340
    assert cost["estimatedComputeUnitsPer30Days"] == 4_896_000
    assert cost["maximumEstimatedComputeUnitsPer30Days"] == 25_632_000
    assert cost["retry"]["budgetPerCycle"] == 4
    assert cost["assumptions"]["includesBoundedRetryBudget"] is True


@pytest.mark.asyncio
async def test_http_polling_persists_each_provider_page_as_one_activity_batch() -> None:
    now = datetime.now(timezone.utc)
    stream = polling_stream(backfill_max_slots=64, backfill_limit_per_candidate=100)
    await stream.set_candidates([MINT_A])
    stream.store.record_activities = AsyncMock(return_value=2)
    stream._rpc_call = AsyncMock(
        side_effect=[
            120,
            [
                {
                    "signature": SIGNATURE_A,
                    "slot": 119,
                    "err": None,
                    "blockTime": int(now.timestamp()),
                },
                {
                    "signature": SIGNATURE_B,
                    "slot": 118,
                    "err": None,
                    "blockTime": int(now.timestamp()),
                },
            ],
        ]
    )

    assert await stream._poll_once() is True
    stream.store.record_activities.assert_awaited_once()
    (page,) = stream.store.record_activities.await_args.args
    health = await stream.public_health()

    assert len(page) == 2
    assert {activity[3] for activity in page} == {(MINT_A,)}
    assert stream._candidate_transactions == 2
    assert health["reliability"]["activityPersistenceWriteMode"] == (
        "one_postgres_batch_per_rpc_page"
    )
    assert isinstance(
        health["reliability"]["lastPollDurationMilliseconds"],
        int,
    )
    assert health["reliability"]["pollStartedAt"] is None


@pytest.mark.asyncio
async def test_http_polling_retries_429_once_within_global_budget() -> None:
    stream = polling_stream(http_retry_budget=1)
    stream._retry_budget_remaining = 1
    stream._retry_delay_seconds = lambda retry_number: 0
    request = httpx.Request("POST", "https://solana-mainnet.g.alchemy.com")
    response = httpx.Response(429, request=request)
    rate_error = httpx.HTTPStatusError(
        "rate limited",
        request=request,
        response=response,
    )
    stream._rpc_call = AsyncMock(side_effect=[rate_error, []])

    result = await stream._backfill_rpc_call(
        AsyncMock(spec=httpx.AsyncClient),
        "getSignaturesForAddress",
        [MINT_A, {"limit": 1000}],
        2,
    )
    health = await stream.public_health()

    assert result == []
    assert stream._rpc_call.await_count == 2
    assert health["reliability"]["retriesAttempted"] == 1
    assert health["reliability"]["retriesRecovered"] == 1
    assert health["reliability"]["requestFailureCodes"] == {
        "http_rpc_http_429": 1
    }


@pytest.mark.asyncio
async def test_http_polling_discloses_non_retryable_final_failure_code() -> None:
    stream = polling_stream(backfill_max_slots=64)
    await stream.set_candidates([MINT_A])
    request = httpx.Request("POST", "https://solana-mainnet.g.alchemy.com")
    response = httpx.Response(400, request=request)
    invalid_request = httpx.HTTPStatusError(
        "invalid request",
        request=request,
        response=response,
    )
    stream._rpc_call = AsyncMock(side_effect=[120, invalid_request])

    assert await stream._poll_once() is False
    health = await stream.public_health()

    assert health["replay"]["failureCodes"] == {"http_rpc_http_400": 1}
    assert health["reliability"]["requestFailureCodes"] == {
        "http_rpc_http_400": 1
    }
    assert health["reliability"]["retriesAttempted"] == 0


@pytest.mark.asyncio
async def test_http_polling_fails_closed_on_truncated_candidate_window() -> None:
    stream = polling_stream(
        backfill_max_slots=64,
        backfill_limit_per_candidate=1,
        backfill_max_pages_per_candidate=1,
    )
    await stream.set_candidates([MINT_A])
    stream._rpc_call = AsyncMock(
        side_effect=[
            120,
            [{"signature": SIGNATURE_A, "slot": 120, "err": None}],
        ]
    )

    assert await stream._poll_once() is False
    health = await stream.public_health()

    assert health["subscription"]["activeCandidateCount"] == 0
    assert health["replay"]["truncatedCandidates"] == 1
    assert health["replay"]["coverageComplete"] is False
    assert health["activity"]["scoreEligible"] is False
    assert health["activity"]["observedConfirmedTransactions"] is None
    assert health["reliability"]["lastErrorCode"] == "http_poll_incomplete"


@pytest.mark.asyncio
async def test_http_polling_paginates_busy_candidates_within_global_budget() -> None:
    now = datetime.now(timezone.utc)
    stream = polling_stream(
        replay_rewind_slots=10,
        backfill_max_slots=64,
        backfill_limit_per_candidate=2,
        backfill_max_pages_per_candidate=2,
        backfill_extra_page_budget=1,
    )
    await stream.store.save_cursor(100, now)
    await stream.set_candidates([MINT_A])
    stream._rpc_call = AsyncMock(
        side_effect=[
            120,
            [
                {"signature": SIGNATURE_A, "slot": 115, "err": None},
                {"signature": SIGNATURE_B, "slot": 110, "err": None},
            ],
            [{"signature": SIGNATURE_C, "slot": 85, "err": None}],
        ]
    )

    assert await stream._poll_once() is True
    health = await stream.public_health()
    second_page_params = stream._rpc_call.await_args_list[2].args[2]

    assert second_page_params[1]["before"] == SIGNATURE_B
    assert health["replay"]["pagesRequested"] == 2
    assert health["replay"]["extraPagesUsed"] == 1
    assert health["replay"]["candidatesCompleted"] == 1
    assert health["replay"]["truncatedCandidates"] == 0
    assert health["replay"]["coverageComplete"] is True


@pytest.mark.asyncio
async def test_http_polling_global_page_budget_fails_closed() -> None:
    stream = polling_stream(
        backfill_max_slots=64,
        backfill_limit_per_candidate=1,
        backfill_max_pages_per_candidate=2,
        backfill_extra_page_budget=1,
    )
    await stream.set_candidates([MINT_A, MINT_B])
    stream._rpc_call = AsyncMock(
        side_effect=[
            120,
            [{"signature": SIGNATURE_A, "slot": 120, "err": None}],
            [],
            [{"signature": SIGNATURE_B, "slot": 120, "err": None}],
        ]
    )

    assert await stream._poll_once() is False
    health = await stream.public_health()

    assert health["replay"]["pagesRequested"] == 3
    assert health["replay"]["extraPagesUsed"] == 1
    assert health["replay"]["candidatesCompleted"] == 1
    assert health["replay"]["truncatedCandidates"] == 1
    assert health["replay"]["coverageComplete"] is False
    assert health["activity"]["scoreEligible"] is False


@pytest.mark.asyncio
async def test_authenticated_alchemy_url_is_not_emitted_by_http_client_logger(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "never-log-this-provider-key"
    stream = polling_stream(api_key=secret)

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": 120})

    caplog.set_level(logging.INFO)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        assert await stream._rpc_call(client, "getSlot", [], 1) == 120

    assert secret not in caplog.text
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    assert logging.getLogger("httpcore").getEffectiveLevel() >= logging.WARNING


@pytest.mark.asyncio
async def test_http_polling_enrichment_is_read_only() -> None:
    stream = polling_stream(backfill_max_slots=64)
    await stream.set_candidates([MINT_A])
    stream._rpc_call = AsyncMock(side_effect=[120, []])
    assert await stream._poll_once() is True

    (enriched,) = await stream.enrich_candidate_lists([{"mint": MINT_B}])

    assert stream._candidate_mints == (MINT_A,)
    assert "alchemyActivity" not in enriched[0]
    assert stream._rpc_call.await_count == 2


@pytest.mark.asyncio
async def test_http_polling_lifecycle_wakes_when_candidates_arrive() -> None:
    stream = polling_stream(poll_interval_seconds=180)
    polled = asyncio.Event()

    async def observe_poll() -> bool:
        polled.set()
        return True

    stream._poll_once = observe_poll
    assert await stream.start() is True
    try:
        assert stream.running is True
        await stream.set_candidates([MINT_A])
        await asyncio.wait_for(polled.wait(), timeout=1)
    finally:
        await stream.stop()

    assert stream.running is False


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
