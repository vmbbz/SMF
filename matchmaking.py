"""ELO-based matchmaking queue with periodic matching.

Players join an isolated league/category queue with their ELO rating.
A background task periodically scans for pairs within an ELO threshold.
The threshold widens over time so no player waits indefinitely.

When matched, a room is auto-created with both controllers set and
status transitioned to ``fighting``.  Clients poll for match results.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import TYPE_CHECKING, Any

from competition import RANKED_LEAGUES, match_type_for_league, matchmaking_pool

if TYPE_CHECKING:
    from elo import EloManager
    from room_manager import RoomManager

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

MATCH_INTERVAL = 3.0  # seconds between match attempts
STALE_THRESHOLD = 60.0  # seconds without refresh → prune
MATCH_EXPIRY = 60.0  # seconds before unclaimed match result expires
ACTIVE_MATCH_EXPIRY = 300.0  # abandoned match reservations fail open with room TTL

DEFAULT_ELO_THRESHOLD = 100
THRESHOLD_WIDEN_AMOUNT = 50
THRESHOLD_WIDEN_INTERVAL = 10  # seconds


class MatchmakingTask:
    """Background matchmaking engine — matches players by ELO within a category."""

    def __init__(self, room_manager: RoomManager, elo_manager: EloManager) -> None:
        self._room_manager = room_manager
        self._elo_manager = elo_manager
        self._task: asyncio.Task[None] | None = None
        self._stopped = False
        # In-memory state
        self._entries: dict[str, dict[str, Any]] = {}   # player_id → entry
        self._matches: dict[str, dict[str, Any]] = {}   # player_id → match result
        self._active_matches: dict[str, dict[str, Any]] = {}  # match_id → participants

    # ── Queue operations ──────────────────────────

    async def join(
        self,
        player_id: str,
        league: str,
        category: str,
        controller: str,
        elo: float,
        wallet: str = "",
        name: str = "",
    ) -> None:
        """Add a player to the matchmaking queue."""
        if league not in RANKED_LEAGUES:
            raise ValueError(f"Invalid ranked league: {league}")
        if not wallet:
            raise ValueError("Ranked matchmaking requires an authenticated wallet")
        if player_id in self._entries or player_id in self._matches:
            raise ValueError("Matchmaking player is already in use")
        if any(entry["wallet"] == wallet for entry in self._entries.values()):
            raise ValueError("Wallet is already queued")

        claimed = await self._room_manager.claim_ranked_wallet(wallet, player_id)
        if not claimed:
            raise ValueError("Wallet is already queued or in an active ranked match")

        now = time.monotonic()
        try:
            self._entries[player_id] = {
                "league": league,
                "category": category,
                "controller": controller,
                "elo": elo,
                "wallet": wallet,
                "name": name,
                "joined_at": now,
                "refreshed_at": now,
            }
            added = await self._room_manager.matchmaking_join(league, category, player_id, elo)
            if not added:
                raise ValueError("Matchmaking player is already queued")
        except Exception:
            self._entries.pop(player_id, None)
            await self._room_manager.release_ranked_wallet(wallet, player_id)
            raise

    async def cancel(self, player_id: str) -> bool:
        """Remove a queued player without releasing an already-active match."""
        entry = self._entries.pop(player_id, None)
        if entry:
            try:
                await self._room_manager.matchmaking_leave(entry["league"], entry["category"], player_id)
            finally:
                await self._room_manager.release_ranked_wallet(entry["wallet"], player_id)
            return True
        return False

    def refresh(self, player_id: str) -> None:
        """Mark a player as still active (called on status poll)."""
        entry = self._entries.get(player_id)
        if entry:
            entry["refreshed_at"] = time.monotonic()

    def get_status(self, player_id: str) -> dict[str, Any]:
        """Return the player's current matchmaking status."""
        match = self._matches.get(player_id)
        if match:
            return {
                "status": "matched",
                "roomCode": match["roomCode"],
                "playerNum": match["playerNum"],
                "playerId": match["playerId"],
                "opponentName": match["opponentName"],
                "league": match["league"],
                "category": match["category"],
                "matchType": match["matchType"],
                "matchId": match["matchId"],
            }

        entry = self._entries.get(player_id)
        if not entry:
            return {"status": "not_queued"}

        now = time.monotonic()
        wait_time = now - entry["joined_at"]
        queue_count = sum(
            1 for e in self._entries.values()
            if e["category"] == entry["category"] and e["league"] == entry["league"]
        )
        threshold = self._threshold(wait_time)

        return {
            "status": "searching",
            "waitTime": round(wait_time),
            "queueSize": queue_count,
            "threshold": threshold,
            "category": entry["category"],
            "league": entry["league"],
        }

    # ── Matching algorithm ────────────────────────

    def _threshold(self, wait_time: float) -> int:
        """ELO threshold: starts at 100, widens by 50 every 10 seconds."""
        return DEFAULT_ELO_THRESHOLD + int(wait_time / THRESHOLD_WIDEN_INTERVAL) * THRESHOLD_WIDEN_AMOUNT

    async def try_match(self) -> list[tuple[str, str]]:
        """Scan the queue and match closest-ELO pairs. Returns matched (pid1, pid2) pairs."""
        matched_pairs: list[tuple[str, str]] = []

        # Never match a client that stopped polling. Cleanup also releases its
        # cross-instance wallet reservation and Redis queue entry.
        await self._prune_stale()
        await self._prune_expired_active_matches()
        self._prune_expired_matches()

        # Skill and Boosted ratings/results must never cross matchmaking pools.
        by_pool: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for pid, entry in list(self._entries.items()):
            pool = matchmaking_pool(entry["league"], entry["category"])
            by_pool.setdefault(pool, []).append((pid, entry))

        for _pool, players in by_pool.items():
            if len(players) < 2:
                continue

            # Sort by ELO for efficient closest-pair matching
            players.sort(key=lambda x: x[1]["elo"])
            matched_pids: set[str] = set()

            for i in range(len(players)):
                pid1, entry1 = players[i]
                if pid1 in matched_pids:
                    continue

                now = time.monotonic()
                wait1 = now - entry1["joined_at"]
                thresh1 = self._threshold(wait1)

                best: tuple[str, dict[str, Any]] | None = None
                best_diff = float("inf")

                for j in range(i + 1, len(players)):
                    pid2, entry2 = players[j]
                    if pid2 in matched_pids:
                        continue
                    if entry1["wallet"] == entry2["wallet"]:
                        continue

                    diff = abs(entry1["elo"] - entry2["elo"])
                    wait2 = now - entry2["joined_at"]
                    thresh2 = self._threshold(wait2)
                    # Use the wider threshold (more generous for longer-waiting player)
                    threshold = max(thresh1, thresh2)

                    if diff <= threshold and diff < best_diff:
                        best = (pid2, entry2)
                        best_diff = diff

                if best is not None:
                    pid2, entry2 = best
                    matched_pids.add(pid1)
                    matched_pids.add(pid2)
                    await self._create_match(pid1, entry1, pid2, entry2)
                    matched_pairs.append((pid1, pid2))

        return matched_pairs

    async def _create_match(
        self,
        pid1: str,
        entry1: dict[str, Any],
        pid2: str,
        entry2: dict[str, Any],
    ) -> str:
        """Create a room for a matched pair. Returns the room code."""
        if (entry1["league"], entry1["category"]) != (entry2["league"], entry2["category"]):
            raise RuntimeError("Cannot create a match across league or input pools")
        if entry1["wallet"] == entry2["wallet"]:
            raise RuntimeError("Cannot create a ranked self-match")

        league = entry1["league"]
        match_type = match_type_for_league(league)
        match_id = str(uuid.uuid4())
        locks_valid = await asyncio.gather(
            self._room_manager.refresh_ranked_wallet(entry1["wallet"], pid1),
            self._room_manager.refresh_ranked_wallet(entry2["wallet"], pid2),
        )
        if not all(locks_valid):
            raise RuntimeError("Ranked wallet reservation expired before match creation")

        room = await self._room_manager.create_room(
            pid1,
            match_type=match_type,
            league=league,
            input_category=entry1["category"],
            match_id=match_id,
            p1_wallet=entry1["wallet"],
            p1_name=entry1.get("name") or "",
        )
        code = room["code"]
        await self._room_manager.join_room(
            code,
            pid2,
            wallet=entry2["wallet"],
            name=entry2.get("name") or "",
        )
        await self._room_manager.transition_status(code, "selecting")
        await self._room_manager.set_controller(code, 1, entry1["controller"])
        await self._room_manager.set_controller(code, 2, entry2["controller"])
        await self._room_manager.transition_status(code, "fighting")

        now = time.monotonic()
        self._matches[pid1] = {
            "roomCode": code,
            "playerNum": 1,
            "playerId": pid1,
            "opponentName": entry2.get("name") or "Opponent",
            "wallet": entry1["wallet"],
            "league": league,
            "category": entry1["category"],
            "matchType": match_type,
            "matchId": match_id,
            "matched_at": now,
        }
        self._matches[pid2] = {
            "roomCode": code,
            "playerNum": 2,
            "playerId": pid2,
            "opponentName": entry1.get("name") or "Opponent",
            "wallet": entry2["wallet"],
            "league": league,
            "category": entry2["category"],
            "matchType": match_type,
            "matchId": match_id,
            "matched_at": now,
        }
        self._active_matches[match_id] = {
            "participants": (
                (entry1["wallet"], pid1),
                (entry2["wallet"], pid2),
            ),
            "created_at": now,
        }

        # Remove from queue
        self._entries.pop(pid1, None)
        self._entries.pop(pid2, None)
        await self._room_manager.matchmaking_leave(league, entry1["category"], pid1)
        await self._room_manager.matchmaking_leave(league, entry2["category"], pid2)

        print(f"[matchmaking] Matched {pid1} vs {pid2} → room {code}")
        return code

    async def release_match(
        self,
        match_id: str,
        participants: tuple[tuple[str, str], ...] = (),
    ) -> bool:
        """Release wallet reservations after a server-recorded final result.

        ``participants`` lets a retry after process restart release Redis locks
        from durable room metadata even when the in-memory active map is gone.
        """
        active = self._active_matches.pop(match_id, None)
        known = tuple(active.get("participants", ())) if active else ()
        owners = tuple(dict.fromkeys((*known, *participants)))
        released = active is not None
        for wallet, player_id in owners:
            match = self._matches.get(player_id)
            if match and match.get("matchId") == match_id:
                self._matches.pop(player_id, None)
            released = await self._room_manager.release_ranked_wallet(wallet, player_id) or released
        return released

    # ── Housekeeping ──────────────────────────────

    async def _prune_stale(self) -> list[str]:
        """Remove stale queue entries and their wallet reservations."""
        now = time.monotonic()
        stale: list[str] = []
        for pid in list(self._entries.keys()):
            if now - self._entries[pid]["refreshed_at"] > STALE_THRESHOLD:
                stale.append(pid)
                entry = self._entries.pop(pid)
                try:
                    await self._room_manager.matchmaking_leave(entry["league"], entry["category"], pid)
                finally:
                    await self._room_manager.release_ranked_wallet(entry["wallet"], pid)
        return stale

    async def _prune_expired_active_matches(self) -> list[str]:
        """Fail open abandoned reservations after the room lifetime."""
        now = time.monotonic()
        expired = [
            match_id
            for match_id, active in self._active_matches.items()
            if now - active["created_at"] > ACTIVE_MATCH_EXPIRY
        ]
        for match_id in expired:
            await self.release_match(match_id)
        return expired

    def _prune_expired_matches(self) -> list[str]:
        """Remove match results that weren't picked up within MATCH_EXPIRY."""
        now = time.monotonic()
        expired: list[str] = []
        for pid in list(self._matches.keys()):
            if now - self._matches[pid]["matched_at"] > MATCH_EXPIRY:
                expired.append(pid)
                self._matches.pop(pid)
        return expired

    # ── Lifecycle ─────────────────────────────────

    def start(self) -> None:
        """Start the periodic matching task."""
        if self._task is not None:
            return
        self._stopped = False
        self._task = asyncio.create_task(self._run())
        print(f"[matchmaking] Started (interval={MATCH_INTERVAL}s)")

    async def stop(self) -> None:
        """Stop the matching task."""
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        print("[matchmaking] Stopped")

    async def _run(self) -> None:
        """Background loop — tries to match players at regular intervals."""
        try:
            while not self._stopped:
                await asyncio.sleep(MATCH_INTERVAL)
                if self._stopped:
                    break
                try:
                    pairs = await self.try_match()
                    if pairs:
                        print(f"[matchmaking] Matched {len(pairs)} pair(s)")
                except Exception as e:
                    print(f"[matchmaking] Error: {type(e).__name__}: {e}")
        except asyncio.CancelledError:
            pass
