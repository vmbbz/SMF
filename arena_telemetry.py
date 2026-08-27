"""Privacy-preserving, insert-only telemetry for the public StickLash arena.

Gameplay remains authoritative in the game loop and ranked settlement paths.
This module records bounded facts from those paths; it never decides winners,
changes ratings, or creates reward eligibility.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

import asyncpg  # type: ignore[import-untyped]


TELEMETRY_SCHEMA_VERSION = "2026-08-28.v1"
DEFAULT_MEMORY_EVENT_LIMIT = 500
DEFAULT_PUBLIC_RECENT_LIMIT = 8

_LOGGER = logging.getLogger(__name__)


TELEMETRY_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS arena_director_events (
    event_id              TEXT PRIMARY KEY,
    decision_id           TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('selected', 'no_candidate')),
    policy_version        TEXT NOT NULL,
    generated_at          TIMESTAMPTZ NOT NULL,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    selected_mint         TEXT NOT NULL DEFAULT '',
    selected_symbol       TEXT NOT NULL DEFAULT '',
    selected_score        DOUBLE PRECISION,
    candidate_count       INTEGER NOT NULL CHECK (candidate_count >= 0),
    market_data_state     TEXT NOT NULL CHECK (
        market_data_state IN ('fresh', 'degraded', 'stale', 'unavailable', 'unverified')
    ),
    provider_snapshots    JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_metrics      JSONB NOT NULL DEFAULT '{}'::jsonb,
    explanation           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_arena_director_events_recorded
    ON arena_director_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_director_events_token
    ON arena_director_events (selected_mint, recorded_at DESC)
    WHERE selected_mint <> '';

CREATE TABLE IF NOT EXISTS arena_match_events (
    event_id              TEXT PRIMARY KEY,
    match_id              TEXT NOT NULL DEFAULT '',
    room_code             TEXT NOT NULL,
    match_type            TEXT NOT NULL,
    ranked                BOOLEAN NOT NULL,
    league                TEXT NOT NULL DEFAULT '',
    input_category        TEXT NOT NULL DEFAULT '',
    winner_player         SMALLINT CHECK (winner_player IN (1, 2)),
    result                TEXT NOT NULL CHECK (result IN ('p1_win', 'p2_win', 'draw')),
    reason                TEXT NOT NULL,
    p1_health             DOUBLE PRECISION NOT NULL,
    p2_health             DOUBLE PRECISION NOT NULL,
    server_tick           BIGINT NOT NULL CHECK (server_tick >= 0),
    p1_boost_charges      INTEGER NOT NULL DEFAULT 0 CHECK (p1_boost_charges >= 0),
    p2_boost_charges      INTEGER NOT NULL DEFAULT 0 CHECK (p2_boost_charges >= 0),
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_match_events_recorded
    ON arena_match_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_match_events_competition
    ON arena_match_events (ranked, league, input_category, recorded_at DESC);

CREATE TABLE IF NOT EXISTS arena_share_events (
    event_id              TEXT PRIMARY KEY,
    share_id              TEXT NOT NULL UNIQUE,
    mode                  TEXT NOT NULL CHECK (mode IN ('solo', 'pvp')),
    result                TEXT NOT NULL CHECK (result IN ('win', 'loss')),
    token_symbol          TEXT NOT NULL DEFAULT '',
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_share_events_recorded
    ON arena_share_events (recorded_at DESC);

CREATE OR REPLACE FUNCTION sticklash_reject_telemetry_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'StickLash telemetry tables are insert-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_director_events_insert_only'
          AND tgrelid = 'arena_director_events'::regclass
    ) THEN
        CREATE TRIGGER arena_director_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_director_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_match_events_insert_only'
          AND tgrelid = 'arena_match_events'::regclass
    ) THEN
        CREATE TRIGGER arena_match_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_match_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_share_events_insert_only'
          AND tgrelid = 'arena_share_events'::regclass
    ) THEN
        CREATE TRIGGER arena_share_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_share_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
END $$;
"""


