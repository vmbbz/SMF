"""ELO rating system with PostgreSQL persistence.

Legacy ratings are stored per-user per-category (voice / keyboard):
  - Table ``players`` → user_id, name
  - Table ``elo_ratings`` → user_id, category, rating, wins, losses, draws, matches
  - Table ``match_history`` → per-match audit trail

Reward-candidate competitive ratings use separate Skill/Boosted tables keyed
by authenticated wallet, league, and input division.  A unique authoritative
match settlement is committed in the same transaction as both rating updates.
"""
from __future__ import annotations

import math
import random
import re
from typing import Any

import asyncpg  # type: ignore[import-untyped]

from competition import (
    BOOSTED_LEAGUE,
    BOOSTED_MAX_PAID_CHARGES,
    INPUT_CATEGORIES,
    RANKED_LEAGUES,
    SKILL_LEAGUE,
)


# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

DEFAULT_RATING = 1000
K_FACTOR_NEW = 32       # <30 matches
K_FACTOR_ESTABLISHED = 16  # ≥30 matches
K_FACTOR_THRESHOLD = 30

# Input category mapping
VOICE_CONTROLLERS = {"voice", "phone"}
KEYBOARD_CONTROLLERS = {"keyboard", "controller"}


def controller_to_category(controller: str) -> str | None:
    """Map a controller name to an ELO category.

    Returns 'voice', 'keyboard', or None for non-ranked controllers.
    """
    if controller in VOICE_CONTROLLERS:
        return "voice"
    if controller in KEYBOARD_CONTROLLERS:
        return "keyboard"
    return None


# ─────────────────────────────────────────────
# Random fighter username generation
# ─────────────────────────────────────────────

FIGHTER_NOUNS = [
    "ninja", "tank", "knight", "samurai", "boxer", "brawler", "warrior",
    "striker", "guardian", "champion", "berserker", "duelist", "monk",
    "ronin", "gladiator", "paladin",
]

STICK_NOUNS = [
    "stick", "branch", "broom", "mop", "pole", "stretch", "twig",
    "rod", "staff", "cane", "reed", "wand", "beam", "shaft", "spar",
]

ADJECTIVES = [
    "swift", "shadow", "iron", "dark", "wild", "bold", "keen",
    "fierce", "calm", "stone", "frost", "flame",
]

MAX_USERNAME_RETRIES = 10
USERNAME_PATTERN = r"^[a-zA-Z0-9-]{2,30}$"


def generate_fighter_username() -> str:
    """Generate a random fighter-themed username.

    Format: {adjective}-{fighter}-{stick} or {fighter}-{stick}.
    Roughly 50/50 chance of including the adjective prefix.
    """
    fighter = random.choice(FIGHTER_NOUNS)
    stick = random.choice(STICK_NOUNS)
    if random.random() < 0.5:
        return f"{random.choice(ADJECTIVES)}-{fighter}-{stick}"
    return f"{fighter}-{stick}"


# ─────────────────────────────────────────────
# ELO calculation
# ─────────────────────────────────────────────

def _expected_score(rating_a: float, rating_b: float) -> float:
    """Calculate expected score for player A against player B."""
    return 1.0 / (1.0 + math.pow(10.0, (rating_b - rating_a) / 400.0))


def _k_factor(matches: int) -> int:
    """Return K-factor based on number of matches played."""
    return K_FACTOR_NEW if matches < K_FACTOR_THRESHOLD else K_FACTOR_ESTABLISHED


def calculate_elo_change(
    rating_a: float,
    rating_b: float,
    matches_a: int,
    matches_b: int,
    result: float,
) -> tuple[float, float]:
    """Calculate new ratings for both players.

    Args:
        rating_a: Player A's current rating
        rating_b: Player B's current rating
        matches_a: Player A's total matches played
        matches_b: Player B's total matches played
        result: 1.0 = A wins, 0.0 = B wins, 0.5 = draw

    Returns:
        Tuple of (new_rating_a, new_rating_b)
    """
    expected_a = _expected_score(rating_a, rating_b)
    expected_b = 1.0 - expected_a

    k_a = _k_factor(matches_a)
    k_b = _k_factor(matches_b)

    new_a = rating_a + k_a * (result - expected_a)
    new_b = rating_b + k_b * ((1.0 - result) - expected_b)

    return round(new_a, 1), round(new_b, 1)


