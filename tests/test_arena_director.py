from __future__ import annotations

from datetime import datetime, timezone

from arena_director import ArenaDirector, DIRECTOR_VERSION


FIXED_TIME = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)


def token(
    mint: str,
    symbol: str,
    *,
    volume: float,
    change: float,
    liquidity: float,
) -> dict:
    return {
        "mint": mint,
        "symbol": symbol,
        "name": f"{symbol} Token",
        "volume24h": volume,
        "priceChange24h": change,
        "liquidity": liquidity,
        "marketCap": volume * 2,
        "logoURI": f"https://example.test/{mint}.png",
    }


def test_selects_highest_scored_live_candidate() -> None:
    director = ArenaDirector()
    quiet = token("mint-quiet", "QUIET", volume=10_000, change=2, liquidity=20_000)
    active = token("mint-active", "ACTIVE", volume=2_000_000, change=42, liquidity=250_000)

    decision = director.decide([quiet, active], [], generated_at=FIXED_TIME)

    assert decision["status"] == "selected"
    assert decision["opponent"]["mint"] == "mint-active"
    assert decision["opponent"]["arenaDirector"]["policyVersion"] == DIRECTOR_VERSION
    assert "exceptional_24h_volume" in decision["opponent"]["arenaDirector"]["reasons"]
    assert decision["candidateCount"] == 2


def test_excludes_current_opponent_and_merges_duplicate_sources() -> None:
    director = ArenaDirector()
    current = token("mint-current", "CURRENT", volume=9_000_000, change=70, liquidity=800_000)
    next_token = token("mint-next", "NEXT", volume=500_000, change=25, liquidity=80_000)

    decision = director.decide(
        [current, next_token],
        [dict(next_token), current],
        current_mint="mint-current",
        generated_at=FIXED_TIME,
    )

    assert decision["candidateCount"] == 1
    assert decision["opponent"]["mint"] == "mint-next"
    assert decision["candidates"][0]["sourceLists"] == ["graduated", "trending"]
    assert "graduated_discovery" in decision["candidates"][0]["reasons"]


def test_same_snapshot_has_same_decision_id_and_ranking() -> None:
    director = ArenaDirector()
    candidates = [
        token("mint-b", "B", volume=250_000, change=-35, liquidity=70_000),
        token("mint-a", "A", volume=250_000, change=-35, liquidity=70_000),
    ]

    first = director.decide(candidates, [], generated_at=FIXED_TIME)
    second = director.decide(candidates, [], generated_at=FIXED_TIME)

    assert first["decisionId"] == second["decisionId"]
    assert first["candidates"] == second["candidates"]
    assert first["opponent"]["mint"] == "mint-a"


def test_empty_or_invalid_inputs_return_no_candidate() -> None:
    director = ArenaDirector()

    decision = director.decide([{}, "not-a-token"], None, generated_at=FIXED_TIME)  # type: ignore[list-item]

    assert decision["status"] == "no_candidate"
    assert decision["opponent"] is None
    assert decision["candidateCount"] == 0
    assert decision["fallback"] is True


def test_non_finite_market_values_are_bounded() -> None:
    director = ArenaDirector()
    malformed = {
        "mint": "mint-malformed",
        "symbol": "ODD",
        "volume24h": float("inf"),
        "priceChange24h": float("nan"),
        "liquidity": -1,
    }

    decision = director.decide([malformed], [], generated_at=FIXED_TIME)

    candidate = decision["candidates"][0]
    assert candidate["score"] == 0
    assert candidate["metrics"]["volume24h"] == 0
    assert candidate["metrics"]["priceChange24h"] == 0
    assert candidate["metrics"]["liquidity"] == 0
    assert "thin_liquidity_risk" in candidate["reasons"]


def test_fresh_alchemy_activity_adds_only_the_bounded_optional_bonus() -> None:
    director = ArenaDirector()
    base = token("mint-activity", "ACTIVE", volume=250_000, change=18, liquidity=70_000)
    enriched = {
        **base,
        "alchemyActivity": {
            "provider": "alchemy",
            "transport": "solana_pubsub",
            "scoreEligible": True,
            "observedConfirmedTransactions": 31,
        },
    }

    baseline = director.decide([base], [], generated_at=FIXED_TIME)
    with_activity = director.decide([enriched], [], generated_at=FIXED_TIME)
    delta = with_activity["candidates"][0]["score"] - baseline["candidates"][0]["score"]

    assert 0 < delta <= with_activity["policy"]["confirmedActivityBonus"]
    assert "alchemy_solana_pubsub_candidate_activity" in with_activity["inputSources"]
    assert "recent_confirmed_onchain_activity" in with_activity["candidates"][0]["reasons"]
    assert with_activity["candidates"][0]["metrics"]["alchemyConfirmedTransactions"] == 31


def test_stale_alchemy_activity_cannot_change_selection_or_score() -> None:
    director = ArenaDirector()
    base = token("mint-stale", "STALE", volume=250_000, change=18, liquidity=70_000)
    stale = {
        **base,
        "alchemyActivity": {
            "provider": "alchemy",
            "transport": "solana_pubsub",
            "scoreEligible": False,
            "observedConfirmedTransactions": 999_999,
        },
    }

    baseline = director.decide([base], [], generated_at=FIXED_TIME)
    stale_decision = director.decide([stale], [], generated_at=FIXED_TIME)

    assert stale_decision["candidates"][0]["score"] == baseline["candidates"][0]["score"]
    assert stale_decision["decisionId"] == baseline["decisionId"]
    assert "alchemy_solana_pubsub_candidate_activity" not in stale_decision["inputSources"]
    assert stale_decision["candidates"][0]["metrics"]["alchemyConfirmedTransactions"] is None
