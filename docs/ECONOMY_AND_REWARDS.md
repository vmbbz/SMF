# StickLash Economy, Leaderboards, and Rewards

Status: architecture decision for the AnsemHack build, recorded 27 August 2026.

## Decision summary

StickLash will use one purpose per asset and will not mix paid combat power with ranked rewards.

| Asset or system | One job |
|---|---|
| StickLash game token | Purchases casual boost packs and other game consumables after the ClawPump mint is final |
| `$ANSEM` | Unlocks bounded Arena Director actions such as a daily reroll or challenger nomination |
| Human ELO | Measures ranked player skill under equal combat rules |
| Reward vault | Holds the fixed weekly leaderboard budget |

There is no staking, revenue-share staking, dual-token boost payment, or automatic `$ANSEM` distribution in this design.

## Current production reality

The public service was inspected on 27 August 2026. `/api/smf-config` returned Solana mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. The current purchase transaction is a 100% SPL burn, so a completed purchase destroys USDC and produces no treasury or leaderboard revenue. Old client copy incorrectly called that payment asset `$SMF`.

This is a pre-launch configuration, not the target economy. New boost purchases are now disabled by default, and the server rejects known stablecoin burns even if purchases are accidentally enabled. Existing confirmed boost balances and consumption continue to work.

## Target boost flow

After the StickLash game token is launched and its exact mint is recorded:

1. The server quotes a boost pack in the game token.
2. The wallet shows one explicit Solana transaction.
3. The transaction atomically transfers 50% to the weekly reward vault and 50% to the operating treasury.
4. The server verifies the signer, mint, total amount, both destinations, and both amounts before crediting boosts.
5. The purchase ledger records the signature and settlement split exactly once.

The initial target contains no burn. Burning boost payments would destroy the same funds intended to support rewards, and adding a third output would make the first economy harder to explain without improving the game.

The 50/50 split applies to verified boost receipts before ordinary offchain operating expenses. Solana network fees remain the purchaser's wallet expense and are not counted as game revenue.

## Reward pool funding

The weekly reward budget has two transparent sources:

- 100% of StickLash creator rewards received from the selected launch platform during the epoch;
- 50% of verified game-token boost revenue, transferred directly during each purchase.

Creator rewards are therefore not the only funding source. Boost revenue is included, but only after the settlement changes from burn to verified transfer. The reward vault balance caps the next finalized epoch; the game never promises rewards that are not already funded.

Any sponsor contribution is recorded as a separate vault deposit. `$ANSEM` holdings and Arena Director privileges do not create a claim on the reward vault.

## Leaderboard separation

### Ranked human leaderboard

The existing PostgreSQL ELO leaderboard remains the skill ranking. A reward-bearing tournament version must additionally require:

- wallet-linked identity;
- server-authoritative match settlement;
- equal fighter rules with purchased boosts disabled;
- a minimum match count and minimum number of unique opponents;
- caps on repeated matches between the same wallets;
- unique match settlement IDs, replay protection, and a fraud-review window.

Raw win count, raw transaction volume, and local browser state are not reward criteria.

The authoritative multiplayer engine currently gives both players the same special-move rules and does not consume purchased boost balances, which is the correct ranked boundary. The present match-complete path still accepts player identity fields from clients, and each current client reports only its own identity. That path must be replaced by identities bound to the room by authenticated server sessions before ELO can become reward-eligible.

### Token Arena leaderboard

Token appearances, wins, losses, market snapshots, and Arena Director selections are entertainment and judge-facing analytics. They do not pay the token issuer or the player automatically.

### Reward eligibility ledger

Reward eligibility is a separate immutable weekly snapshot built only from validated ranked matches. It is not the browser-local token leaderboard and is not a direct query over mutable live ELO rows.

## Weekly distribution

Each weekly epoch follows this order:

1. Close entry at a published timestamp.
2. Freeze the validated match set and reward-vault balance.
3. Calculate final eligible ranks and fixed payout amounts.
4. Publish the snapshot and open a short fraud-review window.
5. Finalize the allocation without increasing the funded budget.
6. Let wallets claim from a verified distributor; unclaimed funds return to a future epoch under a published expiry rule.

A sample top-ten split is 25%, 18%, 14%, 10%, 8%, 7%, 6%, 5%, 4%, and 3%. This is a distribution example, not active production configuration.

## `$ANSEM` utility boundary

The first `$ANSEM` feature is a read-only holder check against the exact official mint. An eligible wallet receives one bounded Arena Director action per day, such as rerolling the selected opponent or nominating a challenger. It does not improve fighter damage, health, or ranked odds.

This keeps `$ANSEM` visible and useful without forcing a second payment token into boost purchases. No mint will be added to code until it is verified from an official source.

## Delivery gates

The implementation sequence is intentionally gated:

1. Expose the real boost-payment asset and settlement status; prevent stablecoin burns.
2. Finalize the ClawPump game-token mint, reward-vault address, and operating-treasury address.
3. Replace the burn transaction and burn verifier with one atomic split-transfer transaction and verifier.
4. Add server-authoritative tournament settlement and a separate reward-eligibility ledger.
5. Add the verified `$ANSEM` holder privilege with a daily server-side usage limit.
6. Run a non-monetary tournament epoch before enabling token claims.

No public copy should claim boost-funded prizes, `$ANSEM` utility, staking, or weekly token payouts before the corresponding gate is implemented and verified on Solana.
