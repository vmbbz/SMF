"""Tests for room_manager.py — Redis-backed room state management."""
from __future__ import annotations

import asyncio

import fakeredis.aioredis
import pytest
import pytest_asyncio

from competition import PRIVATE_CASUAL, RANKED_SKILL
from room_manager import (
    MATCHMAKING_ENTRY_TTL,
    RANKED_WALLET_LOCK_TTL,
    ROOM_TTL,
    RoomManager,
    generate_room_code,
)


@pytest_asyncio.fixture
async def redis():
    """Create a fresh fakeredis instance per test."""
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


@pytest_asyncio.fixture
async def manager(redis):
    return RoomManager(redis)


async def create_ranked_fighting_room(
    manager: RoomManager,
    *,
    match_type: str = RANKED_SKILL,
    league: str = "skill",
) -> dict[str, str]:
    room = await manager.create_room(
        "p1",
        match_type=match_type,
        league=league,
        input_category="keyboard",
        match_id="match-1",
        p1_wallet="wallet-1",
    )
    await manager.join_room(room["code"], "p2", wallet="wallet-2")
    await manager.transition_status(room["code"], "selecting")
    return await manager.transition_status(room["code"], "fighting")


# ─── Code generation ────────────────────────────


class TestGenerateRoomCode:
    def test_format(self) -> None:
        code = generate_room_code()
        parts = code.split("-")
        assert len(parts) == 3, f"Expected 3-word code, got: {code}"

    def test_uniqueness_across_samples(self) -> None:
        codes = {generate_room_code() for _ in range(50)}
        # With 13k+ combos, 50 samples should have very few collisions
        assert len(codes) >= 40


# ─── Room creation ──────────────────────────────


