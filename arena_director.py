"""Explainable market-agent policy for autonomous StickLash match selection."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable


DIRECTOR_NAME = "StickLash Arena Director"
DIRECTOR_VERSION = "0.2.0"
MAX_PUBLIC_CANDIDATES = 8

POLICY = {
    "volume24h": 42,
    "absolutePriceChange24h": 23,
    "liquidity": 25,
    "graduatedDiscoveryBonus": 10,
    "confirmedActivityBonus": 8,
    "thinLiquidityPenalty": 15,
    "missingVolumePenalty": 10,
}


def _number(value: Any) -> float:
    """Return a finite, non-negative market number."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(parsed):
        return 0.0
    return max(0.0, parsed)


def _signed_number(value: Any) -> float:
    """Return a finite signed market number."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def _token_mint(token: dict[str, Any]) -> str:
    return str(token.get("mint") or token.get("address") or "").strip()


ALCHEMY_ACTIVITY_INPUT_SOURCES = {
    "solana_http_polling": "alchemy_solana_http_candidate_activity",
    "solana_pubsub": "alchemy_solana_pubsub_candidate_activity",
    "yellowstone_grpc": "alchemy_yellowstone_candidate_activity",
}


def _alchemy_activity(token: dict[str, Any]) -> tuple[float, bool, str | None]:
    """Return bounded activity, eligibility, and verified transport provenance."""
    activity = token.get("alchemyActivity")
    if (
        not isinstance(activity, dict)
        or activity.get("provider") != "alchemy"
        or activity.get("scoreEligible") is not True
    ):
        return 0.0, False, None
    source = ALCHEMY_ACTIVITY_INPUT_SOURCES.get(str(activity.get("transport") or ""))
    if source is None:
        return 0.0, False, None
    return _number(activity.get("observedConfirmedTransactions")), True, source


def _merge_candidate(
    existing: dict[str, Any] | None,
    token: dict[str, Any],
    source_list: str,
) -> dict[str, Any]:
    """Merge duplicate discovery entries without discarding richer fields."""
    merged = dict(existing or {})
    for key, value in token.items():
        if key not in merged or merged[key] in (None, "", 0, "N/A"):
            merged[key] = value

    mint = _token_mint(token) or _token_mint(merged)
    merged["mint"] = mint
    merged["address"] = str(merged.get("address") or mint)
    merged["symbol"] = str(merged.get("symbol") or "MEME").strip() or "MEME"
    merged["name"] = str(merged.get("name") or merged["symbol"]).strip() or merged["symbol"]

    sources = set(merged.get("arenaSourceLists") or [])
    sources.add(source_list)
    merged["arenaSourceLists"] = sorted(sources)

    # Normalize the fields consumed by the policy and by fighter power scaling.
    merged["volume24h"] = _number(merged.get("volume24h"))
    merged["priceChange24h"] = _signed_number(merged.get("priceChange24h"))
    merged["liquidity"] = _number(merged.get("liquidity"))
    merged["marketCap"] = _number(merged.get("marketCap"))
    merged["price"] = _number(merged.get("price"))
    return merged


def _reason_codes(token: dict[str, Any]) -> list[str]:
    volume = _number(token.get("volume24h"))
    movement = _signed_number(token.get("priceChange24h"))
    liquidity = _number(token.get("liquidity"))
    confirmed_activity, activity_eligible, _ = _alchemy_activity(token)
    sources = set(token.get("arenaSourceLists") or [])
    reasons: list[str] = []

    if "graduated" in sources:
        reasons.append("graduated_discovery")
    if activity_eligible and confirmed_activity > 0:
        reasons.append("recent_confirmed_onchain_activity")
    if volume >= 1_000_000:
        reasons.append("exceptional_24h_volume")
    elif volume >= 100_000:
        reasons.append("active_24h_volume")
    elif volume <= 0:
        reasons.append("missing_volume_data")

    if movement >= 15:
        reasons.append("strong_upward_momentum")
    elif movement <= -15:
        reasons.append("strong_selling_pressure")
    if abs(movement) >= 30:
        reasons.append("high_volatility")

    if liquidity >= 100_000:
        reasons.append("deep_liquidity")
    elif liquidity < 5_000:
        reasons.append("thin_liquidity_risk")

    if not reasons:
        reasons.append("balanced_market_activity")
    return reasons


def _score_candidate(token: dict[str, Any]) -> float:
    volume = _number(token.get("volume24h"))
    movement = abs(_signed_number(token.get("priceChange24h")))
    liquidity = _number(token.get("liquidity"))
    confirmed_activity, activity_eligible, _ = _alchemy_activity(token)
    sources = set(token.get("arenaSourceLists") or [])

    volume_score = min(math.log10(1 + volume) / 8, 1) * POLICY["volume24h"]
    movement_score = min(movement / 100, 1) * POLICY["absolutePriceChange24h"]
    liquidity_score = min(math.log10(1 + liquidity) / 6, 1) * POLICY["liquidity"]
    graduated_bonus = POLICY["graduatedDiscoveryBonus"] if "graduated" in sources else 0
    activity_bonus = 0.0
    if activity_eligible:
        activity_bonus = min(math.log2(1 + confirmed_activity) / 5, 1) * POLICY["confirmedActivityBonus"]
    thin_penalty = POLICY["thinLiquidityPenalty"] if liquidity < 5_000 else 0
    missing_volume_penalty = POLICY["missingVolumePenalty"] if volume <= 0 else 0

    score = volume_score + movement_score + liquidity_score + graduated_bonus + activity_bonus
    score -= thin_penalty + missing_volume_penalty
    return round(max(0.0, min(100.0, score)), 2)


def _explanation(token: dict[str, Any], reasons: list[str]) -> str:
    symbol = str(token.get("symbol") or "MEME").upper()
    labels = {
        "graduated_discovery": "a newly graduated discovery",
        "exceptional_24h_volume": "exceptional 24-hour volume",
        "active_24h_volume": "active 24-hour volume",
        "strong_upward_momentum": "strong upward momentum",
        "strong_selling_pressure": "heavy selling pressure",
        "high_volatility": "high volatility",
        "deep_liquidity": "deep liquidity",
        "thin_liquidity_risk": "a thin-liquidity risk flag",
        "missing_volume_data": "missing volume data",
        "balanced_market_activity": "balanced market activity",
        "recent_confirmed_onchain_activity": "recent confirmed onchain activity",
    }
    readable = [labels[reason] for reason in reasons[:3] if reason in labels]
    return f"Selected ${symbol} for " + ", ".join(readable) + "."


def _decision_id(current_mint: str, scored: Iterable[dict[str, Any]]) -> str:
    snapshot = {
        "version": DIRECTOR_VERSION,
        "currentMint": current_mint,
        "candidates": [
            {
                "mint": item["mint"],
                "score": item["score"],
                "volume24h": item["metrics"]["volume24h"],
                "priceChange24h": item["metrics"]["priceChange24h"],
                "liquidity": item["metrics"]["liquidity"],
                "alchemyConfirmedTransactions": item["metrics"]["alchemyConfirmedTransactions"],
                "alchemyActivityScoreEligible": item["metrics"]["alchemyActivityScoreEligible"],
            }
            for item in scored
        ],
    }
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return f"arena-{digest[:16]}"


class ArenaDirector:
    """Select the next opponent from normalized live-market snapshots."""

    def decide(
        self,
        trending: list[dict[str, Any]] | None,
        graduated: list[dict[str, Any]] | None,
        *,
        current_mint: str | None = None,
        generated_at: datetime | None = None,
    ) -> dict[str, Any]:
        current = str(current_mint or "").strip()
        merged: dict[str, dict[str, Any]] = {}

        for source_list, tokens in (("trending", trending or []), ("graduated", graduated or [])):
            for raw_token in tokens:
                if not isinstance(raw_token, dict):
                    continue
                mint = _token_mint(raw_token)
                if not mint or mint == current:
                    continue
                merged[mint] = _merge_candidate(merged.get(mint), raw_token, source_list)

        scored: list[dict[str, Any]] = []
        alchemy_activity_sources: set[str] = set()
        for mint, token in merged.items():
            reasons = _reason_codes(token)
            confirmed_activity, activity_eligible, activity_source = _alchemy_activity(token)
            if activity_eligible and activity_source:
                alchemy_activity_sources.add(activity_source)
            scored.append(
                {
                    "mint": mint,
                    "symbol": token["symbol"],
                    "name": token["name"],
                    "score": _score_candidate(token),
                    "reasons": reasons,
                    "sourceLists": token["arenaSourceLists"],
                    "metrics": {
                        "volume24h": token["volume24h"],
                        "priceChange24h": token["priceChange24h"],
                        "liquidity": token["liquidity"],
                        "marketCap": token["marketCap"],
                        "alchemyConfirmedTransactions": confirmed_activity if activity_eligible else None,
                        "alchemyActivityScoreEligible": activity_eligible,
                    },
                    "token": token,
                }
            )

        # Mint is the final tie-breaker, making equal snapshots deterministic.
        scored.sort(key=lambda item: (-item["score"], item["mint"]))
        decision_id = _decision_id(current, scored)
        timestamp = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
        selected = scored[0] if scored else None

        opponent: dict[str, Any] | None = None
        explanation = "No eligible live-market candidates were available."
        if selected:
            opponent = dict(selected["token"])
            opponent["arenaDirector"] = {
                "decisionId": decision_id,
                "policyVersion": DIRECTOR_VERSION,
                "score": selected["score"],
                "reasons": selected["reasons"],
            }
            explanation = _explanation(opponent, selected["reasons"])

        public_candidates = []
        for rank, item in enumerate(scored[:MAX_PUBLIC_CANDIDATES], start=1):
            public_candidates.append(
                {
                    "rank": rank,
                    "mint": item["mint"],
                    "symbol": item["symbol"],
                    "name": item["name"],
                    "score": item["score"],
                    "reasons": item["reasons"],
                    "sourceLists": item["sourceLists"],
                    "metrics": item["metrics"],
                }
            )

        return {
            "status": "selected" if selected else "no_candidate",
            "decisionId": decision_id,
            "generatedAt": timestamp,
            "agent": {
                "name": DIRECTOR_NAME,
                "version": DIRECTOR_VERSION,
                "mode": "deterministic_market_policy",
            },
            "policy": dict(POLICY),
            "currentMintExcluded": current or None,
            "inputSources": [
                "birdeye_trending",
                "birdeye_graduated",
                *sorted(alchemy_activity_sources),
            ],
            "candidateCount": len(scored),
            "opponent": opponent,
            "explanation": explanation,
            "candidates": public_candidates,
            "fallback": selected is None,
        }


arena_director = ArenaDirector()
