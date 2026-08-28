"""Bounded Alchemy stream for Arena Director activity evidence.

Birdeye remains the candidate-discovery and base market-data provider. This
module watches confirmed transactions that mention those candidate mint
accounts, persists a replay cursor, deduplicates rewind overlap, and exposes
public-safe health. An observation is deliberately not called a trade, user,
price, or volume event because this adapter does not parse that evidence.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Iterable, Sequence
from urllib.parse import quote, urlparse

import asyncpg  # type: ignore[import-untyped]
import grpc

from yellowstone_proto import geyser_pb2 as _geyser_pb2
from yellowstone_proto import geyser_pb2_grpc as _geyser_pb2_grpc


# Python protobuf modules build most message attributes dynamically. Keep that
# boundary explicitly untyped while retaining mypy coverage for adapter logic.
geyser_pb2: Any = _geyser_pb2
geyser_pb2_grpc: Any = _geyser_pb2_grpc


_LOGGER = logging.getLogger(__name__)

DEFAULT_ALCHEMY_YELLOWSTONE_ENDPOINT = "https://solana-mainnet.g.alchemy.com"
DEFAULT_ALCHEMY_SOLANA_WS_ENDPOINT = "wss://solana-mainnet.g.alchemy.com"
DEFAULT_ALCHEMY_SOLANA_HTTP_ENDPOINT = "https://solana-mainnet.g.alchemy.com"
DEFAULT_ALCHEMY_STREAM_TRANSPORT = "solana_pubsub"
SUPPORTED_ALCHEMY_STREAM_TRANSPORTS = {"solana_pubsub", "yellowstone_grpc"}
YELLOWSTONE_PROTOCOL_VERSION = "v15.1.2+solana.4.2.0"
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SOLANA_ADDRESS_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

ALCHEMY_STREAM_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS alchemy_stream_cursor (
    singleton       SMALLINT PRIMARY KEY CHECK (singleton = 1),
    last_slot       BIGINT NOT NULL CHECK (last_slot >= 0),
    last_update_at  TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alchemy_stream_transactions (
    signature_hash  TEXT PRIMARY KEY CHECK (length(signature_hash) = 64),
    slot            BIGINT NOT NULL CHECK (slot >= 0),
    observed_at     TIMESTAMPTZ NOT NULL,
    mints           TEXT[] NOT NULL CHECK (cardinality(mints) > 0)
);

CREATE INDEX IF NOT EXISTS idx_alchemy_stream_transactions_observed
    ON alchemy_stream_transactions (observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alchemy_stream_transactions_mints
    ON alchemy_stream_transactions USING GIN (mints);
"""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _public_time(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _b58encode(raw: bytes) -> str:
    """Encode bytes without adding a second Solana SDK dependency."""
    if not raw:
        return ""
    leading_zeroes = len(raw) - len(raw.lstrip(b"\0"))
    value = int.from_bytes(raw, "big")
    encoded: list[str] = []
    while value:
        value, remainder = divmod(value, 58)
        encoded.append(BASE58_ALPHABET[remainder])
    return ("1" * leading_zeroes) + ("".join(reversed(encoded)) or "")


def calculate_replay_start(
    last_slot: int | None,
    current_slot: int,
    *,
    rewind_slots: int,
    max_replay_slots: int,
    provider_first_available: int | None = None,
) -> tuple[int | None, str]:
    """Return a conservative replay cursor and a public-safe reason code."""
    if last_slot is None or last_slot < 0:
        return None, "no_durable_cursor"

    current = max(0, int(current_slot))
    requested = max(0, int(last_slot) - max(0, int(rewind_slots)))
    replay_floor = max(0, current - max(1, int(max_replay_slots)))
    if provider_first_available is not None:
        replay_floor = max(replay_floor, max(0, int(provider_first_available)))

    replay_from = max(replay_floor, min(requested, current))
    reason = "cursor_rewind" if replay_from == requested else "cursor_clamped_to_replay_window"
    return replay_from, reason


@dataclass(frozen=True)
class AlchemyStreamConfig:
    enabled: bool
    api_key: str = field(repr=False)
    transport: str = DEFAULT_ALCHEMY_STREAM_TRANSPORT
    endpoint: str = field(default=DEFAULT_ALCHEMY_YELLOWSTONE_ENDPOINT, repr=False)
    websocket_endpoint: str = field(default=DEFAULT_ALCHEMY_SOLANA_WS_ENDPOINT, repr=False)
    http_endpoint: str = field(default=DEFAULT_ALCHEMY_SOLANA_HTTP_ENDPOINT, repr=False)
    freshness_seconds: int = 20
    activity_window_seconds: int = 180
    max_candidates: int = 32
    replay_rewind_slots: int = 32
    replay_max_slots: int = 6_000
    queue_size: int = 2_048
    reconnect_min_seconds: int = 1
    reconnect_max_seconds: int = 30
    candidate_refresh_seconds: int = 180
    dedupe_retention_seconds: int = 21_600
    rpc_timeout_seconds: int = 12
    backfill_max_slots: int = 512
    backfill_limit_per_candidate: int = 25
    backfill_min_interval_seconds: int = 60

    @classmethod
    def from_env(cls) -> "AlchemyStreamConfig":
        activity_window = _env_int(
            "ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS",
            180,
            minimum=30,
            maximum=3_600,
        )
        reconnect_min = _env_int(
            "ALCHEMY_STREAM_RECONNECT_MIN_SECONDS",
            1,
            minimum=1,
            maximum=30,
        )
        reconnect_max = max(
            reconnect_min,
            _env_int(
                "ALCHEMY_STREAM_RECONNECT_MAX_SECONDS",
                30,
                minimum=2,
                maximum=300,
            ),
        )
        return cls(
            enabled=_env_bool("ALCHEMY_STREAM_ENABLED"),
            api_key=os.environ.get("ALCHEMY_API_KEY", "").strip(),
            transport=os.environ.get(
                "ALCHEMY_STREAM_TRANSPORT",
                DEFAULT_ALCHEMY_STREAM_TRANSPORT,
            ).strip().lower(),
            endpoint=os.environ.get(
                "ALCHEMY_YELLOWSTONE_ENDPOINT",
                DEFAULT_ALCHEMY_YELLOWSTONE_ENDPOINT,
            ).strip(),
            websocket_endpoint=os.environ.get(
                "ALCHEMY_SOLANA_WS_ENDPOINT",
                DEFAULT_ALCHEMY_SOLANA_WS_ENDPOINT,
            ).strip(),
            http_endpoint=os.environ.get(
                "ALCHEMY_SOLANA_HTTP_ENDPOINT",
                DEFAULT_ALCHEMY_SOLANA_HTTP_ENDPOINT,
            ).strip(),
            freshness_seconds=_env_int(
                "ALCHEMY_STREAM_FRESHNESS_SECONDS",
                20,
                minimum=5,
                maximum=300,
            ),
            activity_window_seconds=activity_window,
            max_candidates=_env_int(
                "ALCHEMY_STREAM_MAX_CANDIDATES",
                32,
                minimum=1,
                maximum=100,
            ),
            replay_rewind_slots=_env_int(
                "ALCHEMY_STREAM_REWIND_SLOTS",
                32,
                minimum=0,
                maximum=512,
            ),
            replay_max_slots=_env_int(
                "ALCHEMY_STREAM_MAX_REPLAY_SLOTS",
                6_000,
                minimum=100,
                maximum=432_000,
            ),
            queue_size=_env_int(
                "ALCHEMY_STREAM_QUEUE_SIZE",
                2_048,
                minimum=128,
                maximum=20_000,
            ),
            reconnect_min_seconds=reconnect_min,
            reconnect_max_seconds=reconnect_max,
            candidate_refresh_seconds=_env_int(
                "ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS",
                180,
                minimum=30,
                maximum=1_800,
            ),
            dedupe_retention_seconds=max(
                activity_window,
                _env_int(
                    "ALCHEMY_STREAM_DEDUPE_RETENTION_SECONDS",
                    21_600,
                    minimum=300,
                    maximum=172_800,
                ),
            ),
            rpc_timeout_seconds=_env_int(
                "ALCHEMY_STREAM_RPC_TIMEOUT_SECONDS",
                12,
                minimum=3,
                maximum=60,
            ),
            backfill_max_slots=_env_int(
                "ALCHEMY_STREAM_BACKFILL_MAX_SLOTS",
                512,
                minimum=32,
                maximum=6_000,
            ),
            backfill_limit_per_candidate=_env_int(
                "ALCHEMY_STREAM_BACKFILL_LIMIT_PER_CANDIDATE",
                25,
                minimum=1,
                maximum=100,
            ),
            backfill_min_interval_seconds=_env_int(
                "ALCHEMY_STREAM_BACKFILL_MIN_INTERVAL_SECONDS",
                60,
                minimum=30,
                maximum=1_800,
            ),
        )

    @property
    def endpoint_parts(self):
        return urlparse(self.endpoint)

    @staticmethod
    def _safe_alchemy_endpoint(endpoint: str, *, scheme: str) -> bool:
        parsed = urlparse(endpoint)
        try:
            port_valid = parsed.port is None or 1 <= parsed.port <= 65_535
        except ValueError:
            port_valid = False
        hostname = parsed.hostname or ""
        alchemy_host = hostname == "alchemy.com" or hostname.endswith(".alchemy.com")
        return bool(
            parsed.scheme == scheme
            and alchemy_host
            and port_valid
            and not parsed.username
            and not parsed.password
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )

    @property
    def endpoint_valid(self) -> bool:
        return self._safe_alchemy_endpoint(self.endpoint, scheme="https")

    @property
    def websocket_endpoint_valid(self) -> bool:
        return self._safe_alchemy_endpoint(self.websocket_endpoint, scheme="wss")

    @property
    def http_endpoint_valid(self) -> bool:
        return self._safe_alchemy_endpoint(self.http_endpoint, scheme="https")

    @property
    def transport_supported(self) -> bool:
        return self.transport in SUPPORTED_ALCHEMY_STREAM_TRANSPORTS

    @property
    def endpoint_host(self) -> str | None:
        if self.transport == "solana_pubsub":
            parsed = urlparse(self.websocket_endpoint)
            return parsed.hostname if self.websocket_endpoint_valid and self.http_endpoint_valid else None
        return self.endpoint_parts.hostname if self.endpoint_valid else None

    @property
    def endpoint_target(self) -> str:
        parsed = self.endpoint_parts
        host = parsed.hostname or ""
        return f"{host}:{parsed.port or 443}"

    @property
    def websocket_uri(self) -> str:
        return f"{self.websocket_endpoint.rstrip('/')}/v2/{quote(self.api_key, safe='')}"

    @property
    def http_rpc_url(self) -> str:
        return f"{self.http_endpoint.rstrip('/')}/v2/{quote(self.api_key, safe='')}"

    @property
    def configured(self) -> bool:
        if not self.api_key or not self.transport_supported:
            return False
        if self.transport == "yellowstone_grpc":
            return self.endpoint_valid
        return self.websocket_endpoint_valid and self.http_endpoint_valid


async def ensure_alchemy_stream_schema(pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
    """Create operational cursor/dedupe tables when PostgreSQL is available."""
    async with pool.acquire() as conn:
        await conn.execute(ALCHEMY_STREAM_SCHEMA_SQL)


@dataclass(frozen=True)
class _ActivityEvent:
    signature_hash: str
    slot: int
    observed_at: datetime
    mints: tuple[str, ...]


class AlchemyStreamStore:
    """Durable cursor plus bounded operational activity cache.

    These records are provider-ingestion state, not gameplay telemetry, reward
    eligibility, or an onchain accounting ledger. Old dedupe rows are pruned.
    """

    def __init__(
        self,
        pool: asyncpg.Pool | None = None,  # type: ignore[type-arg]
        *,
        memory_event_limit: int = 20_000,
    ) -> None:
        self._pool = pool
        self._database_healthy = pool is not None
        self._memory_event_limit = max(100, int(memory_event_limit))
        self._lock = asyncio.Lock()
        self._last_slot: int | None = None
        self._last_update_at: datetime | None = None
        self._events: OrderedDict[str, _ActivityEvent] = OrderedDict()

    @property
    def durable(self) -> bool:
        return self._pool is not None and self._database_healthy

    async def load_cursor(self) -> tuple[int | None, datetime | None]:
        if self._pool is not None:
            try:
                async with self._pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT last_slot, last_update_at FROM alchemy_stream_cursor WHERE singleton = 1"
                    )
                self._database_healthy = True
                if row is not None:
                    async with self._lock:
                        self._last_slot = int(row["last_slot"])
                        self._last_update_at = row["last_update_at"]
            except Exception as exc:
                self._database_healthy = False
                _LOGGER.warning("Alchemy cursor read fell back to process memory: %s", type(exc).__name__)

        async with self._lock:
            return self._last_slot, self._last_update_at

    async def save_cursor(self, slot: int, observed_at: datetime) -> bool:
        normalized_slot = max(0, int(slot))
        normalized_time = observed_at.astimezone(timezone.utc)
        async with self._lock:
            if self._last_slot is None or normalized_slot >= self._last_slot:
                self._last_slot = normalized_slot
                self._last_update_at = normalized_time

        if self._pool is None:
            return False
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO alchemy_stream_cursor (singleton, last_slot, last_update_at)
                    VALUES (1, $1, $2)
                    ON CONFLICT (singleton) DO UPDATE SET
                        last_update_at = CASE
                            WHEN EXCLUDED.last_slot >= alchemy_stream_cursor.last_slot
                            THEN EXCLUDED.last_update_at
                            ELSE alchemy_stream_cursor.last_update_at
                        END,
                        last_slot = GREATEST(alchemy_stream_cursor.last_slot, EXCLUDED.last_slot),
                        updated_at = NOW()
                    """,
                    normalized_slot,
                    normalized_time,
                )
            self._database_healthy = True
            return True
        except Exception as exc:
            self._database_healthy = False
            _LOGGER.warning("Alchemy cursor write fell back to process memory: %s", type(exc).__name__)
            return False

    async def record_activity(
        self,
        signature_hash: str,
        slot: int,
        observed_at: datetime,
        mints: Iterable[str],
    ) -> bool:
        normalized_mints = tuple(sorted({mint for mint in mints if SOLANA_ADDRESS_RE.fullmatch(mint)}))
        if len(signature_hash) != 64 or not normalized_mints:
            return False

        event = _ActivityEvent(
            signature_hash=signature_hash,
            slot=max(0, int(slot)),
            observed_at=observed_at.astimezone(timezone.utc),
            mints=normalized_mints,
        )

        if self._pool is not None:
            try:
                async with self._pool.acquire() as conn:
                    result = await conn.execute(
                        """
                        INSERT INTO alchemy_stream_transactions (signature_hash, slot, observed_at, mints)
                        VALUES ($1, $2, $3, $4::TEXT[])
                        ON CONFLICT (signature_hash) DO NOTHING
                        """,
                        event.signature_hash,
                        event.slot,
                        event.observed_at,
                        list(event.mints),
                    )
                self._database_healthy = True
                inserted = result.endswith("1")
                if not inserted:
                    async with self._pool.acquire() as conn:
                        await conn.execute(
                            """
                            UPDATE alchemy_stream_transactions
                            SET slot = GREATEST(slot, $2),
                                observed_at = GREATEST(observed_at, $3),
                                mints = (
                                    SELECT ARRAY_AGG(DISTINCT value ORDER BY value)
                                    FROM UNNEST(mints || $4::TEXT[]) AS mint_value(value)
                                )
                            WHERE signature_hash = $1
                            """,
                            event.signature_hash,
                            event.slot,
                            event.observed_at,
                            list(event.mints),
                        )
                remembered = await self._remember(event)
                return inserted and remembered
            except Exception as exc:
                self._database_healthy = False
                _LOGGER.warning("Alchemy activity write fell back to process memory: %s", type(exc).__name__)

        return await self._remember(event)

    async def _remember(self, event: _ActivityEvent) -> bool:
        async with self._lock:
            existing = self._events.get(event.signature_hash)
            if existing is not None:
                self._events[event.signature_hash] = _ActivityEvent(
                    signature_hash=event.signature_hash,
                    slot=max(existing.slot, event.slot),
                    observed_at=max(existing.observed_at, event.observed_at),
                    mints=tuple(sorted(set(existing.mints).union(event.mints))),
                )
                self._events.move_to_end(event.signature_hash)
                return False
            self._events[event.signature_hash] = event
            while len(self._events) > self._memory_event_limit:
                self._events.popitem(last=False)
            return True

    async def activity_snapshot(
        self,
        mints: Sequence[str],
        *,
        since: datetime,
    ) -> dict[str, Any]:
        normalized_mints = tuple(dict.fromkeys(mint for mint in mints if SOLANA_ADDRESS_RE.fullmatch(mint)))
        if not normalized_mints:
            return {"totalTransactions": 0, "latestObservedAt": None, "byMint": {}}

        events: list[_ActivityEvent] | None = None
        if self._pool is not None:
            try:
                async with self._pool.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT signature_hash, slot, observed_at, mints
                        FROM alchemy_stream_transactions
                        WHERE observed_at >= $1
                          AND mints && $2::TEXT[]
                        ORDER BY observed_at ASC
                        """,
                        since.astimezone(timezone.utc),
                        list(normalized_mints),
                    )
                self._database_healthy = True
                events = [
                    _ActivityEvent(
                        signature_hash=str(row["signature_hash"]),
                        slot=int(row["slot"]),
                        observed_at=row["observed_at"],
                        mints=tuple(str(value) for value in row["mints"]),
                    )
                    for row in rows
                ]
            except Exception as exc:
                self._database_healthy = False
                _LOGGER.warning("Alchemy activity read fell back to process memory: %s", type(exc).__name__)

        if events is None:
            async with self._lock:
                events = [event for event in self._events.values() if event.observed_at >= since]

        requested = set(normalized_mints)
        by_mint: dict[str, dict[str, Any]] = {
            mint: {
                "observedConfirmedTransactions": 0,
                "lastObservedAt": None,
                "lastSlot": None,
            }
            for mint in normalized_mints
        }
        matching_signatures: set[str] = set()
        latest: datetime | None = None
        for event in events:
            matched = requested.intersection(event.mints)
            if not matched:
                continue
            matching_signatures.add(event.signature_hash)
            latest = event.observed_at if latest is None or event.observed_at > latest else latest
            for mint in matched:
                metric = by_mint[mint]
                metric["observedConfirmedTransactions"] += 1
                previous_time = metric["lastObservedAt"]
                if previous_time is None or event.observed_at > previous_time:
                    metric["lastObservedAt"] = event.observed_at
                    metric["lastSlot"] = event.slot

        for metric in by_mint.values():
            metric["lastObservedAt"] = _public_time(metric["lastObservedAt"])
        return {
            "totalTransactions": len(matching_signatures),
            "latestObservedAt": _public_time(latest),
            "byMint": by_mint,
        }

    async def prune(self, *, before: datetime) -> None:
        cutoff = before.astimezone(timezone.utc)
        async with self._lock:
            stale = [key for key, event in self._events.items() if event.observed_at < cutoff]
            for key in stale:
                self._events.pop(key, None)

        if self._pool is not None:
            try:
                async with self._pool.acquire() as conn:
                    await conn.execute(
                        "DELETE FROM alchemy_stream_transactions WHERE observed_at < $1",
                        cutoff,
                    )
                self._database_healthy = True
            except Exception as exc:
                self._database_healthy = False
                _LOGGER.warning("Alchemy dedupe pruning skipped: %s", type(exc).__name__)

    async def cursor_status(self) -> dict[str, Any]:
        async with self._lock:
            return {
                "slot": self._last_slot,
                "updatedAt": _public_time(self._last_update_at),
                "persistence": "postgres" if self.durable else "process_memory",
                "durable": self.durable,
            }


