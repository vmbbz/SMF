from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import asyncio
import base64
import binascii
import hashlib
import html
import json
import os
import random
import re
import secrets
import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_CEILING, InvalidOperation
from pathlib import Path
from typing import Any, List, Dict, Optional
from urllib.parse import urlparse
from birdeye_service import birdeye_service

import asyncpg  # type: ignore[import-untyped]
import httpx
import redis.asyncio as aioredis
from deepgram import AsyncDeepgramClient  # Deepgram SDK v6
from deepgram.core.events import EventType
from deepgram.listen.v2.types import ListenV2TurnInfo, ListenV2Connected, ListenV2FatalError
from litestar import Litestar, Request, get, post, websocket
from litestar.connection import WebSocket
from litestar.response import ServerSentEvent
from litestar.response.base import Response
from litestar.static_files import create_static_files_router
from litestar.exceptions import HTTPException
from litestar.config.cors import CORSConfig

from room_manager import RoomManager
from game_loop import GameLoopManager
from signaling import SignalingManager, ICE_SERVERS
from auth import OIDCConfig, exchange_code, refresh_tokens, fetch_userinfo, extract_user_from_id_token
from elo import EloManager, controller_to_category, ensure_schema
from room_cleanup import RoomCleanupTask
from matchmaking import MatchmakingTask
from characters import CHARACTER_LIST, get_character
import sys

def safe_print(*args, **kwargs):
    """Print utility that safely intercepts and downsamples Unicode strings on Windows terminals."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        new_args = []
        for arg in args:
            if isinstance(arg, str):
                encoding = sys.stdout.encoding or 'ascii'
                new_args.append(arg.encode(encoding, errors='replace').decode(encoding))
            else:
                new_args.append(arg)
        try:
            print(*new_args, **kwargs)
        except Exception:
            pass

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

ROOT = Path(__file__).parent
PUBLIC_ORIGIN = "https://sticklash.fun"
SHARE_CARD_DIR = ROOT / "public" / "share-cards"
MAX_SHARE_CARD_BYTES = 5 * 1024 * 1024

# ─────────────────────────────────────────────
# Redis / Room Manager lifecycle
# ─────────────────────────────────────────────

room_manager: RoomManager | None = None
game_loop_manager: GameLoopManager | None = None
signaling_manager: SignalingManager | None = None
oidc_config: OIDCConfig | None = None
elo_manager: EloManager | None = None
boost_pg_pool: asyncpg.Pool | None = None
cleanup_task: RoomCleanupTask | None = None
matchmaking_task: MatchmakingTask | None = None

# ─────────────────────────────────────────────
# Solana Boost Purchase / Ledger
# ─────────────────────────────────────────────

DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com"
DEFAULT_PUBLIC_SOLANA_RPC = "https://api.mainnet-beta.solana.com"
DEFAULT_PAYMENT_TOKEN_PRICE_FALLBACK = Decimal("0")
DEFAULT_ANDROID_PACKAGE_NAME = "com.solanamemefighter.app"
DEFAULT_ANDROID_CERT_SHA256 = "84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76"
BOOST_INTENT_TTL_SECONDS = int(os.environ.get("BOOST_INTENT_TTL_SECONDS", "600"))
STARTER_BOOSTS = int(os.environ.get("STARTER_BOOSTS", "15"))
WALLET_AUTH_CHALLENGE_TTL_SECONDS = int(os.environ.get("WALLET_AUTH_CHALLENGE_TTL_SECONDS", "300"))
WALLET_AUTH_SESSION_TTL_SECONDS = int(os.environ.get("WALLET_AUTH_SESSION_TTL_SECONDS", "86400"))

TOKEN_PROGRAM_IDS = {
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  # SPL Token
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  # Token-2022
}

WALLET_ADDRESS_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_INDEX = {c: i for i, c in enumerate(BASE58_ALPHABET)}
BOOST_RATE_LIMITS = {
    "wallet-auth-challenge": {"limit": 20, "window": 60},
    "wallet-auth-verify": {"limit": 30, "window": 60},
    "create-intent": {"limit": 8, "window": 60},
    "confirm": {"limit": 20, "window": 60},
    "consume": {"limit": 90, "window": 60},
}
_boost_rate_window: dict[str, list[float]] = {}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(int(os.environ.get(name, str(default))), minimum)
    except (TypeError, ValueError):
        return default


BOOST_PACKS: dict[str, dict[str, int | str]] = {
    "micro": {"boosts": _env_int("BOOST_MICRO_BOOSTS", 5), "usd_cents": _env_int("BOOST_MICRO_USD_CENTS", 100)},
    "degen": {"boosts": _env_int("BOOST_DEGEN_BOOSTS", 20), "usd_cents": _env_int("BOOST_DEGEN_USD_CENTS", 300)},
    "chaos": {"boosts": _env_int("BOOST_CHAOS_BOOSTS", 45), "usd_cents": _env_int("BOOST_CHAOS_USD_CENTS", 500)},
}

MARKET_API_PREFIX = os.environ.get("SMF_MARKET_API_PREFIX", "/api/marketfeed/v2").rstrip("/")
MARKET_TRENDING_ROUTE = f"{MARKET_API_PREFIX}/trending-scan"
MARKET_GRADUATES_ROUTE = f"{MARKET_API_PREFIX}/graduate-scan"
MARKET_TOKEN_ROUTE = f"{MARKET_API_PREFIX}/token-scan/{{mint:str}}"
ALLOW_LEGACY_MARKET_ENDPOINTS = os.environ.get("SMF_ALLOW_LEGACY_MARKET_ENDPOINTS", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

BOOST_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS player_boost_balances (
    wallet_address TEXT PRIMARY KEY,
    boosts INTEGER NOT NULL DEFAULT 15,
    total_purchased_boosts INTEGER NOT NULL DEFAULT 0,
    total_spent_boosts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_purchase_intents (
    intent_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    boosts_count INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    expected_smf_amount BIGINT NOT NULL,
    token_decimals INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    signature TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_boost_intents_wallet_created
    ON boost_purchase_intents (wallet_address, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boost_intents_signature
    ON boost_purchase_intents (signature)
    WHERE signature IS NOT NULL;

CREATE TABLE IF NOT EXISTS boost_purchase_ledger (
    id BIGSERIAL PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE REFERENCES boost_purchase_intents(intent_id) ON DELETE RESTRICT,
    signature TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    boosts_credited INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    burn_amount BIGINT NOT NULL,
    slot BIGINT,
    raw_tx JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_ledger_wallet_created
    ON boost_purchase_ledger (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS boost_consumption_ledger (
    id BIGSERIAL PRIMARY KEY,
    consume_id TEXT,
    wallet_address TEXT NOT NULL,
    units INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT 'hadouken',
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_consumption_wallet_created
    ON boost_consumption_ledger (wallet_address, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boost_consumption_consume_id
    ON boost_consumption_ledger (consume_id)
    WHERE consume_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
    challenge_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_wallet_created
    ON wallet_auth_challenges (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    challenge_id TEXT REFERENCES wallet_auth_challenges(challenge_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_auth_sessions_wallet_created
    ON wallet_auth_sessions (wallet_address, created_at DESC);
"""

# ─────────────────────────────────────────────
# Controller wait / forfeit timer
# ─────────────────────────────────────────────

CONTROLLER_WAIT_TIMEOUT = 60  # seconds before opponent forfeits

# Active asyncio tasks keyed by room code
_controller_wait_tasks: dict[str, asyncio.Task[None]] = {}


async def _controller_wait_timer(code: str, waiting_player: int) -> None:
    """Server-authoritative forfeit timer — runs as an asyncio task.

    After CONTROLLER_WAIT_TIMEOUT seconds, if the opponent still hasn't
    selected a controller, forfeit the opponent and transition to finished.
    """
    try:
        await asyncio.sleep(CONTROLLER_WAIT_TIMEOUT)
    except asyncio.CancelledError:
        _controller_wait_tasks.pop(code, None)
        return

    _controller_wait_tasks.pop(code, None)

    if room_manager is None:
        return

    room = await room_manager.get_room(code)
    if room is None:
        return

    # Only forfeit if still in "selecting" and opponent hasn't confirmed
    if room["status"] != "selecting":
        return

    opponent = 2 if waiting_player == 1 else 1
    opponent_field = f"p{opponent}_controller"
    if room[opponent_field]:
        return  # Opponent selected in the meantime

    # Forfeit: store winner and transition to finished
    key = f"room:{code}"
    await room_manager._redis.hset(key, "forfeit_winner", str(waiting_player))  # type: ignore[misc]
    try:
        await room_manager.transition_status(code, "finished")
        print(f"[forfeit-timer:{code}] Player {opponent} forfeited (controller wait timeout)")
    except ValueError:
        pass  # Room may have transitioned already


def _start_controller_wait_timer(code: str, waiting_player: int) -> None:
    """Start the 60s forfeit timer for a room."""
    _cancel_controller_wait_timer(code)
    task = asyncio.create_task(_controller_wait_timer(code, waiting_player))
    _controller_wait_tasks[code] = task


def _cancel_controller_wait_timer(code: str) -> None:
    """Cancel an active forfeit timer for a room."""
    task = _controller_wait_tasks.pop(code, None)
    if task is not None and not task.done():
        task.cancel()


@asynccontextmanager
async def lifespan(app: Litestar) -> AsyncGenerator[None, None]:
    """Safe lifespan for $XXX Stick Lash - no required Redis or Postgres"""
    print("[lifespan] Starting safe mode for $XXX Stick Lash")

    global room_manager, game_loop_manager, signaling_manager, oidc_config, elo_manager, boost_pg_pool, cleanup_task, matchmaking_task

    # Declare variables BEFORE try so finally block never fails
    redis_pool = None
    pg_pool = None

    try:
        # Redis (optional - initialized from REDIS_URL if set)
        redis_url = os.environ.get("REDIS_URL")
        if redis_url:
            try:
                # Force rediss:// for secure Upstash connection if not already set
                if redis_url.startswith("redis://") and "upstash" in redis_url:
                    redis_url = redis_url.replace("redis://", "rediss://", 1)
                
                redis_pool = aioredis.from_url(
                    redis_url,
                    decode_responses=True,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0
                )
                # Test connection
                await redis_pool.ping()
                print("[redis] Connected successfully")
            except Exception as e:
                print(f"[redis] Connection failed: {e}. Falling back to in-memory mode.")
                redis_pool = None
        else:
            print("[redis] No REDIS_URL found. Running in-memory mode.")
            redis_pool = None


        # Postgres (optional)
        try:
            pg_pool = await asyncpg.create_pool(
                os.environ.get("DATABASE_URL", "postgresql://stick:fighter@localhost:5433/stickfighter"),
                min_size=2, max_size=10,
                timeout=8.0 # Prevent 60s hangs from database startup/networking issues
            )
            await ensure_schema(pg_pool)
            await ensure_boost_schema(pg_pool)
            boost_pg_pool = pg_pool
            print("[postgres] Connected")
        except Exception:
            print("[postgres] Skipped - running without database")
            boost_pg_pool = None

        # Only create background tasks if we have a working RoomManager
        if redis_pool:
            room_manager = RoomManager(redis_pool)
            game_loop_manager = GameLoopManager()
            signaling_manager = SignalingManager()
            oidc_config = OIDCConfig.from_env()
            elo_manager = EloManager(pg_pool) if pg_pool else None

            cleanup_task = RoomCleanupTask(room_manager, game_loop_manager, signaling_manager)
            cleanup_task.start()
            matchmaking_task = MatchmakingTask(room_manager, elo_manager)
            matchmaking_task.start()
        else:
            # In-memory mode - no background tasks
            room_manager = None
            game_loop_manager = None
            signaling_manager = None
            oidc_config = OIDCConfig.from_env()
            elo_manager = None
            cleanup_task = None
            matchmaking_task = None
            print("[mode] Running in-memory mode - no multiplayer features")

        # Start Birdeye background cache warmer (works regardless of Redis/PG)
        birdeye_service.start_background_warmer()

        if oidc_config.configured:
            print(f"[auth] OIDC configured: issuer={oidc_config.issuer}")
        else:
            print("[auth] OIDC not configured")

        yield

    finally:
        birdeye_service.stop_background_warmer()
        # SAFE SHUTDOWN - only stop what was created
        if matchmaking_task is not None:
            await matchmaking_task.stop()
        if cleanup_task is not None:
            await cleanup_task.stop()
        if game_loop_manager is not None:
            await game_loop_manager.stop_all()
        if pg_pool is not None:
            await pg_pool.close()
            boost_pg_pool = None
            print("[postgres] Connection closed")
        if redis_pool is not None:
            await redis_pool.aclose()
            print("[redis] Connection closed")
        print("[lifespan] Shutdown complete")


