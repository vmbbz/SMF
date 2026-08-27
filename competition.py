"""Competitive mode policy shared by matchmaking, rooms, and settlement.

The constants in this module are intentionally free of framework and storage
dependencies so every layer applies the same vocabulary.  A room's
``match_type`` describes how it was created; ``league`` is populated only for
reward-candidate public matchmaking rooms.
"""
from __future__ import annotations

from dataclasses import dataclass


PRIVATE_CASUAL = "private_casual"
RANKED_SKILL = "ranked_skill"
RANKED_BOOSTED = "ranked_boosted"
AI_SHOWCASE = "ai_showcase"

MATCH_TYPES = frozenset({PRIVATE_CASUAL, RANKED_SKILL, RANKED_BOOSTED, AI_SHOWCASE})
RANKED_MATCH_TYPES = frozenset({RANKED_SKILL, RANKED_BOOSTED})

SKILL_LEAGUE = "skill"
BOOSTED_LEAGUE = "boosted"
RANKED_LEAGUES = frozenset({SKILL_LEAGUE, BOOSTED_LEAGUE})

KEYBOARD_CATEGORY = "keyboard"
VOICE_CATEGORY = "voice"
INPUT_CATEGORIES = frozenset({KEYBOARD_CATEGORY, VOICE_CATEGORY})

BOOSTED_MAX_PAID_CHARGES = 3


@dataclass(frozen=True)
class MatchPolicy:
    """Immutable rules derived from a room's match type."""

    match_type: str
    league: str
    reward_candidate: bool
    max_paid_boost_charges: int


_POLICIES = {
    PRIVATE_CASUAL: MatchPolicy(PRIVATE_CASUAL, "", False, 0),
    RANKED_SKILL: MatchPolicy(RANKED_SKILL, SKILL_LEAGUE, True, 0),
    RANKED_BOOSTED: MatchPolicy(
        RANKED_BOOSTED,
        BOOSTED_LEAGUE,
        True,
        BOOSTED_MAX_PAID_CHARGES,
    ),
    AI_SHOWCASE: MatchPolicy(AI_SHOWCASE, "", False, 0),
}


def match_type_for_league(league: str) -> str:
    """Return the only ranked match type valid for ``league``."""
    if league == SKILL_LEAGUE:
        return RANKED_SKILL
    if league == BOOSTED_LEAGUE:
        return RANKED_BOOSTED
    raise ValueError(f"Invalid ranked league: {league}")


def policy_for_match_type(match_type: str) -> MatchPolicy:
    """Return validated policy for ``match_type``."""
    try:
        return _POLICIES[match_type]
    except KeyError as exc:
        raise ValueError(f"Invalid match type: {match_type}") from exc


def is_ranked_match_type(match_type: str) -> bool:
    return match_type in RANKED_MATCH_TYPES


def matchmaking_pool(league: str, category: str) -> str:
    """Build a stable queue key that cannot mix leagues or input divisions."""
    if league not in RANKED_LEAGUES:
        raise ValueError(f"Invalid ranked league: {league}")
    if category not in INPUT_CATEGORIES:
        raise ValueError(f"Invalid input category: {category}")
    return f"{league}:{category}"