# ─────────────────────────────────────────────
# Schema bootstrap
# ─────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS players (
    user_id   TEXT PRIMARY KEY,
    name      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS elo_ratings (
    user_id   TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
    category  TEXT NOT NULL CHECK (category IN ('voice', 'keyboard')),
    rating    REAL NOT NULL DEFAULT 1000,
    wins      INTEGER NOT NULL DEFAULT 0,
    losses    INTEGER NOT NULL DEFAULT 0,
    draws     INTEGER NOT NULL DEFAULT 0,
    matches   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_elo_category_rating
    ON elo_ratings (category, rating DESC);

CREATE TABLE IF NOT EXISTS match_history (
    id                    SERIAL PRIMARY KEY,
    winner_id             TEXT REFERENCES players(user_id),
    loser_id              TEXT REFERENCES players(user_id),
    category              TEXT NOT NULL CHECK (category IN ('voice', 'keyboard')),
    winner_rating_before  REAL NOT NULL,
    loser_rating_before   REAL NOT NULL,
    winner_rating_after   REAL NOT NULL,
    loser_rating_after    REAL NOT NULL,
    draw                  BOOLEAN NOT NULL DEFAULT FALSE,
    played_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_history_played_at
    ON match_history (played_at DESC);

CREATE TABLE IF NOT EXISTS competitive_ratings (
    wallet_address  TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
    league          TEXT NOT NULL CHECK (league IN ('skill', 'boosted')),
    input_category  TEXT NOT NULL CHECK (input_category IN ('voice', 'keyboard')),
    rating          REAL NOT NULL DEFAULT 1000,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    draws           INTEGER NOT NULL DEFAULT 0,
    matches         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (wallet_address, league, input_category)
);

CREATE INDEX IF NOT EXISTS idx_competitive_leaderboard
    ON competitive_ratings (league, input_category, rating DESC);

CREATE TABLE IF NOT EXISTS ranked_match_settlements (
    match_id          TEXT PRIMARY KEY,
    room_code         TEXT NOT NULL UNIQUE,
    league            TEXT NOT NULL CHECK (league IN ('skill', 'boosted')),
    input_category    TEXT NOT NULL CHECK (input_category IN ('voice', 'keyboard')),
    p1_wallet         TEXT NOT NULL REFERENCES players(user_id),
    p2_wallet         TEXT NOT NULL REFERENCES players(user_id),
    winner_player     SMALLINT CHECK (winner_player IN (1, 2)),
    result            TEXT NOT NULL CHECK (result IN ('p1_win', 'p2_win', 'draw')),
    reason            TEXT NOT NULL,
    p1_health         REAL NOT NULL,
    p2_health         REAL NOT NULL,
    server_tick       BIGINT NOT NULL,
    p1_boost_charges  INTEGER NOT NULL DEFAULT 0 CHECK (p1_boost_charges >= 0),
    p2_boost_charges  INTEGER NOT NULL DEFAULT 0 CHECK (p2_boost_charges >= 0),
    p1_rating_before  REAL NOT NULL,
    p2_rating_before  REAL NOT NULL,
    p1_rating_after   REAL NOT NULL,
    p2_rating_after   REAL NOT NULL,
    played_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (p1_wallet <> p2_wallet),
    CONSTRAINT ranked_match_settlements_boost_policy CHECK (
        (league = 'skill' AND p1_boost_charges = 0 AND p2_boost_charges = 0)
        OR
        (league = 'boosted' AND p1_boost_charges <= 3 AND p2_boost_charges <= 3)
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ranked_match_settlements_boost_policy'
    ) THEN
        ALTER TABLE ranked_match_settlements
            ADD CONSTRAINT ranked_match_settlements_boost_policy CHECK (
                (league = 'skill' AND p1_boost_charges = 0 AND p2_boost_charges = 0)
                OR
                (league = 'boosted' AND p1_boost_charges <= 3 AND p2_boost_charges <= 3)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_epoch
    ON ranked_match_settlements (league, input_category, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_p1
    ON ranked_match_settlements (p1_wallet, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_p2
    ON ranked_match_settlements (p2_wallet, played_at DESC);
"""


async def ensure_schema(pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
    """Create tables if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute(_SCHEMA_SQL)


# ─────────────────────────────────────────────
# ELO Manager
# ─────────────────────────────────────────────

class EloManager:
    """Async PostgreSQL-backed ELO rating manager."""

    def __init__(self, pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
        self._pool: asyncpg.Pool = pool  # type: ignore[type-arg]

    @staticmethod
    def _validate_competitive_dimensions(league: str, input_category: str) -> None:
        if league not in RANKED_LEAGUES:
            raise ValueError(f"Invalid ranked league: {league}")
        if input_category not in INPUT_CATEGORIES:
            raise ValueError(f"Invalid input category: {input_category}")

    @staticmethod
    def _competitive_stats(row: Any, *, wallet: str, league: str, input_category: str) -> dict[str, Any]:
        return {
            "wallet": wallet,
            "user_id": wallet,
            "league": league,
            "category": input_category,
            "rating": float(row["rating"]),
            "wins": int(row["wins"]),
            "losses": int(row["losses"]),
            "draws": int(row["draws"]),
            "matches": int(row["matches"]),
        }

    async def get_competitive_rating(
        self,
        wallet: str,
        league: str,
        input_category: str,
    ) -> dict[str, Any]:
        """Return wallet rating in one league/input division."""
        self._validate_competitive_dimensions(league, input_category)
        row = await self._pool.fetchrow(
            "SELECT rating, wins, losses, draws, matches FROM competitive_ratings "
            "WHERE wallet_address = $1 AND league = $2 AND input_category = $3",
            wallet,
            league,
            input_category,
        )
        if row is None:
            return {
                "wallet": wallet,
                "user_id": wallet,
                "league": league,
                "category": input_category,
                "rating": DEFAULT_RATING,
                "wins": 0,
                "losses": 0,
                "draws": 0,
                "matches": 0,
            }
        return self._competitive_stats(
            row,
            wallet=wallet,
            league=league,
            input_category=input_category,
        )

    async def settle_competitive_match(
        self,
        *,
        match_id: str,
        room_code: str,
        league: str,
        input_category: str,
        p1_wallet: str,
        p2_wallet: str,
        winner: int | None,
        reason: str,
        p1_health: float,
        p2_health: float,
        server_tick: int,
        p1_boost_charges: int = 0,
        p2_boost_charges: int = 0,
        p1_name: str = "",
        p2_name: str = "",
    ) -> dict[str, Any]:
        """Atomically persist one authoritative result and both rating updates.

        The transaction takes a match-scoped advisory lock before checking the
        unique settlement row. Replays therefore return the original outcome
        without applying rating changes twice, even under concurrent delivery.
        """
        self._validate_competitive_dimensions(league, input_category)
        if not match_id or not room_code:
            raise ValueError("Competitive settlement requires match_id and room_code")
        if not p1_wallet or not p2_wallet or p1_wallet == p2_wallet:
            raise ValueError("Competitive settlement requires two distinct wallets")
        if winner not in (1, 2, None):
            raise ValueError("winner must be 1, 2, or None")
        if p1_boost_charges < 0 or p2_boost_charges < 0:
            raise ValueError("Boost charge counts cannot be negative")
        if league == SKILL_LEAGUE and (p1_boost_charges or p2_boost_charges):
            raise ValueError("Skill Championship settlements cannot contain paid boost charges")
        if league == BOOSTED_LEAGUE and max(p1_boost_charges, p2_boost_charges) > BOOSTED_MAX_PAID_CHARGES:
            raise ValueError("Boosted League settlement exceeds the paid charge cap")

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", match_id)
                existing = await conn.fetchrow(
                    "SELECT match_id, room_code, league, input_category, p1_wallet, p2_wallet, "
                    "result, winner_player, reason, server_tick, p1_boost_charges, p2_boost_charges, "
                    "p1_rating_before, p2_rating_before, p1_rating_after, p2_rating_after "
                    "FROM ranked_match_settlements WHERE match_id = $1",
                    match_id,
                )
                if existing is not None:
                    expected_result = "draw" if winner is None else ("p1_win" if winner == 1 else "p2_win")
                    replay_identity = (
                        str(existing["room_code"]),
                        str(existing["league"]),
                        str(existing["input_category"]),
                        str(existing["p1_wallet"]),
                        str(existing["p2_wallet"]),
                        existing["winner_player"],
                        str(existing["result"]),
                        str(existing["reason"]),
                        int(existing["server_tick"]),
                        int(existing["p1_boost_charges"]),
                        int(existing["p2_boost_charges"]),
                    )
                    incoming_identity = (
                        room_code,
                        league,
                        input_category,
                        p1_wallet,
                        p2_wallet,
                        winner,
                        expected_result,
                        reason[:32],
                        int(server_tick),
                        int(p1_boost_charges),
                        int(p2_boost_charges),
                    )
                    if replay_identity != incoming_identity:
                        raise ValueError("Competitive settlement idempotency conflict")
                    return {
                        "settled": True,
                        "idempotent": True,
                        "matchId": str(existing["match_id"]),
                        "league": str(existing["league"]),
                        "category": str(existing["input_category"]),
                        "result": str(existing["result"]),
                        "winner": existing["winner_player"],
                        "p1": {
                            "old_rating": float(existing["p1_rating_before"]),
                            "rating": float(existing["p1_rating_after"]),
                        },
                        "p2": {
                            "old_rating": float(existing["p2_rating_before"]),
                            "rating": float(existing["p2_rating_after"]),
                        },
                    }

                await conn.execute(
                    "INSERT INTO players (user_id, name) VALUES ($1, $2) "
                    "ON CONFLICT (user_id) DO UPDATE SET name = "
                    "CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE players.name END",
                    p1_wallet,
                    p1_name[:30],
                )
                await conn.execute(
                    "INSERT INTO players (user_id, name) VALUES ($1, $2) "
                    "ON CONFLICT (user_id) DO UPDATE SET name = "
                    "CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE players.name END",
                    p2_wallet,
                    p2_name[:30],
                )
                for wallet in (p1_wallet, p2_wallet):
                    await conn.execute(
                        "INSERT INTO competitive_ratings (wallet_address, league, input_category) "
                        "VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                        wallet,
                        league,
                        input_category,
                    )

                rows = await conn.fetch(
                    "SELECT wallet_address, rating, wins, losses, draws, matches "
                    "FROM competitive_ratings "
                    "WHERE wallet_address = ANY($1::text[]) AND league = $2 AND input_category = $3 "
                    "ORDER BY wallet_address FOR UPDATE",
                    [p1_wallet, p2_wallet],
                    league,
                    input_category,
                )
                by_wallet = {str(row["wallet_address"]): row for row in rows}
                if set(by_wallet) != {p1_wallet, p2_wallet}:
                    raise RuntimeError("Failed to lock both competitive rating rows")

                p1_before = self._competitive_stats(
                    by_wallet[p1_wallet],
                    wallet=p1_wallet,
                    league=league,
                    input_category=input_category,
                )
                p2_before = self._competitive_stats(
                    by_wallet[p2_wallet],
                    wallet=p2_wallet,
                    league=league,
                    input_category=input_category,
                )
                result_value = 0.5 if winner is None else (1.0 if winner == 1 else 0.0)
                p1_after_rating, p2_after_rating = calculate_elo_change(
                    float(p1_before["rating"]),
                    float(p2_before["rating"]),
                    int(p1_before["matches"]),
                    int(p2_before["matches"]),
                    result_value,
                )

                p1_win = 1 if winner == 1 else 0
                p2_win = 1 if winner == 2 else 0
                p1_loss = 1 if winner == 2 else 0
                p2_loss = 1 if winner == 1 else 0
                draw_inc = 1 if winner is None else 0

                await conn.execute(
                    "UPDATE competitive_ratings SET rating = $4, wins = wins + $5, "
                    "losses = losses + $6, draws = draws + $7, matches = matches + 1 "
                    "WHERE wallet_address = $1 AND league = $2 AND input_category = $3",
                    p1_wallet,
                    league,
                    input_category,
                    p1_after_rating,
                    p1_win,
                    p1_loss,
                    draw_inc,
                )
                await conn.execute(
                    "UPDATE competitive_ratings SET rating = $4, wins = wins + $5, "
                    "losses = losses + $6, draws = draws + $7, matches = matches + 1 "
                    "WHERE wallet_address = $1 AND league = $2 AND input_category = $3",
                    p2_wallet,
                    league,
                    input_category,
                    p2_after_rating,
                    p2_win,
                    p2_loss,
                    draw_inc,
                )

                result_label = "draw" if winner is None else ("p1_win" if winner == 1 else "p2_win")
                await conn.execute(
                    "INSERT INTO ranked_match_settlements ("
                    "match_id, room_code, league, input_category, p1_wallet, p2_wallet, "
                    "winner_player, result, reason, p1_health, p2_health, server_tick, "
                    "p1_boost_charges, p2_boost_charges, p1_rating_before, p2_rating_before, "
                    "p1_rating_after, p2_rating_after) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
                    match_id,
                    room_code,
                    league,
                    input_category,
                    p1_wallet,
                    p2_wallet,
                    winner,
                    result_label,
                    reason[:32],
                    float(p1_health),
                    float(p2_health),
                    int(server_tick),
                    int(p1_boost_charges),
                    int(p2_boost_charges),
                    float(p1_before["rating"]),
                    float(p2_before["rating"]),
                    p1_after_rating,
                    p2_after_rating,
                )

        p1_after = {
            **p1_before,
            "old_rating": float(p1_before["rating"]),
            "rating": p1_after_rating,
            "wins": int(p1_before["wins"]) + p1_win,
            "losses": int(p1_before["losses"]) + p1_loss,
            "draws": int(p1_before["draws"]) + draw_inc,
            "matches": int(p1_before["matches"]) + 1,
        }
        p2_after = {
            **p2_before,
            "old_rating": float(p2_before["rating"]),
            "rating": p2_after_rating,
            "wins": int(p2_before["wins"]) + p2_win,
            "losses": int(p2_before["losses"]) + p2_loss,
            "draws": int(p2_before["draws"]) + draw_inc,
            "matches": int(p2_before["matches"]) + 1,
        }
        return {
            "settled": True,
            "idempotent": False,
            "matchId": match_id,
            "league": league,
            "category": input_category,
            "result": result_label,
            "winner": winner,
            "p1": p1_after,
            "p2": p2_after,
        }

    async def get_competitive_leaderboard(
        self,
        league: str,
        input_category: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Return one isolated league/input leaderboard."""
        self._validate_competitive_dimensions(league, input_category)
        rows = await self._pool.fetch(
            "SELECT e.wallet_address, COALESCE(p.name, '') AS name, e.rating, "
            "e.wins, e.losses, e.draws, e.matches FROM competitive_ratings e "
            "LEFT JOIN players p ON p.user_id = e.wallet_address "
            "WHERE e.league = $1 AND e.input_category = $2 "
            "ORDER BY e.rating DESC, e.matches DESC, e.wallet_address ASC LIMIT $3 OFFSET $4",
            league,
            input_category,
            limit,
            offset,
        )
        return [
            {
                "rank": offset + index + 1,
                "wallet": str(row["wallet_address"]),
                "user_id": str(row["wallet_address"]),
                "name": str(row["name"]),
                "league": league,
                "category": input_category,
                "rating": float(row["rating"]),
                "wins": int(row["wins"]),
                "losses": int(row["losses"]),
                "draws": int(row["draws"]),
                "matches": int(row["matches"]),
            }
            for index, row in enumerate(rows)
        ]

    async def get_competitive_player_rank(self, wallet: str, league: str, input_category: str) -> int | None:
        self._validate_competitive_dimensions(league, input_category)
        row = await self._pool.fetchrow(
            "SELECT COUNT(*) + 1 AS rank FROM competitive_ratings WHERE league = $1 "
            "AND input_category = $2 AND rating > (SELECT rating FROM competitive_ratings "
            "WHERE wallet_address = $3 AND league = $1 AND input_category = $2)",
            league,
            input_category,
            wallet,
        )
        exists = await self._pool.fetchrow(
            "SELECT 1 FROM competitive_ratings WHERE wallet_address = $1 AND league = $2 AND input_category = $3",
            wallet,
            league,
            input_category,
        )
        if exists is None:
            return None
        return int(row["rank"]) if row else None

    async def get_rating(self, user_id: str, category: str) -> dict[str, Any]:
        """Get a player's rating data for a category.

        Returns dict with: user_id, category, rating, wins, losses, draws, matches.
        Returns defaults (rating=1000) if player has no record.
        """
        row = await self._pool.fetchrow(
            "SELECT rating, wins, losses, draws, matches FROM elo_ratings WHERE user_id = $1 AND category = $2",
            user_id, category,
        )

        if row is None:
            return {
                "user_id": user_id,
                "category": category,
                "rating": DEFAULT_RATING,
                "wins": 0,
                "losses": 0,
                "draws": 0,
                "matches": 0,
            }

        return {
            "user_id": user_id,
            "category": category,
            "rating": float(row["rating"]),
            "wins": int(row["wins"]),
            "losses": int(row["losses"]),
            "draws": int(row["draws"]),
            "matches": int(row["matches"]),
        }

    async def set_player_name(self, user_id: str, name: str) -> None:
        """Store/update a player's display name."""
        await self._pool.execute(
            "INSERT INTO players (user_id, name) VALUES ($1, $2) "
            "ON CONFLICT (user_id) DO UPDATE SET name = $2",
            user_id, name,
        )

    async def get_player_name(self, user_id: str) -> str:
        """Get a player's display name."""
        row = await self._pool.fetchrow(
            "SELECT name FROM players WHERE user_id = $1", user_id,
        )
        return str(row["name"]) if row else ""

    async def _is_name_taken(self, name: str) -> bool:
        """Check if a display name is already used by any player."""
        row = await self._pool.fetchrow(
            "SELECT 1 FROM players WHERE name = $1", name,
        )
        return row is not None

    async def _is_name_taken_by_other(self, name: str, user_id: str) -> bool:
        """Check if a display name is used by a different player."""
        row = await self._pool.fetchrow(
            "SELECT 1 FROM players WHERE name = $1 AND user_id != $2",
            name, user_id,
        )
        return row is not None

    async def update_username(self, user_id: str, name: str) -> str | None:
        """Validate and update a player's username.

        Returns the new name on success, or None if the name is taken.
        Raises ValueError if the name format is invalid.
        """
        if not re.match(USERNAME_PATTERN, name):
            raise ValueError(
                "Username must be 2-30 characters, alphanumeric and hyphens only"
            )
        if await self._is_name_taken_by_other(name, user_id):
            return None
        await self.set_player_name(user_id, name)
        return name

    async def ensure_fighter_username(self, user_id: str) -> str:
        """Return existing name or generate a unique fighter username.

        On first login (no entry or empty name in players table), generates
        a random fighter-themed username and stores it. Retries on collision.
        """
        existing = await self.get_player_name(user_id)
        if existing:
            return existing

        for _ in range(MAX_USERNAME_RETRIES):
            candidate = generate_fighter_username()
            if not await self._is_name_taken(candidate):
                await self.set_player_name(user_id, candidate)
                return candidate

        # Extremely unlikely: all retries collided — append user_id suffix
        fallback = f"{generate_fighter_username()}-{user_id[:6]}"
        await self.set_player_name(user_id, fallback)
        return fallback

    async def update_ratings(
        self,
        winner_id: str,
        loser_id: str,
        category: str,
        draw: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Update ratings after a match. Atomic via Postgres transaction.

        Args:
            winner_id: User ID of the winner (or player A if draw)
            loser_id: User ID of the loser (or player B if draw)
            category: 'voice' or 'keyboard'
            draw: True if the match was a draw

        Returns:
            Tuple of (winner_new_stats, loser_new_stats)
        """
        # Fetch current ratings
        winner_stats = await self.get_rating(winner_id, category)
        loser_stats = await self.get_rating(loser_id, category)

        winner_rating = float(winner_stats["rating"])
        loser_rating = float(loser_stats["rating"])
        winner_matches = int(winner_stats["matches"])
        loser_matches = int(loser_stats["matches"])

        # Calculate new ratings
        result = 0.5 if draw else 1.0
        new_winner_rating, new_loser_rating = calculate_elo_change(
            winner_rating, loser_rating, winner_matches, loser_matches, result
        )

        # Atomic transaction
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # Ensure both players exist in players table
                await conn.execute(
                    "INSERT INTO players (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
                    winner_id,
                )
                await conn.execute(
                    "INSERT INTO players (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
                    loser_id,
                )

                # Upsert winner
                await conn.execute(
                    "INSERT INTO elo_ratings (user_id, category, rating, wins, losses, draws, matches) "
                    "VALUES ($1, $2, $3, $4, 0, $5, 1) "
                    "ON CONFLICT (user_id, category) DO UPDATE SET "
                    "rating = $3, wins = elo_ratings.wins + $4, "
                    "draws = elo_ratings.draws + $5, matches = elo_ratings.matches + 1",
                    winner_id, category, new_winner_rating,
                    0 if draw else 1,  # wins increment
                    1 if draw else 0,  # draws increment
                )

                # Upsert loser
                await conn.execute(
                    "INSERT INTO elo_ratings (user_id, category, rating, wins, losses, draws, matches) "
                    "VALUES ($1, $2, $3, 0, $4, $5, 1) "
                    "ON CONFLICT (user_id, category) DO UPDATE SET "
                    "rating = $3, losses = elo_ratings.losses + $4, "
                    "draws = elo_ratings.draws + $5, matches = elo_ratings.matches + 1",
                    loser_id, category, new_loser_rating,
                    0 if draw else 1,  # losses increment
                    1 if draw else 0,  # draws increment
                )

                # Record match history
                await conn.execute(
                    "INSERT INTO match_history "
                    "(winner_id, loser_id, category, winner_rating_before, loser_rating_before, "
                    "winner_rating_after, loser_rating_after, draw) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                    winner_id, loser_id, category,
                    winner_rating, loser_rating,
                    new_winner_rating, new_loser_rating,
                    draw,
                )

        # Return updated stats with previous rating tracked
        winner_new = {
            "user_id": winner_id,
            "category": category,
            "rating": new_winner_rating,
            "old_rating": winner_rating,
            "wins": int(winner_stats["wins"]) + (0 if draw else 1),
            "losses": int(winner_stats["losses"]),
            "draws": int(winner_stats["draws"]) + (1 if draw else 0),
            "matches": winner_matches + 1,
        }
        loser_new = {
            "user_id": loser_id,
            "category": category,
            "rating": new_loser_rating,
            "old_rating": loser_rating,
            "wins": int(loser_stats["wins"]),
            "losses": int(loser_stats["losses"]) + (0 if draw else 1),
            "draws": int(loser_stats["draws"]) + (1 if draw else 0),
            "matches": loser_matches + 1,
        }

        return winner_new, loser_new

    async def get_leaderboard(
        self,
        category: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Get leaderboard entries sorted by ELO (highest first).

        Args:
            category: 'voice' or 'keyboard'
            limit: Max entries to return
            offset: Starting offset

        Returns:
            List of dicts with: rank, user_id, name, rating, wins, losses, draws, matches
        """
        rows = await self._pool.fetch(
            "SELECT e.user_id, COALESCE(p.name, '') AS name, "
            "e.rating, e.wins, e.losses, e.draws, e.matches "
            "FROM elo_ratings e "
            "LEFT JOIN players p ON p.user_id = e.user_id "
            "WHERE e.category = $1 "
            "ORDER BY e.rating DESC "
            "LIMIT $2 OFFSET $3",
            category, limit, offset,
        )

        return [
            {
                "rank": offset + i + 1,
                "user_id": str(row["user_id"]),
                "name": str(row["name"]),
                "rating": float(row["rating"]),
                "wins": int(row["wins"]),
                "losses": int(row["losses"]),
                "draws": int(row["draws"]),
                "matches": int(row["matches"]),
            }
            for i, row in enumerate(rows)
        ]

    async def get_player_rank(self, user_id: str, category: str) -> int | None:
        """Get a player's rank (1-based) in a category. Returns None if not ranked."""
        row = await self._pool.fetchrow(
            "SELECT COUNT(*) + 1 AS rank FROM elo_ratings "
            "WHERE category = $1 AND rating > "
            "(SELECT rating FROM elo_ratings WHERE user_id = $2 AND category = $1)",
            category, user_id,
        )
        # Check player actually has a rating in this category
        exists = await self._pool.fetchrow(
            "SELECT 1 FROM elo_ratings WHERE user_id = $1 AND category = $2",
            user_id, category,
        )
        if exists is None:
            return None
        return int(row["rank"]) if row else None
