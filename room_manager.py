"""Redis-backed room state management for multiplayer rooms.

Room data is stored as a Redis hash at key ``room:{code}``.  In addition to
player/controller state, every room carries an immutable match origin and (for
public ranked rooms) a league, input division, wallet identities, and unique
match ID.

Rooms expire via Redis TTL (5 minutes from last activity).
"""
from __future__ import annotations

import random
import time

import redis.asyncio as aioredis  # type: ignore[import-untyped]
from redis.exceptions import WatchError

from competition import (
    INPUT_CATEGORIES,
    PRIVATE_CASUAL,
    is_ranked_match_type,
    matchmaking_pool,
    policy_for_match_type,
)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

ROOM_TTL = 300  # 5 minutes
MATCHMAKING_ENTRY_TTL = 120  # 2 minutes — queue entries expire if player disconnects
RANKED_WALLET_LOCK_TTL = ROOM_TTL  # one wallet may occupy only one ranked queue/match

ROOM_STATUSES = ("waiting", "selecting", "fighting", "finished")

_VALID_TRANSITIONS: dict[str, list[str]] = {
    "waiting": ["selecting"],
    "selecting": ["fighting", "finished"],
    "fighting": ["finished"],
    "finished": [],
}

# Word list for room codes — common, distinct, inoffensive English words
_ADJECTIVES = [
    "red", "blue", "gold", "dark", "wild", "cool", "bold", "fast",
    "keen", "calm", "warm", "deep", "free", "high", "iron", "jade",
    "pale", "rich", "sage", "true", "vast", "wise", "pure", "dawn",
]

_NOUNS = [
    "tiger", "eagle", "flame", "storm", "blade", "frost", "crown",
    "spark", "shade", "stone", "river", "forge", "lance", "ridge",
    "grove", "raven", "steel", "drift", "thorn", "cedar", "flint",
    "ember", "cliff", "pearl",
]

_VERBS = [
    "paw", "run", "fly", "dash", "leap", "spin", "rush", "soar",
    "roar", "dive", "howl", "snap", "kick", "rise", "glow", "flow",
    "burn", "turn", "call", "roll", "hold", "leap", "cast", "draw",
]


def _room_key(code: str) -> str:
    return f"room:{code}"


def _ranked_wallet_key(wallet: str) -> str:
    return f"ranked_wallet:{wallet}"


def generate_room_code() -> str:
    """Generate a 3-word room code like ``red-tiger-paw``."""
    return f"{random.choice(_ADJECTIVES)}-{random.choice(_NOUNS)}-{random.choice(_VERBS)}"