async def ensure_boost_schema(pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
    """Create boost ledger tables if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute(BOOST_SCHEMA_SQL)


def _audit_boost_event(event: str, **fields: Any) -> None:
    parts = [f"{k}={v}" for k, v in fields.items()]
    safe_print(f"[boost-audit] {event} {' '.join(parts)}")


def _check_rate_limit(action: str, wallet: str) -> None:
    cfg = BOOST_RATE_LIMITS.get(action)
    if not cfg:
        return
    now = time.time()
    key = f"{action}:{wallet}"
    window = int(cfg["window"])
    limit = int(cfg["limit"])
    events = _boost_rate_window.get(key, [])
    events = [t for t in events if now - t <= window]
    if len(events) >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded for {action}. Try again soon.",
        )
    events.append(now)
    _boost_rate_window[key] = events


def _base58_decode(value: str) -> bytes:
    if not value:
        raise ValueError("Empty base58 value")
    num = 0
    for char in value:
        if char not in BASE58_INDEX:
            raise ValueError("Invalid base58 character")
        num = num * 58 + BASE58_INDEX[char]
    decoded = b""
    while num > 0:
        num, rem = divmod(num, 256)
        decoded = bytes([rem]) + decoded
    leading_zeros = len(value) - len(value.lstrip("1"))
    return b"\x00" * leading_zeros + decoded


def _decode_signature(signature: str) -> bytes:
    sig = signature.strip()
    # Preferred path: base64 (wallet client sends base64 for transport)
    padding = "=" * ((4 - len(sig) % 4) % 4)
    try:
        raw = base64.b64decode(sig + padding, validate=True)
        if len(raw) == 64:
            return raw
    except (binascii.Error, ValueError):
        pass
    # Fallback: base58-encoded signature
    raw_bs58 = _base58_decode(sig)
    if len(raw_bs58) == 64:
        return raw_bs58
    raise ValueError("Signature format invalid. Expect base64 or base58 64-byte signature.")


def _extract_bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return ""
    return auth[7:].strip()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _wallet_auth_domain(request: Request) -> str:
    base = os.environ.get("BASE_URL", "").strip()
    if base:
        parsed = urlparse(base)
        if parsed.netloc:
            return parsed.netloc
    parsed_req = urlparse(str(request.base_url))
    return parsed_req.netloc or "sticklash.fun"


def _public_base_url(request: Request) -> str:
    base = os.environ.get("BASE_URL", "").strip().rstrip("/")
    if base:
        return base
    parsed_req = urlparse(str(request.base_url))
    host = (parsed_req.hostname or "").lower()
    if host in {"localhost", "127.0.0.1"} or parsed_req.scheme in {"capacitor", "file"}:
        return PUBLIC_ORIGIN
    if parsed_req.scheme and parsed_req.netloc:
        return f"{parsed_req.scheme}://{parsed_req.netloc}".rstrip("/")
    return PUBLIC_ORIGIN


def _wallet_auth_message(request: Request, wallet: str, nonce: str, issued_at_unix: int, expires_at_unix: int) -> str:
    issued_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(issued_at_unix))
    expires_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at_unix))
    domain = _wallet_auth_domain(request)
    return (
        f"{domain} wants you to sign in with your Solana account:\n"
        f"{wallet}\n\n"
        "Sign in to StickLash and authorize secure boost actions.\n\n"
        f"URI: https://{domain}\n"
        "Version: 1\n"
        "Chain ID: solana:mainnet-beta\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_iso}\n"
        f"Expiration Time: {expires_iso}"
    )


def _parse_siws_message_fields(message: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    lines = [line.strip() for line in message.splitlines()]
    for index, line in enumerate(lines):
        if index == 1 and line:
            fields["wallet"] = line
        elif ": " in line:
            key, value = line.split(": ", 1)
            fields[key.lower().replace(" ", "_")] = value.strip()
    return fields


async def _require_wallet_session(conn: asyncpg.Connection, request: Request, wallet: str) -> None:  # type: ignore[type-arg]
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Wallet auth token required")
    token_hash = _token_hash(token)
    row = await conn.fetchrow(
        """
        SELECT wallet_address, expires_at, revoked_at
        FROM wallet_auth_sessions
        WHERE token_hash = $1
        """,
        token_hash,
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid wallet auth token")
    if str(row["wallet_address"]) != wallet:
        raise HTTPException(status_code=403, detail="Wallet auth token does not match wallet")
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="Wallet auth token revoked")
    expires_at = row["expires_at"]
    if expires_at is not None and expires_at.timestamp() < time.time():
        raise HTTPException(status_code=401, detail="Wallet auth token expired")


def _get_smf_mint() -> str:
    mint = os.environ.get("SMF_MINT", "").strip()
    if not mint:
        raise ValueError("SMF_MINT must be configured")
    return mint


def _get_boost_payment_token_symbol(mint: str | None = None) -> str:
    configured = os.environ.get("BOOST_PAYMENT_TOKEN_SYMBOL", "").strip()
    if configured:
        return configured
    return "$XXX"


def _get_solana_rpc() -> str:
    return os.environ.get("SOLANA_RPC", DEFAULT_SOLANA_RPC)


def _get_public_solana_rpc() -> str:
    # Never leak private provider URLs (e.g. key-bearing RPC) to browser clients.
    return os.environ.get("SOLANA_RPC_PUBLIC", DEFAULT_PUBLIC_SOLANA_RPC)


def _as_decimal(value: Any, fallback: Decimal) -> Decimal:
    try:
        parsed = Decimal(str(value))
        if parsed > 0:
            return parsed
    except (InvalidOperation, ValueError, TypeError):
        pass
    return fallback


def _get_boost_payment_price_fallback(mint: str) -> Decimal:
    configured = os.environ.get("BOOST_PAYMENT_TOKEN_PRICE_FALLBACK", "").strip()
    if configured:
        return _as_decimal(configured, DEFAULT_PAYMENT_TOKEN_PRICE_FALLBACK)
    return DEFAULT_PAYMENT_TOKEN_PRICE_FALLBACK


def _get_fixed_boost_payment_price(mint: str) -> Decimal | None:
    configured = os.environ.get("BOOST_PAYMENT_TOKEN_FIXED_PRICE_USD", "").strip()
    if not configured:
        return None
    return _as_decimal(configured, _get_boost_payment_price_fallback(mint))


async def _fetch_mint_decimals(rpc_url: str, mint: str) -> int:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenSupply",
        "params": [mint, {"commitment": "confirmed"}],
    }
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post(rpc_url, json=payload)
        resp.raise_for_status()
        body = resp.json()
    value = (body.get("result") or {}).get("value") or {}
    decimals = value.get("decimals")
    if not isinstance(decimals, int) or decimals < 0 or decimals > 18:
        raise ValueError("Could not determine token decimals from RPC")
    return decimals


async def _compute_pack_quote(pack_id: str) -> dict[str, Any]:
    pack = BOOST_PACKS.get(pack_id)
    if not pack:
        raise ValueError("Unknown pack id")

    mint = _get_smf_mint()
    rpc = _get_solana_rpc()

    fixed_payment_price = _get_fixed_boost_payment_price(mint)
    if fixed_payment_price is not None:
        payment_price = fixed_payment_price
    else:
        token = await birdeye_service.get_cached_token(mint, mark_hot=False)
        payment_price = _as_decimal((token or {}).get("price"), _get_boost_payment_price_fallback(mint))
    if payment_price <= 0:
        raise ValueError("Could not determine boost payment token price")

    decimals = await _fetch_mint_decimals(rpc, mint)
    usd_cents = int(pack["usd_cents"])
    usd = Decimal(usd_cents) / Decimal(100)
    token_units_per_ui = Decimal(10) ** decimals
    required_smf_ui = usd / payment_price
    required_smf_raw = int((required_smf_ui * token_units_per_ui).to_integral_value(rounding=ROUND_CEILING))
    required_smf_raw = max(required_smf_raw, 1)
    required_smf_ui_display = Decimal(required_smf_raw) / token_units_per_ui

    return {
        "pack_id": pack_id,
        "boosts_count": int(pack["boosts"]),
        "usd_cents": usd_cents,
        "smf_price": str(payment_price),
        "payment_token_symbol": _get_boost_payment_token_symbol(mint),
        "payment_token_price": str(payment_price),
        "mint": mint,
        "rpc": rpc,
        "token_decimals": decimals,
        "required_smf_ui": str(required_smf_ui_display.normalize()),
        "required_smf_raw": required_smf_raw,
        "required_token_ui": str(required_smf_ui_display.normalize()),
        "required_token_raw": required_smf_raw,
    }


def _is_valid_wallet_address(address: str) -> bool:
    return bool(WALLET_ADDRESS_RE.fullmatch(address))


def _normalize_wallet_address(value: Any) -> str:
    return str(value or "").strip()


def _extract_burn_entries(tx: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract spl-token burn / burnChecked instructions from parsed transaction JSON."""
    result: list[dict[str, Any]] = []
    tx_obj = tx.get("transaction") or {}
    meta = tx.get("meta") or {}
    message = tx_obj.get("message") or {}

    instructions = message.get("instructions") or []
    inner_groups = meta.get("innerInstructions") or []
    for group in inner_groups:
        instructions.extend((group or {}).get("instructions") or [])

    for instr in instructions:
        if not isinstance(instr, dict):
            continue
        program_id = instr.get("programId")
        if program_id not in TOKEN_PROGRAM_IDS:
            continue
        parsed = instr.get("parsed")
        if not isinstance(parsed, dict):
            continue
        if str(parsed.get("type", "")).lower() not in {"burn", "burnchecked"}:
            continue
        info = parsed.get("info") or {}
        if not isinstance(info, dict):
            continue
        amount_raw = info.get("amount")
        if amount_raw is None:
            token_amount = info.get("tokenAmount")
            if isinstance(token_amount, dict):
                amount_raw = token_amount.get("amount")
        try:
            amount = int(str(amount_raw))
        except (ValueError, TypeError):
            continue
        result.append({
            "mint": str(info.get("mint", "")),
            "authority": str(info.get("authority", "")),
            "account": str(info.get("account", "")),
            "amount": amount,
            "type": str(parsed.get("type", "")),
        })
    return result


def _extract_signers(tx: dict[str, Any]) -> set[str]:
    signers: set[str] = set()
    tx_obj = tx.get("transaction") or {}
    message = tx_obj.get("message") or {}
    account_keys = message.get("accountKeys") or []
    for key in account_keys:
        if isinstance(key, dict):
            pubkey = str(key.get("pubkey", ""))
            if key.get("signer") and pubkey:
                signers.add(pubkey)
    return signers


async def _fetch_transaction(signature: str, rpc_url: str) -> dict[str, Any] | None:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            signature,
            {
                "encoding": "jsonParsed",
                "commitment": "confirmed",
                "maxSupportedTransactionVersion": 0,
            },
        ],
    }
    async with httpx.AsyncClient(timeout=18.0) as client:
        resp = await client.post(rpc_url, json=payload)
        resp.raise_for_status()
        body = resp.json()
    return body.get("result")


async def _verify_burn_transaction(
    signature: str,
    wallet: str,
    mint: str,
    min_burn_amount: int,
    rpc_url: str,
) -> tuple[bool, str, int, dict[str, Any] | None]:
    tx = await _fetch_transaction(signature, rpc_url)
    if tx is None:
        return False, "Transaction not found on RPC", 0, None

    meta = tx.get("meta") or {}
    if meta.get("err") is not None:
        return False, "Transaction execution failed on-chain", 0, tx

    signers = _extract_signers(tx)
    if wallet not in signers:
        return False, "Wallet address did not sign this transaction", 0, tx

    burns = _extract_burn_entries(tx)
    if not burns:
        return False, "No SPL burn instruction found in transaction", 0, tx

    matching = [
        b for b in burns
        if b["mint"] == mint and b["authority"] == wallet
    ]
    if not matching:
        return False, "Burn instructions did not match expected mint/authority", 0, tx

    burned_amount = sum(int(b["amount"]) for b in matching)
    if burned_amount < min_burn_amount:
        return False, (
            f"Burn amount too low. Required {min_burn_amount}, observed {burned_amount}"
        ), burned_amount, tx

    return True, "", burned_amount, tx

DG_TTS_URL = "https://api.deepgram.com/v1/speak"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"


# ─────────────────────────────────────────────
# STT WebSocket proxy (Deepgram Flux v2)
# ─────────────────────────────────────────────

_STT_KEYTERMS = {
    "forward", "forwards", "back", "backward", "backwards",
    "crouch", "duck", "jump", "somersault", "flip",
    "dash", "punch", "kick", "light", "medium", "heavy", "hard",
    "hadouken", "hadoken", "hadou", "hado", "summersault", "backflip", "frontflip", "roundhouse", "haducon", "hadokun", "fireball", "energy blast",
}

STT_KEYTERMS = [
    # Movement
    "forward", "back", "crouch", "duck",
    # Jumps
    "jump", "somersault", "flip", "summersault", "backflip", "frontflip",
    # Dash
    "dash", "dash forward", "dash back",
    # Attack modifiers
    "light", "medium", "heavy", "hard",
    # Attacks
    "punch", "kick", "roundhouse", "fireball", "energy blast",
    # Special moves & homophones
    "hadouken", "hadoken", "hadou", "hado", "haducon", "hadokun",
    # Multi-word attacks
    "light punch", "medium punch", "heavy punch", "hard punch",
    "light kick", "medium kick", "heavy kick",
    # Combos (high risk / high reward moves)
    "jump forward heavy kick", "jump forward heavy punch",
    "jump jump forward heavy kick", "jump jump forward heavy punch",
    "crouch heavy punch", "crouch heavy kick",
    "dash forward heavy punch", "dash forward heavy kick",
]


@websocket("/ws/stt")
async def stt_proxy(socket: WebSocket) -> None:
    """Proxy mic audio to Deepgram STT (Flux v2) and return transcription results."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        await socket.close(code=4000, reason="DEEPGRAM_API_KEY not set")
        return

    await socket.accept()
    safe_print("[stt] Browser WebSocket accepted, connecting to Deepgram Flux...")

    client = AsyncDeepgramClient(api_key=api_key)
    audio_chunks = 0

    try:
        async with client.listen.v2.connect(
            model="flux-general-en",
            encoding="linear16",
            sample_rate="16000",
            keyterm=STT_KEYTERMS,
        ) as dg:
            safe_print("[stt] Connected to Deepgram Flux v2")

            # ── Event handler: forward Deepgram events ──
            async def on_message(message) -> None:
                try:
                    if isinstance(message, ListenV2TurnInfo):
                        event = message.event
                        transcript = message.transcript or ""
                        # Log interesting events
                        if transcript:
                            safe_print(f"[stt] ─── {event} (turn={int(message.turn_index)}) ───")
                            safe_print(f'[stt]   "{transcript}"')
                            words = transcript.lower().split()
                            matched = [w for w in words if w in _STT_KEYTERMS]
                            unmatched = [w for w in words if w not in _STT_KEYTERMS]
                            if matched:
                                safe_print(f"[stt]   actions: {' '.join(matched)}")
                            if unmatched:
                                safe_print(f"[stt]   other:   {' '.join(unmatched)}")
                        elif event in ("EndOfTurn", "EagerEndOfTurn"):
                            safe_print(f"[stt] ─── {event} (empty) ───")

                        # Send to browser as JSON
                        data = {
                            "type": "TurnInfo",
                            "event": event,
                            "turn_index": message.turn_index,
                            "transcript": transcript,
                            "words": [{"word": w.word, "confidence": w.confidence} for w in (message.words or [])],
                        }
                        await socket.send_data(json.dumps(data), mode="text")

                    elif isinstance(message, ListenV2Connected):
                        safe_print(f"[stt] Deepgram connected: {message}")

                    elif isinstance(message, ListenV2FatalError):
                        safe_print(f"[stt] Deepgram FATAL: {message}")
                        await socket.send_data(json.dumps({
                            "type": "Error",
                            "message": str(message),
                        }), mode="text")
                except Exception as e:
                    safe_print(f"[stt] Error sending message to browser: {type(e).__name__}: {e}")

            def on_error(error) -> None:
                safe_print(f"[stt] Deepgram error: {type(error).__name__}: {error}")

            def on_close(_) -> None:
                safe_print("[stt] Deepgram connection closed")

            dg.on(EventType.MESSAGE, on_message)
            dg.on(EventType.ERROR, on_error)
            dg.on(EventType.CLOSE, on_close)

            # ── Audio forwarder: browser ──
            async def forward_audio():
                nonlocal audio_chunks
                try:
                    while True:
                        data = await socket.receive_data(mode="binary")
                        if data:
                            audio_chunks += 1
                            if audio_chunks == 1:
                                safe_print(f"[stt] First audio chunk ({len(data)} bytes)")
                            elif audio_chunks % 100 == 0:
                                safe_print(f"[stt] Audio chunks: {audio_chunks}")
                            await dg.send_media(data)
                except Exception as e:
                    safe_print(f"[stt] Audio forwarding ended: {type(e).__name__}: {e}")

            # Run audio forwarding + SDK listener concurrently using two-way wait
            audio_task = asyncio.create_task(forward_audio())
            listening_task = asyncio.create_task(dg.start_listening())

            done, pending = await asyncio.wait(
                [audio_task, listening_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()

    except Exception as e:
        safe_print(f"[stt] Connection error: {type(e).__name__}: {e}")
        try:
            await socket.send_data(json.dumps({
                "type": "Error",
                "message": f"Deepgram connection failed: {e}",
            }), mode="text")
        except Exception:
            pass

    safe_print(f"[stt] Disconnected (sent {audio_chunks} audio chunks)")



# ─────────────────────────────────────────────
# LLM fighter endpoint (Anthropic Claude)
# ─────────────────────────────────────────────

LLM_FIGHTER_SYSTEM = """STICK FIGHTER AI. You control a fighter. Plan your next 5 moves as a JSON array.

COMMANDS: forward, back, crouch, jump, somersault, dash forward, dash back, light punch, medium punch, heavy punch, light kick, medium kick, heavy kick, hadouken

Commands can be combined: "forward light punch", "jump heavy kick", "dash forward medium punch". Movement + attack combos execute together.

MECHANICS:
- Walk: 200px/s. Dash: 90px burst (600px/s for 0.15s).
- Jump: ~107px high, ~0.69s airtime. Double jump available.
- Somersault: airborne flip attack, max 2 per airtime. Must jump first.
- Block: hold back while grounded. Absorbs hits with reduced stun.
- Health: 200 per fighter. Head hits=2x dmg. Crotch=3x. Limbs=0.5x. Body=1x.
- P1 faces right, P2 faces left. "forward"=toward opponent, "back"=away.

