"""Tests for matchmaking.py — ELO-based matchmaking queue."""
from __future__ import annotations

import time

import fakeredis.aioredis
import pytest
import pytest_asyncio

from elo import EloManager
from matchmaking import (
    ACTIVE_MATCH_EXPIRY,
    DEFAULT_ELO_THRESHOLD,
    MATCH_EXPIRY,
    STALE_THRESHOLD,
    THRESHOLD_WIDEN_AMOUNT,
    MatchmakingTask,
)
from room_manager import RoomManager


@pytest_asyncio.fixture
async def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


@pytest_asyncio.fixture
async def task(redis):
    rm = RoomManager(redis)
    em = EloManager(redis)
    return MatchmakingTask(rm, em)


async def queue_player(
    task: MatchmakingTask,
    player_id: str,
    category: str,
    controller: str,
    elo: float,
    *,
    league: str = "skill",
    wallet: str | None = None,
    name: str = "",
) -> None:
    await task.join(
        player_id,
        league,
        category,
        controller,
        elo,
        wallet=wallet or f"wallet-{player_id}",
        name=name,
    )


# ─── Join ──────────────────────────────────────


class TestJoin:
    @pytest.mark.asyncio
    async def test_join_adds_to_entries(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        assert "p1" in task._entries
        assert task._entries["p1"]["category"] == "keyboard"
        assert task._entries["p1"]["elo"] == 1000.0

    @pytest.mark.asyncio
    async def test_join_adds_to_redis(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        score = await task._room_manager._redis.zscore("matchmaking:skill:keyboard", "p1")  # type: ignore[misc]
        assert score == 1000.0

    @pytest.mark.asyncio
    async def test_join_multiple_players(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1100.0)
        assert len(task._entries) == 2

    @pytest.mark.asyncio
    async def test_join_with_user_info(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, wallet="wallet-1", name="Alice")
        assert task._entries["p1"]["wallet"] == "wallet-1"
        assert task._entries["p1"]["name"] == "Alice"

    @pytest.mark.asyncio
    async def test_join_requires_wallet_and_rejects_duplicate_wallet(self, task: MatchmakingTask) -> None:
        with pytest.raises(ValueError, match="authenticated wallet"):
            await task.join("p1", "skill", "keyboard", "controller", 1000.0)
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, wallet="wallet-1")
        with pytest.raises(ValueError, match="already queued"):
            await queue_player(task, "p2", "keyboard", "controller", 1000.0, wallet="wallet-1")


# ─── Cancel ────────────────────────────────────


class TestCancel:
    @pytest.mark.asyncio
    async def test_cancel_removes_entry(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        result = await task.cancel("p1")
        assert result is True
        assert "p1" not in task._entries

    @pytest.mark.asyncio
    async def test_cancel_removes_from_redis(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await task.cancel("p1")
        score = await task._room_manager._redis.zscore("matchmaking:skill:keyboard", "p1")  # type: ignore[misc]
        assert score is None

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_returns_false(self, task: MatchmakingTask) -> None:
        result = await task.cancel("nobody")
        assert result is False

    @pytest.mark.asyncio
    async def test_cancel_does_not_release_active_match(self, task: MatchmakingTask) -> None:
        task._matches["p1"] = {"matched_at": time.monotonic()}
        assert await task.cancel("p1") is False
        assert "p1" in task._matches

    @pytest.mark.asyncio
    async def test_cancel_releases_wallet_reservation(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, wallet="wallet-1")
        assert await task.cancel("p1") is True
        assert await task._room_manager.claim_ranked_wallet("wallet-1", "p2") is True


# ─── Status ────────────────────────────────────


class TestGetStatus:
    @pytest.mark.asyncio
    async def test_status_not_queued(self, task: MatchmakingTask) -> None:
        status = task.get_status("nobody")
        assert status["status"] == "not_queued"

    @pytest.mark.asyncio
    async def test_status_searching(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        status = task.get_status("p1")
        assert status["status"] == "searching"
        assert "waitTime" in status
        assert status["queueSize"] == 1
        assert status["threshold"] == DEFAULT_ELO_THRESHOLD

    @pytest.mark.asyncio
    async def test_status_matched(self, task: MatchmakingTask) -> None:
        task._matches["p1"] = {
            "roomCode": "test-room",
            "playerNum": 1,
            "playerId": "p1",
            "opponentName": "Bob",
            "league": "skill",
            "category": "keyboard",
            "matchType": "ranked_skill",
            "matchId": "match-1",
            "matched_at": time.monotonic(),
        }
        status = task.get_status("p1")
        assert status["status"] == "matched"
        assert status["roomCode"] == "test-room"
        assert status["playerNum"] == 1

    @pytest.mark.asyncio
    async def test_status_queue_count_per_category(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1100.0)
        await queue_player(task, "p3", "voice", "voice", 1000.0)
        status = task.get_status("p1")
        assert status["queueSize"] == 2  # Only keyboard queue


# ─── Threshold ─────────────────────────────────


class TestThreshold:
    def test_initial_threshold(self, task: MatchmakingTask) -> None:
        assert task._threshold(0) == DEFAULT_ELO_THRESHOLD

    def test_threshold_widens_at_10s(self, task: MatchmakingTask) -> None:
        assert task._threshold(10) == DEFAULT_ELO_THRESHOLD + THRESHOLD_WIDEN_AMOUNT

    def test_threshold_widens_at_20s(self, task: MatchmakingTask) -> None:
        assert task._threshold(20) == DEFAULT_ELO_THRESHOLD + 2 * THRESHOLD_WIDEN_AMOUNT

    def test_threshold_widens_at_30s(self, task: MatchmakingTask) -> None:
        assert task._threshold(30) == DEFAULT_ELO_THRESHOLD + 3 * THRESHOLD_WIDEN_AMOUNT

    def test_threshold_between_intervals(self, task: MatchmakingTask) -> None:
        # At 5 seconds: still within first interval
        assert task._threshold(5) == DEFAULT_ELO_THRESHOLD


# ─── Match finding ──────────────────────────────


class TestMatchFinding:
    @pytest.mark.asyncio
    async def test_match_two_same_category(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        pairs = await task.try_match()
        assert len(pairs) == 1
        assert set(pairs[0]) == {"p1", "p2"}

    @pytest.mark.asyncio
    async def test_no_match_different_categories(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "voice", "voice", 1000.0)
        pairs = await task.try_match()
        assert len(pairs) == 0

    @pytest.mark.asyncio
    async def test_no_match_outside_threshold(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1200.0)
        pairs = await task.try_match()
        assert len(pairs) == 0

    @pytest.mark.asyncio
    async def test_threshold_widening_enables_match(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1200.0)
        # Simulate 20 seconds of waiting → threshold = 100 + 2*50 = 200
        task._entries["p1"]["joined_at"] = time.monotonic() - 20
        task._entries["p2"]["joined_at"] = time.monotonic() - 20
        pairs = await task.try_match()
        assert len(pairs) == 1

    @pytest.mark.asyncio
    async def test_match_closest_elo(self, task: MatchmakingTask) -> None:
        """With 3 players, closest ELO pair should match."""
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1090.0)
        await queue_player(task, "p3", "keyboard", "controller", 1020.0)
        pairs = await task.try_match()
        assert len(pairs) == 1
        # p1 (1000) should match p3 (1020) — 20 diff vs 90 diff with p2
        matched = set(pairs[0])
        assert matched == {"p1", "p3"}

    @pytest.mark.asyncio
    async def test_single_player_no_match(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        pairs = await task.try_match()
        assert len(pairs) == 0

    @pytest.mark.asyncio
    async def test_match_removes_from_entries(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        await task.try_match()
        assert "p1" not in task._entries
        assert "p2" not in task._entries

    @pytest.mark.asyncio
    async def test_four_players_two_pairs(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1010.0)
        await queue_player(task, "p3", "keyboard", "controller", 1060.0)
        await queue_player(task, "p4", "keyboard", "controller", 1070.0)
        pairs = await task.try_match()
        assert len(pairs) == 2


# ─── Room creation ──────────────────────────────


class TestRoomCreation:
    @pytest.mark.asyncio
    async def test_room_in_fighting_status(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        await task.try_match()
        code = task._matches["p1"]["roomCode"]
        room = await task._room_manager.get_room(code)
        assert room is not None
        assert room["status"] == "fighting"
        assert room["match_type"] == "ranked_skill"
        assert room["league"] == "skill"
        assert room["match_id"]
        assert room["p1_wallet"] == "wallet-p1"
        assert room["p2_wallet"] == "wallet-p2"

    @pytest.mark.asyncio
    async def test_room_has_controllers(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "voice", 1050.0)
        await task.try_match()
        code = task._matches["p1"]["roomCode"]
        room = await task._room_manager.get_room(code)
        assert room is not None
        assert room["p1_controller"] == "controller"
        assert room["p2_controller"] == "voice"

    @pytest.mark.asyncio
    async def test_room_has_player_ids(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        await task.try_match()
        code = task._matches["p1"]["roomCode"]
        room = await task._room_manager.get_room(code)
        assert room is not None
        assert room["p1_id"] == "p1"
        assert room["p2_id"] == "p2"

    @pytest.mark.asyncio
    async def test_match_sets_player_nums(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        await task.try_match()
        assert task._matches["p1"]["playerNum"] == 1
        assert task._matches["p2"]["playerNum"] == 2

    @pytest.mark.asyncio
    async def test_match_records_opponent_name(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, name="Alice")
        await queue_player(task, "p2", "keyboard", "controller", 1050.0, name="Bob")
        await task.try_match()
        assert task._matches["p1"]["opponentName"] == "Bob"
        assert task._matches["p2"]["opponentName"] == "Alice"

    @pytest.mark.asyncio
    async def test_same_room_code_for_both(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        await queue_player(task, "p2", "keyboard", "controller", 1050.0)
        await task.try_match()
        assert task._matches["p1"]["roomCode"] == task._matches["p2"]["roomCode"]

    @pytest.mark.asyncio
    async def test_skill_and_boosted_never_match(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, league="skill")
        await queue_player(task, "p2", "keyboard", "controller", 1000.0, league="boosted")
        assert await task.try_match() == []

    @pytest.mark.asyncio
    async def test_active_wallet_cannot_requeue_until_server_release(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, wallet="wallet-1")
        await queue_player(task, "p2", "keyboard", "controller", 1000.0, wallet="wallet-2")
        await task.try_match()
        match_id = task._matches["p1"]["matchId"]

        with pytest.raises(ValueError, match="active ranked match"):
            await queue_player(task, "p3", "keyboard", "controller", 1000.0, wallet="wallet-1")

        released = await task.release_match(
            match_id,
            (("wallet-1", "p1"), ("wallet-2", "p2")),
        )
        assert released is True
        await queue_player(task, "p3", "keyboard", "controller", 1000.0, wallet="wallet-1")
        assert task._entries["p3"]["wallet"] == "wallet-1"


# ─── Pruning ────────────────────────────────────


class TestPruning:
    @pytest.mark.asyncio
    async def test_prune_stale_entries(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        task._entries["p1"]["refreshed_at"] = time.monotonic() - STALE_THRESHOLD - 1
        stale = await task._prune_stale()
        assert "p1" in stale
        assert "p1" not in task._entries
        assert await task._room_manager.claim_ranked_wallet("wallet-p1", "p2") is True

    @pytest.mark.asyncio
    async def test_refresh_prevents_pruning(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        task.refresh("p1")
        stale = await task._prune_stale()
        assert len(stale) == 0

    def test_prune_expired_matches(self, task: MatchmakingTask) -> None:
        task._matches["p1"] = {
            "roomCode": "x",
            "playerNum": 1,
            "playerId": "p1",
            "opponentName": "Bob",
            "league": "skill",
            "category": "keyboard",
            "matchType": "ranked_skill",
            "matched_at": time.monotonic() - MATCH_EXPIRY - 1,
        }
        expired = task._prune_expired_matches()
        assert "p1" in expired
        assert "p1" not in task._matches

    def test_fresh_match_not_pruned(self, task: MatchmakingTask) -> None:
        task._matches["p1"] = {
            "roomCode": "x",
            "playerNum": 1,
            "playerId": "p1",
            "opponentName": "Bob",
            "league": "skill",
            "category": "keyboard",
            "matchType": "ranked_skill",
            "matched_at": time.monotonic(),
        }
        expired = task._prune_expired_matches()
        assert len(expired) == 0

    @pytest.mark.asyncio
    async def test_try_match_prunes_stale(self, task: MatchmakingTask) -> None:
        """Stale entries are pruned during match cycle."""
        await queue_player(task, "p1", "keyboard", "controller", 1000.0)
        task._entries["p1"]["refreshed_at"] = time.monotonic() - STALE_THRESHOLD - 1
        await task.try_match()
        assert "p1" not in task._entries

    @pytest.mark.asyncio
    async def test_prune_expired_active_match_releases_wallets(self, task: MatchmakingTask) -> None:
        await queue_player(task, "p1", "keyboard", "controller", 1000.0, wallet="wallet-1")
        await queue_player(task, "p2", "keyboard", "controller", 1000.0, wallet="wallet-2")
        await task.try_match()
        match_id = task._matches["p1"]["matchId"]
        task._active_matches[match_id]["created_at"] = time.monotonic() - ACTIVE_MATCH_EXPIRY - 1

        assert await task._prune_expired_active_matches() == [match_id]
        assert match_id not in task._active_matches
        assert await task._room_manager.claim_ranked_wallet("wallet-1", "p3") is True


# ─── Lifecycle ──────────────────────────────────


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_task(self, task: MatchmakingTask) -> None:
        task.start()
        assert task._task is not None
        await task.stop()

    @pytest.mark.asyncio
    async def test_stop_clears_task(self, task: MatchmakingTask) -> None:
        task.start()
        await task.stop()
        assert task._task is None

    @pytest.mark.asyncio
    async def test_double_start_noop(self, task: MatchmakingTask) -> None:
        task.start()
        first_task = task._task
        task.start()  # Should be a no-op
        assert task._task is first_task
        await task.stop()
