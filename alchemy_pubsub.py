"""Alchemy Solana transports for bounded candidate activity evidence.

The free default performs bounded confirmed HTTP polling. An optional PubSub
transport opens one server-side WebSocket and creates one ``logsSubscribe``
filter per candidate mint. Both use ``getSignaturesForAddress`` for bounded
recovery and neither is described as native stream replay.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx
import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

from alchemy_stream import (
    AlchemyStreamConfig,
    AlchemyStreamStore,
    AlchemyYellowstoneStream,
    _IngressUpdate,
    _ProcessingBackpressure,
    _public_time,
    _utc_now,
    calculate_replay_start,
)


PUBSUB_PROTOCOL_VERSION = "solana_json_rpc_pubsub_v1"
HTTP_POLL_PROTOCOL_VERSION = "solana_json_rpc_http_poll_v1"
SOLANA_SIGNATURE_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{80,90}$")
HTTP_POLL_GET_SLOT_COMPUTE_UNITS = 20
HTTP_POLL_GET_SIGNATURES_COMPUTE_UNITS = 40
HTTP_POLL_SECONDS_PER_30_DAYS = 30 * 24 * 60 * 60

# httpx logs complete request URLs at INFO. Alchemy authenticates standard
# Solana HTTP RPC through the URL path, so provider request logging must stay
# below WARNING in every runtime. Public health exposes sanitized hosts instead.
for _provider_http_logger_name in ("httpx", "httpcore"):
    logging.getLogger(_provider_http_logger_name).setLevel(logging.WARNING)


class _PubSubProtocolError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class _PendingRequest:
    action: str
    mint: str | None = None
    subscription_id: int | None = None


@dataclass(frozen=True)
class _PubSubUpdate:
    kind: str
    slot: int
    signature: str | None = None
    successful: bool = True


class AlchemySolanaPubSubStream(AlchemyYellowstoneStream):
    """Lifecycle-managed Alchemy Solana WebSocket with bounded HTTP backfill."""

    transport_name = "solana_pubsub"
    protocol_version = PUBSUB_PROTOCOL_VERSION
    provider_channel = "solana_pubsub_candidate_activity"
    task_name = "alchemy-solana-pubsub-stream"

    def __init__(self, config: AlchemyStreamConfig, store: AlchemyStreamStore | None = None) -> None:
        super().__init__(config, store)
        self._next_request_id = 0
        self._pending_requests: dict[int, _PendingRequest] = {}
        self._subscriptions: dict[int, tuple[str, str | None]] = {}
        self._mint_subscriptions: dict[str, int] = {}
        self._failed_candidate_mints: set[str] = set()
        self._root_subscription_id: int | None = None
        self._heartbeat_method = "rootSubscribe"
        self._heartbeat_fallback = False
        self._backfill_tasks: set[asyncio.Task[None]] = set()
        self._backfill_tail: asyncio.Task[None] | None = None
        self._backfill_pending = False
        self._last_backfill_at: datetime | None = None
        self._backfill_current_slot: int | None = None
        self._backfill_candidates_attempted = 0
        self._backfill_candidates_completed = 0
        self._backfill_signatures_scanned = 0
        self._backfill_pages_requested = 0
        self._backfill_extra_pages_used = 0
        self._backfill_truncated_candidates = 0
        self._backfill_failures = 0
        self._backfill_coverage_complete = False
        self._backfill_basis = "not_started"
        self._live_coverage_started_at: datetime | None = None

    async def set_candidates(self, mints: Iterable[str]) -> tuple[str, ...]:
        selected = await super().set_candidates(mints)
        if self._connected and self._request_queue is not None:
            retry_mints = sorted(self._failed_candidate_mints.intersection(selected))
            for mint in retry_mints:
                self._failed_candidate_mints.discard(mint)
                await self._queue_logs_subscription(mint)
        return selected

    def _public_endpoint_host(self) -> str | None:
        return self.config.endpoint_host

    def _active_candidate_mints(self) -> tuple[str, ...]:
        return tuple(sorted(self._mint_subscriptions))

    async def _on_candidates_changed(
        self,
        previous: tuple[str, ...],
        current: tuple[str, ...],
    ) -> None:
        if not self._connected or self._request_queue is None:
            return

        previous_set = set(previous)
        current_set = set(current)
        added_mints = tuple(sorted(current_set - previous_set))
        self._live_coverage_started_at = None
        if added_mints:
            self._backfill_coverage_complete = False
        for mint in sorted(previous_set - current_set):
            self._failed_candidate_mints.discard(mint)
            subscription_id = self._mint_subscriptions.pop(mint, None)
            if subscription_id is None:
                continue
            self._subscriptions.pop(subscription_id, None)
            await self._queue_request(
                "logs_unsubscribe",
                "logsUnsubscribe",
                [subscription_id],
                mint=mint,
                subscription_id=subscription_id,
            )

        for mint in added_mints:
            await self._queue_logs_subscription(mint)

        if added_mints:
            self._schedule_backfill(
                added_mints,
                name="alchemy-pubsub-candidate-backfill",
                full_window=True,
            )
        else:
            self._refresh_live_coverage_start()

    def _subscriptions_complete(self) -> bool:
        return bool(
            self._candidate_mints
            and self._root_subscription_id is not None
            and not self._failed_candidate_mints
            and set(self._mint_subscriptions) == set(self._candidate_mints)
        )

    def _refresh_live_coverage_start(self, observed_at: datetime | None = None) -> None:
        if not self._subscriptions_complete():
            self._live_coverage_started_at = None
            return
        if self._live_coverage_started_at is None:
            self._live_coverage_started_at = observed_at or _utc_now()

    def _schedule_backfill(
        self,
        candidates: tuple[str, ...],
        *,
        name: str,
        cursor_slot: int | None = None,
        full_window: bool = False,
    ) -> asyncio.Task[None]:
        previous = self._backfill_tail

        async def run_after_previous() -> None:
            if previous is not None and not previous.done():
                await previous
            await self._backfill_candidates(
                candidates,
                cursor_slot=cursor_slot,
                full_window=full_window,
            )

        task = asyncio.create_task(run_after_previous(), name=name)
        self._backfill_tasks.add(task)
        self._backfill_tail = task
        self._backfill_pending = True

        def finished(completed: asyncio.Task[None]) -> None:
            self._backfill_tasks.discard(completed)
            if self._backfill_tail is completed:
                self._backfill_tail = None
            self._backfill_pending = any(not item.done() for item in self._backfill_tasks)

        task.add_done_callback(finished)
        return task

    def _request(
        self,
        action: str,
        method: str,
        params: list[Any],
        *,
        mint: str | None = None,
        subscription_id: int | None = None,
    ) -> dict[str, Any]:
        self._next_request_id += 1
        request_id = self._next_request_id
        self._pending_requests[request_id] = _PendingRequest(
            action=action,
            mint=mint,
            subscription_id=subscription_id,
        )
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }

    async def _queue_request(
        self,
        action: str,
        method: str,
        params: list[Any],
        *,
        mint: str | None = None,
        subscription_id: int | None = None,
    ) -> None:
        request = self._request(
            action,
            method,
            params,
            mint=mint,
            subscription_id=subscription_id,
        )
        try:
            await self._enqueue_request(request)
        except Exception:
            self._pending_requests.pop(int(request["id"]), None)
            raise

    async def _queue_root_subscription(self) -> None:
        if self._heartbeat_fallback:
            await self._queue_request("slot_subscribe", "slotSubscribe", [])
            return
        await self._queue_request("root_subscribe", "rootSubscribe", [])

    async def _queue_logs_subscription(self, mint: str) -> None:
        await self._queue_request(
            "logs_subscribe",
            "logsSubscribe",
            [{"mentions": [mint]}, {"commitment": "confirmed"}],
            mint=mint,
        )

    async def _sender(self, websocket: Any, queue: asyncio.Queue[Any | None]) -> None:
        while not self._stop_event.is_set():
            request = await queue.get()
            try:
                if request is None:
                    return
                await websocket.send(json.dumps(request, separators=(",", ":")))
            finally:
                queue.task_done()

    async def _connect_once(self) -> None:
        self._state = "connecting"
        sender_task: asyncio.Task[None] | None = None
        recovery_cursor, _ = await self.store.load_cursor()
        try:
            async with websockets.connect(
                self.config.websocket_uri,
                open_timeout=self.config.rpc_timeout_seconds,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=5,
                max_size=2 * 1024 * 1024,
                max_queue=64,
            ) as websocket:
                self._pending_requests.clear()
                self._subscriptions.clear()
                self._mint_subscriptions.clear()
                self._failed_candidate_mints.clear()
                self._root_subscription_id = None
                self._backfill_coverage_complete = False

                request_queue: asyncio.Queue[Any | None] = asyncio.Queue(
                    maxsize=max(64, min(self.config.queue_size, 512))
                )
                self._request_queue = request_queue
                sender_task = asyncio.create_task(
                    self._sender(websocket, request_queue),
                    name="alchemy-pubsub-sender",
                )

                await self._queue_root_subscription()
                candidate_snapshot = self._candidate_mints
                for mint in candidate_snapshot:
                    await self._queue_logs_subscription(mint)

                self._connected = True
                self._state = "connected"
                self._last_connected_at = _utc_now()
                self._schedule_backfill(
                    candidate_snapshot,
                    name="alchemy-pubsub-backfill",
                    cursor_slot=recovery_cursor,
                    full_window=recovery_cursor is None,
                )

                async for raw_message in websocket:
                    await self._handle_wire_message(raw_message, _utc_now())
        finally:
            auxiliary_tasks = tuple(self._backfill_tasks)
            for task in (*auxiliary_tasks, sender_task):
                if task is not None and not task.done():
                    task.cancel()
            for task in (*auxiliary_tasks, sender_task):
                if task is not None:
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            self._backfill_tasks.clear()
            self._backfill_tail = None
            self._backfill_pending = False

    async def _handle_wire_message(self, raw_message: str | bytes, received_at: datetime) -> None:
        try:
            decoded = json.loads(raw_message)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise _PubSubProtocolError("websocket_invalid_json") from exc

        messages = decoded if isinstance(decoded, list) else [decoded]
        for message in messages:
            if not isinstance(message, dict):
                raise _PubSubProtocolError("websocket_invalid_payload")
            if "id" in message:
                await self._handle_response(message)
            elif "method" in message:
                await self._handle_notification(message, received_at)

    async def _handle_response(self, message: dict[str, Any]) -> None:
        request_id = _parse_int(message.get("id"))
        if request_id is None:
            return
        pending = self._pending_requests.pop(request_id, None)
        if pending is None:
            return

        error = message.get("error")
        if isinstance(error, dict):
            error_code = str(error.get("code") or "unknown").replace("-", "neg")
            if pending.action == "root_subscribe":
                if error_code == "neg32601":
                    self._heartbeat_method = "slotSubscribe"
                    self._heartbeat_fallback = True
                    self._last_error_code = "root_subscribe_unsupported_slot_fallback"
                    await self._queue_request("slot_subscribe", "slotSubscribe", [])
                    return
                raise _PubSubProtocolError(f"root_subscribe_rpc_{error_code}")
            if pending.action == "slot_subscribe":
                raise _PubSubProtocolError(f"slot_subscribe_rpc_{error_code}")
            if pending.action == "logs_subscribe" and pending.mint:
                self._failed_candidate_mints.add(pending.mint)
                self._live_coverage_started_at = None
                self._last_error_code = f"logs_subscribe_rpc_{error_code}"
            return

        if pending.action in {"root_subscribe", "slot_subscribe", "logs_subscribe"}:
            subscription_id = _parse_int(message.get("result"))
            if subscription_id is None:
                raise _PubSubProtocolError("subscribe_missing_id")

            if pending.action in {"root_subscribe", "slot_subscribe"}:
                self._root_subscription_id = subscription_id
                self._heartbeat_method = (
                    "slotSubscribe" if pending.action == "slot_subscribe" else "rootSubscribe"
                )
                self._subscriptions[subscription_id] = (
                    "slot_root" if pending.action == "slot_subscribe" else "root",
                    None,
                )
                self._last_error_code = None
                self._refresh_live_coverage_start()
                return

            mint = pending.mint
            if not mint or mint not in self._candidate_mints:
                await self._queue_request(
                    "logs_unsubscribe",
                    "logsUnsubscribe",
                    [subscription_id],
                    mint=mint,
                    subscription_id=subscription_id,
                )
                return
            self._failed_candidate_mints.discard(mint)
            self._mint_subscriptions[mint] = subscription_id
            self._subscriptions[subscription_id] = ("logs", mint)
            self._refresh_live_coverage_start()

    async def _handle_notification(self, message: dict[str, Any], received_at: datetime) -> None:
        params = message.get("params")
        if not isinstance(params, dict):
            return
        subscription_id = _parse_int(params.get("subscription"))
        if subscription_id is None:
            return

        subscription = self._subscriptions.get(subscription_id)
        if subscription is None:
            return
        kind, mint = subscription
        result = params.get("result")

        if kind == "root" and message.get("method") == "rootNotification":
            parsed_slot = _parse_int(result)
            if parsed_slot is None:
                return
            slot = max(0, parsed_slot)
            await self._queue_ingress(_PubSubUpdate(kind="root", slot=slot), received_at, ())
            return

        if kind == "slot_root" and message.get("method") == "slotNotification":
            if not isinstance(result, dict):
                return
            parsed_root = _parse_int(result.get("root"))
            if parsed_root is None:
                return
            await self._queue_ingress(
                _PubSubUpdate(kind="root", slot=max(0, parsed_root)),
                received_at,
                (),
            )
            return

        if kind != "logs" or not mint or message.get("method") != "logsNotification":
            return
        if not isinstance(result, dict):
            return
        context = result.get("context")
        value = result.get("value")
        if not isinstance(context, dict) or not isinstance(value, dict):
            return
        parsed_slot = _parse_int(context.get("slot"))
        if parsed_slot is None:
            return
        slot = max(0, parsed_slot)
        signature = str(value.get("signature") or "")
        if not SOLANA_SIGNATURE_RE.fullmatch(signature):
            return
        await self._queue_ingress(
            _PubSubUpdate(
                kind="logs",
                slot=slot,
                signature=signature,
                successful=value.get("err") is None,
            ),
            received_at,
            (mint,),
        )

    async def _queue_ingress(
        self,
        update: _PubSubUpdate,
        received_at: datetime,
        candidate_mints: tuple[str, ...],
    ) -> None:
        self._last_received_at = received_at
        self._received_updates += 1
        envelope = _IngressUpdate(
            message=update,
            received_at=received_at,
            candidate_mints=candidate_mints,
        )
        try:
            await asyncio.wait_for(self._updates.put(envelope), timeout=5)
        except TimeoutError as exc:
            self._dropped_updates += 1
            raise _ProcessingBackpressure("processing_queue_full") from exc

    async def _process_update(self, envelope: _IngressUpdate) -> None:
        update = envelope.message
        if not isinstance(update, _PubSubUpdate):
            return

        if update.kind == "logs" and update.successful and update.signature:
            signature_hash = hashlib.sha256(update.signature.encode("ascii")).hexdigest()
            inserted = await self.store.record_activity(
                signature_hash,
                update.slot,
                envelope.received_at,
                envelope.candidate_mints,
            )
            if inserted:
                self._candidate_transactions += 1

        await self.store.save_cursor(update.slot, envelope.received_at)
        self._last_slot = max(update.slot, self._last_slot or 0)

    async def _rpc_call(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: list[Any],
        request_id: int,
    ) -> Any:
        response = await client.post(
            self.config.http_rpc_url,
            json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise _PubSubProtocolError("http_rpc_invalid_payload")
        error = payload.get("error")
        if isinstance(error, dict):
            code = str(error.get("code") or "unknown").replace("-", "neg")
            raise _PubSubProtocolError(f"http_rpc_{code}")
        return payload.get("result")

    async def _backfill_candidates(
        self,
        candidates: tuple[str, ...],
        *,
        cursor_slot: int | None = None,
        full_window: bool = False,
    ) -> bool:
        now = _utc_now()
        self._backfill_current_slot = None
        self._backfill_coverage_complete = False
        try:
            if not candidates:
                self._replay_from_slot = None
                self._replay_reason = "no_candidates"
                return False
            if self._last_backfill_at is not None:
                elapsed = (now - self._last_backfill_at).total_seconds()
                remaining = self.config.backfill_min_interval_seconds - elapsed
                if remaining > 0:
                    self._replay_reason = "backfill_deferred"
                    await asyncio.sleep(remaining)
                    now = _utc_now()

            self._last_backfill_at = now
            self._backfill_candidates_attempted = 0
            self._backfill_candidates_completed = 0
            self._backfill_signatures_scanned = 0
            self._backfill_pages_requested = 0
            self._backfill_extra_pages_used = 0
            self._backfill_truncated_candidates = 0
            self._backfill_failures = 0

            last_slot = cursor_slot
            if last_slot is None and not full_window:
                last_slot, _ = await self.store.load_cursor()
            timeout = httpx.Timeout(self.config.rpc_timeout_seconds)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                current_result = await self._rpc_call(
                    client,
                    "getSlot",
                    [{"commitment": "confirmed"}],
                    1,
                )
                current_slot = max(0, int(current_result))
                self._backfill_current_slot = current_slot
                replay_from: int | None
                if full_window or last_slot is None:
                    replay_from = max(0, current_slot - self.config.backfill_max_slots)
                    reason = "candidate_window_backfill"
                    self._backfill_basis = "candidate_window"
                else:
                    replay_from, reason = calculate_replay_start(
                        last_slot,
                        current_slot,
                        rewind_slots=self.config.replay_rewind_slots,
                        max_replay_slots=self.config.backfill_max_slots,
                    )
                    self._backfill_basis = "cursor_rewind"
                self._replay_from_slot = replay_from
                self._replay_reason = reason
                if replay_from is None:
                    return False

                request_id = 1
                for mint in candidates:
                    self._backfill_candidates_attempted += 1
                    candidate_complete = False
                    candidate_failed = False
                    before_signature: str | None = None
                    pages_for_candidate = 0

                    while pages_for_candidate < self.config.backfill_max_pages_per_candidate:
                        if pages_for_candidate > 0:
                            if (
                                self._backfill_extra_pages_used
                                >= self.config.backfill_extra_page_budget
                            ):
                                break
                            self._backfill_extra_pages_used += 1

                        spacing = self._http_request_spacing_seconds()
                        if spacing > 0:
                            await asyncio.sleep(spacing)
                        request_id += 1
                        options: dict[str, Any] = {
                            "commitment": "confirmed",
                            "limit": self.config.backfill_limit_per_candidate,
                        }
                        if before_signature is not None:
                            options["before"] = before_signature

                        try:
                            result = await self._rpc_call(
                                client,
                                "getSignaturesForAddress",
                                [mint, options],
                                request_id,
                            )
                        except asyncio.CancelledError:
                            raise
                        except Exception:
                            self._backfill_failures += 1
                            candidate_failed = True
                            break
                        pages_for_candidate += 1
                        self._backfill_pages_requested += 1
                        if not isinstance(result, list):
                            self._backfill_failures += 1
                            candidate_failed = True
                            break

                        self._backfill_signatures_scanned += len(result)
                        result_slots = [
                            item["slot"]
                            for item in result
                            if isinstance(item, dict) and isinstance(item.get("slot"), int)
                        ]

                        for item in result:
                            if not isinstance(item, dict) or item.get("err") is not None:
                                continue
                            slot = _parse_int(item.get("slot"))
                            if slot is None:
                                continue
                            if slot < replay_from or slot > current_slot:
                                continue
                            signature = str(item.get("signature") or "")
                            if not SOLANA_SIGNATURE_RE.fullmatch(signature):
                                continue
                            block_time = item.get("blockTime")
                            if isinstance(block_time, (int, float)) and block_time > 0:
                                observed_at = datetime.fromtimestamp(block_time, tz=timezone.utc)
                            else:
                                observed_at = now
                            signature_hash = hashlib.sha256(signature.encode("ascii")).hexdigest()
                            inserted = await self.store.record_activity(
                                signature_hash,
                                slot,
                                observed_at,
                                [mint],
                            )
                            if inserted:
                                self._candidate_transactions += 1

                        if len(result) < self.config.backfill_limit_per_candidate:
                            candidate_complete = True
                            break
                        if result_slots and min(result_slots) < replay_from:
                            candidate_complete = True
                            break

                        last_item = result[-1] if result else None
                        next_before = (
                            str(last_item.get("signature") or "")
                            if isinstance(last_item, dict)
                            else ""
                        )
                        if not SOLANA_SIGNATURE_RE.fullmatch(next_before):
                            break
                        before_signature = next_before

                    if candidate_complete:
                        self._backfill_candidates_completed += 1
                    elif not candidate_failed:
                        self._backfill_truncated_candidates += 1

                if self._backfill_failures or self._backfill_truncated_candidates:
                    self._replay_reason = "partial_backfill"
                    self._backfill_coverage_complete = False
                else:
                    self._replay_reason = "backfill_complete"
                    self._backfill_coverage_complete = True
                return self._backfill_coverage_complete
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._backfill_failures += 1
            self._replay_reason = "backfill_failed"
            self._backfill_coverage_complete = False
            self._last_error_code = self._sanitize_transport_error(exc)
            return False

    def _http_request_spacing_seconds(self) -> float:
        return 0.0

    def _subscription_health(self) -> dict[str, Any]:
        active_count = len(self._mint_subscriptions)
        return {
            "candidateCount": len(self._candidate_mints),
            "activeCandidateCount": active_count,
            "pendingCandidateCount": max(
                0,
                len(self._candidate_mints) - active_count - len(self._failed_candidate_mints),
            ),
            "failedCandidateCount": len(self._failed_candidate_mints),
            "maxCandidates": self.config.max_candidates,
            "connectionCount": 1 if self._connected else 0,
            "activeSubscriptionCount": len(self._subscriptions),
            "transactionMethod": "logsSubscribe",
            "transactionFilter": "one_mentions_pubkey_per_candidate",
            "transactionCommitment": "confirmed",
            "heartbeatMethod": self._heartbeat_method,
            "heartbeatSource": (
                "slot_notification_finalized_root"
                if self._heartbeat_method == "slotSubscribe"
                else "root_notification"
            ),
            "heartbeatFallback": self._heartbeat_fallback,
            "heartbeatCommitment": "finalized_root",
            "rootSubscriptionActive": self._root_subscription_id is not None,
            "voteTransactions": False,
            "failedTransactions": False,
            "activityWindowSeconds": self.config.activity_window_seconds,
            "refreshSeconds": self.config.candidate_refresh_seconds,
        }

    def _recovery_health(self, cursor: dict[str, Any]) -> dict[str, Any]:
        coverage_complete = self._observation_coverage_complete()
        if self._backfill_coverage_complete:
            coverage_basis = "bounded_http_backfill"
        elif coverage_complete:
            coverage_basis = "continuous_live_window"
        else:
            coverage_basis = "incomplete"
        return {
            "mode": "http_signature_backfill",
            "nativeProviderReplay": False,
            "cursorSlot": cursor["slot"],
            "cursorUpdatedAt": cursor["updatedAt"],
            "cursorPersistence": cursor["persistence"],
            "cursorDurable": cursor["durable"],
            "rewindSlots": self.config.replay_rewind_slots,
            "maxReplaySlots": self.config.backfill_max_slots,
            "requestedFromSlot": self._replay_from_slot,
            "providerFirstAvailableSlot": None,
            "currentSlotAtBackfill": self._backfill_current_slot,
            "limitPerCandidate": self.config.backfill_limit_per_candidate,
            "candidatesAttempted": self._backfill_candidates_attempted,
            "candidatesCompleted": self._backfill_candidates_completed,
            "signaturesScanned": self._backfill_signatures_scanned,
            "pagesRequested": self._backfill_pages_requested,
            "extraPagesUsed": self._backfill_extra_pages_used,
            "maxPagesPerCandidate": self.config.backfill_max_pages_per_candidate,
            "extraPageBudget": self.config.backfill_extra_page_budget,
            "truncatedCandidates": self._backfill_truncated_candidates,
            "failures": self._backfill_failures,
            "lastBackfillAt": _public_time(self._last_backfill_at),
            "pending": self._backfill_pending,
            "coverageComplete": coverage_complete,
            "coverageBasis": coverage_basis,
            "continuousLiveWindowStartedAt": _public_time(self._live_coverage_started_at),
            "basis": self._backfill_basis,
            "reason": self._replay_reason,
        }

    def _reliability_health(self) -> dict[str, Any]:
        health = super()._reliability_health()
        health.update(
            {
                "failedCandidateSubscriptions": len(self._failed_candidate_mints),
                "backfillFailures": self._backfill_failures,
                "backfillTruncatedCandidates": self._backfill_truncated_candidates,
            }
        )
        return health

    def _transport_degraded(self) -> bool:
        return bool(
            not self._subscriptions_complete()
            or self._backfill_pending
            or not self._observation_coverage_complete()
        )

    def _observation_coverage_complete(self, now: datetime | None = None) -> bool:
        if not self._subscriptions_complete():
            return False
        if self._backfill_pending:
            return False
        if self._backfill_coverage_complete:
            return True
        if self._live_coverage_started_at is None:
            return False
        observed_now = now or _utc_now()
        return (
            observed_now - self._live_coverage_started_at
        ).total_seconds() >= self.config.activity_window_seconds

    def _sanitize_transport_error(self, exc: Exception) -> str:
        if isinstance(exc, _PubSubProtocolError):
            return exc.code
        if isinstance(exc, InvalidStatus):
            status = getattr(getattr(exc, "response", None), "status_code", "unknown")
            return f"websocket_http_{status}"
        if isinstance(exc, ConnectionClosed):
            return f"websocket_closed_{getattr(exc, 'code', 'unknown')}"
        if isinstance(exc, httpx.TimeoutException):
            return "http_rpc_timeout"
        if isinstance(exc, httpx.HTTPStatusError):
            return f"http_rpc_http_{exc.response.status_code}"
        return type(exc).__name__

    def _connection_closed(self) -> None:
        super()._connection_closed()
        self._pending_requests.clear()
        self._subscriptions.clear()
        self._mint_subscriptions.clear()
        self._failed_candidate_mints.clear()
        self._root_subscription_id = None
        self._backfill_coverage_complete = False
        self._live_coverage_started_at = None


class AlchemySolanaHttpPollingStream(AlchemySolanaPubSubStream):
    """Bounded free-tier HTTP observation loop with durable recovery state."""

    transport_name = "solana_http_polling"
    protocol_version = HTTP_POLL_PROTOCOL_VERSION
    provider_channel = "solana_http_candidate_activity"
    task_name = "alchemy-solana-http-polling"

    def __init__(self, config: AlchemyStreamConfig, store: AlchemyStreamStore | None = None) -> None:
        super().__init__(config, store)
        self._poll_wake_event = asyncio.Event()
        self._polled_candidate_mints: tuple[str, ...] = ()
        self._poll_cycles_attempted = 0
        self._poll_cycles_completed = 0
        self._poll_cycles_failed = 0
        self._last_poll_completed_at: datetime | None = None

    async def _on_candidates_changed(
        self,
        previous: tuple[str, ...],
        current: tuple[str, ...],
    ) -> None:
        del previous
        self._backfill_coverage_complete = False
        self._polled_candidate_mints = ()
        self._connected = False
        self._state = "waiting_for_poll" if current else "waiting_for_candidates"
        self._poll_wake_event.set()

    def _active_candidate_mints(self) -> tuple[str, ...]:
        if not self._observation_coverage_complete():
            return ()
        return self._polled_candidate_mints

    def _freshness_threshold_seconds(self) -> int:
        jitter_allowance = max(30, self.config.poll_interval_seconds // 2)
        return max(
            self.config.freshness_seconds,
            self.config.poll_interval_seconds + jitter_allowance,
        )

    def _http_request_spacing_seconds(self) -> float:
        # Five 40-CU signature requests per second remain below the documented
        # free-tier 300 CU/s throughput before accounting for the single getSlot.
        return 0.2

    async def _wait_for_next_poll(self, timeout: float | None) -> None:
        try:
            if timeout is None:
                await self._poll_wake_event.wait()
            else:
                await asyncio.wait_for(self._poll_wake_event.wait(), timeout=timeout)
        except TimeoutError:
            pass
        finally:
            self._poll_wake_event.clear()

    async def _poll_once(self) -> bool:
        candidates = self._candidate_mints
        if not candidates:
            self._connected = False
            self._state = "waiting_for_candidates"
            return False

        cursor_slot, _ = await self.store.load_cursor()
        self._poll_cycles_attempted += 1
        self._backfill_pending = True
        self._connected = False
        self._state = "polling"
        try:
            complete = await self._backfill_candidates(
                candidates,
                cursor_slot=cursor_slot,
                full_window=cursor_slot is None,
            )
            polled_slot = self._backfill_current_slot
            complete = bool(
                complete
                and polled_slot is not None
                and candidates == self._candidate_mints
            )
            if not complete or polled_slot is None:
                self._poll_cycles_failed += 1
                self._polled_candidate_mints = ()
                self._state = "degraded"
                if self._last_error_code is None:
                    self._last_error_code = "http_poll_incomplete"
                return False

            completed_at = _utc_now()
            current_slot = int(polled_slot)
            await self.store.save_cursor(current_slot, completed_at)
            self._last_slot = max(current_slot, self._last_slot or 0)
            self._last_received_at = completed_at
            self._last_connected_at = completed_at
            self._last_poll_completed_at = completed_at
            self._polled_candidate_mints = candidates
            self._received_updates += 1
            self._processed_updates += 1
            self._poll_cycles_completed += 1
            self._last_error_code = None
            self._connected = True
            self._state = "connected"
            return True
        finally:
            self._backfill_pending = False

    async def _run(self) -> None:
        self._state = "waiting_for_candidates"
        while not self._stop_event.is_set():
            if not self._candidate_mints:
                self._poll_wake_event.clear()
                await self._wait_for_next_poll(None)
                continue

            self._poll_wake_event.clear()
            await self._poll_once()
            if self._stop_event.is_set():
                break
            await self._wait_for_next_poll(float(self.config.poll_interval_seconds))

    def _observation_coverage_complete(self, now: datetime | None = None) -> bool:
        del now
        return bool(
            self._candidate_mints
            and not self._backfill_pending
            and self._backfill_coverage_complete
            and self._polled_candidate_mints == self._candidate_mints
        )

    def _transport_degraded(self) -> bool:
        return bool(
            self._backfill_pending
            or not self._observation_coverage_complete()
            or not self._connected
        )

    def _subscription_health(self) -> dict[str, Any]:
        active_count = len(self._active_candidate_mints())
        freshness, _ = self._transport_freshness()
        return {
            "candidateCount": len(self._candidate_mints),
            "activeCandidateCount": active_count,
            "pendingCandidateCount": max(0, len(self._candidate_mints) - active_count),
            "failedCandidateCount": self._backfill_failures + self._backfill_truncated_candidates,
            "maxCandidates": self.config.max_candidates,
            "connectionCount": 0,
            "activeSubscriptionCount": 0,
            "transactionMethod": "getSignaturesForAddress",
            "transactionFilter": "one_address_per_confirmed_http_request",
            "transactionCommitment": "confirmed",
            "heartbeatMethod": "getSlot",
            "heartbeatSource": "confirmed_http_json_rpc",
            "heartbeatFallback": False,
            "heartbeatCommitment": "confirmed",
            "heartbeatActive": self._connected and freshness == "fresh",
            "rootSubscriptionActive": False,
            "voteTransactions": False,
            "failedTransactions": False,
            "activityWindowSeconds": self.config.activity_window_seconds,
            "refreshSeconds": self.config.candidate_refresh_seconds,
            "pollIntervalSeconds": self.config.poll_interval_seconds,
            "lastPollCompletedAt": _public_time(self._last_poll_completed_at),
        }

    def _cost_guard_health(self) -> dict[str, Any]:
        candidate_count = len(self._candidate_mints)
        cycles_per_30_days = HTTP_POLL_SECONDS_PER_30_DAYS / self.config.poll_interval_seconds

        def estimate(count: int) -> tuple[int, int, int, int, int, int]:
            baseline_requests = 1 + count
            available_extra_pages = min(
                self.config.backfill_extra_page_budget,
                count * max(0, self.config.backfill_max_pages_per_candidate - 1),
            )
            bounded_requests = baseline_requests + available_extra_pages
            baseline_per_cycle = (
                HTTP_POLL_GET_SLOT_COMPUTE_UNITS
                + count * HTTP_POLL_GET_SIGNATURES_COMPUTE_UNITS
            )
            bounded_per_cycle = (
                baseline_per_cycle
                + available_extra_pages * HTTP_POLL_GET_SIGNATURES_COMPUTE_UNITS
            )
            baseline_per_month = round(baseline_per_cycle * cycles_per_30_days)
            bounded_per_month = round(bounded_per_cycle * cycles_per_30_days)
            return (
                baseline_requests,
                bounded_requests,
                baseline_per_cycle,
                bounded_per_cycle,
                baseline_per_month,
                bounded_per_month,
            )

        (
            baseline_requests,
            bounded_requests,
            baseline_per_cycle,
            bounded_per_cycle,
            baseline_per_month,
            bounded_per_month,
        ) = estimate(candidate_count)
        (
            maximum_baseline_requests,
            maximum_bounded_requests,
            maximum_baseline_per_cycle,
            maximum_bounded_per_cycle,
            maximum_baseline_per_month,
            maximum_bounded_per_month,
        ) = estimate(self.config.max_candidates)
        return {
            "pollIntervalSeconds": self.config.poll_interval_seconds,
            "candidateCount": candidate_count,
            "baselineRequestsPerCycle": baseline_requests,
            "requestsPerCycle": bounded_requests,
            "baselineComputeUnitsPerCycle": baseline_per_cycle,
            "estimatedComputeUnitsPerCycle": bounded_per_cycle,
            "baselineComputeUnitsPer30Days": baseline_per_month,
            "estimatedComputeUnitsPer30Days": bounded_per_month,
            "maximumBaselineRequestsPerCycle": maximum_baseline_requests,
            "maximumRequestsPerCycle": maximum_bounded_requests,
            "maximumBaselineComputeUnitsPerCycle": maximum_baseline_per_cycle,
            "maximumEstimatedComputeUnitsPerCycle": maximum_bounded_per_cycle,
            "maximumBaselineComputeUnitsPer30Days": maximum_baseline_per_month,
            "maximumEstimatedComputeUnitsPer30Days": maximum_bounded_per_month,
            "pagination": {
                "limitPerPage": self.config.backfill_limit_per_candidate,
                "maxPagesPerCandidate": self.config.backfill_max_pages_per_candidate,
                "extraPageBudgetPerCycle": self.config.backfill_extra_page_budget,
            },
            "assumptions": {
                "getSlotComputeUnits": HTTP_POLL_GET_SLOT_COMPUTE_UNITS,
                "getSignaturesForAddressComputeUnits": HTTP_POLL_GET_SIGNATURES_COMPUTE_UNITS,
                "days": 30,
                "excludesRetriesAndOtherApplicationTraffic": True,
            },
        }

    def _recovery_health(self, cursor: dict[str, Any]) -> dict[str, Any]:
        coverage_complete = self._observation_coverage_complete()
        return {
            "mode": "http_signature_polling",
            "nativeProviderReplay": False,
            "cursorSlot": cursor["slot"],
            "cursorUpdatedAt": cursor["updatedAt"],
            "cursorPersistence": cursor["persistence"],
            "cursorDurable": cursor["durable"],
            "rewindSlots": self.config.replay_rewind_slots,
            "maxReplaySlots": self.config.backfill_max_slots,
            "requestedFromSlot": self._replay_from_slot,
            "providerFirstAvailableSlot": None,
            "currentSlotAtPoll": self._backfill_current_slot,
            "limitPerCandidate": self.config.backfill_limit_per_candidate,
            "limitPerPage": self.config.backfill_limit_per_candidate,
            "maximumSignaturesPerCandidate": (
                self.config.backfill_limit_per_candidate
                * self.config.backfill_max_pages_per_candidate
            ),
            "candidatesAttempted": self._backfill_candidates_attempted,
            "candidatesCompleted": self._backfill_candidates_completed,
            "signaturesScanned": self._backfill_signatures_scanned,
            "pagesRequested": self._backfill_pages_requested,
            "extraPagesUsed": self._backfill_extra_pages_used,
            "maxPagesPerCandidate": self.config.backfill_max_pages_per_candidate,
            "extraPageBudget": self.config.backfill_extra_page_budget,
            "truncatedCandidates": self._backfill_truncated_candidates,
            "failures": self._backfill_failures,
            "lastPollAt": _public_time(self._last_backfill_at),
            "pending": self._backfill_pending,
            "coverageComplete": coverage_complete,
            "coverageBasis": "bounded_http_poll_cycle" if coverage_complete else "incomplete",
            "basis": self._backfill_basis,
            "reason": self._replay_reason,
        }

    def _reliability_health(self) -> dict[str, Any]:
        health = AlchemyYellowstoneStream._reliability_health(self)
        health.update(
            {
                "httpFailures": self._backfill_failures,
                "truncatedCandidates": self._backfill_truncated_candidates,
                "pollCyclesAttempted": self._poll_cycles_attempted,
                "pollCyclesCompleted": self._poll_cycles_completed,
                "pollCyclesFailed": self._poll_cycles_failed,
                "costGuard": self._cost_guard_health(),
            }
        )
        return health


def create_alchemy_stream(
    config: AlchemyStreamConfig | None = None,
    store: AlchemyStreamStore | None = None,
) -> AlchemyYellowstoneStream:
    selected = config or AlchemyStreamConfig.from_env()
    if selected.transport == "yellowstone_grpc":
        return AlchemyYellowstoneStream(selected, store)
    if selected.transport == "solana_pubsub":
        return AlchemySolanaPubSubStream(selected, store)
    return AlchemySolanaHttpPollingStream(selected, store)