ATTACKS (dmg/startup/active/recovery/range/type):
- light punch: 3/2/2/3/40/high (fastest)
- medium punch: 6/3/2/5/50/high
- heavy punch: 10/5/3/8/55/high (slowest, most damage)
- light kick: 3/2/2/4/50/low
- medium kick: 7/4/2/6/60/mid
- heavy kick: 11/6/3/10/65/low (longest range)

SPECIAL MOVE:
- hadouken: 25dmg energy projectile, mid-height. ~300ms windup, 1.5s cooldown. Opponent can jump over it or block (reduced damage). Best at mid-range.

COMBOS (high risk, high reward — plan sequences that set these up!):
- "jump forward heavy kick" — aerial approach, long range, 11dmg body or 22dmg head
- "jump forward heavy punch" — aerial punch, 10dmg body or 20dmg head
- "jump jump forward heavy kick" — double jump attack, harder to block, closes distance fast
- "jump jump forward heavy punch" — double jump punch, surprise from above
- "crouch heavy punch" — low stance into uppercut, 10dmg, avoids high attacks while hitting
- "crouch heavy kick" — sweep from crouch, 11dmg, catches standing opponents low
- "dash forward heavy punch" — rush in with power hit, 10dmg, punishes idle opponents
- "dash forward heavy kick" — dash into sweep, 11dmg, longest range surprise
- "hadouken" — 25dmg projectile, great at mid-range, forces opponent to jump or block
- "hadouken" then "dash forward heavy punch" — projectile pressure into rush-down

STRATEGY:
- Think in sequences: approach → position → attack → recover → reposition.
- Close distance first (forward/dash forward), then strike.
- Use light attacks when close (fast, safe). Heavy when opponent is in recovery/stun.
- Plan combo setups: e.g. ["dash forward", "forward", "jump forward heavy kick", "back", "crouch heavy punch"]
- Crouch to avoid high attacks. Jump to avoid low kicks.
- Block (back) when you expect the opponent to attack.
- If low health, plan defensively. If opponent is low, press advantage aggressively.
- Vary your plan — mix movement, positioning, and different attack types.

LEARNING:
- You'll see RESULT from your previous plan's outcome: total damage dealt and taken.
- BEST: shows your most effective tactics ranked by net damage per use.
- Favor your BEST tactics but ALWAYS mix up to stay unpredictable.
- If previous plan was ineffective, try a completely different approach.

State format: T<timer> | ME:<x>,<y> hp<health> <state> | OPP:<x>,<y> hp<health> <state> | D<distance> | RESULT:<outcome> | BEST:<tactics>
States: idle, walk, jump, crouch, attack, hitstun, blockstun. "air" suffix = airborne.

RESPOND WITH ONLY A JSON ARRAY OF 5 MOVES. Example: ["dash forward", "forward", "jump forward heavy kick", "back", "light punch"]
No explanation, no markdown, no code fences. Just the JSON array."""


@get("/api/characters")
async def list_characters() -> list[dict[str, str]]:
    """Return available AI characters for single-player mode."""
    return [
        {
            "id": c.id,
            "name": c.name,
            "provider": c.provider,
            "icon": c.icon,
            "description": c.description,
        }
        for c in CHARACTER_LIST
    ]


def _server_behavior_tree(messages: list[dict]) -> list[str]:
    """
    Server-side Intelligent Behavior Tree (Option 3).

    Parses the last game state message from the conversation to extract:
    - Distance between fighters
    - Our HP / opponent HP
    - Opponent state (hitstun, attack, crouch, airborne)

    Then picks a tactical 5-move plan matching the situation.
    Zero LLM calls — runs locally, infinite scale, <1ms latency.

    State format: T<timer> | ME:x,y hp<HP> <state> | OPP:x,y hp<HP> <state> | D<dist> | ...
    """
    import re

    # --- Parse last user message for game state ---
    state_str = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            state_str = msg.get("content", "")
            break

    # Defaults (neutral mid-range)
    dist, my_hp, opp_hp = 300, 150, 150
    opp_state, opp_grounded = "idle", True

    try:
        # Distance: D<number>
        m = re.search(r'\bD(\d+)', state_str)
        if m:
            dist = int(m.group(1))

        # HP: ME:... hp<number>
        m = re.search(r'ME:\S+ hp(\d+)', state_str)
        if m:
            my_hp = int(m.group(1))

        # OPP HP and state
        m = re.search(r'OPP:\S+ hp(\d+)\s+(\w+)', state_str)
        if m:
            opp_hp = int(m.group(1))
            opp_state = m.group(2).lower()

        # Airborne check — "air" suffix in opponent state
        opp_grounded = "air" not in state_str.split("OPP:")[-1][:30] if "OPP:" in state_str else True

    except Exception:
        pass  # Fall through to defaults on any parse error

    # ── Behavior Tree Branches ────────────────────────────────────────────────

    def pick(plans: list) -> list:
        return random.choice(plans)

    # 1. CRITICAL DEFENSE — we're nearly dead
    if my_hp <= 30:
        return pick([
            ["back", "back", "crouch", "dash back", "jump"],
            ["dash back", "back", "back", "crouch", "jump"],
        ])

    # 2. FINISH HIM — opponent is very low
    if opp_hp <= 30 and my_hp > 40:
        if dist <= 120:
            return pick([
                ["heavy punch", "heavy kick", "forward heavy punch", "forward heavy kick", "heavy punch"],
                ["crouch heavy punch", "heavy kick", "heavy punch", "hadouken", "heavy kick"],
            ])
        return ["hadouken", "dash forward", "dash forward", "heavy punch", "heavy kick"]

    # 3. PUNISH — opponent in hitstun/blockstun
    if opp_state in ("hitstun", "blockstun") and dist <= 280:
        if dist <= 120:
            return pick([
                ["heavy punch", "heavy kick", "medium punch", "heavy punch", "crouch heavy kick"],
                ["heavy kick", "heavy punch", "forward heavy kick", "medium punch", "heavy kick"],
            ])
        return ["dash forward", "heavy punch", "heavy kick", "forward heavy punch", "medium kick"]

    # 4. ANTI-AIR — opponent airborne and close
    if not opp_grounded and dist <= 280:
        return pick([
            ["crouch heavy punch", "back", "light punch", "medium punch", "back"],
            ["heavy punch", "crouch", "back", "light punch", "crouch heavy punch"],
        ])

    # 5. DEFENSIVE — we're in danger
    if my_hp <= 60:
        if dist <= 120:
            return pick([
                ["back", "light punch", "back", "crouch", "back"],
                ["dash back", "hadouken", "back", "crouch", "back"],
            ])
        return pick([
            ["hadouken", "back", "crouch", "back", "hadouken"],
            ["back", "hadouken", "crouch", "back", "back"],
        ])

    # 6. DOMINANT — opponent is weak
    if opp_hp <= 100 and my_hp > opp_hp + 40:
        if dist <= 120:
            return pick([
                ["heavy punch", "heavy kick", "medium punch", "forward heavy kick", "heavy punch"],
                ["crouch heavy kick", "heavy punch", "heavy kick", "medium punch", "heavy kick"],
            ])
        return pick([
            ["dash forward", "heavy punch", "heavy kick", "heavy punch", "forward heavy kick"],
            ["jump forward heavy kick", "heavy punch", "dash forward", "heavy kick", "heavy punch"],
        ])

    # 7. Neutral play by distance zone
    if dist <= 120:  # Close range
        if opp_state == "attack":
            return pick([
                ["back", "heavy punch", "heavy kick", "medium punch", "back"],
                ["crouch", "heavy punch", "medium kick", "light punch", "back"],
            ])
        return pick([
            ["light punch", "medium punch", "heavy kick", "crouch heavy kick", "light punch"],
            ["medium kick", "light punch", "heavy punch", "forward light kick", "medium punch"],
            ["crouch heavy punch", "medium kick", "light punch", "heavy kick", "medium punch"],
        ])
    elif dist <= 280:  # Mid range
        if opp_state == "attack":
            return pick([
                ["back", "crouch", "dash forward", "heavy punch", "heavy kick"],
                ["jump", "forward heavy kick", "medium punch", "back", "heavy kick"],
            ])
        return pick([
            ["dash forward", "heavy punch", "medium kick", "forward heavy kick", "back"],
            ["jump forward heavy kick", "medium punch", "back", "forward", "heavy kick"],
            ["hadouken", "forward", "dash forward", "heavy punch", "heavy kick"],
            ["dash forward heavy punch", "medium kick", "back", "forward", "heavy punch"],
        ])
    elif dist <= 480:  # Far range
        return pick([
            ["hadouken", "dash forward", "forward", "dash forward", "heavy punch"],
            ["dash forward", "dash forward", "heavy punch", "heavy kick", "back"],
            ["jump forward heavy kick", "forward", "dash forward", "heavy punch", "medium kick"],
        ])
    else:  # Full screen
        return pick([
            ["hadouken", "dash forward", "dash forward", "dash forward", "forward"],
            ["dash forward", "dash forward", "hadouken", "dash forward", "forward"],
            ["hadouken", "hadouken", "dash forward", "dash forward", "forward"],
        ])




async def _call_llm_provider(
    provider: str,
    messages: list[dict],
    system_prompt: str,
    temperature: float | None,
) -> str:
    """Call the appropriate LLM provider. Raises on failure."""
    if provider == "xai":
        return await _llm_xai(messages, system_prompt, temperature=temperature)
    elif provider == "openai":
        return await _llm_openai(messages, system_prompt, temperature=temperature)
    elif provider == "gemini":
        return await _llm_gemini(messages, system_prompt, temperature=temperature)
    
    # Smart fallbacks to free Gemini API or Grok if preferred keys are missing
    if provider == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
        if os.environ.get("XAI_API_KEY"):
            print("[llm-fighter:fallback] ANTHROPIC_API_KEY not set, using XAI_API_KEY instead")
            return await _llm_xai(messages, system_prompt, temperature=temperature)
        elif os.environ.get("GEMINI_API_KEY"):
            print("[llm-fighter:fallback] ANTHROPIC_API_KEY not set, using GEMINI_API_KEY instead")
            return await _llm_gemini(messages, system_prompt, temperature=temperature)
        
    if provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
        if os.environ.get("XAI_API_KEY"):
            print("[llm-fighter:fallback] OPENAI_API_KEY not set, using XAI_API_KEY instead")
            return await _llm_xai(messages, system_prompt, temperature=temperature)
        elif os.environ.get("GEMINI_API_KEY"):
            print("[llm-fighter:fallback] OPENAI_API_KEY not set, using GEMINI_API_KEY instead")
            return await _llm_gemini(messages, system_prompt, temperature=temperature)
        
    return await _llm_anthropic(messages, system_prompt, temperature=temperature)



def _parse_llm_plan(raw: str, provider: str) -> list[str]:
    """Parse raw LLM response text into a list of normalized move strings."""
    try:
        clean = raw
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        plan = json.loads(clean)
        if not isinstance(plan, list):
            plan = [str(plan)]
        return [str(m).strip().strip('"\'').lower().strip('.') for m in plan if m]
    except (json.JSONDecodeError, ValueError):
        command = raw.strip('"\'').lower().strip('.')
        plan = [command] if command else ["forward"]
        print(f"[llm-fighter:{provider}] JSON parse failed, fallback: {plan}")
        return plan


@post("/api/llm/command")
async def llm_command(data: dict[str, Any]) -> dict:
    """Send game state to LLM, return a 5-move plan.

    Retry once on failure; if both attempts fail, return a random plan.
    """
    provider = data.get("provider", "anthropic")
    messages = data.get("messages", [])
    character_id = data.get("character")

    # Build system prompt: base + optional character personality
    system_prompt = LLM_FIGHTER_SYSTEM
    temperature: float | None = None
    if character_id:
        char = get_character(character_id)
        if char:
            system_prompt = LLM_FIGHTER_SYSTEM + char.personality_prompt
            provider = char.provider  # character determines provider
            temperature = char.temperature

    # Log outgoing request
    print(f"[llm-fighter:{provider}] ─── REQUEST ───")
    if character_id:
        print(f"[llm-fighter:{provider}] character: {character_id}")
    print(f"[llm-fighter:{provider}] messages ({len(messages)}):")
    for msg in messages[-4:]:
        role = msg.get("role", "?")
        content = msg.get("content", "")
        print(f"[llm-fighter:{provider}]   {role}: {content}")
    if len(messages) > 4:
        print(f"[llm-fighter:{provider}]   ... ({len(messages) - 4} earlier messages omitted)")

    # Try up to 2 times (initial + 1 retry), then fall back to random
    last_error: str = ""
    for attempt in range(2):
        try:
            text = await _call_llm_provider(provider, messages, system_prompt, temperature)
            raw = text.strip()
            print(f"[llm-fighter:{provider}] raw: \"{raw}\"")
            plan = _parse_llm_plan(raw, provider)
            print(f"[llm-fighter:{provider}] plan: {plan}")
            print(f"[llm-fighter:{provider}] ──────────────")
            return {"plan": plan}
        except Exception as exc:
            last_error = str(exc)
            label = "retry" if attempt == 0 else "giving up"
            print(f"[llm-fighter:{provider}] attempt {attempt + 1} failed ({label}): {last_error}")

    # Both LLM attempts failed — use server-side behavior tree (state-aware, zero API calls)
    plan = _server_behavior_tree(messages)
    print(f"[llm-fighter:{provider}] ─── FALLBACK (behavior tree) ─── {plan}")
    return {"plan": plan, "fallback": True}


async def _llm_anthropic(
    messages: list[dict],
    system_prompt: str = LLM_FIGHTER_SYSTEM,
    temperature: float | None = None,
) -> str:
    """Call Anthropic Claude Haiku 4.5."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    body: dict[str, Any] = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": system_prompt,
        "messages": messages,
    }
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=3) as client:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )

    if resp.status_code != 200:
        print(f"[llm-fighter:anthropic] ─── ERROR {resp.status_code} ───")
        print(f"[llm-fighter:anthropic] {resp.text}")
        raise HTTPException(status_code=502, detail="Anthropic request failed")

    result = resp.json()
    print("[llm-fighter:anthropic] ─── RESPONSE ───")
    print(f"[llm-fighter:anthropic] model: {result.get('model')}")
    print(f"[llm-fighter:anthropic] usage: in={result.get('usage', {}).get('input_tokens')} out={result.get('usage', {}).get('output_tokens')}")
    print(f"[llm-fighter:anthropic] stop: {result.get('stop_reason')}")

    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text":
            text += block["text"]
    return text


