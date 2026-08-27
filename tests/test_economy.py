"""Tests for the read-only StickLash economy policy."""

from economy import BASIS_POINTS, POLICY_VERSION, build_public_economy_policy


def _policy(**overrides):
    values = {
        "game_token_mint": "",
        "game_token_symbol": "TOKEN",
        "ansem_token_mint": "",
        "boost_settlement_mode": "reward_vault_transfer",
        "boost_purchases_enabled": False,
        "boost_purchases_disabled_reason": "not ready",
        "game_reward_reserve_configured": False,
        "ansem_reward_reserve_configured": False,
        "creator_fee_payout_configured": False,
        "operating_treasury_configured": False,
    }
    values.update(overrides)
    return build_public_economy_policy(**values)


def test_policy_has_clear_asset_roles_and_no_usdc_role() -> None:
    policy = _policy(game_token_mint="game-mint", ansem_token_mint="ansem-mint")

    assert policy["policyVersion"] == POLICY_VERSION
    assert policy["assets"]["usdc"]["role"] == "none"
    assert policy["assets"]["gameToken"]["roles"] == ["boost payment", "leaderboard reward"]
    assert policy["assets"]["ansem"]["roles"] == [
        "Arena Director action payment",
        "leaderboard reward",
    ]


def test_creator_fee_and_boost_flows_are_complete() -> None:
    policy = _policy()
    creator_flow = policy["flows"]["creatorFeeSol"]
    boost_flow = policy["flows"]["gameTokenBoostPayment"]

    assert creator_flow["operationsBps"] + creator_flow["ansemAcquisitionBps"] == BASIS_POINTS
    assert (
        boost_flow["gameTokenRewardReserveBps"]
        + boost_flow["burnBps"]
        + boost_flow["operationsBps"]
        == BASIS_POINTS
    )
    assert boost_flow["gameTokenRewardReserveBps"] == BASIS_POINTS
    assert boost_flow["burnBps"] == 0


def test_competitive_rewards_are_separated_70_30() -> None:
    leagues = _policy()["leagues"]

    assert leagues["skill"]["rewardBudgetBps"] == 7_000
    assert leagues["skill"]["purchasedBoosts"] == "disabled"
    assert leagues["skill"]["rewardEligible"] is False
    assert leagues["skill"]["rewardEligibleWhenEpochsEnabled"] is True
    assert leagues["boosted"]["rewardBudgetBps"] == 3_000
    assert leagues["boosted"]["maxPaidBoostChargesPerPlayerPerMatch"] == 3
    assert leagues["boosted"]["rewardEligible"] is False
    assert leagues["boosted"]["rewardEligibleWhenEpochsEnabled"] is True
    assert leagues["casual"]["rewardBudgetBps"] == 0


def test_unimplemented_value_paths_remain_disabled() -> None:
    policy = _policy(boost_purchases_enabled=False)
    runtime = policy["runtime"]

    assert runtime["boostPurchasesEnabled"] is False
    assert runtime["creatorFeeRoutingEnabled"] is False
    assert runtime["ansemActionsEnabled"] is False
    assert runtime["rewardEpochsEnabled"] is False
    assert runtime["rewardClaimsEnabled"] is False


def test_competition_policy_excludes_casual_and_ai_paths() -> None:
    competition = _policy()["competition"]

    assert competition["settlementAuthority"] == "server"
    assert competition["ratingPartitions"] == ["league", "input-category"]
    assert competition["eligibleMatchTypesWhenEpochsEnabled"] == [
        "ranked_skill",
        "ranked_boosted",
    ]
    assert "private_casual" in competition["excludedMatchTypes"]
    assert "ai_practice" in competition["excludedMatchTypes"]
    assert competition["perWinTokenPayouts"] is False
    assert competition["currentTokenEarning"] == "disabled"
