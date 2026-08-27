"""Public, non-custodial economy policy for StickLash.

This module contains product-policy constants and builds a read-only policy
document. It deliberately does not construct swaps, move tokens, calculate
claims, or hold signing keys.
"""

from __future__ import annotations

from typing import Any

BASIS_POINTS = 10_000
POLICY_VERSION = "2026-08-27.v3"

CREATOR_FEE_OPERATIONS_BPS = 5_000
CREATOR_FEE_ANSEM_ACQUISITION_BPS = 5_000

BOOST_PAYMENT_GAME_REWARD_RESERVE_BPS = 10_000
BOOST_PAYMENT_BURN_BPS = 0
BOOST_PAYMENT_OPERATIONS_BPS = 0

ANSEM_ACTION_REWARD_RESERVE_BPS = 10_000

SKILL_CHAMPIONSHIP_REWARD_BPS = 7_000
BOOSTED_LEAGUE_REWARD_BPS = 3_000
CASUAL_ARENA_REWARD_BPS = 0
BOOSTED_LEAGUE_MAX_PAID_CHARGES = 3


def _require_complete_allocation(name: str, *allocations: int) -> None:
    if sum(allocations) != BASIS_POINTS:
        raise RuntimeError(f"{name} allocations must total {BASIS_POINTS} basis points")


_require_complete_allocation(
    "creator-fee SOL",
    CREATOR_FEE_OPERATIONS_BPS,
    CREATOR_FEE_ANSEM_ACQUISITION_BPS,
)
_require_complete_allocation(
    "game-token boost payment",
    BOOST_PAYMENT_GAME_REWARD_RESERVE_BPS,
    BOOST_PAYMENT_BURN_BPS,
    BOOST_PAYMENT_OPERATIONS_BPS,
)
_require_complete_allocation(
    "competitive reward budget",
    SKILL_CHAMPIONSHIP_REWARD_BPS,
    BOOSTED_LEAGUE_REWARD_BPS,
    CASUAL_ARENA_REWARD_BPS,
)


def build_public_economy_policy(
    *,
    game_token_mint: str,
    game_token_symbol: str,
    ansem_token_mint: str,
    boost_settlement_mode: str,
    boost_purchases_enabled: bool,
    boost_purchases_disabled_reason: str,
    game_reward_reserve_configured: bool,
    ansem_reward_reserve_configured: bool,
    creator_fee_payout_configured: bool,
    operating_treasury_configured: bool,
) -> dict[str, Any]:
    """Build the public design and runtime-readiness document.

    Configuration booleans intentionally expose readiness rather than treasury
    addresses. Token mints are public identities and are returned when known.
    """

    normalized_game_mint = game_token_mint.strip()
    normalized_ansem_mint = ansem_token_mint.strip()
    normalized_symbol = game_token_symbol.strip() or "TOKEN"

    return {
        "policyVersion": POLICY_VERSION,
        "policyStatus": "design-approved-not-live",
        "network": "solana-mainnet",
        "assets": {
            "sol": {
                "role": "creator-fee income",
            },
            "usdc": {
                "role": "none",
            },
            "gameToken": {
                "symbol": normalized_symbol,
                "mint": normalized_game_mint,
                "configured": bool(normalized_game_mint),
                "roles": ["boost payment", "leaderboard reward"],
            },
            "ansem": {
                "symbol": "ANSEM",
                "mint": normalized_ansem_mint,
                "configured": bool(normalized_ansem_mint),
                "roles": ["Arena Director action payment", "leaderboard reward"],
            },
        },
        "flows": {
            "creatorFeeSol": {
                "operationsBps": CREATOR_FEE_OPERATIONS_BPS,
                "ansemAcquisitionBps": CREATOR_FEE_ANSEM_ACQUISITION_BPS,
                "enabled": False,
            },
            "gameTokenBoostPayment": {
                "gameTokenRewardReserveBps": BOOST_PAYMENT_GAME_REWARD_RESERVE_BPS,
                "burnBps": BOOST_PAYMENT_BURN_BPS,
                "operationsBps": BOOST_PAYMENT_OPERATIONS_BPS,
                "enabled": boost_purchases_enabled,
            },
            "ansemArenaDirectorAction": {
                "ansemRewardReserveBps": ANSEM_ACTION_REWARD_RESERVE_BPS,
                "enabled": False,
            },
        },
        "leagues": {
            "casual": {
                "purchasedBoosts": "allowed",
                "rewardBudgetBps": CASUAL_ARENA_REWARD_BPS,
                "rewardEligible": False,
                "rewardEligibleWhenEpochsEnabled": False,
            },
            "boosted": {
                "purchasedBoosts": "allowed-capped",
                "maxPaidBoostChargesPerPlayerPerMatch": BOOSTED_LEAGUE_MAX_PAID_CHARGES,
                "rewardBudgetBps": BOOSTED_LEAGUE_REWARD_BPS,
                "rewardEligible": False,
                "rewardEligibleWhenEpochsEnabled": True,
                "rating": "separate-validated-elo",
            },
            "skill": {
                "purchasedBoosts": "disabled",
                "rewardBudgetBps": SKILL_CHAMPIONSHIP_REWARD_BPS,
                "rewardEligible": False,
                "rewardEligibleWhenEpochsEnabled": True,
                "rating": "main-validated-elo",
            },
        },
        "competition": {
            "settlementAuthority": "server",
            "ratingPartitions": ["league", "input-category"],
            "eligibleMatchTypesWhenEpochsEnabled": ["ranked_skill", "ranked_boosted"],
            "excludedMatchTypes": [
                "private_casual",
                "ai_practice",
                "token_arena",
                "endless",
                "practice_while_waiting",
            ],
            "perWinTokenPayouts": False,
            "currentTokenEarning": "disabled",
        },
        "runtime": {
            "boostSettlementMode": boost_settlement_mode,
            "boostPurchasesEnabled": boost_purchases_enabled,
            "boostPurchasesDisabledReason": boost_purchases_disabled_reason,
            "creatorFeeRoutingEnabled": False,
            "ansemActionsEnabled": False,
            "rewardEpochsEnabled": False,
            "rewardClaimsEnabled": False,
        },
        "readiness": {
            "gameTokenMintConfigured": bool(normalized_game_mint),
            "ansemMintConfigured": bool(normalized_ansem_mint),
            "gameRewardReserveConfigured": game_reward_reserve_configured,
            "ansemRewardReserveConfigured": ansem_reward_reserve_configured,
            "creatorFeePayoutConfigured": creator_fee_payout_configured,
            "operatingTreasuryConfigured": operating_treasury_configured,
        },
    }