async def _llm_openai(
    messages: list[dict],
    system_prompt: str = LLM_FIGHTER_SYSTEM,
    temperature: float | None = None,
) -> str:
    """Call OpenAI GPT-4o mini."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set")

    # OpenAI uses system message in the messages array
    oai_messages = [{"role": "system", "content": system_prompt}] + messages

    body: dict[str, Any] = {
        "model": "gpt-4o-mini",
        "max_tokens": 150,
        "messages": oai_messages,
    }
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=3) as client:
        resp = await client.post(
            OPENAI_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )

    if resp.status_code != 200:
        print(f"[llm-fighter:openai] ─── ERROR {resp.status_code} ───")
        print(f"[llm-fighter:openai] {resp.text}")
        raise HTTPException(status_code=502, detail="OpenAI request failed")

    result = resp.json()
    print("[llm-fighter:openai] ─── RESPONSE ───")
    print(f"[llm-fighter:openai] model: {result.get('model')}")
    usage = result.get("usage", {})
    print(f"[llm-fighter:openai] usage: in={usage.get('prompt_tokens')} out={usage.get('completion_tokens')}")
    print(f"[llm-fighter:openai] stop: {result.get('choices', [{}])[0].get('finish_reason')}")

    choices = result.get("choices", [])
    if choices:
        return choices[0].get("message", {}).get("content", "")
    return ""


async def _llm_xai(
    messages: list[dict],
    system_prompt: str = LLM_FIGHTER_SYSTEM,
    temperature: float | None = None,
) -> str:
    """Call xAI Grok API (using OpenAI compatible endpoint)."""
    api_key = os.environ.get("XAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="XAI_API_KEY not set")

    # OpenAI-compatible messages format
    xai_messages = [{"role": "system", "content": system_prompt}] + messages

    body: dict[str, Any] = {
        "model": "grok-beta",
        "max_tokens": 150,
        "messages": xai_messages,
    }
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        if resp.status_code != 200:
            print(f"[llm-fighter:xai] ❌ ERROR {resp.status_code} ❌")
            print(f"[llm-fighter:xai] {resp.text}")
            raise HTTPException(status_code=502, detail="xAI request failed")

        result = resp.json()
        print("[llm-fighter:xai] ⚡ RESPONSE ⚡")
        choices = result.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return ""


async def _llm_gemini(
    messages: list[dict],
    system_prompt: str = LLM_FIGHTER_SYSTEM,
    temperature: float | None = None,
) -> str:
    """Call Google Gemini API (Free developer tier)."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")

    # Map message roles from (user/assistant) to Gemini's expected (user/model) format
    gemini_contents = []
    for msg in messages:
        role = "user" if msg.get("role") == "user" else "model"
        gemini_contents.append({
            "role": role,
            "parts": [{"text": msg.get("content", "")}]
        })

    body: dict[str, Any] = {
        "contents": gemini_contents,
        "generationConfig": {
            "maxOutputTokens": 150
        }
    }
    if temperature is not None:
        body["generationConfig"]["temperature"] = temperature
    
    if system_prompt:
        body["systemInstruction"] = {
            "parts": [{"text": system_prompt}]
        }

    # We use gemini-1.5-flash as the fast, smart, and generous free-tier model
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            gemini_url,
            headers={"Content-Type": "application/json"},
            json=body,
        )

    if resp.status_code != 200:
        print(f"[llm-fighter:gemini] ─── ERROR {resp.status_code} ───")
        print(f"[llm-fighter:gemini] {resp.text}")
        raise HTTPException(status_code=502, detail="Gemini request failed")

    result = resp.json()
    print("[llm-fighter:gemini] ─── RESPONSE ───")
    usage = result.get("usageMetadata", {})
    print(f"[llm-fighter:gemini] usage: in={usage.get('promptTokenCount')} out={usage.get('candidatesTokenCount')}")

    candidates = result.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        if parts:
            return parts[0].get("text", "")
    return ""



# ─────────────────────────────────────────────
# Voice LLM endpoint (Anthropic Claude / Gemini / Scripted fallback)
# ─────────────────────────────────────────────

# Pre-scripted personality responses for when no LLM key is configured.
# Keyed by trigger category detected from the last user message or context.
_FIGHTER_LINES: dict[str, list[str]] = {
    "hit_taken": ["ugh!", "that hurt!", "come on!", "block next time!", "seriously?!", "ow!"],
    "hit_landed": ["yes!", "gotcha!", "take that!", "nice one!", "boom!", "that's what I'm talking about!"],
    "taunt": ["bring it!", "is that all you got?", "I'm just warming up!", "let's go!", "you're gonna regret that!"],
    "default": ["yeah!", "focus!", "let's do this!", "I got you!", "trust me!"],
}

def _scripted_reply(messages: list[dict]) -> str:
    """Pick a contextually appropriate scripted fighter line."""
    last_content = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            last_content = (m.get("content") or "").lower()
            break

    if "[game event]" in last_content:
        if any(w in last_content for w in ("hit", "damage", "hurt", "took")):
            return random.choice(_FIGHTER_LINES["hit_taken"])
        if any(w in last_content for w in ("landed", "scored", "dealt")):
            return random.choice(_FIGHTER_LINES["hit_landed"])
        return ""
    if any(w in last_content for w in ("help", "how", "what", "why", "who", "where")):
        return random.choice(_FIGHTER_LINES["taunt"])
    return random.choice(_FIGHTER_LINES["default"])


def _clean_tts_text(text: str, max_chars: int = 200) -> str:
    """Strip markdown and limit length before sending to TTS."""
    import re
    # Strip markdown bold/italic/code
    text = re.sub(r'[*_`#]+', '', text)
    # Strip URLs
    text = re.sub(r'https?://\S+', '', text)
    # Collapse whitespace
    text = ' '.join(text.split())
    # Hard limit — Deepgram TTS is billed per character
    return text[:max_chars].strip()


@post("/api/voice/llm")
async def voice_llm(data: dict[str, Any]) -> dict:
    """Send conversation to xAI Grok, Anthropic, or Gemini and return response text."""
    xai_key = os.environ.get("XAI_API_KEY")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    messages = data.get("messages", [])
    system = data.get("system", "")

    # Prioritize xAI (Grok-Beta) if key is configured
    if xai_key:
        print("[llm:voice] xAI key set, routing to xAI Grok API")
        try:
            text = await _llm_xai(messages, system, temperature=0.7)
            return {"text": _clean_tts_text(text)}
        except Exception as e:
            print(f"[llm:voice] xAI Grok failed with error: {e}. Falling back...")

    # Fallback to Gemini if Anthropic is not configured
    if not api_key and gemini_key:
        print("[llm:voice] ANTHROPIC_API_KEY not set, routing to Gemini free tier")
        try:
            text = await _llm_gemini(messages, system, temperature=0.7)
            return {"text": _clean_tts_text(text)}
        except Exception as e:
            print(f"[llm:voice] Gemini failed with error: {e}. Falling back to scripted reply.")
            return {"text": _scripted_reply(messages)}

    if not api_key:
        # Graceful scripted fallback — still gives the fighter a voice even without an LLM key
        reply = _scripted_reply(messages)
        print(f"[llm:voice] No LLM key configured — scripted reply: '{reply}'")
        return {"text": reply}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 80,
                "system": system,
                "messages": messages,
            },
        )

    if resp.status_code != 200:
        print(f"[llm] Anthropic error {resp.status_code}: {resp.text}")
        # Don't crash — return scripted fallback
        return {"text": _scripted_reply(messages)}

    result = resp.json()
    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text":
            text += block["text"]

    return {"text": _clean_tts_text(text)}



# ─────────────────────────────────────────────
# TTS endpoint (Deepgram Aura 2)
# ─────────────────────────────────────────────

# Supported Aura 2 voice IDs — use zeus for a powerful fighter character
_DG_TTS_MODEL = "aura-2-zeus-en"   # Deep, authoritative male voice
_DG_SAMPLE_RATE = 24000


async def _dg_tts_bytes(text: str, model: str = _DG_TTS_MODEL) -> bytes:
    """Call Deepgram TTS and return raw linear16 PCM bytes."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="DEEPGRAM_API_KEY not set")

    clean = _clean_tts_text(text)
    if not clean:
        raise HTTPException(status_code=400, detail="text required")

    tts_url = (
        f"{DG_TTS_URL}"
        f"?model={model}"
        f"&encoding=linear16"
        f"&sample_rate={_DG_SAMPLE_RATE}"
        f"&container=none"
    )
    print(f"[tts] Requesting TTS for: '{clean[:60]}...' " if len(clean) > 60 else f"[tts] Requesting TTS for: '{clean}'")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            tts_url,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "application/json",
            },
            json={"text": clean},
        )

    if resp.status_code != 200:
        print(f"[tts] Deepgram TTS error {resp.status_code}: {resp.text[:200]}")
        raise HTTPException(status_code=502, detail="TTS request failed")

    return resp.content


@post("/api/voice/tts")
async def voice_tts(data: dict[str, Any]) -> Response:
    """Convert text to speech via Deepgram Aura 2, return raw linear16 PCM audio."""
    text = data.get("text", "")
    model = data.get("model", _DG_TTS_MODEL)
    audio = await _dg_tts_bytes(text, model=model)
    return Response(
        content=audio,
        media_type="audio/raw",
        headers={
            "Content-Type": "audio/raw",
            "X-Sample-Rate": str(_DG_SAMPLE_RATE),
        },
    )


# ─────────────────────────────────────────────
# LLM mode (SSE-based, random commands)
# ─────────────────────────────────────────────

@dataclass
class LLMSession:
    id: str
    player: int
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    closed: bool = False


llm_sessions: dict[str, LLMSession] = {}


async def query_llm(game_state: Any) -> str:
    # Weighted towards passive/defensive actions so voice players can keep up
    commands = [
        "forward", "forward", "forward", "forward", "forward",
        "forward", "forward", "forward",
        "back", "back", "back",
        "dash forward", "dash back",
        "crouch",
        "jump",
        "light punch", "light kick",
        "forward punch", "forward kick",
        "medium punch",
    ]
    return random.choice(commands)


async def send_sse(session: LLMSession, data: Any) -> None:
    if not session.closed:
        await session.queue.put(data)


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@get("/health")
async def health() -> dict:
    return {"status": "ok"}

@get("/favicon.ico")
async def favicon() -> Response:
    # Return empty 204 to prevent 404 errors
    return Response(content="", status_code=204)


@get("/.well-known/assetlinks.json")
async def android_assetlinks() -> Response:
    package_name = os.environ.get("ANDROID_APP_PACKAGE_NAME", DEFAULT_ANDROID_PACKAGE_NAME).strip()
    fingerprint = os.environ.get("ANDROID_APP_SHA256_CERT_FINGERPRINT", DEFAULT_ANDROID_CERT_SHA256).strip()
    payload = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": package_name,
                "sha256_cert_fingerprints": [fingerprint],
            },
        }
    ]
    return Response(content=json.dumps(payload, indent=2), media_type="application/json")


def _share_card_paths(share_id: str) -> tuple[Path, Path]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,48}", share_id or ""):
        raise HTTPException(status_code=404, detail="Share card not found")
    return SHARE_CARD_DIR / f"{share_id}.png", SHARE_CARD_DIR / f"{share_id}.json"


@post("/api/share-card")
async def create_share_card(data: dict[str, Any], request: Request) -> dict[str, str]:
    """Store a generated battle card so X can crawl a public image URL."""
    image_data = str(data.get("imageData", "")).strip()
    match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=]+)", image_data)
    if not match:
        raise HTTPException(status_code=400, detail="imageData must be a PNG data URL")

    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid image data")

    if not raw or len(raw) > MAX_SHARE_CARD_BYTES:
        raise HTTPException(status_code=413, detail="Share card image is too large")

    share_id = secrets.token_urlsafe(12)
    image_path, meta_path = _share_card_paths(share_id)
    SHARE_CARD_DIR.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(raw)

    symbol = re.sub(r"[^A-Za-z0-9_$.-]", "", str(data.get("symbol", "MEME")))[:16] or "MEME"
    result = "win" if str(data.get("result", "win")).lower() == "win" else "loss"
    mode = "pvp" if str(data.get("mode", "solo")).lower() == "pvp" else "solo"
    meta_path.write_text(
        json.dumps(
            {
                "symbol": symbol,
                "result": result,
                "mode": mode,
                "created_at": int(time.time()),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    base = _public_base_url(request)
    return {
        "shareId": share_id,
        "shareUrl": f"{base}/share/{share_id}",
        "imageUrl": f"{base}/api/share-card/{share_id}",
    }


@get("/api/share-card/{share_id:str}")
async def get_share_card_image(share_id: str) -> Response:
    image_path, _ = _share_card_paths(share_id)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Share card not found")
    return Response(
        content=image_path.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@get("/share/{share_id:str}")
async def share_card_page(share_id: str, request: Request) -> Response:
    image_path, meta_path = _share_card_paths(share_id)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Share card not found")

    meta: dict[str, Any] = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    base = _public_base_url(request)
    symbol = html.escape(str(meta.get("symbol") or "MEME"))
    result = str(meta.get("result") or "win")
    title = f"StickLash Battle Card - ${symbol}"
    description = (
        f"A StickLash fighter just won against ${symbol}."
        if result == "win"
        else f"${symbol} just forced a StickLash rematch."
    )
    page_url = f"{base}/share/{share_id}"
    image_url = f"{base}/api/share-card/{share_id}"
    safe_title = html.escape(title)
    safe_description = html.escape(description)
    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <link rel="canonical" href="{page_url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{safe_title}">
  <meta property="og:description" content="{safe_description}">
  <meta property="og:url" content="{page_url}">
  <meta property="og:image" content="{image_url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@sticklashfun">
  <meta name="twitter:title" content="{safe_title}">
  <meta name="twitter:description" content="{safe_description}">
  <meta name="twitter:image" content="{image_url}">
  <meta name="twitter:image:alt" content="StickLash battle result card">
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#020607; color:#fff; font-family:Arial,sans-serif; }}
    main {{ width:min(92vw,960px); text-align:center; }}
    img {{ width:100%; border-radius:24px; border:2px solid #13ef95; box-shadow:0 0 32px rgba(19,239,149,.35); }}
    a {{ display:inline-block; margin-top:18px; padding:14px 20px; border-radius:999px; background:#13ef95; color:#020607; font-weight:800; text-decoration:none; }}
  </style>
</head>
<body>
  <main>
    <img src="{image_url}" alt="StickLash battle result card">
    <a href="{base}/">Enter StickLash</a>
  </main>
</body>
</html>"""
    return Response(content=html_doc, media_type="text/html")


# ─────────────────────────────────────────────
# Solscan Discovery Engine Endpoints
# ─────────────────────────────────────────────

@get("/api/smf-config")
async def api_smf_config() -> dict[str, str]:
    """Retrieve SMF mint address and client-safe Solana RPC URL."""
    return {
        "smfMint": _get_smf_mint(),
        "solanaRpc": _get_public_solana_rpc(),
    }


@post("/api/wallet-auth/challenge")
async def api_wallet_auth_challenge(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """Create a short-lived wallet sign-in challenge."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    _check_rate_limit("wallet-auth-challenge", wallet)

    challenge_id = str(uuid.uuid4())
    nonce = secrets.token_hex(16)
    issued_at_unix = int(time.time())
    expires_at_unix = issued_at_unix + WALLET_AUTH_CHALLENGE_TTL_SECONDS
    message = _wallet_auth_message(request, wallet, nonce, issued_at_unix, expires_at_unix)

    async with boost_pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO wallet_auth_challenges (
                challenge_id, wallet_address, nonce, message, expires_at
            )
            VALUES ($1, $2, $3, $4, to_timestamp($5))
            """,
            challenge_id,
            wallet,
            nonce,
            message,
            expires_at_unix,
        )

    _audit_boost_event("wallet_auth_challenge_issued", wallet=wallet, challenge_id=challenge_id)
    return {
        "challengeId": challenge_id,
        "wallet": wallet,
        "message": message,
        "nonce": nonce,
        "expiresAtUnix": expires_at_unix,
    }