class TestCreateRoom:
    @pytest.mark.asyncio
    async def test_create_returns_room_data(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        assert room["p1_id"] == "player-1"
        assert room["p2_id"] == ""
        assert room["status"] == "waiting"
        assert room["code"]
        assert room["created_at"]
        assert room["match_type"] == PRIVATE_CASUAL
        assert room["reward_candidate"] == "0"

    @pytest.mark.asyncio
    async def test_ranked_room_requires_complete_immutable_metadata(self, manager: RoomManager) -> None:
        with pytest.raises(ValueError, match="match ID"):
            await manager.create_room(
                "player-1",
                match_type=RANKED_SKILL,
                league="skill",
                input_category="keyboard",
                p1_wallet="wallet-1",
            )

        room = await manager.create_room(
            "player-1",
            match_type=RANKED_SKILL,
            league="skill",
            input_category="keyboard",
            match_id="match-1",
            p1_wallet="wallet-1",
            p1_name="Alice",
        )
        assert room["match_type"] == RANKED_SKILL
        assert room["league"] == "skill"
        assert room["reward_candidate"] == "1"
        assert room["settlement_status"] == "awaiting_result"

    @pytest.mark.asyncio
    async def test_create_sets_ttl(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        ttl = await redis.ttl(f"room:{room['code']}")
        assert 0 < ttl <= ROOM_TTL

    @pytest.mark.asyncio
    async def test_create_stores_in_redis(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        fetched = await manager.get_room(room["code"])
        assert fetched is not None
        assert fetched["p1_id"] == "player-1"
        assert fetched["status"] == "waiting"


# ─── Room fetching ──────────────────────────────


class TestGetRoom:
    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_none(self, manager: RoomManager) -> None:
        result = await manager.get_room("no-such-room")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_existing_room(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        fetched = await manager.get_room(room["code"])
        assert fetched is not None
        assert fetched["code"] == room["code"]


# ─── Room joining ───────────────────────────────


class TestJoinRoom:
    @pytest.mark.asyncio
    async def test_join_assigns_player2(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        updated = await manager.join_room(room["code"], "player-2")
        assert updated["p2_id"] == "player-2"
        assert updated["p1_id"] == "player-1"

    @pytest.mark.asyncio
    async def test_join_refreshes_ttl(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        # Simulate time passing by manually reducing TTL
        await redis.expire(f"room:{room['code']}", 60)
        await manager.join_room(room["code"], "player-2")
        ttl = await redis.ttl(f"room:{room['code']}")
        assert ttl > 60  # TTL was refreshed

    @pytest.mark.asyncio
    async def test_join_full_room_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        await manager.join_room(room["code"], "player-2")
        with pytest.raises(ValueError, match="full"):
            await manager.join_room(room["code"], "player-3")

    @pytest.mark.asyncio
    async def test_join_nonexistent_room_raises(self, manager: RoomManager) -> None:
        with pytest.raises(ValueError, match="not found"):
            await manager.join_room("no-such-room", "player-2")

    @pytest.mark.asyncio
    async def test_join_non_waiting_room_raises(self, manager: RoomManager) -> None:
        """Transition without a p2 to test the status check specifically."""
        room = await manager.create_room("player-1")
        # Force to selecting without joining (tests the status guard)
        await manager.transition_status(room["code"], "selecting")
        with pytest.raises(ValueError, match="not accepting"):
            await manager.join_room(room["code"], "player-2")

    @pytest.mark.asyncio
    async def test_ranked_join_binds_distinct_wallet(self, manager: RoomManager) -> None:
        room = await manager.create_room(
            "player-1",
            match_type=RANKED_SKILL,
            league="skill",
            input_category="keyboard",
            match_id="match-1",
            p1_wallet="wallet-1",
        )
        with pytest.raises(ValueError, match="authenticated"):
            await manager.join_room(room["code"], "player-2")
        with pytest.raises(ValueError, match="cannot play itself"):
            await manager.join_room(room["code"], "player-2", wallet="wallet-1")

        joined = await manager.join_room(room["code"], "player-2", wallet="wallet-2", name="Bob")
        assert joined["p2_wallet"] == "wallet-2"
        assert joined["p2_name"] == "Bob"


# ─── Controller selection ───────────────────────


class TestSetController:
    @pytest.mark.asyncio
    async def test_set_p1_controller(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        updated = await manager.set_controller(room["code"], 1, "keyboard")
        assert updated["p1_controller"] == "keyboard"

    @pytest.mark.asyncio
    async def test_set_p2_controller(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        await manager.join_room(room["code"], "player-2")
        updated = await manager.set_controller(room["code"], 2, "voice")
        assert updated["p2_controller"] == "voice"

    @pytest.mark.asyncio
    async def test_invalid_player_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        with pytest.raises(ValueError, match="must be 1 or 2"):
            await manager.set_controller(room["code"], 3, "keyboard")

    @pytest.mark.asyncio
    async def test_nonexistent_room_raises(self, manager: RoomManager) -> None:
        with pytest.raises(ValueError, match="not found"):
            await manager.set_controller("no-such-room", 1, "keyboard")

    @pytest.mark.asyncio
    async def test_set_controller_refreshes_ttl(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        await redis.expire(f"room:{room['code']}", 60)
        await manager.set_controller(room["code"], 1, "keyboard")
        ttl = await redis.ttl(f"room:{room['code']}")
        assert ttl > 60


# ─── Status transitions ────────────────────────


class TestTransitionStatus:
    @pytest.mark.asyncio
    async def test_waiting_to_selecting(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        updated = await manager.transition_status(room["code"], "selecting")
        assert updated["status"] == "selecting"

    @pytest.mark.asyncio
    async def test_selecting_to_fighting(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        await manager.transition_status(room["code"], "selecting")
        updated = await manager.transition_status(room["code"], "fighting")
        assert updated["status"] == "fighting"

    @pytest.mark.asyncio
    async def test_fighting_to_finished(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        await manager.transition_status(room["code"], "selecting")
        await manager.transition_status(room["code"], "fighting")
        updated = await manager.transition_status(room["code"], "finished")
        assert updated["status"] == "finished"

    @pytest.mark.asyncio
    async def test_full_lifecycle(self, manager: RoomManager) -> None:
        """Walk through the entire room lifecycle."""
        room = await manager.create_room("player-1")
        assert room["status"] == "waiting"

        await manager.join_room(room["code"], "player-2")
        room = await manager.transition_status(room["code"], "selecting")
        assert room["status"] == "selecting"

        await manager.set_controller(room["code"], 1, "keyboard")
        await manager.set_controller(room["code"], 2, "voice")

        room = await manager.transition_status(room["code"], "fighting")
        assert room["status"] == "fighting"

        room = await manager.transition_status(room["code"], "finished")
        assert room["status"] == "finished"

    @pytest.mark.asyncio
    async def test_selecting_to_finished_forfeit(self, manager: RoomManager) -> None:
        """selecting → finished is allowed (forfeit when opponent doesn't pick controller)."""
        room = await manager.create_room("player-1")
        await manager.transition_status(room["code"], "selecting")
        updated = await manager.transition_status(room["code"], "finished")
        assert updated["status"] == "finished"

    @pytest.mark.asyncio
    async def test_invalid_transition_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        # Can't skip from waiting to fighting
        with pytest.raises(ValueError, match="Cannot transition"):
            await manager.transition_status(room["code"], "fighting")

    @pytest.mark.asyncio
    async def test_backward_transition_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        await manager.transition_status(room["code"], "selecting")
        with pytest.raises(ValueError, match="Cannot transition"):
            await manager.transition_status(room["code"], "waiting")

    @pytest.mark.asyncio
    async def test_invalid_status_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        with pytest.raises(ValueError, match="Invalid status"):
            await manager.transition_status(room["code"], "exploding")

    @pytest.mark.asyncio
    async def test_nonexistent_room_raises(self, manager: RoomManager) -> None:
        with pytest.raises(ValueError, match="not found"):
            await manager.transition_status("no-such-room", "selecting")

    @pytest.mark.asyncio
    async def test_transition_refreshes_ttl(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        await redis.expire(f"room:{room['code']}", 60)
        await manager.transition_status(room["code"], "selecting")
        ttl = await redis.ttl(f"room:{room['code']}")
        assert ttl > 60


# ─── TTL refresh ────────────────────────────────


class TestRefreshTTL:
    @pytest.mark.asyncio
    async def test_refresh_existing_room(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        await redis.expire(f"room:{room['code']}", 30)
        result = await manager.refresh_ttl(room["code"])
        assert result is True
        ttl = await redis.ttl(f"room:{room['code']}")
        assert ttl > 30

    @pytest.mark.asyncio
    async def test_refresh_nonexistent_room(self, manager: RoomManager) -> None:
        result = await manager.refresh_ttl("no-such-room")
        assert result is False


# ─── Room deletion ──────────────────────────────


class TestDeleteRoom:
    @pytest.mark.asyncio
    async def test_delete_existing_room(self, manager: RoomManager) -> None:
        room = await manager.create_room("player-1")
        result = await manager.delete_room(room["code"])
        assert result is True
        assert await manager.get_room(room["code"]) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_room(self, manager: RoomManager) -> None:
        result = await manager.delete_room("no-such-room")
        assert result is False


# ─── Redis hash structure ───────────────────────


class TestRedisStructure:
    @pytest.mark.asyncio
    async def test_room_stored_as_hash(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        key = f"room:{room['code']}"
        key_type = await redis.type(key)
        assert key_type == "hash"

    @pytest.mark.asyncio
    async def test_hash_has_expected_fields(self, manager: RoomManager, redis) -> None:
        room = await manager.create_room("player-1")
        key = f"room:{room['code']}"
        fields = await redis.hkeys(key)
        expected = {
            "code", "p1_id", "p2_id", "p1_controller", "p2_controller", "status", "created_at",
            "match_type", "league", "input_category", "match_id", "p1_wallet", "p2_wallet",
            "p1_name", "p2_name", "reward_candidate", "max_paid_boost_charges", "settlement_status",
        }
        assert set(fields) == expected


# ─── Authoritative ranked outcome ─────────────────


class TestAuthoritativeRankedOutcome:
    @pytest.mark.asyncio
    async def test_first_result_is_persisted_and_identical_retry_is_safe(
        self,
        manager: RoomManager,
    ) -> None:
        room = await create_ranked_fighting_room(manager)
        kwargs = {
            "winner": 1,
            "reason": "ko",
            "p1_health": 31.5,
            "p2_health": 0,
            "server_tick": 700,
            "p1_boost_charges": 0,
            "p2_boost_charges": 0,
        }

        first = await manager.record_authoritative_outcome(room["code"], **kwargs)
        replay = await manager.record_authoritative_outcome(room["code"], **kwargs)

        assert first["authoritative_winner"] == "1"
        assert first["settlement_status"] == "recorded"
        assert replay["authoritative_recorded_at"] == first["authoritative_recorded_at"]

    @pytest.mark.asyncio
    async def test_different_retry_cannot_rewrite_result(self, manager: RoomManager) -> None:
        room = await create_ranked_fighting_room(manager)
        common = {
            "reason": "ko",
            "p1_health": 31.5,
            "p2_health": 0,
            "server_tick": 700,
            "p1_boost_charges": 0,
            "p2_boost_charges": 0,
        }
        await manager.record_authoritative_outcome(room["code"], winner=1, **common)

        with pytest.raises(ValueError, match="already recorded"):
            await manager.record_authoritative_outcome(room["code"], winner=2, **common)

        stored = await manager.get_room(room["code"])
        assert stored is not None
        assert stored["authoritative_winner"] == "1"

    @pytest.mark.asyncio
    async def test_concurrent_different_results_accept_exactly_one(self, manager: RoomManager) -> None:
        room = await create_ranked_fighting_room(manager)

        async def record(winner: int):
            return await manager.record_authoritative_outcome(
                room["code"],
                winner=winner,
                reason="ko",
                p1_health=20 if winner == 1 else 0,
                p2_health=0 if winner == 1 else 20,
                server_tick=800,
                p1_boost_charges=0,
                p2_boost_charges=0,
            )

        results = await asyncio.gather(record(1), record(2), return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, ValueError) for result in results) == 1
        stored = await manager.get_room(room["code"])
        assert stored is not None
        assert stored["authoritative_winner"] in {"1", "2"}

    @pytest.mark.asyncio
    async def test_skill_result_rejects_paid_boost_charges(self, manager: RoomManager) -> None:
        room = await create_ranked_fighting_room(manager)
        with pytest.raises(ValueError, match="boost-charge policy"):
            await manager.record_authoritative_outcome(
                room["code"],
                winner=1,
                reason="ko",
                p1_health=20,
                p2_health=0,
                server_tick=800,
                p1_boost_charges=1,
                p2_boost_charges=0,
            )


# ─── Reset for rematch ────────────────────────────


class TestResetForRematch:
    @pytest.mark.asyncio
    async def test_rematch_resets_controllers_and_status(self, manager: RoomManager) -> None:
        room = await manager.create_room("p1")
        code = room["code"]
        await manager.join_room(code, "p2")
        await manager.transition_status(code, "selecting")
        await manager.set_controller(code, 1, "controller")
        await manager.set_controller(code, 2, "voice")
        await manager.transition_status(code, "fighting")

        result = await manager.reset_for_rematch(code)
        assert result["status"] == "selecting"
        assert result["p1_controller"] == ""
        assert result["p2_controller"] == ""
        # Players should still be assigned
        assert result["p1_id"] == "p1"
        assert result["p2_id"] == "p2"

    @pytest.mark.asyncio
    async def test_rematch_from_finished(self, manager: RoomManager) -> None:
        room = await manager.create_room("p1")
        code = room["code"]
        await manager.join_room(code, "p2")
        await manager.transition_status(code, "selecting")
        await manager.set_controller(code, 1, "controller")
        await manager.set_controller(code, 2, "controller")
        await manager.transition_status(code, "fighting")
        await manager.transition_status(code, "finished")

        result = await manager.reset_for_rematch(code)
        assert result["status"] == "selecting"

    @pytest.mark.asyncio
    async def test_rematch_from_waiting_raises(self, manager: RoomManager) -> None:
        room = await manager.create_room("p1")
        with pytest.raises(ValueError, match="Cannot rematch"):
            await manager.reset_for_rematch(room["code"])

    @pytest.mark.asyncio
    async def test_duplicate_rematch_from_selecting_is_idempotent(self, manager: RoomManager) -> None:
        room = await manager.create_room("p1")
        await manager.join_room(room["code"], "p2")
        await manager.transition_status(room["code"], "selecting")
        result = await manager.reset_for_rematch(room["code"])
        assert result["status"] == "selecting"

    @pytest.mark.asyncio
    async def test_rematch_nonexistent_room_raises(self, manager: RoomManager) -> None:
        with pytest.raises(ValueError, match="Room not found"):
            await manager.reset_for_rematch("nonexistent-room-code")


# ─── Matchmaking queue with TTL ──────────────────


class TestRankedWalletReservation:
    @pytest.mark.asyncio
    async def test_claim_is_cross_player_exclusive(self, manager: RoomManager) -> None:
        assert await manager.claim_ranked_wallet("wallet-1", "player-1") is True
        assert await manager.claim_ranked_wallet("wallet-1", "player-2") is False

    @pytest.mark.asyncio
    async def test_claim_has_room_lifetime_ttl(self, manager: RoomManager, redis) -> None:
        await manager.claim_ranked_wallet("wallet-1", "player-1")
        ttl = await redis.ttl("ranked_wallet:wallet-1")
        assert 0 < ttl <= RANKED_WALLET_LOCK_TTL

    @pytest.mark.asyncio
    async def test_refresh_requires_owner(self, manager: RoomManager, redis) -> None:
        await manager.claim_ranked_wallet("wallet-1", "player-1")
        await redis.expire("ranked_wallet:wallet-1", 30)
        assert await manager.refresh_ranked_wallet("wallet-1", "player-2") is False
        assert await manager.refresh_ranked_wallet("wallet-1", "player-1") is True
        assert await redis.ttl("ranked_wallet:wallet-1") > 30

    @pytest.mark.asyncio
    async def test_release_cannot_delete_newer_owner(self, manager: RoomManager, redis) -> None:
        await redis.set("ranked_wallet:wallet-1", "player-2", ex=RANKED_WALLET_LOCK_TTL)
        assert await manager.release_ranked_wallet("wallet-1", "player-1") is False
        assert await redis.get("ranked_wallet:wallet-1") == "player-2"
        assert await manager.release_ranked_wallet("wallet-1", "player-2") is True
        assert await redis.get("ranked_wallet:wallet-1") is None


class TestMatchmakingQueue:
    @pytest.mark.asyncio
    async def test_join_adds_to_queue(self, manager: RoomManager, redis) -> None:
        result = await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        assert result is True
        score = await redis.zscore("matchmaking:skill:keyboard", "player-1")
        assert score == 1000.0

    @pytest.mark.asyncio
    async def test_join_sets_ttl_key(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        ttl = await redis.ttl("matchmaking_ttl:skill:keyboard:player-1")
        assert 0 < ttl <= MATCHMAKING_ENTRY_TTL

    @pytest.mark.asyncio
    async def test_join_duplicate_returns_false(self, manager: RoomManager) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        result = await manager.matchmaking_join("skill", "keyboard", "player-1", 1050.0)
        assert result is False

    @pytest.mark.asyncio
    async def test_join_duplicate_refreshes_ttl(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        # Reduce TTL artificially
        await redis.expire("matchmaking_ttl:skill:keyboard:player-1", 30)
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        ttl = await redis.ttl("matchmaking_ttl:skill:keyboard:player-1")
        assert ttl > 30

    @pytest.mark.asyncio
    async def test_leave_removes_from_queue(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        result = await manager.matchmaking_leave("skill", "keyboard", "player-1")
        assert result is True
        score = await redis.zscore("matchmaking:skill:keyboard", "player-1")
        assert score is None

    @pytest.mark.asyncio
    async def test_leave_removes_ttl_key(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        await manager.matchmaking_leave("skill", "keyboard", "player-1")
        exists = await redis.exists("matchmaking_ttl:skill:keyboard:player-1")
        assert not exists

    @pytest.mark.asyncio
    async def test_leave_nonexistent_returns_false(self, manager: RoomManager) -> None:
        result = await manager.matchmaking_leave("skill", "keyboard", "nobody")
        assert result is False

    @pytest.mark.asyncio
    async def test_cleanup_removes_expired_entries(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "voice", "player-1", 1000.0)
        await manager.matchmaking_join("skill", "voice", "player-2", 1100.0)

        # Simulate TTL expiry for player-1
        await redis.delete("matchmaking_ttl:skill:voice:player-1")

        removed = await manager.matchmaking_cleanup_expired("skill", "voice")
        assert "player-1" in removed
        assert "player-2" not in removed

        # player-1 gone from sorted set, player-2 still there
        assert await redis.zscore("matchmaking:skill:voice", "player-1") is None
        assert await redis.zscore("matchmaking:skill:voice", "player-2") is not None

    @pytest.mark.asyncio
    async def test_cleanup_empty_queue(self, manager: RoomManager) -> None:
        removed = await manager.matchmaking_cleanup_expired("skill", "keyboard")
        assert removed == []

    @pytest.mark.asyncio
    async def test_separate_categories(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "player-1", 1000.0)
        await manager.matchmaking_join("skill", "voice", "player-1", 900.0)

        # Leave keyboard queue only
        await manager.matchmaking_leave("skill", "keyboard", "player-1")

        assert await redis.zscore("matchmaking:skill:keyboard", "player-1") is None
        assert await redis.zscore("matchmaking:skill:voice", "player-1") == 900.0

    @pytest.mark.asyncio
    async def test_separate_leagues(self, manager: RoomManager, redis) -> None:
        await manager.matchmaking_join("skill", "keyboard", "skill-player", 1000.0)
        await manager.matchmaking_join("boosted", "keyboard", "boosted-player", 1000.0)

        assert await redis.zscore("matchmaking:skill:keyboard", "skill-player") == 1000.0
        assert await redis.zscore("matchmaking:boosted:keyboard", "boosted-player") == 1000.0