async def ensure_telemetry_schema(pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
    """Create the telemetry tables and their insert-only guards."""
    async with pool.acquire() as conn:
        await conn.execute(TELEMETRY_SCHEMA_SQL)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _datetime(value: Any) -> datetime:
    iso_value = _iso(value)
    if iso_value is None:
        return _utc_now()
    return datetime.fromisoformat(iso_value)


def _text(value: Any, limit: int = 160) -> str:
    return str(value or "").strip()[:limit]


def _integer(value: Any, minimum: int = 0) -> int:
    try:
        return max(int(value), minimum)
    except (TypeError, ValueError):
        return minimum


def _number(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def _json_safe_snapshots(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    snapshots: list[dict[str, Any]] = []
    for raw in value[:8]:
        if not isinstance(raw, dict):
            continue
        snapshots.append(
            {
                "provider": _text(raw.get("provider"), 40),
                "channel": _text(raw.get("channel"), 40),
                "state": _text(raw.get("state"), 40),
                "freshness": _text(raw.get("freshness"), 24),
                "snapshotAt": _iso(raw.get("snapshotAt")),
                "observedAt": _iso(raw.get("observedAt")),
                "ageSeconds": _number(raw.get("ageSeconds")),
                "tokenCount": _integer(raw.get("tokenCount")),
            }
        )
    return snapshots


def _decision_event(decision: dict[str, Any]) -> dict[str, Any]:
    opponent = decision.get("opponent") if isinstance(decision.get("opponent"), dict) else {}
    director = opponent.get("arenaDirector") if isinstance(opponent.get("arenaDirector"), dict) else {}
    metrics = {
        "volume24h": _number(opponent.get("volume24h")),
        "priceChange24h": _number(opponent.get("priceChange24h")),
        "liquidity": _number(opponent.get("liquidity")),
        "marketCap": _number(opponent.get("marketCap")),
    } if opponent else {}
    agent = decision.get("agent") if isinstance(decision.get("agent"), dict) else {}
    market_state = _text(decision.get("marketDataState"), 24)
    if market_state not in {"fresh", "degraded", "stale", "unavailable", "unverified"}:
        market_state = "unverified"
    status = "selected" if decision.get("status") == "selected" and opponent else "no_candidate"
    return {
        "event_id": str(uuid.uuid4()),
        "decision_id": _text(decision.get("decisionId"), 96) or "unknown-decision",
        "status": status,
        "policy_version": _text(agent.get("version"), 40) or "unknown",
        "generated_at": _datetime(decision.get("generatedAt")),
        "recorded_at": _utc_now(),
        "selected_mint": _text(opponent.get("mint") or opponent.get("address"), 64),
        "selected_symbol": _text(opponent.get("symbol"), 24),
        "selected_score": _number(director.get("score")) if opponent else None,
        "candidate_count": _integer(decision.get("candidateCount")),
        "market_data_state": market_state,
        "provider_snapshots": _json_safe_snapshots(decision.get("providerSnapshots")),
        "selected_metrics": metrics,
        "explanation": _text(decision.get("explanation"), 500),
    }


def _match_event(payload: dict[str, Any], *, ranked: bool) -> dict[str, Any]:
    winner_raw = payload.get("winner")
    winner = winner_raw if winner_raw in (1, 2) else None
    result = "draw" if winner is None else ("p1_win" if winner == 1 else "p2_win")
    match_id = _text(payload.get("match_id"), 96)
    telemetry_round_id = _text(payload.get("telemetry_round_id"), 96)
    room_code = _text(payload.get("room_code"), 96) or "unknown-room"
    server_tick = _integer(payload.get("server_tick"))
    identity = match_id or telemetry_round_id or f"{room_code}:{server_tick}"
    return {
        "event_id": f"match:{identity}",
        "match_id": match_id,
        "room_code": room_code,
        "match_type": _text(payload.get("match_type"), 40) or "private_casual",
        "ranked": bool(ranked),
        "league": _text(payload.get("league"), 24),
        "input_category": _text(payload.get("input_category"), 24),
        "winner_player": winner,
        "result": result,
        "reason": _text(payload.get("reason"), 32) or "unknown",
        "p1_health": _number(payload.get("p1_health")),
        "p2_health": _number(payload.get("p2_health")),
        "server_tick": server_tick,
        "p1_boost_charges": _integer(payload.get("p1_boost_charges")),
        "p2_boost_charges": _integer(payload.get("p2_boost_charges")),
        "recorded_at": _utc_now(),
    }


def _share_event(share_id: str, *, mode: str, result: str, symbol: str) -> dict[str, Any]:
    normalized_mode = "pvp" if mode == "pvp" else "solo"
    normalized_result = "loss" if result == "loss" else "win"
    clean_share_id = _text(share_id, 64)
    return {
        "event_id": f"share:{clean_share_id}",
        "share_id": clean_share_id,
        "mode": normalized_mode,
        "result": normalized_result,
        "token_symbol": _text(symbol, 24),
        "recorded_at": _utc_now(),
    }


def _public_time(value: Any) -> str | None:
    return _iso(value)


class ArenaTelemetryStore:
    """Durable PostgreSQL telemetry with an honest bounded-memory fallback."""

    def __init__(
        self,
        pool: asyncpg.Pool | None = None,  # type: ignore[type-arg]
        *,
        memory_event_limit: int = DEFAULT_MEMORY_EVENT_LIMIT,
    ) -> None:
        self._pool = pool
        self._memory_event_limit = max(10, int(memory_event_limit))
        self._decisions: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._matches: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._shares: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = asyncio.Lock()
        self._started_at = _utc_now()
        self._database_healthy = pool is not None

    @property
    def database_enabled(self) -> bool:
        return self._pool is not None and self._database_healthy

    async def _remember(self, collection: OrderedDict[str, dict[str, Any]], event: dict[str, Any]) -> bool:
        event_id = str(event["event_id"])
        async with self._lock:
            if event_id in collection:
                return False
            collection[event_id] = event
            while len(collection) > self._memory_event_limit:
                collection.popitem(last=False)
        return True

    async def _write(self, query: str, *args: Any) -> bool:
        if self._pool is None:
            return False
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(query, *args)
            self._database_healthy = True
            return True
        except Exception as exc:
            self._database_healthy = False
            _LOGGER.warning("Arena telemetry write fell back to process memory: %s", type(exc).__name__)
            return False

    async def record_director_decision(self, decision: dict[str, Any]) -> dict[str, Any]:
        event = _decision_event(decision)
        await self._remember(self._decisions, event)
        durable = await self._write(
            """
            INSERT INTO arena_director_events (
                event_id, decision_id, status, policy_version, generated_at,
                selected_mint, selected_symbol, selected_score, candidate_count,
                market_data_state, provider_snapshots, selected_metrics, explanation
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event["event_id"],
            event["decision_id"],
            event["status"],
            event["policy_version"],
            event["generated_at"],
            event["selected_mint"],
            event["selected_symbol"],
            event["selected_score"],
            event["candidate_count"],
            event["market_data_state"],
            json.dumps(event["provider_snapshots"], separators=(",", ":")),
            json.dumps(event["selected_metrics"], separators=(",", ":")),
            event["explanation"],
        )
        return self._receipt(event["event_id"], durable)

    async def record_match_outcome(self, payload: dict[str, Any], *, ranked: bool) -> dict[str, Any]:
        event = _match_event(payload, ranked=ranked)
        inserted = await self._remember(self._matches, event)
        durable = await self._write(
            """
            INSERT INTO arena_match_events (
                event_id, match_id, room_code, match_type, ranked, league, input_category,
                winner_player, result, reason, p1_health, p2_health, server_tick,
                p1_boost_charges, p2_boost_charges
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event["event_id"],
            event["match_id"],
            event["room_code"],
            event["match_type"],
            event["ranked"],
            event["league"],
            event["input_category"],
            event["winner_player"],
            event["result"],
            event["reason"],
            event["p1_health"],
            event["p2_health"],
            event["server_tick"],
            event["p1_boost_charges"],
            event["p2_boost_charges"],
        )
        receipt = self._receipt(event["event_id"], durable)
        receipt["idempotent"] = not inserted
        return receipt

    async def record_share_card(self, share_id: str, *, mode: str, result: str, symbol: str) -> dict[str, Any]:
        event = _share_event(share_id, mode=mode, result=result, symbol=symbol)
        inserted = await self._remember(self._shares, event)
        durable = await self._write(
            """
            INSERT INTO arena_share_events (event_id, share_id, mode, result, token_symbol)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event["event_id"],
            event["share_id"],
            event["mode"],
            event["result"],
            event["token_symbol"],
        )
        receipt = self._receipt(event["event_id"], durable)
        receipt["idempotent"] = not inserted
        return receipt

    def _receipt(self, event_id: str, durable: bool) -> dict[str, Any]:
        return {
            "recorded": True,
            "durable": durable,
            "persistence": "postgres" if durable else "process_memory",
            "eventId": event_id,
        }

    async def public_status(self, *, recent_limit: int = DEFAULT_PUBLIC_RECENT_LIMIT) -> dict[str, Any]:
        limit = max(1, min(int(recent_limit), 20))
        if self._pool is not None:
            try:
                status = await self._database_status(limit)
                self._database_healthy = True
                return status
            except Exception as exc:
                self._database_healthy = False
                _LOGGER.warning("Arena telemetry read fell back to process memory: %s", type(exc).__name__)
        return await self._memory_status(limit)

    async def _database_status(self, limit: int) -> dict[str, Any]:
        if self._pool is None:
            raise RuntimeError("No telemetry database")
        async with self._pool.acquire() as conn:
            decisions = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'selected') AS selected,
                    COUNT(DISTINCT decision_id) AS unique_snapshots,
                    COUNT(DISTINCT NULLIF(selected_mint, '')) AS unique_tokens,
                    COUNT(*) FILTER (WHERE status = 'selected' AND market_data_state = 'fresh') AS fresh,
                    COUNT(*) FILTER (WHERE status = 'selected' AND market_data_state = 'degraded') AS degraded,
                    MAX(recorded_at) AS latest
                FROM arena_director_events
                """
            )
            matches = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE ranked) AS ranked,
                    COUNT(*) FILTER (WHERE match_type = 'ranked_skill') AS skill,
                    COUNT(*) FILTER (WHERE match_type = 'ranked_boosted') AS boosted,
                    COUNT(*) FILTER (WHERE NOT ranked) AS casual,
                    COALESCE(SUM(p1_boost_charges + p2_boost_charges), 0) AS boost_charges,
                    MAX(recorded_at) AS latest
                FROM arena_match_events
                """
            )
            shares = await conn.fetchrow(
                "SELECT COUNT(*) AS total, MAX(recorded_at) AS latest FROM arena_share_events"
            )
            wallets = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS sessions,
                    COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW()) AS active,
                    COUNT(DISTINCT wallet_address) AS unique_wallets
                FROM wallet_auth_sessions
                """
            )
            onchain = await conn.fetchrow(
                "SELECT COUNT(*) AS total, MAX(created_at) AS latest FROM boost_purchase_ledger"
            )
            recent_decisions = await conn.fetch(
                """
                SELECT decision_id, selected_mint, selected_symbol, selected_score,
                       market_data_state, generated_at
                FROM arena_director_events
                WHERE status = 'selected'
                ORDER BY recorded_at DESC
                LIMIT $1
                """,
                limit,
            )
            recent_transactions = await conn.fetch(
                """
                SELECT signature, slot, created_at
                FROM boost_purchase_ledger
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )

        return self._status_payload(
            persistence_mode="postgres",
            durable=True,
            retention_scope="all retained database events",
            decisions={
                "total": int(decisions["total"]),
                "selected": int(decisions["selected"]),
                "unique_snapshots": int(decisions["unique_snapshots"]),
                "unique_tokens": int(decisions["unique_tokens"]),
                "fresh": int(decisions["fresh"]),
                "degraded": int(decisions["degraded"]),
                "latest": decisions["latest"],
                "recent": [
                    {
                        "decisionId": str(row["decision_id"]),
                        "mint": str(row["selected_mint"]),
                        "symbol": str(row["selected_symbol"]),
                        "score": float(row["selected_score"] or 0),
                        "marketDataState": str(row["market_data_state"]),
                        "generatedAt": _public_time(row["generated_at"]),
                    }
                    for row in recent_decisions
                ],
            },
            matches={
                "total": int(matches["total"]),
                "ranked": int(matches["ranked"]),
                "skill": int(matches["skill"]),
                "boosted": int(matches["boosted"]),
                "casual": int(matches["casual"]),
                "boost_charges": int(matches["boost_charges"]),
                "latest": matches["latest"],
            },
            engagement={
                "shares": int(shares["total"]),
                "latest_share": shares["latest"],
                "wallet_sessions": int(wallets["sessions"]),
                "active_wallet_sessions": int(wallets["active"]),
                "unique_wallets": int(wallets["unique_wallets"]),
                "wallet_availability": "database_aggregate",
            },
            onchain={
                "transactions": int(onchain["total"]),
                "latest": onchain["latest"],
                "verification": "server_verified_boost_burn_ledger",
                "recent": [
                    {
                        "signature": str(row["signature"]),
                        "slot": int(row["slot"]) if row["slot"] is not None else None,
                        "verifiedAt": _public_time(row["created_at"]),
                        "explorerUrl": f"https://solscan.io/tx/{row['signature']}",
                    }
                    for row in recent_transactions
                ],
            },
        )

    async def _memory_status(self, limit: int) -> dict[str, Any]:
        async with self._lock:
            decision_events = list(self._decisions.values())
            match_events = list(self._matches.values())
            share_events = list(self._shares.values())

        selected = [event for event in decision_events if event["status"] == "selected"]
        recent = list(reversed(selected[-limit:]))
        return self._status_payload(
            persistence_mode="process_memory",
            durable=False,
            retention_scope=f"current process, bounded to {self._memory_event_limit} events per category",
            decisions={
                "total": len(decision_events),
                "selected": len(selected),
                "unique_snapshots": len({event["decision_id"] for event in decision_events}),
                "unique_tokens": len({event["selected_mint"] for event in selected if event["selected_mint"]}),
                "fresh": sum(event["market_data_state"] == "fresh" for event in selected),
                "degraded": sum(event["market_data_state"] == "degraded" for event in selected),
                "latest": decision_events[-1]["recorded_at"] if decision_events else None,
                "recent": [
                    {
                        "decisionId": event["decision_id"],
                        "mint": event["selected_mint"],
                        "symbol": event["selected_symbol"],
                        "score": event["selected_score"] or 0,
                        "marketDataState": event["market_data_state"],
                        "generatedAt": _public_time(event["generated_at"]),
                    }
                    for event in recent
                ],
            },
            matches={
                "total": len(match_events),
                "ranked": sum(event["ranked"] for event in match_events),
                "skill": sum(event["match_type"] == "ranked_skill" for event in match_events),
                "boosted": sum(event["match_type"] == "ranked_boosted" for event in match_events),
                "casual": sum(not event["ranked"] for event in match_events),
                "boost_charges": sum(
                    event["p1_boost_charges"] + event["p2_boost_charges"] for event in match_events
                ),
                "latest": match_events[-1]["recorded_at"] if match_events else None,
            },
            engagement={
                "shares": len(share_events),
                "latest_share": share_events[-1]["recorded_at"] if share_events else None,
                "wallet_sessions": None,
                "active_wallet_sessions": None,
                "unique_wallets": None,
                "wallet_availability": "unavailable_without_postgres",
            },
            onchain={
                "transactions": None,
                "latest": None,
                "verification": "unavailable_without_postgres",
                "recent": [],
            },
        )

    def _status_payload(
        self,
        *,
        persistence_mode: str,
        durable: bool,
        retention_scope: str,
        decisions: dict[str, Any],
        matches: dict[str, Any],
        engagement: dict[str, Any],
        onchain: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "schemaVersion": TELEMETRY_SCHEMA_VERSION,
            "generatedAt": _utc_now().isoformat(),
            "persistence": {
                "mode": persistence_mode,
                "durable": durable,
                "retentionScope": retention_scope,
                "processStartedAt": self._started_at.isoformat(),
            },
            "arenaDirector": {
                "decisionsReturned": decisions["total"],
                "selectedDecisions": decisions["selected"],
                "uniqueDecisionSnapshots": decisions["unique_snapshots"],
                "uniqueTokensFeatured": decisions["unique_tokens"],
                "freshMarketSelections": decisions["fresh"],
                "degradedMarketSelections": decisions["degraded"],
                "latestDecisionAt": _public_time(decisions["latest"]),
                "recentSelections": decisions["recent"],
                "definition": "API decisions returned, not completed fights or unique people.",
            },
            "matches": {
                "authoritativeMultiplayerRounds": matches["total"],
                "rankedRounds": matches["ranked"],
                "skillRankedRounds": matches["skill"],
                "boostedRankedRounds": matches["boosted"],
                "privateCasualRounds": matches["casual"],
                "paidBoostChargesInRecordedRounds": matches["boost_charges"],
                "latestMatchAt": _public_time(matches["latest"]),
                "definition": "Rounds finalized by the server game loop; browser-local AI fights are excluded.",
            },
            "engagement": {
                "shareCardsGenerated": engagement["shares"],
                "latestShareAt": _public_time(engagement["latest_share"]),
                "walletSessionsCreated": engagement["wallet_sessions"],
                "activeWalletSessions": engagement["active_wallet_sessions"],
                "uniqueAuthenticatedWallets": engagement["unique_wallets"],
                "walletMetricAvailability": engagement["wallet_availability"],
                "definition": "Aggregates only; wallet addresses and session tokens are never public.",
            },
            "onchain": {
                "verifiedTransactions": onchain["transactions"],
                "latestVerifiedAt": _public_time(onchain["latest"]),
                "verification": onchain["verification"],
                "recentTransactions": onchain["recent"],
                "definition": "Only server-verified Solana boost-burn ledger entries count here.",
            },
            "boundaries": [
                "Gameplay telemetry is not proof of onchain volume.",
                "These counters do not calculate leaderboard rank or reward eligibility.",
                "No wallet address, room code, player name, or auth token is exposed.",
                "A null metric means the backing durable ledger is unavailable; it is not reported as zero.",
            ],
        }