@post("/api/wallet-auth/verify")
async def api_wallet_auth_verify(data: dict[str, Any]) -> dict[str, Any]:
    """Verify wallet signature for challenge and issue bearer session token."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    challenge_id = str(data.get("challengeId") or data.get("challenge_id") or "").strip()
    signature = str(data.get("signature") or "").strip()

    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    if not challenge_id:
        raise HTTPException(status_code=400, detail="challengeId is required")
    if not signature:
        raise HTTPException(status_code=400, detail="signature is required")
    _check_rate_limit("wallet-auth-verify", wallet)

    try:
        signature_bytes = _decode_signature(signature)
        wallet_bytes = _base58_decode(wallet)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if len(wallet_bytes) != 32:
        raise HTTPException(status_code=400, detail="Wallet public key bytes length invalid")

    try:
        import nacl.signing  # type: ignore[import-not-found]
        from nacl.exceptions import BadSignatureError  # type: ignore[import-not-found]
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Wallet auth dependency missing on server (PyNaCl).",
        )

    session_token = secrets.token_urlsafe(48)
    session_hash = _token_hash(session_token)
    session_expires_at_unix = int(time.time()) + WALLET_AUTH_SESSION_TTL_SECONDS

    async with boost_pg_pool.acquire() as conn:
        async with conn.transaction():
            challenge = await conn.fetchrow(
                """
                SELECT challenge_id, wallet_address, message, expires_at, consumed_at
                FROM wallet_auth_challenges
                WHERE challenge_id = $1
                FOR UPDATE
                """,
                challenge_id,
            )
            if challenge is None:
                raise HTTPException(status_code=404, detail="Challenge not found")
            if str(challenge["wallet_address"]) != wallet:
                raise HTTPException(status_code=403, detail="Challenge wallet mismatch")
            if challenge["consumed_at"] is not None:
                raise HTTPException(status_code=409, detail="Challenge already used")
            expires_at = challenge["expires_at"]
            if expires_at is not None and expires_at.timestamp() < time.time():
                raise HTTPException(status_code=409, detail="Challenge expired")

            verify_key = nacl.signing.VerifyKey(wallet_bytes)
            try:
                verify_key.verify(str(challenge["message"]).encode("utf-8"), signature_bytes)
            except BadSignatureError:
                raise HTTPException(status_code=401, detail="Invalid wallet signature")

            await conn.execute(
                """
                UPDATE wallet_auth_challenges
                SET consumed_at = NOW()
                WHERE challenge_id = $1
                """,
                challenge_id,
            )
            await conn.execute(
                """
                INSERT INTO wallet_auth_sessions (
                    token_hash, wallet_address, challenge_id, expires_at
                )
                VALUES ($1, $2, $3, to_timestamp($4))
                """,
                session_hash,
                wallet,
                challenge_id,
                session_expires_at_unix,
            )

    _audit_boost_event("wallet_auth_verified", wallet=wallet, challenge_id=challenge_id)
    return {
        "wallet": wallet,
        "token": session_token,
        "expiresAtUnix": session_expires_at_unix,
    }


@post("/api/wallet-auth/verify-siws")
async def api_wallet_auth_verify_siws(data: dict[str, Any]) -> dict[str, Any]:
    """Verify a native MWA Sign-In-with-Solana payload and issue a session token."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    signature = str(data.get("signature") or "").strip()
    signed_message_b64 = str(data.get("signedMessageBase64") or data.get("signed_message_base64") or "").strip()
    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    if not signature:
        raise HTTPException(status_code=400, detail="signature is required")
    if not signed_message_b64:
        raise HTTPException(status_code=400, detail="signedMessageBase64 is required")
    _check_rate_limit("wallet-auth-verify", wallet)

    try:
        signature_bytes = _decode_signature(signature)
        wallet_bytes = _base58_decode(wallet)
        padding = "=" * ((4 - len(signed_message_b64) % 4) % 4)
        message_bytes = base64.b64decode(signed_message_b64 + padding, validate=True)
        message = message_bytes.decode("utf-8")
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid SIWS payload: {exc}")
    if len(wallet_bytes) != 32:
        raise HTTPException(status_code=400, detail="Wallet public key bytes length invalid")

    fields = _parse_siws_message_fields(message)
    if fields.get("wallet") != wallet:
        raise HTTPException(status_code=403, detail="SIWS wallet mismatch")
    if fields.get("uri") != "https://sticklash.fun":
        raise HTTPException(status_code=403, detail="SIWS URI mismatch")
    if fields.get("version") != "1":
        raise HTTPException(status_code=403, detail="SIWS version mismatch")
    if fields.get("chain_id") not in {"solana:mainnet-beta", "mainnet"}:
        raise HTTPException(status_code=403, detail="SIWS chain mismatch")
    nonce = fields.get("nonce", "")
    if len(nonce) < 16:
        raise HTTPException(status_code=400, detail="SIWS nonce missing")

    try:
        import nacl.signing  # type: ignore[import-not-found]
        from nacl.exceptions import BadSignatureError  # type: ignore[import-not-found]
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Wallet auth dependency missing on server (PyNaCl).",
        )

    verify_key = nacl.signing.VerifyKey(wallet_bytes)
    try:
        verify_key.verify(message_bytes, signature_bytes)
    except BadSignatureError:
        raise HTTPException(status_code=401, detail="Invalid SIWS signature")

    session_token = secrets.token_urlsafe(48)
    session_hash = _token_hash(session_token)
    session_expires_at_unix = int(time.time()) + WALLET_AUTH_SESSION_TTL_SECONDS
    challenge_id = "siws:" + hashlib.sha256(f"{wallet}:{nonce}".encode("utf-8")).hexdigest()

    async with boost_pg_pool.acquire() as conn:
        async with conn.transaction():
            inserted = await conn.fetchval(
                """
                INSERT INTO wallet_auth_challenges (
                    challenge_id, wallet_address, nonce, message, expires_at, consumed_at
                )
                VALUES ($1, $2, $3, $4, to_timestamp($5), NOW())
                ON CONFLICT (challenge_id) DO NOTHING
                RETURNING challenge_id
                """,
                challenge_id,
                wallet,
                nonce,
                message,
                session_expires_at_unix,
            )
            if inserted is None:
                raise HTTPException(status_code=409, detail="SIWS nonce already used")
            await conn.execute(
                """
                INSERT INTO wallet_auth_sessions (
                    token_hash, wallet_address, challenge_id, expires_at
                )
                VALUES ($1, $2, $3, to_timestamp($4))
                """,
                session_hash,
                wallet,
                challenge_id,
                session_expires_at_unix,
            )

    _audit_boost_event("wallet_auth_siws_verified", wallet=wallet, challenge_id=challenge_id)
    return {
        "wallet": wallet,
        "token": session_token,
        "expiresAtUnix": session_expires_at_unix,
    }