class RoomManager:
    """Async Redis-backed room state manager."""

    def __init__(self, redis: aioredis.Redis | None) -> None:  # type: ignore[type-arg]
        self._redis: aioredis.Redis | None = redis  # type: ignore[type-arg]

    async def create_room(
        self,
        player_id: str,
        *,
        match_type: str = PRIVATE_CASUAL,
        league: str = "",
        input_category: str = "",
        match_id: str = "",
        p1_wallet: str = "",
        p1_name: str = "",
    ) -> dict[str, str]:
        """Create a new room, assign creator as Player 1, return room data.

        Generates a unique code among active rooms.
        """
        policy = policy_for_match_type(match_type)
        if is_ranked_match_type(match_type):
            if league != policy.league:
                raise ValueError("Ranked room league does not match its match type")
            if input_category not in INPUT_CATEGORIES:
                raise ValueError("Ranked room requires a valid input category")
            if not match_id or not p1_wallet:
                raise ValueError("Ranked room requires a match ID and Player 1 wallet")
        elif league or input_category or match_id or p1_wallet:
            raise ValueError("Casual rooms cannot carry ranked match metadata")

        # Generate a unique code (retry on collision)
        for _ in range(20):
            code = generate_room_code()
            key = _room_key(code)
            if self._redis and not await self._redis.exists(key):
                break
        else:
            # Extremely unlikely — 24*24*24 = 13,824 combinations
            raise RuntimeError("Could not generate unique room code")

        now = str(int(time.time()))
        room_data: dict[str, str] = {
            "code": code,
            "p1_id": player_id,
            "p2_id": "",
            "p1_controller": "",
            "p2_controller": "",
            "status": "waiting",
            "created_at": now,
            "match_type": match_type,
            "league": policy.league,
            "input_category": input_category,
            "match_id": match_id,
            "p1_wallet": p1_wallet,
            "p2_wallet": "",
            "p1_name": p1_name[:30],
            "p2_name": "",
            "reward_candidate": "1" if policy.reward_candidate else "0",
            "max_paid_boost_charges": str(policy.max_paid_boost_charges),
            "settlement_status": "awaiting_result" if policy.reward_candidate else "not_applicable",
        }

        key = _room_key(code)
        if self._redis:
            await self._redis.hset(key, mapping=room_data)  # type: ignore[misc]
            await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]

        return room_data

    async def get_room(self, code: str) -> dict[str, str] | None:
        """Fetch room data by code. Returns None if not found / expired."""
        if not self._redis:
            return None
        data = await self._redis.hgetall(_room_key(code))  # type: ignore[misc]
        if not data:
            return None
        # Redis returns bytes when decode_responses is not set,
        # but our tests/config typically use decode_responses=True.
        # Handle both cases.
        return {
            (k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v)
            for k, v in data.items()
        }

    async def join_room(
        self,
        code: str,
        player_id: str,
        *,
        wallet: str = "",
        name: str = "",
    ) -> dict[str, str]:
        """Join a room as Player 2. Raises ValueError if room is full or not found."""
        room = await self.get_room(code)
        if room is None:
            raise ValueError("Room not found or expired")

        if room["p2_id"]:
            raise ValueError("Room is full")

        if room["status"] != "waiting":
            raise ValueError(f"Room is not accepting players (status: {room['status']})")

        ranked = is_ranked_match_type(room.get("match_type", PRIVATE_CASUAL))
        if ranked and not wallet:
            raise ValueError("Ranked room requires an authenticated Player 2 wallet")
        if not ranked and wallet:
            raise ValueError("Casual rooms cannot carry ranked player identity")
        if ranked and wallet == room.get("p1_wallet"):
            raise ValueError("A wallet cannot play itself in ranked matchmaking")

        key = _room_key(code)
        mapping = {"p2_id": player_id}
        if ranked:
            mapping.update({"p2_wallet": wallet, "p2_name": name[:30]})
        await self._redis.hset(key, mapping=mapping)  # type: ignore[misc]
        await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]

        room["p2_id"] = player_id
        if ranked:
            room["p2_wallet"] = wallet
            room["p2_name"] = name[:30]
        return room

    async def set_controller(self, code: str, player: int, controller: str) -> dict[str, str]:
        """Set a player's controller choice. player is 1 or 2."""
        if player not in (1, 2):
            raise ValueError("player must be 1 or 2")

        room = await self.get_room(code)
        if room is None:
            raise ValueError("Room not found or expired")

        field = f"p{player}_controller"
        key = _room_key(code)
        await self._redis.hset(key, field, controller)  # type: ignore[misc]
        await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]

        room[field] = controller
        return room

    async def transition_status(self, code: str, new_status: str) -> dict[str, str]:
        """Transition room to a new status. Raises ValueError on invalid transition."""
        if new_status not in ROOM_STATUSES:
            raise ValueError(f"Invalid status: {new_status}")

        room = await self.get_room(code)
        if room is None:
            raise ValueError("Room not found or expired")

        current = room["status"]
        allowed = _VALID_TRANSITIONS.get(current, [])
        if new_status not in allowed:
            raise ValueError(f"Cannot transition from '{current}' to '{new_status}'")

        key = _room_key(code)
        await self._redis.hset(key, "status", new_status)  # type: ignore[misc]
        await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]

        room["status"] = new_status
        return room

    async def record_authoritative_outcome(
        self,
        code: str,
        *,
        winner: int | None,
        reason: str,
        p1_health: float,
        p2_health: float,
        server_tick: int,
        p1_boost_charges: int,
        p2_boost_charges: int,
    ) -> dict[str, str]:
        """Persist the immutable server result before ranked settlement.

        A repeated write is accepted only when every result field matches the
        first authoritative outcome. This gives database settlement a durable
        Redis retry source without allowing a later caller to rewrite a match.
        """
        if winner not in (1, 2, None):
            raise ValueError("winner must be 1, 2, or None")
        if min(p1_boost_charges, p2_boost_charges) < 0:
            raise ValueError("Boost charge counts cannot be negative")

        outcome = {
            "authoritative_winner": "" if winner is None else str(winner),
            "authoritative_reason": reason[:32],
            "authoritative_p1_health": str(float(p1_health)),
            "authoritative_p2_health": str(float(p2_health)),
            "authoritative_server_tick": str(int(server_tick)),
            "authoritative_p1_boost_charges": str(int(p1_boost_charges)),
            "authoritative_p2_boost_charges": str(int(p2_boost_charges)),
        }
        key = _room_key(code)
        if not self._redis:
            raise ValueError("Room not found or expired")

        # WATCH makes the check-and-write atomic: under concurrent callbacks,
        # exactly one outcome is accepted and any different loser observes the
        # immutable stored result on retry.
        for _ in range(3):
            async with self._redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(key)
                    raw_room = await pipe.hgetall(key)
                    room = {
                        (k.decode() if isinstance(k, bytes) else k):
                        (v.decode() if isinstance(v, bytes) else v)
                        for k, v in raw_room.items()
                    }
                    if not room:
                        await pipe.unwatch()
                        raise ValueError("Room not found or expired")
                    if not is_ranked_match_type(room.get("match_type", PRIVATE_CASUAL)):
                        await pipe.unwatch()
                        raise ValueError("Only ranked rooms store authoritative outcomes")
                    if room["status"] not in ("fighting", "finished"):
                        await pipe.unwatch()
                        raise ValueError(f"Cannot record an outcome while room is '{room['status']}'")
                    max_paid_charges = int(room.get("max_paid_boost_charges") or 0)
                    if max(p1_boost_charges, p2_boost_charges) > max_paid_charges:
                        await pipe.unwatch()
                        raise ValueError("Authoritative outcome exceeds the room boost-charge policy")
                    if room.get("authoritative_recorded_at"):
                        await pipe.unwatch()
                        if any(room.get(field, "") != value for field, value in outcome.items()):
                            raise ValueError("Authoritative outcome is already recorded with different values")
                        return room

                    mapping = {
                        **outcome,
                        "authoritative_recorded_at": str(int(time.time())),
                        "settlement_status": "recorded",
                    }
                    pipe.multi()
                    pipe.hset(key, mapping=mapping)
                    pipe.expire(key, ROOM_TTL)
                    await pipe.execute()
                    room.update(mapping)
                    return room
                except WatchError:
                    continue
        raise RuntimeError("Could not freeze authoritative outcome after concurrent updates")

    async def set_settlement_status(self, code: str, status: str) -> dict[str, str]:
        """Update ranked settlement bookkeeping without exposing Redis internals."""
        room = await self.get_room(code)
        if room is None:
            raise ValueError("Room not found or expired")
        if not is_ranked_match_type(room.get("match_type", PRIVATE_CASUAL)):
            raise ValueError("Only ranked rooms have settlement status")

        mapping = {"settlement_status": status}
        if status == "settled":
            mapping["settled_at"] = str(int(time.time()))
        key = _room_key(code)
        await self._redis.hset(key, mapping=mapping)  # type: ignore[misc]
        await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]
        room.update(mapping)
        return room

    async def reset_for_rematch(self, code: str) -> dict[str, str]:
        """Reset a room for a rematch — clear controllers, set status to 'selecting'.

        Room must be in 'fighting' or 'finished' status. Players stay assigned.
        Raises ValueError if room not found or invalid status.
        """
        room = await self.get_room(code)
        if room is None:
            raise ValueError("Room not found or expired")

        if is_ranked_match_type(room.get("match_type", PRIVATE_CASUAL)):
            raise ValueError("Ranked matches do not support direct rematches; re-enter matchmaking")

        if room["status"] == "selecting":
            # Rematch already initiated by the other player — return success
            return room

        if room["status"] not in ("fighting", "finished"):
            raise ValueError(f"Cannot rematch from status '{room['status']}'")

        key = _room_key(code)
        await self._redis.hset(key, mapping={  # type: ignore[misc]
            "p1_controller": "",
            "p2_controller": "",
            "status": "selecting",
        })
        await self._redis.expire(key, ROOM_TTL)  # type: ignore[misc]

        room["p1_controller"] = ""
        room["p2_controller"] = ""
        room["status"] = "selecting"
        return room

    async def refresh_ttl(self, code: str) -> bool:
        """Refresh the room's TTL on activity. Returns False if room doesn't exist."""
        return bool(await self._redis.expire(_room_key(code), ROOM_TTL))  # type: ignore[misc]

    async def delete_room(self, code: str) -> bool:
        """Explicitly delete a room. Returns True if it existed."""
        return bool(await self._redis.delete(_room_key(code)))  # type: ignore[misc]

    # ─────────────────────────────────────────────
    # Matchmaking queue with TTL
    # ─────────────────────────────────────────────

    async def claim_ranked_wallet(self, wallet: str, player_id: str) -> bool:
        """Reserve a wallet for exactly one queued or active ranked match.

        Redis ``SET NX`` makes this guard effective across application
        instances. The value is the opaque matchmaking player capability so a
        stale client cannot release a newer reservation for the same wallet.
        """
        if not self._redis or not wallet or not player_id:
            return False
        return bool(
            await self._redis.set(
                _ranked_wallet_key(wallet),
                player_id,
                ex=RANKED_WALLET_LOCK_TTL,
                nx=True,
            )
        )

    async def refresh_ranked_wallet(self, wallet: str, player_id: str) -> bool:
        """Refresh a reservation only when it still belongs to ``player_id``."""
        if not self._redis:
            return False
        key = _ranked_wallet_key(wallet)
        current = await self._redis.get(key)
        if isinstance(current, bytes):
            current = current.decode()
        if current != player_id:
            return False
        return bool(await self._redis.expire(key, RANKED_WALLET_LOCK_TTL))

    async def release_ranked_wallet(self, wallet: str, player_id: str) -> bool:
        """Compare-and-delete a wallet reservation owned by ``player_id``.

        ``WATCH`` prevents a delayed cancel/settlement from deleting a newer
        reservation that was acquired after the old key expired.
        """
        if not self._redis:
            return False
        key = _ranked_wallet_key(wallet)
        for _ in range(3):
            async with self._redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(key)
                    current = await pipe.get(key)
                    if isinstance(current, bytes):
                        current = current.decode()
                    if current != player_id:
                        await pipe.unwatch()
                        return False
                    pipe.multi()
                    pipe.delete(key)
                    result = await pipe.execute()
                    return bool(result and result[0])
                except WatchError:
                    continue
        return False

    async def matchmaking_join(self, league: str, category: str, player_id: str, elo: float) -> bool:
        """Add a player to the matchmaking queue with an auto-expiring TTL key.

        The sorted set ``matchmaking:{league}:{category}`` holds player_id
        scored by ELO. A companion TTL key expires after
        ``MATCHMAKING_ENTRY_TTL``; the cleanup sweep removes orphaned entries.

        Returns True if the player was added (False if already in queue).
        """
        pool = matchmaking_pool(league, category)
        queue_key = f"matchmaking:{pool}"
        ttl_key = f"matchmaking_ttl:{pool}:{player_id}"

        # Check if already queued
        existing = await self._redis.zscore(queue_key, player_id)  # type: ignore[misc]
        if existing is not None:
            # Refresh TTL on re-join
            await self._redis.expire(ttl_key, MATCHMAKING_ENTRY_TTL)  # type: ignore[misc]
            return False

        await self._redis.zadd(queue_key, {player_id: elo})  # type: ignore[misc]
        await self._redis.set(ttl_key, "1", ex=MATCHMAKING_ENTRY_TTL)  # type: ignore[misc]
        return True

    async def matchmaking_leave(self, league: str, category: str, player_id: str) -> bool:
        """Remove a player from the matchmaking queue. Returns True if they were queued."""
        pool = matchmaking_pool(league, category)
        queue_key = f"matchmaking:{pool}"
        ttl_key = f"matchmaking_ttl:{pool}:{player_id}"

        removed = await self._redis.zrem(queue_key, player_id)  # type: ignore[misc]
        await self._redis.delete(ttl_key)  # type: ignore[misc]
        return bool(removed)

    async def matchmaking_refresh_ttl(self, league: str, category: str, player_id: str) -> bool:
        """Refresh the TTL for a matchmaking queue entry. Returns False if key doesn't exist."""
        pool = matchmaking_pool(league, category)
        ttl_key = f"matchmaking_ttl:{pool}:{player_id}"
        return bool(await self._redis.expire(ttl_key, MATCHMAKING_ENTRY_TTL))  # type: ignore[misc]

    async def matchmaking_cleanup_expired(self, league: str, category: str) -> list[str]:
        """Remove queue entries whose TTL key has expired. Returns removed player IDs."""
        pool = matchmaking_pool(league, category)
        queue_key = f"matchmaking:{pool}"
        if not self._redis:
            return []
        members: list[str] = await self._redis.zrange(queue_key, 0, -1)  # type: ignore[misc]
        removed: list[str] = []

        for player_id in members:
            ttl_key = f"matchmaking_ttl:{pool}:{player_id}"
            exists = await self._redis.exists(ttl_key)  # type: ignore[misc]
            if not exists:
                await self._redis.zrem(queue_key, player_id)  # type: ignore[misc]
                removed.append(player_id)

        return removed