@dataclass(frozen=True)
class _IngressUpdate:
    message: Any
    received_at: datetime
    candidate_mints: tuple[str, ...]


class _ProcessingBackpressure(RuntimeError):
    pass


class AlchemyYellowstoneStream:
    """Lifecycle-managed Yellowstone connection with replay and health evidence."""

    transport_name = "yellowstone_grpc"
    protocol_version = YELLOWSTONE_PROTOCOL_VERSION
    provider_channel = "yellowstone_candidate_activity"
    task_name = "alchemy-yellowstone-stream"

    def __init__(self, config: AlchemyStreamConfig, store: AlchemyStreamStore | None = None) -> None:
        self.config = config
        self.store = store or AlchemyStreamStore()
        self._stop_event = asyncio.Event()
        self._run_task: asyncio.Task[None] | None = None
        self._processor_task: asyncio.Task[None] | None = None
        self._updates: asyncio.Queue[_IngressUpdate] = asyncio.Queue(maxsize=config.queue_size)
        self._request_queue: asyncio.Queue[Any | None] | None = None
        self._candidate_mints: tuple[str, ...] = ()
        self._connected = False
        self._state = "disabled" if not config.enabled else "stopped"
        if config.enabled and not config.configured:
            self._state = "misconfigured"
        self._last_connected_at: datetime | None = None
        self._last_received_at: datetime | None = None
        self._last_slot: int | None = None
        self._last_error_code: str | None = None
        self._reconnects = 0
        self._dropped_updates = 0
        self._received_updates = 0
        self._processed_updates = 0
        self._candidate_transactions = 0
        self._subscription_updates = 0
        self._replay_from_slot: int | None = None
        self._replay_reason = "not_started"
        self._provider_first_available: int | None = None
        self._last_pruned_at: datetime | None = None

    @property
    def should_start(self) -> bool:
        return self.config.enabled and self.config.configured

    @property
    def running(self) -> bool:
        return self._run_task is not None and not self._run_task.done()

    async def start(self) -> bool:
        if not self.config.enabled:
            self._state = "disabled"
            return False
        if not self.config.configured:
            self._state = "misconfigured"
            return False
        if self.running:
            return True

        await self.store.load_cursor()
        self._stop_event.clear()
        self._state = "connecting"
        self._processor_task = asyncio.create_task(self._processor_loop(), name="alchemy-stream-processor")
        self._run_task = asyncio.create_task(self._run(), name=self.task_name)
        return True

    async def stop(self) -> None:
        self._stop_event.set()
        for task in (self._run_task, self._processor_task):
            if task is not None and not task.done():
                task.cancel()
        for task in (self._run_task, self._processor_task):
            if task is not None:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._run_task = None
        self._processor_task = None
        self._request_queue = None
        self._connected = False
        self._state = "disabled" if not self.config.enabled else "stopped"

    async def set_candidates(self, mints: Iterable[str]) -> tuple[str, ...]:
        selected: list[str] = []
        seen: set[str] = set()
        for raw_mint in mints:
            mint = str(raw_mint or "").strip()
            if mint in seen or not SOLANA_ADDRESS_RE.fullmatch(mint):
                continue
            selected.append(mint)
            seen.add(mint)
            if len(selected) >= self.config.max_candidates:
                break

        normalized = tuple(sorted(selected))
        if normalized == self._candidate_mints:
            return normalized
        previous = self._candidate_mints
        self._candidate_mints = normalized
        self._subscription_updates += 1
        await self._on_candidates_changed(previous, normalized)
        return normalized

    async def _on_candidates_changed(
        self,
        previous: tuple[str, ...],
        current: tuple[str, ...],
    ) -> None:
        del previous, current
        if self._connected and self._request_queue is not None:
            await self._enqueue_request(self._build_subscription_request(from_slot=None))

    def _active_candidate_mints(self) -> tuple[str, ...]:
        return self._candidate_mints

    def _public_endpoint_host(self) -> str | None:
        return self.config.endpoint_host

    def _subscription_health(self) -> dict[str, Any]:
        return {
            "candidateCount": len(self._candidate_mints),
            "activeCandidateCount": len(self._active_candidate_mints()),
            "maxCandidates": self.config.max_candidates,
            "transactionFilter": "account_include_any",
            "voteTransactions": False,
            "failedTransactions": False,
            "activityWindowSeconds": self.config.activity_window_seconds,
            "refreshSeconds": self.config.candidate_refresh_seconds,
        }

    def _recovery_health(self, cursor: dict[str, Any]) -> dict[str, Any]:
        return {
            "mode": "yellowstone_native_replay",
            "nativeProviderReplay": True,
            "cursorSlot": cursor["slot"],
            "cursorUpdatedAt": cursor["updatedAt"],
            "cursorPersistence": cursor["persistence"],
            "cursorDurable": cursor["durable"],
            "rewindSlots": self.config.replay_rewind_slots,
            "maxReplaySlots": self.config.replay_max_slots,
            "requestedFromSlot": self._replay_from_slot,
            "providerFirstAvailableSlot": self._provider_first_available,
            "reason": self._replay_reason,
        }

    def _reliability_health(self) -> dict[str, Any]:
        return {
            "reconnects": self._reconnects,
            "receivedUpdates": self._received_updates,
            "processedUpdates": self._processed_updates,
            "droppedUpdates": self._dropped_updates,
            "candidateTransactionsThisProcess": self._candidate_transactions,
            "subscriptionUpdates": self._subscription_updates,
            "lastErrorCode": self._last_error_code,
            "lastDedupePruneAt": _public_time(self._last_pruned_at),
        }

    def _transport_degraded(self) -> bool:
        return False

    def _observation_coverage_complete(self, now: datetime | None = None) -> bool:
        del now
        return True

    def _sanitize_transport_error(self, exc: Exception) -> str:
        if isinstance(exc, grpc.aio.AioRpcError):
            return f"grpc_{exc.code().name.lower()}"
        return type(exc).__name__

    def _connection_closed(self) -> None:
        self._request_queue = None

    def _build_subscription_request(self, *, from_slot: int | None) -> Any:
        transactions: dict[str, Any] = {}
        if self._candidate_mints:
            transactions["candidate_activity"] = geyser_pb2.SubscribeRequestFilterTransactions(
                vote=False,
                failed=False,
                account_include=list(self._candidate_mints),
            )

        request = geyser_pb2.SubscribeRequest(
            slots={
                "confirmed_slots": geyser_pb2.SubscribeRequestFilterSlots(
                    filter_by_commitment=True,
                    interslot_updates=False,
                )
            },
            transactions=transactions,
            commitment=geyser_pb2.CONFIRMED,
        )
        if from_slot is not None:
            request.from_slot = max(0, int(from_slot))
        return request

    async def _enqueue_request(self, request: Any) -> None:
        if self._request_queue is None:
            return
        try:
            await asyncio.wait_for(self._request_queue.put(request), timeout=2)
        except TimeoutError as exc:
            raise _ProcessingBackpressure("subscription_request_queue_full") from exc

    async def _request_iterator(self, queue: asyncio.Queue[Any | None]) -> AsyncIterator[Any]:
        while not self._stop_event.is_set():
            request = await queue.get()
            if request is None:
                return
            yield request

    async def _run(self) -> None:
        backoff = self.config.reconnect_min_seconds
        while not self._stop_event.is_set():
            received_before = self._received_updates
            try:
                await self._connect_once()
                if not self._stop_event.is_set():
                    self._last_error_code = "stream_closed"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error_code = self._sanitize_transport_error(exc)
            finally:
                self._connected = False
                self._connection_closed()

            if self._stop_event.is_set():
                break
            self._reconnects += 1
            self._state = "reconnecting"
            if self._received_updates > received_before:
                backoff = self.config.reconnect_min_seconds
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
            except TimeoutError:
                pass
            backoff = min(backoff * 2, self.config.reconnect_max_seconds)

    async def _connect_once(self) -> None:
        self._state = "connecting"
        credentials = grpc.ssl_channel_credentials()
        channel = grpc.aio.secure_channel(
            self.config.endpoint_target,
            credentials,
            options=(
                ("grpc.max_receive_message_length", 32 * 1024 * 1024),
                ("grpc.keepalive_time_ms", 30_000),
                ("grpc.keepalive_timeout_ms", 10_000),
            ),
        )
        metadata = (("x-token", self.config.api_key),)
        stub = geyser_pb2_grpc.GeyserStub(channel)
        try:
            current_response = await stub.GetSlot(
                geyser_pb2.GetSlotRequest(commitment=geyser_pb2.CONFIRMED),
                metadata=metadata,
                timeout=self.config.rpc_timeout_seconds,
            )
            current_slot = int(current_response.slot)
            provider_first: int | None = None
            try:
                replay_info = await stub.SubscribeReplayInfo(
                    geyser_pb2.SubscribeReplayInfoRequest(),
                    metadata=metadata,
                    timeout=self.config.rpc_timeout_seconds,
                )
                if replay_info.HasField("first_available"):
                    provider_first = int(replay_info.first_available)
            except grpc.aio.AioRpcError as exc:
                if exc.code() not in {grpc.StatusCode.UNIMPLEMENTED, grpc.StatusCode.NOT_FOUND}:
                    raise

            last_slot, _ = await self.store.load_cursor()
            replay_from, replay_reason = calculate_replay_start(
                last_slot,
                current_slot,
                rewind_slots=self.config.replay_rewind_slots,
                max_replay_slots=self.config.replay_max_slots,
                provider_first_available=provider_first,
            )
            self._replay_from_slot = replay_from
            self._replay_reason = replay_reason
            self._provider_first_available = provider_first

            request_queue: asyncio.Queue[Any | None] = asyncio.Queue(maxsize=16)
            self._request_queue = request_queue
            await request_queue.put(self._build_subscription_request(from_slot=replay_from))
            stream = stub.Subscribe(self._request_iterator(request_queue), metadata=metadata)
            self._connected = True
            self._state = "connected"
            self._last_connected_at = _utc_now()
            self._last_error_code = None

            async for message in stream:
                received_at = _utc_now()
                self._last_received_at = received_at
                self._received_updates += 1
                update_kind = message.WhichOneof("update_oneof")
                if update_kind == "ping":
                    await self._enqueue_request(
                        geyser_pb2.SubscribeRequest(
                            ping=geyser_pb2.SubscribeRequestPing(id=1)
                        )
                    )
                    continue

                envelope = _IngressUpdate(
                    message=message,
                    received_at=received_at,
                    candidate_mints=self._candidate_mints,
                )
                try:
                    await asyncio.wait_for(self._updates.put(envelope), timeout=5)
                except TimeoutError as exc:
                    self._dropped_updates += 1
                    raise _ProcessingBackpressure("processing_queue_full") from exc
        finally:
            await channel.close()

    async def _processor_loop(self) -> None:
        while not self._stop_event.is_set():
            envelope = await self._updates.get()
            try:
                await self._process_update(envelope)
                self._processed_updates += 1
                if self._processed_updates % 500 == 0:
                    await self._prune_dedupe_cache()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error_code = f"processor_{type(exc).__name__}"
                _LOGGER.warning("Alchemy stream update skipped: %s", type(exc).__name__)
            finally:
                self._updates.task_done()

    async def _process_update(self, envelope: _IngressUpdate) -> None:
        message = envelope.message
        update_kind = message.WhichOneof("update_oneof")
        if update_kind == "slot":
            slot_update = message.slot
            if int(slot_update.status) != int(geyser_pb2.SLOT_CONFIRMED):
                return
            slot = int(slot_update.slot)
            await self.store.save_cursor(slot, envelope.received_at)
            self._last_slot = max(slot, self._last_slot or 0)
            return

        if update_kind != "transaction":
            return

        transaction_update = message.transaction
        info = transaction_update.transaction
        if info is None or not info.signature:
            return

        account_keys: list[bytes] = []
        if info.HasField("transaction") and info.transaction.HasField("message"):
            account_keys.extend(info.transaction.message.account_keys)
        if info.HasField("meta"):
            account_keys.extend(info.meta.loaded_writable_addresses)
            account_keys.extend(info.meta.loaded_readonly_addresses)

        candidates = set(envelope.candidate_mints)
        matched = sorted(candidates.intersection(_b58encode(bytes(key)) for key in account_keys))
        slot = int(transaction_update.slot)
        if matched:
            signature_hash = hashlib.sha256(bytes(info.signature)).hexdigest()
            inserted = await self.store.record_activity(
                signature_hash,
                slot,
                envelope.received_at,
                matched,
            )
            if inserted:
                self._candidate_transactions += 1

        await self.store.save_cursor(slot, envelope.received_at)
        self._last_slot = max(slot, self._last_slot or 0)

    async def _prune_dedupe_cache(self) -> None:
        cutoff = _utc_now() - timedelta(seconds=self.config.dedupe_retention_seconds)
        await self.store.prune(before=cutoff)
        self._last_pruned_at = _utc_now()

    def _transport_freshness(self, now: datetime | None = None) -> tuple[str, float | None]:
        if self._last_received_at is None:
            return "unavailable", None
        observed_now = now or _utc_now()
        age = max(0.0, (observed_now - self._last_received_at).total_seconds())
        freshness = "fresh" if age <= self.config.freshness_seconds else "stale"
        return freshness, round(age, 3)

    async def enrich_candidate_lists(
        self,
        *candidate_lists: Sequence[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], ...]:
        """Attach activity for lifecycle-managed filters without mutating them."""
        freshness, _ = self._transport_freshness()
        active_mints = self._active_candidate_mints()
        active_mint_set = set(active_mints)
        score_eligible = (
            self._connected
            and freshness == "fresh"
            and bool(active_mints)
            and self._observation_coverage_complete()
        )
        snapshot: dict[str, Any] | None = None
        if score_eligible:
            snapshot = await self.store.activity_snapshot(
                list(active_mints),
                since=_utc_now() - timedelta(seconds=self.config.activity_window_seconds),
            )

        enriched_lists: list[list[dict[str, Any]]] = []
        for candidate_list in candidate_lists:
            enriched: list[dict[str, Any]] = []
            for token in candidate_list:
                copied = dict(token)
                mint = str(copied.get("mint") or copied.get("address") or "").strip()
                metric = (snapshot or {}).get("byMint", {}).get(mint)
                if score_eligible and mint in active_mint_set and metric is not None:
                    copied["alchemyActivity"] = {
                        "provider": "alchemy",
                        "transport": self.transport_name,
                        "freshness": freshness,
                        "scoreEligible": True,
                        "windowSeconds": self.config.activity_window_seconds,
                        "observedConfirmedTransactions": metric["observedConfirmedTransactions"],
                        "lastObservedAt": metric["lastObservedAt"],
                        "lastSlot": metric["lastSlot"],
                        "definition": "Confirmed transactions mentioning this candidate mint; not trades, volume, or unique users.",
                    }
                enriched.append(copied)
            enriched_lists.append(enriched)
        return tuple(enriched_lists)

    async def public_health(self) -> dict[str, Any]:
        now = _utc_now()
        freshness, age_seconds = self._transport_freshness(now)
        cursor = await self.store.cursor_status()

        active_mints = self._active_candidate_mints()
        activity: dict[str, Any]
        coverage_complete = self._observation_coverage_complete(now)
        if self._connected and freshness == "fresh" and active_mints and coverage_complete:
            snapshot = await self.store.activity_snapshot(
                list(active_mints),
                since=now - timedelta(seconds=self.config.activity_window_seconds),
            )
            activity = {
                "availability": "observed",
                "observedConfirmedTransactions": snapshot["totalTransactions"],
                "latestObservedAt": snapshot["latestObservedAt"],
                "scoreEligible": True,
            }
        elif not self.config.enabled:
            activity = {
                "availability": "stream_disabled",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        elif not self.config.configured:
            activity = {
                "availability": "stream_misconfigured",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        elif not self._candidate_mints:
            activity = {
                "availability": "waiting_for_candidates",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        elif self._connected and freshness == "unavailable":
            activity = {
                "availability": "waiting_for_transport_update",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        elif self._connected and not active_mints:
            activity = {
                "availability": "waiting_for_subscriptions",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        elif self._connected and freshness == "fresh" and not coverage_complete:
            activity = {
                "availability": "stream_coverage_incomplete",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }
        else:
            activity = {
                "availability": "stream_not_fresh",
                "observedConfirmedTransactions": None,
                "latestObservedAt": None,
                "scoreEligible": False,
            }

        if not self.config.enabled:
            status = "disabled"
        elif not self.config.configured:
            status = "misconfigured"
        elif self._connected and freshness == "stale":
            status = "stale"
        elif self._connected and freshness == "fresh" and (
            not cursor["durable"] or self._transport_degraded()
        ):
            status = "degraded"
        elif self._connected and freshness == "fresh":
            status = "live"
        else:
            status = self._state

        return {
            "provider": "alchemy",
            "transport": self.transport_name,
            "protocolVersion": self.protocol_version,
            "enabled": self.config.enabled,
            "configured": self.config.configured,
            "status": status,
            "freshness": freshness,
            "freshnessThresholdSeconds": self.config.freshness_seconds,
            "endpointHost": self._public_endpoint_host(),
            "commitment": "confirmed",
            "lastConnectedAt": _public_time(self._last_connected_at),
            "lastUpdateAt": _public_time(self._last_received_at),
            "ageSeconds": age_seconds,
            "lastSlot": self._last_slot or cursor["slot"],
            "subscription": self._subscription_health(),
            "replay": self._recovery_health(cursor),
            "reliability": self._reliability_health(),
            "activity": {
                **activity,
                "windowSeconds": self.config.activity_window_seconds,
                "definition": "Confirmed transactions mentioning subscribed candidate mints; not trades, USD volume, revenue, or unique users.",
            },
            "failover": {
                "baseSelectionProvider": "birdeye",
                "behavior": "Birdeye discovery and market scoring remain available; an unavailable or stale Alchemy stream contributes no activity bonus.",
            },
        }

    async def provider_snapshot(self) -> dict[str, Any]:
        health = await self.public_health()
        return {
            "provider": "alchemy",
            "channel": self.provider_channel,
            "state": health["status"],
            "freshness": health["freshness"],
            "snapshotAt": health["lastUpdateAt"],
            "observedAt": _utc_now().isoformat(),
            "ageSeconds": health["ageSeconds"],
            "tokenCount": health["subscription"]["candidateCount"],
            "requiredForSelection": False,
            "scoreEligible": health["activity"]["scoreEligible"],
            "cursorDurable": health["replay"]["cursorDurable"],
            "lastSlot": health["lastSlot"],
            "definition": health["activity"]["definition"],
        }