@post("/api/wallet-auth/logout")
async def api_wallet_auth_logout(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """Revoke wallet session token for a wallet."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")

    async with boost_pg_pool.acquire() as conn:
        await _require_wallet_session(conn, request, wallet)
        token = _extract_bearer_token(request)
        await conn.execute(
            """
            UPDATE wallet_auth_sessions
            SET revoked_at = NOW()
            WHERE token_hash = $1 AND wallet_address = $2
            """,
            _token_hash(token),
            wallet,
        )

    _audit_boost_event("wallet_auth_logout", wallet=wallet)
    return {"status": "ok", "wallet": wallet}


@get("/api/boost/packs")
async def api_boost_packs() -> dict[str, Any]:
    """Return canonical boost pack catalog."""
    return {
        "packs": [
            {"packId": "micro", "boosts": 5, "usdCents": 100},
            {"packId": "degen", "boosts": 20, "usdCents": 300},
            {"packId": "chaos", "boosts": 45, "usdCents": 500},
        ],
        "starterBoosts": STARTER_BOOSTS,
    }


async def _get_or_create_boost_balance(conn: asyncpg.Connection, wallet: str) -> int:  # type: ignore[type-arg]
    await conn.execute(
        "INSERT INTO player_boost_balances (wallet_address, boosts) VALUES ($1, $2) "
        "ON CONFLICT (wallet_address) DO NOTHING",
        wallet,
        STARTER_BOOSTS,
    )
    row = await conn.fetchrow(
        "SELECT boosts FROM player_boost_balances WHERE wallet_address = $1",
        wallet,
    )
    if row is None:
        return STARTER_BOOSTS
    return int(row["boosts"])


@get("/api/boost/balance")
async def api_boost_balance(wallet: str) -> dict[str, Any]:
    """Return server-authoritative boost balance for a wallet."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    normalized_wallet = _normalize_wallet_address(wallet)
    if not _is_valid_wallet_address(normalized_wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")

    async with boost_pg_pool.acquire() as conn:
        boosts = await _get_or_create_boost_balance(conn, normalized_wallet)
    return {"wallet": normalized_wallet, "boosts": boosts}


@post("/api/boost/create-intent")
async def api_boost_create_intent(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """Create a purchase intent for a boost pack."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    pack_id = str(data.get("packId") or data.get("pack_id") or "").strip().lower()

    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    if pack_id not in BOOST_PACKS:
        raise HTTPException(status_code=400, detail="Invalid pack id")

    try:
        quote = await _compute_pack_quote(pack_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to compute pack quote: {exc}")

    intent_id = str(uuid.uuid4())
    expires_at_unix = int(time.time()) + BOOST_INTENT_TTL_SECONDS

    async with boost_pg_pool.acquire() as conn:
        await _require_wallet_session(conn, request, wallet)
        _check_rate_limit("create-intent", wallet)
        await conn.execute(
            """
            INSERT INTO boost_purchase_intents (
                intent_id, wallet_address, pack_id, boosts_count, mint_address,
                expected_smf_amount, token_decimals, status, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', to_timestamp($8))
            """,
            intent_id,
            wallet,
            quote["pack_id"],
            quote["boosts_count"],
            quote["mint"],
            quote["required_smf_raw"],
            quote["token_decimals"],
            expires_at_unix,
        )
        boosts = await _get_or_create_boost_balance(conn, wallet)

    _audit_boost_event("boost_intent_created", wallet=wallet, intent_id=intent_id, pack=quote["pack_id"])
    return {
        "intentId": intent_id,
        "wallet": wallet,
        "packId": quote["pack_id"],
        "boostsToCredit": quote["boosts_count"],
        "requiredSmfUiAmount": quote["required_smf_ui"],
        "requiredSmfRawAmount": str(quote["required_smf_raw"]),
        "tokenDecimals": quote["token_decimals"],
        "mint": quote["mint"],
        "solanaRpc": _get_public_solana_rpc(),
        "smfPriceUsd": quote["smf_price"],
        "expiresAtUnix": expires_at_unix,
        "currentBoostBalance": boosts,
    }


@post("/api/boost/confirm")
async def api_boost_confirm(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """Confirm a signed burn transaction and credit boosts exactly once."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    intent_id = str(data.get("intentId") or data.get("intent_id") or "").strip()
    signature = str(data.get("signature") or "").strip()

    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    if not intent_id:
        raise HTTPException(status_code=400, detail="intentId is required")
    if not signature:
        raise HTTPException(status_code=400, detail="signature is required")

    async with boost_pg_pool.acquire() as conn:
        await _require_wallet_session(conn, request, wallet)
        _check_rate_limit("confirm", wallet)
        async with conn.transaction():
            intent = await conn.fetchrow(
                """
                SELECT intent_id, wallet_address, pack_id, boosts_count, mint_address,
                       expected_smf_amount, token_decimals, status, signature, expires_at
                FROM boost_purchase_intents
                WHERE intent_id = $1
                FOR UPDATE
                """,
                intent_id,
            )

            if intent is None:
                raise HTTPException(status_code=404, detail="Intent not found")
            if str(intent["wallet_address"]) != wallet:
                raise HTTPException(status_code=403, detail="Intent does not belong to this wallet")

            status = str(intent["status"])
            existing_signature = str(intent["signature"] or "")

            if status == "confirmed":
                boosts = await _get_or_create_boost_balance(conn, wallet)
                _audit_boost_event("boost_confirm_idempotent", wallet=wallet, intent_id=intent_id, signature=existing_signature)
                return {
                    "status": "confirmed",
                    "intentId": intent_id,
                    "signature": existing_signature,
                    "boosts": boosts,
                    "idempotent": True,
                }

            expires_at = intent["expires_at"]
            if expires_at is not None and expires_at.timestamp() < time.time():
                raise HTTPException(status_code=409, detail="Intent expired. Create a new intent.")

            existing = await conn.fetchrow(
                "SELECT intent_id FROM boost_purchase_ledger WHERE signature = $1",
                signature,
            )
            if existing is not None and str(existing["intent_id"]) != intent_id:
                raise HTTPException(status_code=409, detail="Signature already used for another intent")

            ok, reason, burned_amount, tx = await _verify_burn_transaction(
                signature=signature,
                wallet=wallet,
                mint=str(intent["mint_address"]),
                min_burn_amount=int(intent["expected_smf_amount"]),
                rpc_url=_get_solana_rpc(),
            )
            if not ok:
                _audit_boost_event("boost_confirm_failed", wallet=wallet, intent_id=intent_id, reason=reason)
                raise HTTPException(status_code=400, detail=reason)

            await conn.execute(
                """
                INSERT INTO boost_purchase_ledger (
                    intent_id, signature, wallet_address, pack_id, boosts_credited,
                    mint_address, burn_amount, slot, raw_tx
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                ON CONFLICT (intent_id) DO NOTHING
                """,
                intent_id,
                signature,
                wallet,
                str(intent["pack_id"]),
                int(intent["boosts_count"]),
                str(intent["mint_address"]),
                burned_amount,
                (tx or {}).get("slot"),
                json.dumps(tx or {}),
            )

            await conn.execute(
                """
                INSERT INTO player_boost_balances (wallet_address, boosts, total_purchased_boosts, total_spent_boosts)
                VALUES ($1, $2, $3, 0)
                ON CONFLICT (wallet_address)
                DO UPDATE SET
                    boosts = player_boost_balances.boosts + EXCLUDED.total_purchased_boosts,
                    total_purchased_boosts = player_boost_balances.total_purchased_boosts + EXCLUDED.total_purchased_boosts,
                    updated_at = NOW()
                """,
                wallet,
                STARTER_BOOSTS + int(intent["boosts_count"]),
                int(intent["boosts_count"]),
            )

            await conn.execute(
                """
                UPDATE boost_purchase_intents
                SET status = 'confirmed',
                    signature = $2,
                    confirmed_at = NOW(),
                    last_error = ''
                WHERE intent_id = $1
                """,
                intent_id,
                signature,
            )

            balance_row = await conn.fetchrow(
                "SELECT boosts FROM player_boost_balances WHERE wallet_address = $1",
                wallet,
            )
            boosts = int(balance_row["boosts"]) if balance_row else STARTER_BOOSTS

    _audit_boost_event("boost_confirmed", wallet=wallet, intent_id=intent_id, signature=signature, boosts=boosts)
    return {
        "status": "confirmed",
        "intentId": intent_id,
        "signature": signature,
        "burnedAmountRaw": str(burned_amount),
        "boosts": boosts,
        "idempotent": False,
    }


@post("/api/boost/consume")
async def api_boost_consume(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """Atomically consume boost units for gameplay actions (e.g., hadouken)."""
    if boost_pg_pool is None:
        raise HTTPException(status_code=503, detail="Boost ledger database not available")

    wallet = _normalize_wallet_address(data.get("wallet"))
    if not _is_valid_wallet_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")

    try:
        units = int(data.get("units", 1))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="units must be an integer")
    if units < 1 or units > 5:
        raise HTTPException(status_code=400, detail="units must be between 1 and 5")

    consume_id_raw = str(data.get("consumeId") or data.get("consume_id") or "").strip()
    consume_id = consume_id_raw if consume_id_raw else None
    if consume_id is not None and len(consume_id) > 128:
        raise HTTPException(status_code=400, detail="consumeId too long")

    reason = str(data.get("reason") or "hadouken").strip()[:64]
    if not reason:
        reason = "hadouken"

    async with boost_pg_pool.acquire() as conn:
        await _require_wallet_session(conn, request, wallet)
        _check_rate_limit("consume", wallet)
        async with conn.transaction():
            await _get_or_create_boost_balance(conn, wallet)

            if consume_id is not None:
                existing = await conn.fetchrow(
                    """
                    SELECT units, balance_after
                    FROM boost_consumption_ledger
                    WHERE consume_id = $1 AND wallet_address = $2
                    """,
                    consume_id,
                    wallet,
                )
                if existing is not None:
                    _audit_boost_event("boost_consume_idempotent", wallet=wallet, consume_id=consume_id)
                    return {
                        "status": "ok",
                        "wallet": wallet,
                        "consumed": True,
                        "units": int(existing["units"]),
                        "boosts": int(existing["balance_after"]),
                        "idempotent": True,
                    }

            updated = await conn.fetchrow(
                """
                UPDATE player_boost_balances
                SET boosts = boosts - $2,
                    total_spent_boosts = total_spent_boosts + $2,
                    updated_at = NOW()
                WHERE wallet_address = $1 AND boosts >= $2
                RETURNING boosts
                """,
                wallet,
                units,
            )

            if updated is None:
                current = await conn.fetchrow(
                    "SELECT boosts FROM player_boost_balances WHERE wallet_address = $1",
                    wallet,
                )
                boosts_left = int(current["boosts"]) if current else 0
                _audit_boost_event("boost_consume_failed", wallet=wallet, reason="insufficient", balance=boosts_left)
                raise HTTPException(
                    status_code=409,
                    detail=f"Insufficient boosts. Current balance: {boosts_left}",
                )

            boosts_left = int(updated["boosts"])
            await conn.execute(
                """
                INSERT INTO boost_consumption_ledger (
                    consume_id, wallet_address, units, reason, balance_after
                )
                VALUES ($1, $2, $3, $4, $5)
                """,
                consume_id,
                wallet,
                units,
                reason,
                boosts_left,
            )

    _audit_boost_event("boost_consumed", wallet=wallet, units=units, balance=boosts_left)
    return {
        "status": "ok",
        "wallet": wallet,
        "consumed": True,
        "units": units,
        "boosts": boosts_left,
        "idempotent": False,
    }

@get(MARKET_TRENDING_ROUTE)
async def api_market_trending(count: int = 12) -> List[Dict[str, Any]]:
    return await birdeye_service.fetch_trending_tokens(count)

@get(MARKET_GRADUATES_ROUTE)
async def api_market_graduates(count: int = 8) -> List[Dict[str, Any]]:
    return await birdeye_service.fetch_graduated_tokens(count)

@get(MARKET_TOKEN_ROUTE)
async def api_market_token_details(mint: str) -> Optional[Dict[str, Any]]:
    # mark_hot=True: this endpoint is called by live fights for boost detection.
    # Hot tokens get a 90s TTL (vs 300s for cold) and are prioritised by the warmer.
    return await birdeye_service.get_cached_token(mint, mark_hot=True)

def _assert_legacy_market_endpoint_allowed() -> None:
    if ALLOW_LEGACY_MARKET_ENDPOINTS:
        return
    raise HTTPException(
        status_code=410,
        detail="Legacy market endpoint retired. Please upgrade to the latest app build."
    )

@get("/api/trending")
async def api_trending(count: int = 12) -> List[Dict[str, Any]]:
    _assert_legacy_market_endpoint_allowed()
    return await api_market_trending(count)

@get("/api/graduates")
async def api_graduates(count: int = 8) -> List[Dict[str, Any]]:
    _assert_legacy_market_endpoint_allowed()
    return await api_market_graduates(count)

@get("/api/token/{mint:str}")
async def api_token_details(mint: str) -> Optional[Dict[str, Any]]:
    _assert_legacy_market_endpoint_allowed()
    return await api_market_token_details(mint)

@get("/api/proxy/image")
async def proxy_image(url: str) -> Response:
    """Proxy external images to bypass CORS and prevent canvas tainting."""
    if not url:
        raise HTTPException(status_code=400, detail="url parameter is required")
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid URL protocol")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")
            media_type = resp.headers.get("content-type", "image/png")
            return Response(
                content=resp.content,
                media_type=media_type,
                headers={"Cache-Control": "public, max-age=86400"}
            )
    except Exception as e:
        print(f"[proxy_image] Error proxying {url}: {e}")
        raise HTTPException(status_code=502, detail="Error proxying image")

@get("/api/safety/tweets")
async def safety_tweets(cashtag: str) -> dict:
    import random
    bearer_token = (
        os.environ.get("X_BEARER_TOKEN")
        or os.environ.get("VITE_X_BEARER_TOKEN")
        or os.environ.get("X_API_KEY")
    )
    
    # Mock data as robust fallback
    mock_tweets = [
        {"author": "@novasolana", "text": f"{cashtag} contract is clean. LP burned, mint revoked. Good to go. 🛡️"},
        {"author": "@rugmuncher", "text": f"Watching the top 10 wallets for {cashtag}. They hold 42%, be careful playing this one! ⚠️"},
        {"author": "@solana_scanner", "text": f"No honeypot detected on {cashtag}. Renounced ownership."},
        {"author": "@degen_whale", "text": f"I just ape'd into {cashtag}, looks absolutely safe!"}
    ]

    if not bearer_token:
        # Graceful fallback to mock data
        random.shuffle(mock_tweets)
        return {"tweets": mock_tweets[:2]}

    try:
        url = "https://api.twitter.com/2/tweets/search/recent"
        # Search for the cashtag, e.g. "$XYO"
        params = {
            "query": cashtag,
            "max_results": 10,
            "tweet.fields": "author_id,created_at,text",
            "expansions": "author_id",
            "user.fields": "username,name"
        }
        headers = {
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json"
        }
        
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url, headers=headers, params=params)
            
            if resp.status_code != 200:
                print(f"[x-api] Search failed with status {resp.status_code}: {resp.text}")
                random.shuffle(mock_tweets)
                return {"tweets": mock_tweets[:2]}
            
            data = resp.json()
            tweets_data = data.get("data", [])
            users_data = {u["id"]: u for u in data.get("includes", {}).get("users", [])}
            
            formatted_tweets = []
            for t in tweets_data:
                author_id = t.get("author_id")
                author_info = users_data.get(author_id, {})
                username = author_info.get("username", "anonymous")
                formatted_tweets.append({
                    "author": f"@{username}",
                    "text": t.get("text", "")
                })
            
            if not formatted_tweets:
                random.shuffle(mock_tweets)
                return {"tweets": mock_tweets[:2]}
                
            return {"tweets": formatted_tweets[:5]}  # Return up to 5 real tweets
            
    except Exception as e:
        print(f"[x-api] Error fetching tweets: {e}")
        random.shuffle(mock_tweets)
        return {"tweets": mock_tweets[:2]}

@get("/")
async def index_route() -> Response:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return Response(content=html, media_type="text/html")


@get("/room/{code:str}")
async def room_route(code: str) -> Response:
    """Serve the game page for a room join link (JS reads the URL to detect the room code)."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return Response(content=html, media_type="text/html")


@get("/leaderboard")
async def leaderboard_page() -> Response:
    """Serve the game page for the leaderboard URL (JS reads the route)."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return Response(content=html, media_type="text/html")


@post("/api/room/create")
async def room_create(request: Request) -> dict[str, str]:
    """Create a new multiplayer room. Returns the room code and shareable URL."""
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    player_id = str(uuid.uuid4())
    room = await room_manager.create_room(player_id)

    # Build shareable URL: prefer BASE_URL env var, fall back to request origin
    base = os.environ.get("BASE_URL", "").rstrip("/") or str(request.base_url).rstrip("/")
    code = room["code"]

    return {
        "code": code,
        "playerId": player_id,
        "url": f"{base}/room/{code}",
    }


@post("/api/room/join")
async def room_join(data: dict[str, str]) -> dict[str, str]:
    """Join an existing room as Player 2. Returns room code and player ID."""
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    code = data.get("code", "").strip().lower()
    if not code:
        raise HTTPException(status_code=400, detail="Room code is required")

    player_id = str(uuid.uuid4())
    try:
        room = await room_manager.join_room(code, player_id)
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        if "full" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=400, detail=msg)

    # Transition room to "selecting" now that both players are in
    await room_manager.transition_status(code, "selecting")

    return {
        "code": room["code"],
        "playerId": player_id,
        "playerNum": "2",
    }


@get("/api/room/status")
async def room_status(code: str) -> dict[str, Any]:
    """Poll room state. Used by clients to detect opponent join + controller readiness."""
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    room = await room_manager.get_room(code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    await room_manager.refresh_ttl(code)

    return {
        "code": room["code"],
        "status": room["status"],
        "p1Controller": room["p1_controller"],
        "p2Controller": room["p2_controller"],
        "p1Ready": bool(room["p1_controller"]),
        "p2Ready": bool(room["p2_controller"]),
        "controllerWaitDeadline": int(room.get("controller_wait_deadline", "0") or "0"),
        "forfeitWinner": int(room["forfeit_winner"]) if room.get("forfeit_winner") else None,
    }


VALID_CONTROLLERS = {"controller", "voice", "phone", "simulated", "llm"}
VALID_MP_CONTROLLERS = {"controller", "voice", "phone"}


@post("/api/room/controller")
async def room_controller(data: dict[str, str]) -> dict[str, Any]:
    """Set a player's controller choice. When both are set, transitions to fighting."""
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    code = data.get("code", "").strip()
    player_id = data.get("playerId", "").strip()
    controller = data.get("controller", "").strip()

    if not code or not player_id or not controller:
        raise HTTPException(status_code=400, detail="code, playerId, and controller are required")

    if controller not in VALID_CONTROLLERS:
        raise HTTPException(status_code=400, detail=f"Invalid controller: {controller}")
    if controller not in VALID_MP_CONTROLLERS:
        raise HTTPException(status_code=400, detail=f"Controller '{controller}' is not allowed in multiplayer")

    room = await room_manager.get_room(code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    player_num = _resolve_player_num(room, player_id)

    room = await room_manager.set_controller(code, player_num, controller)

    # Check if both controllers are set → transition to fighting
    both_ready = bool(room["p1_controller"]) and bool(room["p2_controller"])
    wait_deadline = 0
    if both_ready and room["status"] == "selecting":
        _cancel_controller_wait_timer(code)
        room = await room_manager.transition_status(code, "fighting")
    elif not both_ready and room["status"] == "selecting":
        # First controller confirmed — start the forfeit countdown
        wait_deadline = int(time.time()) + CONTROLLER_WAIT_TIMEOUT
        key = f"room:{code}"
        await room_manager._redis.hset(key, "controller_wait_deadline", str(wait_deadline))  # type: ignore[misc]
        _start_controller_wait_timer(code, waiting_player=player_num)

    return {
        "status": room["status"],
        "p1Controller": room["p1_controller"],
        "p2Controller": room["p2_controller"],
        "bothReady": both_ready,
        "controllerWaitDeadline": wait_deadline,
    }


@post("/api/room/rematch")
async def room_rematch(data: dict[str, str]) -> dict[str, Any]:
    """Reset room for a rematch — clears controllers, returns to 'selecting' status."""
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    code = data.get("code", "").strip()
    player_id = data.get("playerId", "").strip()
    if not code or not player_id:
        raise HTTPException(status_code=400, detail="code and playerId are required")

    room = await room_manager.get_room(code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    # Validate player belongs to this room
    _resolve_player_num(room, player_id)

    try:
        room = await room_manager.reset_for_rematch(code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Cancel any active forfeit timer and clear deadline
    _cancel_controller_wait_timer(code)
    key = f"room:{code}"
    await room_manager._redis.hdel(key, "controller_wait_deadline", "forfeit_winner")  # type: ignore[misc]

    # Stop the existing game loop if running
    if game_loop_manager is not None:
        await game_loop_manager.stop_loop(code)

    return {
        "status": room["status"],
        "code": room["code"],
    }


@post("/api/match/complete")
async def match_complete(data: dict[str, Any]) -> dict[str, Any]:
    """Process end-of-match: transition room to finished, update ELO if applicable.

    Body: { code, playerId, winner (1|2|null), p1Health, p2Health,
            p1UserId?, p2UserId?, p1Name?, p2Name? }
    """
    if room_manager is None:
        raise HTTPException(status_code=503, detail="Room manager not available")

    code = data.get("code", "").strip() if isinstance(data.get("code"), str) else ""
    player_id = data.get("playerId", "").strip() if isinstance(data.get("playerId"), str) else ""
    if not code or not player_id:
        raise HTTPException(status_code=400, detail="code and playerId are required")

    room = await room_manager.get_room(code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    _resolve_player_num(room, player_id)

    # Transition to finished (idempotent — skip if already finished)
    if room["status"] == "fighting":
        try:
            await room_manager.transition_status(code, "finished")
        except ValueError:
            pass  # Already transitioned

    winner = data.get("winner")  # 1, 2, or None for draw

    # ELO update — only if both players are logged in and controllers are ranked
    elo_result: dict[str, Any] = {"updated": False}

    p1_user_id = data.get("p1UserId", "")
    p2_user_id = data.get("p2UserId", "")
    p1_name = data.get("p1Name", "")
    p2_name = data.get("p2Name", "")

    if elo_manager is not None and p1_user_id and p2_user_id:
        # Determine ELO category from controllers
        p1_cat = controller_to_category(room.get("p1_controller", ""))
        p2_cat = controller_to_category(room.get("p2_controller", ""))

        # Both must map to the same ranked category
        if p1_cat and p2_cat and p1_cat == p2_cat:
            category = p1_cat

            # Store display names
            if p1_name:
                await elo_manager.set_player_name(p1_user_id, p1_name)
            if p2_name:
                await elo_manager.set_player_name(p2_user_id, p2_name)

            is_draw = winner is None
            if is_draw:
                w_stats, l_stats = await elo_manager.update_ratings(
                    p1_user_id, p2_user_id, category, draw=True
                )
                elo_result = {
                    "updated": True,
                    "category": category,
                    "p1": w_stats,
                    "p2": l_stats,
                }
            elif winner == 1:
                w_stats, l_stats = await elo_manager.update_ratings(
                    p1_user_id, p2_user_id, category
                )
                elo_result = {
                    "updated": True,
                    "category": category,
                    "p1": w_stats,
                    "p2": l_stats,
                }
            elif winner == 2:
                w_stats, l_stats = await elo_manager.update_ratings(
                    p2_user_id, p1_user_id, category
                )
                elo_result = {
                    "updated": True,
                    "category": category,
                    "p1": l_stats,
                    "p2": w_stats,
                }

    return {
        "ok": True,
        "winner": winner,
        "elo": elo_result,
    }


# ─────────────────────────────────────────────
# WebRTC signaling
# ─────────────────────────────────────────────


def _resolve_player_num(room_data: dict[str, str], player_id: str) -> int:
    """Determine player number (1 or 2) from a room's data and a player ID.

    Raises HTTPException if the player doesn't belong to this room.
    """
    if room_data["p1_id"] == player_id:
        return 1
    if room_data["p2_id"] == player_id:
        return 2
    raise HTTPException(status_code=403, detail="Player not in this room")


@get("/api/rtc/config")
async def rtc_config() -> dict[str, Any]:
    """Return WebRTC ICE server configuration and fallback strategy.

    Clients use this to configure RTCPeerConnection. If WebRTC fails,
    clients fall back to server-only relay via /ws/game/{code}.
    """
    return {
        "iceServers": ICE_SERVERS,
        "fallback": "server-relay",
    }


@post("/api/room/signal")
async def signal_send(data: dict[str, Any]) -> dict[str, bool]:
    """Relay a WebRTC signal (SDP offer/answer or ICE candidate) to the other peer.

    Validates the room exists in Redis and the sender belongs to it.

    Request body:
        room: str — room code
        playerId: str — sender's player ID (from room create/join)
        signal: dict — the WebRTC signal payload (type + sdp/candidate data)
    """
    if room_manager is None or signaling_manager is None:
        raise HTTPException(status_code=503, detail="Service not available")

    room_code: str = data.get("room", "")
    player_id: str = data.get("playerId", "")
    signal: dict[str, Any] = data.get("signal", {})

    if not room_code or not player_id or not signal:
        raise HTTPException(status_code=400, detail="room, playerId, and signal are required")

    # Validate room in Redis and resolve player number
    room_data = await room_manager.get_room(room_code)
    if room_data is None:
        raise HTTPException(status_code=404, detail="Room not found")

    from_player = _resolve_player_num(room_data, player_id)

    # Relay signal to the other player's SSE queue
    relayed = await signaling_manager.relay(room_code, from_player, signal)
    safe_print(f"[signal:{room_code}] P{from_player} -> P{2 if from_player == 1 else 1}: {signal.get('type', '?')} (relayed={relayed})")

    # Refresh room TTL on signaling activity
    await room_manager.refresh_ttl(room_code)

    return {"relayed": relayed}


@get("/api/room/signal/listen")
async def signal_listen(room: str, player_id: str) -> ServerSentEvent:
    """SSE stream for receiving WebRTC signals from the other peer.

    Query params:
        room: str — room code
        player_id: str — this player's ID (from room create/join)

    Sends ICE server config on connect, then relays signals as they arrive.
    """
    if room_manager is None or signaling_manager is None:
        raise HTTPException(status_code=503, detail="Service not available")

    # Validate room in Redis
    room_data = await room_manager.get_room(room)
    if room_data is None:
        raise HTTPException(status_code=404, detail="Room not found")

    player_num = _resolve_player_num(room_data, player_id)

    # Register signaling session
    session = signaling_manager.connect(room, player_num)
    print(f"[signal:{room}] P{player_num} SSE connected")

    async def event_generator() -> AsyncGenerator[dict[str, Any], None]:
        # First message includes ICE server config so the client can
        # create RTCPeerConnection immediately
        yield {"data": json.dumps({
            "type": "connected",
            "player": player_num,
            "iceServers": ICE_SERVERS,
        })}
        try:
            while not session.closed:
                try:
                    data = await asyncio.wait_for(session.queue.get(), timeout=30)
                    yield {"data": json.dumps(data)}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            signaling_manager.disconnect(room, player_num)
            print(f"[signal:{room}] P{player_num} SSE disconnected")

    return ServerSentEvent(event_generator())


@get("/api/session/connect")
async def session_connect(mode: str | None = None, player: int = 1) -> ServerSentEvent:
    if mode != "llm":
        raise HTTPException(status_code=400, detail="mode must be 'llm'")

    session = LLMSession(id=str(uuid.uuid4()), player=player)
    llm_sessions[session.id] = session
    print(f"[llm:{session.id}] Session created for player {player}")

    async def event_generator() -> AsyncGenerator[dict[str, Any], None]:
        yield {"data": json.dumps({"type": "connected", "sessionId": session.id})}
        try:
            while not session.closed:
                try:
                    data = await asyncio.wait_for(session.queue.get(), timeout=30)
                    yield {"data": json.dumps(data)}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            session.closed = True
            llm_sessions.pop(session.id, None)
            print(f"[llm:{session.id}] SSE disconnected, session cleaned up")

    return ServerSentEvent(event_generator())


@post("/api/session/send")
async def session_send(session: str | None = None, data: Any = None) -> dict:
    if not session:
        raise HTTPException(status_code=400, detail="session required")

    sess = llm_sessions.get(session)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")

    command = await query_llm(data)
    await send_sse(sess, {"type": "command", "command": command})
    return {"ok": True}


@post("/api/session/close")
async def session_close(session: str | None = None) -> dict:
    if session:
        sess = llm_sessions.get(session)
        if sess:
            sess.closed = True
            llm_sessions.pop(session, None)
            print(f"[llm:{session}] Session closed")
    return {"ok": True}


# ─────────────────────────────────────────────
# Phone mode (Twilio → Deepgram STT bridge)
# ─────────────────────────────────────────────

@dataclass
class PhoneSession:
    id: str
    player: int
    phone_number: str
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    closed: bool = False


phone_sessions: dict[str, PhoneSession] = {}
phone_number_to_session: dict[str, str] = {}


def _cleanup_phone_session(session_id: str) -> None:
    sess = phone_sessions.pop(session_id, None)
    if sess:
        sess.closed = True
        phone_number_to_session.pop(sess.phone_number, None)
        print(f"[phone:{session_id}] Session cleaned up, released {sess.phone_number}")


@post("/api/phone/allocate")
async def phone_allocate(data: dict[str, Any]) -> dict:
    """Allocate a Twilio phone number for a player."""
    player = data.get("player", 1)
    numbers = [n.strip() for n in os.environ.get("TWILIO_PHONE_NUMBERS", "").split(",") if n.strip()]
    for num in numbers:
        if num not in phone_number_to_session:
            session = PhoneSession(
                id=str(uuid.uuid4()),
                player=player,
                phone_number=num,
            )
            phone_sessions[session.id] = session
            phone_number_to_session[num] = session.id
            print(f"[phone:{session.id}] Allocated {num} for player {player}")
            return {"sessionId": session.id, "phoneNumber": num}
    raise HTTPException(status_code=409, detail="No phone numbers available")


@get("/api/phone/connect")
async def phone_connect(session: str) -> ServerSentEvent:
    """SSE stream for phone transcript events."""
    sess = phone_sessions.get(session)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")

    async def event_generator() -> AsyncGenerator[dict[str, Any], None]:
        yield {"data": json.dumps({"type": "connected", "sessionId": sess.id})}
        try:
            while not sess.closed:
                try:
                    data = await asyncio.wait_for(sess.queue.get(), timeout=30)
                    yield {"data": json.dumps(data)}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            sess.closed = True
            _cleanup_phone_session(sess.id)
            print(f"[phone:{sess.id}] SSE disconnected, session cleaned up")

    return ServerSentEvent(event_generator())


@post("/api/twilio/incoming")
async def twilio_incoming(request: Request) -> Response:
    """TwiML webhook — Twilio calls this when someone dials a number."""
    body_bytes = await request.body()
    form = parse_qs(body_bytes.decode())
    called_number = form.get("To", [""])[0]
    session_id = phone_number_to_session.get(called_number)
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    print(f"[twilio] Incoming call to {called_number}, session={session_id}")

    if not session_id or session_id not in phone_sessions:
        twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No game in progress. Goodbye.</Say><Hangup/></Response>'
        return Response(content=twiml, media_type="application/xml")

    ws_url = base_url.replace("https://", "wss://").replace("http://", "ws://")
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connected to Stick Fighter. Shout your commands!</Say>
    <Connect>
        <Stream url="{ws_url}/ws/twilio-stream">
            <Parameter name="sessionId" value="{session_id}" />
        </Stream>
    </Connect>
</Response>"""
    return Response(content=twiml, media_type="application/xml")


@websocket("/ws/twilio-stream")
async def twilio_stream(socket: WebSocket) -> None:
    """Bridge Twilio Media Streams → Deepgram Flux v2 STT."""
    await socket.accept()
    sess = None
    audio_chunks = 0

    try:
        # Wait for Twilio "start" event to get session info
        while True:
            raw = await socket.receive_data(mode="text")
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "connected":
                print("[twilio-stream] Twilio WebSocket connected")
                continue
            elif event == "start":
                params = msg.get("start", {}).get("customParameters", {})
                session_id = params.get("sessionId")
                sess = phone_sessions.get(session_id)
                if not sess:
                    print(f"[twilio-stream] No session for {session_id}")
                    return
                print(f"[twilio-stream] Stream started for session {session_id}")
                await sess.queue.put({"type": "call_connected"})
                break

        # Connect to Deepgram Flux v2 — mulaw/8kHz directly (no conversion needed)
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        client = AsyncDeepgramClient(api_key=api_key)

        async with client.listen.v2.connect(
            model="flux-general-en",
            encoding="mulaw",
            sample_rate="8000",
            keyterm=STT_KEYTERMS,
        ) as dg:
            print("[twilio-stream] Connected to Deepgram Flux v2 (mulaw/8kHz)")

            async def on_message(message) -> None:
                if isinstance(message, ListenV2TurnInfo):
                    transcript = message.transcript or ""
                    if transcript:
                        print(f'[twilio-stream] {message.event}: "{transcript}"')
                    await sess.queue.put({
                        "type": "TurnInfo",
                        "event": message.event,
                        "turn_index": message.turn_index,
                        "transcript": transcript,
                    })
                elif isinstance(message, ListenV2Connected):
                    print(f"[twilio-stream] Deepgram connected: {message}")
                elif isinstance(message, ListenV2FatalError):
                    print(f"[twilio-stream] Deepgram FATAL: {message}")

            def on_error(error) -> None:
                print(f"[twilio-stream] Deepgram error: {type(error).__name__}: {error}")

            dg.on(EventType.MESSAGE, on_message)
            dg.on(EventType.ERROR, on_error)

            # Forward Twilio audio → Deepgram (base64 decode only, mulaw passthrough)
            async def forward_twilio_audio():
                nonlocal audio_chunks
                try:
                    while True:
                        raw = await socket.receive_data(mode="text")
                        msg = json.loads(raw)
                        evt = msg.get("event")
                        if evt == "media":
                            payload = msg["media"]["payload"]
                            audio_bytes = base64.b64decode(payload)
                            audio_chunks += 1
                            if audio_chunks == 1:
                                print(f"[twilio-stream] First audio chunk ({len(audio_bytes)} bytes)")
                            elif audio_chunks % 100 == 0:
                                print(f"[twilio-stream] Audio chunks: {audio_chunks}")
                            await dg.send_media(audio_bytes)
                        elif evt == "stop":
                            print("[twilio-stream] Twilio stream stopped")
                            break
                except Exception as e:
                    print(f"[twilio-stream] Audio forwarding ended: {type(e).__name__}: {e}")
                finally:
                    try:
                        await dg.send_close_stream()
                    except Exception:
                        pass

            audio_task = asyncio.create_task(forward_twilio_audio())
            try:
                await dg.start_listening()
            finally:
                audio_task.cancel()

    except Exception as e:
        print(f"[twilio-stream] Error: {type(e).__name__}: {e}")
    finally:
        if sess:
            await sess.queue.put({"type": "call_disconnected"})
        print(f"[twilio-stream] Disconnected (sent {audio_chunks} audio chunks)")


@post("/api/phone/close")
async def phone_close(data: dict[str, Any]) -> dict:
    """Release a phone session and its number."""
    session_id = data.get("session")
    if session_id:
        _cleanup_phone_session(session_id)
    return {"ok": True}


# ─────────────────────────────────────────────
# Game WebSocket (multiplayer input + state sync)
# ─────────────────────────────────────────────

@websocket("/ws/game/{code:str}")
async def game_ws(socket: WebSocket, code: str) -> None:
    """WebSocket for multiplayer game input and authoritative state broadcast.

    Query params:
        player: 1 or 2

    Client sends: {"actions": ["left","down"], "just_pressed": ["heavyKick"]}
    Server sends: state snapshots at 20Hz + round_over events
    """
    if game_loop_manager is None:
        await socket.close(code=4000, reason="Game loop manager not initialized")
        return

    # Parse player number from query string
    player_str = socket.query_params.get("player", "0")
    try:
        player = int(player_str)
    except (ValueError, TypeError):
        await socket.close(code=4001, reason="Invalid player number")
        return

    if player not in (1, 2):
        await socket.close(code=4001, reason="player must be 1 or 2")
        return

    await socket.accept()
    print(f"[game-ws:{code}] Player {player} connected")

    # Get or create the room loop
    room = game_loop_manager.get_room_loop(code)
    if room is None:
        room = game_loop_manager.create_room_loop(code)

    # Register this player (and cancel any disconnect timer if reconnecting)
    conn = game_loop_manager.add_player(code, player, socket)
    game_loop_manager.cancel_disconnect_timer(code, player)

    # Start the game loop if both players are connected
    if len(room.players) >= 2 and room.task is None:
        game_loop_manager.start_loop(code)
    elif len(room.players) < 2:
        # Notify player they're waiting
        await socket.send_data(json.dumps({"type": "waiting", "player": player}), mode="text")

    try:
        while conn.connected and not room.stopped:
            raw = await socket.receive_data(mode="text")
            msg = json.loads(raw)

            if msg.get("type") == "input":
                await conn.input_queue.put({
                    "actions": msg.get("actions", []),
                    "just_pressed": msg.get("just_pressed", []),
                    "seq": msg.get("seq", 0),
                })

                # Refresh room TTL on input activity
                if room_manager is not None:
                    await room_manager.refresh_ttl(code)

            elif msg.get("type") == "start" and room.task is None:
                # Allow explicit start (e.g., after both players ready)
                if len(room.players) >= 2:
                    game_loop_manager.start_loop(code)

    except Exception as e:
        print(f"[game-ws:{code}] Player {player} disconnected: {type(e).__name__}")
    finally:
        game_loop_manager.remove_player(code, player)
        # Start disconnect grace period instead of immediately stopping
        if room and not room.stopped and room.task is not None:
            game_loop_manager.start_disconnect_timer(code, player)
        elif room and not room.players:
            await game_loop_manager.stop_loop(code)
        print(f"[game-ws:{code}] Player {player} cleaned up")


# ─────────────────────────────────────────────
# Auth (OIDC / OAuth2)
# ─────────────────────────────────────────────


@get("/auth/callback")
async def auth_callback_route(request: Request) -> Response:
    """Server-side OAuth callback — exchange code for tokens, set session cookie, redirect.

    The PKCE code_verifier is retrieved from Redis (stored during /api/auth/login).
    On success, sets a signed session cookie and redirects to /multiplayer.
    """
    if oidc_config is None or not oidc_config.configured:
        return Response(content="OIDC not configured", status_code=503, media_type="text/plain")

    code = request.query_params.get("code", "")
    state = request.query_params.get("state", "")
    error = request.query_params.get("error", "")

    if error:
        desc = request.query_params.get("error_description", "")
        print(f"[auth] OAuth error: {error} — {desc}")
        return _redirect_response("/", clear_cookie=True)

    if not code or not state:
        print("[auth] Missing code or state in callback")
        return _redirect_response("/")

    # Retrieve PKCE verifier + return_path from Redis
    code_verifier = ""
    return_path = "/multiplayer"
    if room_manager is not None:
        pkce_key = f"pkce:{state}"
        pkce_data = await room_manager._redis.hgetall(pkce_key)  # type: ignore[misc]
        if pkce_data:
            code_verifier = pkce_data.get("code_verifier", "")
            return_path = pkce_data.get("return_path", "/multiplayer")
            await room_manager._redis.delete(pkce_key)  # type: ignore[misc]
        else:
            print(f"[auth] No PKCE data for state {state[:8]}...")

    base = os.environ.get("BASE_URL", str(request.base_url).rstrip("/")).rstrip("/")
    redirect_uri = os.environ.get("OIDC_REDIRECT_URI", f"{base}/auth/callback")

    result = await exchange_code(oidc_config, code, redirect_uri, code_verifier=code_verifier)

    if "error" in result:
        print(f"[auth] Token exchange failed: {result}")
        return _redirect_response("/")

    # Extract user info from ID token
    user: dict[str, str] = {}
    id_token = result.get("id_token", "")
    if id_token:
        user = extract_user_from_id_token(id_token)

    # Ensure fighter username on first login
    if user.get("id") and elo_manager is not None:
        fighter_name = await elo_manager.ensure_fighter_username(user["id"])
        user["name"] = fighter_name

    # Build session cookie value (JSON with user info + tokens)
    session_data = json.dumps({
        "user": user,
        "access_token": result.get("access_token", ""),
        "refresh_token": result.get("refresh_token", ""),
    })

    # Base64-encode session for cookie (simple — not signed, but over HTTPS)
    cookie_value = base64.urlsafe_b64encode(session_data.encode()).decode()

    resp = _redirect_response(return_path)
    resp.set_cookie(
        key="sf_session",
        value=cookie_value,
        max_age=86400 * 7,  # 7 days
        path="/",
        httponly=False,  # JS needs to read it for user info
        secure=True,
        samesite="lax",
    )
    return resp


def _redirect_response(path: str, clear_cookie: bool = False) -> Response:
    """Build a 302 redirect response."""
    resp = Response(
        content=None,
        status_code=302,
        headers={"Location": path},
    )
    if clear_cookie:
        resp.delete_cookie(key="sf_session", path="/")
    return resp


@get("/multiplayer")
async def multiplayer_route() -> Response:
    """Serve the game page for the /multiplayer client-side route (post-auth redirect)."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return Response(content=html, media_type="text/html")


@get("/api/auth/login")
async def auth_login(request: Request) -> Response:
    """Initiate the OIDC login flow — generates PKCE pair, stores verifier in Redis, redirects to provider.

    Query params:
        return_path: optional path to redirect to after login (default: /multiplayer)
    """
    if oidc_config is None or not oidc_config.configured:
        raise HTTPException(status_code=503, detail="OIDC not configured")

    return_path = request.query_params.get("return_path", "/multiplayer")

    base = os.environ.get("BASE_URL", str(request.base_url).rstrip("/")).rstrip("/")
    redirect_uri = os.environ.get("OIDC_REDIRECT_URI", f"{base}/auth/callback")

    # Generate PKCE pair server-side
    code_verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    # Generate state for CSRF
    state = str(uuid.uuid4())

    # Store verifier + return_path in Redis (keyed by state, 10 min TTL)
    if room_manager is not None:
        pkce_key = f"pkce:{state}"
        await room_manager._redis.hset(pkce_key, mapping={  # type: ignore[misc]
            "code_verifier": code_verifier,
            "return_path": return_path,
        })
        await room_manager._redis.expire(pkce_key, 600)  # type: ignore[misc]

    params = {
        "response_type": "code",
        "client_id": oidc_config.client_id,
        "redirect_uri": redirect_uri,
        "scope": oidc_config.scopes,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    authorize_url = f"{oidc_config.authorization_endpoint}?{urlencode(params)}"

    return Response(content=None, status_code=302, headers={"Location": authorize_url})


@get("/api/auth/session")
async def auth_session(request: Request) -> dict[str, Any]:
    """Return the current user session from the session cookie.

    Returns { authenticated: true, user: {...} } or { authenticated: false }.
    """
    cookie = request.cookies.get("sf_session")
    if not cookie:
        return {"authenticated": False}

    try:
        session_data = json.loads(base64.urlsafe_b64decode(cookie.encode()))
        user = session_data.get("user", {})
        if not user.get("id"):
            return {"authenticated": False}
        return {"authenticated": True, "user": user}
    except Exception:
        return {"authenticated": False}


@get("/api/auth/logout")
async def auth_logout() -> Response:
    """Clear the session cookie and redirect to home."""
    return _redirect_response("/", clear_cookie=True)


@get("/api/auth/config")
async def auth_config(request: Request) -> dict[str, Any]:
    """Return OIDC configuration for the frontend.

    Returns empty config if OIDC is not configured (login button hidden).
    """
    if oidc_config is None or not oidc_config.configured:
        return {"configured": False}

    base = str(request.base_url).rstrip("/")
    redirect_uri = os.environ.get("OIDC_REDIRECT_URI", f"{base}/auth/callback")

    return {
        "configured": True,
        "clientId": oidc_config.client_id,
        "authorizationEndpoint": oidc_config.authorization_endpoint,
        "tokenEndpoint": oidc_config.token_endpoint,
        "redirectUri": redirect_uri,
        "scopes": oidc_config.scopes,
    }


@post("/api/auth/token")
async def auth_token(request: Request, data: dict[str, str]) -> dict[str, Any]:
    """Exchange an authorization code for tokens.

    Request body:
        code: str — the authorization code from the OIDC provider
        redirect_uri: str — the redirect URI used in the authorization request
    """
    if oidc_config is None or not oidc_config.configured:
        raise HTTPException(status_code=503, detail="OIDC not configured")

    code = data.get("code", "")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is required")

    # Use provided redirect_uri or derive from request
    base = str(request.base_url).rstrip("/")
    redirect_uri = data.get("redirect_uri", os.environ.get("OIDC_REDIRECT_URI", f"{base}/auth/callback"))

    code_verifier = data.get("code_verifier", "")
    result = await exchange_code(oidc_config, code, redirect_uri, code_verifier=code_verifier)

    if "error" in result:
        print(f"[auth] Token exchange failed: {result}")
        raise HTTPException(status_code=502, detail="Token exchange failed")

    # Extract user info from ID token if present
    user = {}
    id_token = result.get("id_token", "")
    if id_token:
        user = extract_user_from_id_token(id_token)

    # On first login, generate a random fighter username
    if user.get("id") and elo_manager is not None:
        fighter_name = await elo_manager.ensure_fighter_username(user["id"])
        user["name"] = fighter_name

    return {
        "access_token": result.get("access_token", ""),
        "id_token": id_token,
        "refresh_token": result.get("refresh_token", ""),
        "expires_in": result.get("expires_in", 0),
        "user": user,
    }


@post("/api/auth/refresh")
async def auth_refresh(data: dict[str, str]) -> dict[str, Any]:
    """Refresh tokens using a refresh_token.

    Request body:
        refresh_token: str — the refresh token
    """
    if oidc_config is None or not oidc_config.configured:
        raise HTTPException(status_code=503, detail="OIDC not configured")

    refresh_token_value = data.get("refresh_token", "")
    if not refresh_token_value:
        raise HTTPException(status_code=400, detail="Refresh token is required")

    result = await refresh_tokens(oidc_config, refresh_token_value)

    if "error" in result:
        print(f"[auth] Token refresh failed: {result}")
        raise HTTPException(status_code=502, detail="Token refresh failed")

    # Extract updated user info from new ID token
    user = {}
    id_token = result.get("id_token", "")
    if id_token:
        user = extract_user_from_id_token(id_token)

    return {
        "access_token": result.get("access_token", ""),
        "id_token": id_token,
        "refresh_token": result.get("refresh_token", refresh_token_value),
        "expires_in": result.get("expires_in", 0),
        "user": user,
    }


@get("/api/auth/me")
async def auth_me(request: Request) -> dict[str, Any]:
    """Get the current user's profile from the OIDC provider.

    Requires Authorization: Bearer <access_token> header.
    """
    if oidc_config is None or not oidc_config.configured:
        raise HTTPException(status_code=503, detail="OIDC not configured")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    access_token = auth_header[7:]
    result = await fetch_userinfo(oidc_config, access_token)

    if "error" in result:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {
        "id": result.get("sub", ""),
        "name": result.get("name", result.get("nickname", result.get("email", ""))),
        "email": result.get("email", ""),
        "avatar": result.get("picture", result.get("avatar", "")),
    }


@post("/api/auth/username")
async def auth_username(request: Request, data: dict[str, str]) -> dict[str, Any]:
    """Update the authenticated user's display name.

    Request body:
        name: str — new username (2-30 chars, alphanumeric + hyphens)

    Requires Authorization: Bearer <access_token> header.
    Returns 409 if the name is already taken by another user.
    """
    if oidc_config is None or not oidc_config.configured:
        raise HTTPException(status_code=503, detail="OIDC not configured")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    if elo_manager is None:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get user ID from access token via userinfo endpoint
    access_token = auth_header[7:]
    userinfo = await fetch_userinfo(oidc_config, access_token)
    if "error" in userinfo:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = userinfo.get("sub", "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not determine user identity")

    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    try:
        result = await elo_manager.update_username(user_id, name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if result is None:
        raise HTTPException(status_code=409, detail="Username is already taken")

    return {"name": result}


# ─────────────────────────────────────────────
# ELO / Leaderboard
# ─────────────────────────────────────────────


# ─────────────────────────────────────────────
# Matchmaking
# ─────────────────────────────────────────────


@post("/api/matchmaking/join")
async def matchmaking_join_endpoint(data: dict[str, Any]) -> dict[str, Any]:
    """Join the ELO matchmaking queue.

    Body: { controller, userId?, name? }
    Returns: { playerId, category, elo, queueSize }
    """
    if room_manager is None or matchmaking_task is None:
        raise HTTPException(status_code=503, detail="Service not available")

    controller = data.get("controller", "").strip() if isinstance(data.get("controller"), str) else ""
    user_id = data.get("userId", "") or ""
    name = data.get("name", "") or ""

    if not controller:
        raise HTTPException(status_code=400, detail="controller is required")
    if controller not in VALID_CONTROLLERS:
        raise HTTPException(status_code=400, detail=f"Invalid controller: {controller}")

    category = controller_to_category(controller)
    if category is None:
        raise HTTPException(status_code=400, detail="Controller not eligible for ranked matchmaking")

    # Get ELO (default 1000 for anonymous / new players)
    elo = 1000.0
    if user_id and elo_manager is not None:
        stats = await elo_manager.get_rating(user_id, category)
        elo = float(stats["rating"])

    player_id = str(uuid.uuid4())
    await matchmaking_task.join(player_id, category, controller, elo, user_id, name)

    queue_size = sum(1 for e in matchmaking_task._entries.values() if e["category"] == category)

    return {
        "playerId": player_id,
        "category": category,
        "elo": elo,
        "queueSize": queue_size,
    }


@get("/api/matchmaking/status")
async def matchmaking_status_endpoint(player_id: str) -> dict[str, Any]:
    """Poll matchmaking status for a player.

    Query: player_id=X
    Returns: { status: "searching"|"matched"|"not_queued", ... }
    """
    if matchmaking_task is None:
        raise HTTPException(status_code=503, detail="Service not available")

    # Refresh player's activity (prevents stale pruning + Redis TTL expiry)
    matchmaking_task.refresh(player_id)
    entry = matchmaking_task._entries.get(player_id)
    if entry and room_manager is not None:
        await room_manager.matchmaking_refresh_ttl(entry["category"], player_id)

    return matchmaking_task.get_status(player_id)


@post("/api/matchmaking/cancel")
async def matchmaking_cancel_endpoint(data: dict[str, str]) -> dict[str, bool]:
    """Cancel matchmaking for a player.

    Body: { playerId }
    """
    if matchmaking_task is None:
        raise HTTPException(status_code=503, detail="Service not available")

    player_id = data.get("playerId", "").strip()
    if not player_id:
        raise HTTPException(status_code=400, detail="playerId is required")

    removed = await matchmaking_task.cancel(player_id)
    return {"ok": removed}


@get("/api/leaderboard")
async def leaderboard(request: Request) -> dict[str, Any]:
    """Get the leaderboard for a specific league.

    Query params:
        category: 'voice' or 'keyboard' (required, no merged 'all' view)
        limit: max entries (default: 50)
        user_id: optional — if provided, include viewer's own entry + rank
    """
    if elo_manager is None:
        raise HTTPException(status_code=503, detail="ELO manager not available")

    category = request.query_params.get("category", "voice")
    if category not in ("voice", "keyboard"):
        raise HTTPException(
            status_code=400,
            detail="category must be 'voice' or 'keyboard'",
        )
    limit_str = request.query_params.get("limit", "50")
    viewer_id = request.query_params.get("user_id", "")
    try:
        limit = min(int(limit_str), 100)
    except ValueError:
        limit = 50

    entries = await elo_manager.get_leaderboard(category, limit=limit)
    # Add input_mode badge
    for entry in entries:
        entry["input_mode"] = category

    result: dict[str, Any] = {"category": category, "entries": entries}

    # If viewer_id provided, include their rank/stats even if not in top entries
    if viewer_id:
        viewer_in_entries = any(str(e["user_id"]) == viewer_id for e in entries)
        stats = await elo_manager.get_rating(viewer_id, category)
        rank = await elo_manager.get_player_rank(viewer_id, category)
        name = await elo_manager.get_player_name(viewer_id)
        if rank is not None:
            result["viewer"] = {**stats, "rank": rank, "input_mode": category, "name": name}
        else:
            result["viewer"] = None
        result["viewer_in_entries"] = viewer_in_entries

    return result


@get("/api/elo/{user_id:str}")
async def get_elo(user_id: str, request: Request) -> dict[str, Any]:
    """Get a player's ELO rating for a specific category or all categories."""
    if elo_manager is None:
        raise HTTPException(status_code=503, detail="ELO manager not available")

    category = request.query_params.get("category", "")

    if category and category in ("voice", "keyboard"):
        stats = await elo_manager.get_rating(user_id, category)
        rank = await elo_manager.get_player_rank(user_id, category)
        return {**stats, "rank": rank}

    # Return both categories
    voice = await elo_manager.get_rating(user_id, "voice")
    keyboard = await elo_manager.get_rating(user_id, "keyboard")
    voice_rank = await elo_manager.get_player_rank(user_id, "voice")
    keyboard_rank = await elo_manager.get_player_rank(user_id, "keyboard")

    return {
        "user_id": user_id,
        "voice": {**voice, "rank": voice_rank},
        "keyboard": {**keyboard, "rank": keyboard_rank},
    }


# ─────────────────────────────────────────────
# App
# ─────────────────────────────────────────────

cors_config = CORSConfig(
    allow_origins=[
        "https://localhost",
        "http://localhost",
        "https://localhost:8080",
        "http://localhost:8080",
        "capacitor://localhost",
        "https://sticklash.fun",
        "https://www.sticklash.fun",
    ],
    allow_origin_regex=r"^https?://localhost(?::\d+)?$|^capacitor://localhost$|^https://([a-z0-9-]+\.)?sticklash\.fun$|^https://smf-lzf3\.onrender\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = Litestar(
    lifespan=[lifespan],
    cors_config=cors_config,
    route_handlers=[
        health,
        favicon,
        android_assetlinks,
        create_share_card,
        get_share_card_image,
        share_card_page,
        index_route,
        room_route,
        leaderboard_page,
        auth_callback_route,
        auth_login,
        auth_session,
        auth_logout,
        multiplayer_route,
        auth_config,
        auth_token,
        auth_refresh,
        auth_me,
        auth_username,
        room_create,
        room_join,
        room_status,
        room_controller,
        room_rematch,
        match_complete,
        rtc_config,
        signal_send,
        signal_listen,
        stt_proxy,
        list_characters,
        llm_command,
        voice_llm,
        voice_tts,
        session_connect,
        session_send,
        session_close,
        phone_allocate,
        phone_connect,
        twilio_incoming,
        twilio_stream,
        phone_close,
        game_ws,
        matchmaking_join_endpoint,
        matchmaking_status_endpoint,
        matchmaking_cancel_endpoint,
        leaderboard,
        get_elo,
        api_smf_config,
        api_wallet_auth_challenge,
        api_wallet_auth_verify,
        api_wallet_auth_verify_siws,
        api_wallet_auth_logout,
        api_boost_packs,
        api_boost_balance,
        api_boost_create_intent,
        api_boost_confirm,
        api_boost_consume,
        api_market_trending,
        api_market_graduates,
        api_market_token_details,
        api_trending,
        api_graduates,
        api_token_details,
        proxy_image,
        create_static_files_router(path="/src", directories=[ROOT / "src"]),
        create_static_files_router(path="/assets", directories=[ROOT / "assets"]),
        create_static_files_router(path="/", directories=[ROOT / ""]),
    ],
)
