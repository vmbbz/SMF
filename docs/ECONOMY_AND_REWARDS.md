# StickLash Economy, Leagues, Leaderboards, and Rewards

Status: approved product architecture for the AnsemHack build.

Policy version: `2026-08-27.v3`.

Implementation status: the wallet-bound public ranked foundation is implemented: explicit Skill and Boosted match types, isolated ratings by league and input division, server-owned final results, idempotent settlement, Skill boost blocking, and the three-charge Boosted cap. Token purchases, creator-fee routing, `$ANSEM` actions, reward epochs, and token claims are **not live**.

## Executive decision

StickLash uses four assets or systems, each with one clear job:

| Asset or system | Job |
|---|---|
| Creator-fee SOL | Funds operations and market purchases of `$ANSEM` |
| StickLash game token | Buys gameplay boosts and funds the game-token reward reserve |
| `$ANSEM` | Pays for bounded Arena Director actions and funds the `$ANSEM` reward reserve |
| Server-authoritative ELO | Ranks validated competitive results; spending is never leaderboard score |

USDC has no role in the target economy. There is no staking, governance, revenue-share claim, dual-token boost price, or token burn in the first release.

The central rule is simple: **money may change the experience in the modes that explicitly allow it, but it must not silently corrupt the main skill competition.**

## Why this design

The design solves four different product needs without forcing one token to do everything:

1. The game token needs direct, repeatable product demand. It is therefore the only token used to buy boost packs.
2. `$ANSEM` needs a visible, net-new use case and real market activity. Creator-fee SOL buys `$ANSEM`, and Arena Director actions spend `$ANSEM`.
3. Players need credible competition. The main Skill Championship has standardized power and no purchased boosts.
4. The game needs revenue to operate. Half of the creator-fee SOL is reserved for infrastructure and operations.

This is intentionally not a maximal-mechanism token economy. More staking pools, burns, payment tokens, and reward formulas would add explanations and failure modes without making the fighting game better.

## Exact asset flows

### 1. Creator-fee SOL

ClawPump currently documents that 65% of pump.fun creator-vault trading fees is distributed to the registered creator payout wallet. StickLash's internal 50/50 policy applies only to the creator share that StickLash actually receives; it does not apply to the platform's full fee amount.

```text
Confirmed creator-fee SOL received by StickLash
                    |
          +---------+---------+
          |                   |
          v                   v
  50% operations       50% $ANSEM acquisition
  and infrastructure   reserve
                              |
                              v
                   scheduled market buys
                              |
                              v
                    $ANSEM reward reserve
```

Rules:

- Allocation is calculated from confirmed incoming creator-fee SOL deposits.
- 50% remains available for servers, data providers, security, media, and ordinary business operations.
- 50% is restricted to acquiring `$ANSEM` through the market for the `$ANSEM` reward reserve.
- Failed or deferred swaps remain in the `$ANSEM` acquisition reserve; they do not silently become operating funds.
- The split and resulting transaction signatures must be recorded in an append-only treasury ledger.
- Network fees and swap fees are reported separately instead of being hidden inside either 50% allocation.

### 2. Game-token boost purchases

```text
Player approves game-token boost purchase
                    |
                    v
       100% game-token transfer
                    |
                    v
        game-token reward reserve
                    |
                    v
       funded weekly reward budgets
```

Rules:

- Boost packs are priced and paid only in the launched StickLash game token.
- 100% of the boost payment enters the game-token reward reserve.
- No part of a boost payment is burned or routed to the operating treasury in the first release.
- A player receives boosts only after the server verifies the signer, exact game-token mint, destination reserve account, amount, finality, and unused transaction signature.
- Existing boost balances can continue to be consumed while new purchases remain disabled.

This creates a direct loop: players use the game token for gameplay, and competitive players can earn game tokens from a reserve funded by that use.

### 3. `$ANSEM` utility spends

`$ANSEM` is not a second boost-payment token. It pays for bounded, non-ranked Arena Director actions such as:

- rerolling the next AI token opponent;
- nominating a token for the public challenger queue;
- sponsoring a clearly labelled showcase fight.

```text
Creator-fee SOL buys + Arena Director action spends
                         |
                         v
               $ANSEM reward reserve
                         |
                         v
              funded weekly rewards
```

Arena Director actions must have server-side per-wallet limits. They may influence public AI programming and entertainment, but they may not change a human player's health, damage, matchmaking, ELO, or reward eligibility.

The exact official `$ANSEM` mint must be verified from an authoritative source before it is configured. No guessed mint is acceptable.

## Is StickLash boost-to-win?

One mode is deliberately **boost-enabled**. The whole game is not pay-to-win.

Paid combat power becomes unacceptable when it is hidden, unlimited in the main ranked mode, or directly converted into leaderboard points. StickLash avoids those conditions through explicit league separation:

| Mode | Purchased boosts | Ranking | Weekly token rewards |
|---|---:|---|---:|
| Casual Arena | Allowed; no competitive cap required | None | 0% |
| Boosted League | Allowed; maximum 3 paid boost charges per player per match | Separate validated ELO | 30% |
| Skill Championship | Disabled; standardized competitive loadout | Main validated ELO | 70% |

The Boosted League is an opt-in format where resource strategy is part of the contest. Its controls are:

- a visible "boost-enabled" label before entry;
- a hard server-enforced limit of 3 paid boost charges per player per match;
- a separate rating and match history from the Skill Championship;
- no leaderboard points for spending, transaction volume, or number of boosts purchased;
- no transfer of boosted results into the Skill Championship rating;
- the smaller 30% share of each weekly competitive reward budget.

The Skill Championship remains the main prestige competition and receives 70% of each weekly competitive reward budget. Wallet size cannot improve fighter power there.

## What a boost is

A purchased boost is a consumable special-action charge, not a permanent fighter-stat purchase. The current game uses boost units as Hadouken ammunition. The authoritative multiplayer engine now blocks paid specials entirely in Skill Championship and enforces a maximum of three successful paid-charge consumptions for each fighter in a Boosted League match. A rejected, mistimed, or disallowed attempt does not become leaderboard score. Permanent health, damage, or speed purchases are outside this architecture.

## Leaderboards are rankings, not funding sources

The leaderboard answers **who placed where**. The two reward reserves answer **what is available to distribute**. These concepts must never be collapsed.

### Skill Championship leaderboard

- Standardized combat rules; purchased boosts disabled.
- Main competitive ELO.
- Receives 70% of the pre-funded game-token epoch budget and 70% of the pre-funded `$ANSEM` epoch budget.

### Boosted League leaderboard

- Maximum 3 paid boost charges per player per match.
- Separate competitive ELO.
- Receives 30% of the pre-funded game-token epoch budget and 30% of the pre-funded `$ANSEM` epoch budget.

### Casual and token analytics

Casual wins, browser-local token fights, token appearances, Arena Director selections, transaction volume, and social shares can be displayed as entertainment or hackathon analytics. They do not create reward eligibility.

## Exactly how a player earns

There are two different meanings of "earn," and the product must never blur them:

- **Available now:** a player can earn a place in the public ranked standings by changing their server-authoritative ELO.
- **Not available now:** no fight earns, accrues, reserves, or promises game tokens or `$ANSEM`. Token earning starts only after a funded reward epoch is explicitly announced.

The current public-ranked journey is:

1. Connect a Solana wallet.
2. Sign the free StickLash sign-in message. This proves wallet control without transferring tokens.
3. Choose Skill Championship or Boosted League and an allowed input division.
4. Enter public matchmaking. StickLash randomly pairs the wallet with another online human; the player does not select a friend or target wallet.
5. The server binds both wallet identities and the immutable league policy to the room, runs the authoritative match, freezes the final result, and settles one idempotent ELO update.
6. The result changes only the matching league and input-division standings. It does not trigger a token payout.

What counts is intentionally narrow:

| Fight path | Ranked ELO now | Candidate for a future reward epoch | Reason |
|---|---:|---:|---|
| Public Ranked - Skill Championship | Yes | Yes, after epochs launch | Random wallet-authenticated human opponent under equal-power rules |
| Public Ranked - Boosted League | Yes, separate ELO | Yes, after epochs launch | Random wallet-authenticated human opponent under the disclosed three-charge cap |
| Private friend or invite room | No | No | Chosen opponents make farming and collusion too easy |
| AI, LLM, token, Trending, or Endless fight | No | No | Practice and entertainment cannot manufacture competitive rewards |
| AI practice while waiting for matchmaking | No | No | It is a local practice fight, not the queued human match |

When reward epochs are eventually enabled, the earning journey adds these steps:

7. StickLash announces the epoch window, eligible leagues and input divisions, funded game-token and `$ANSEM` budgets, minimum participation rules, and placement curve **before** play starts.
8. At close, the server freezes the eligible match set and calculates an epoch-only rating from those matches. Every entrant starts the epoch calculation from the same seed; lifetime ELO remains a prestige and matchmaking rating, not a permanent weekly payout advantage.
9. Ineligible, duplicate, replayed, impossible, or abuse-linked matches are excluded with recorded reasons. A review window opens before anything is claimable.
10. Final qualified placements receive allocations from both independently funded reserves. The wallet explicitly claims; StickLash never signs for the user or treats a leaderboard row as a guaranteed balance.

There is deliberately **no per-win token payment**. Per-win payouts invite bot loops, repeated-pair farming, and open-ended liabilities. An epoch converts a bounded set of validated results into a bounded, pre-funded placement budget instead.

The first dry run will test these proposed safeguards before they become launch rules: at least 5 validated matches, at least 3 unique opponent wallets, and no more than the first 2 matches against the same opponent counting toward the epoch score. These numbers are **proposed dry-run parameters, not live code or promised final rules**. The dry run must also determine which input divisions have enough real participation to receive a separately published budget; divisions cannot be added, removed, or reweighted after a funded epoch begins.

## Reward-reserve accounting

StickLash maintains two token-denominated reserves:

| Reserve | Inflows | Outflows |
|---|---|---|
| Game-token reward reserve | 100% of verified game-token boost purchases; explicitly labelled sponsor deposits | Finalized game-token claims |
| `$ANSEM` reward reserve | Verified `$ANSEM` market buys; `$ANSEM` Arena Director spends; explicitly labelled sponsor deposits | Finalized `$ANSEM` claims |

The tokens are not mixed and are not automatically converted into one another. A player can receive both assets from the same final placement, but each amount is calculated from its own funded reserve.

An epoch budget is fixed in token units before its competition window opens. It must never exceed the confirmed, spendable balance in its reserve. The policy promises neither a dollar value nor a fixed yield.

For each token's finalized weekly budget:

- 70% is assigned to the Skill Championship;
- 30% is assigned to the Boosted League;
- 0% is assigned to Casual Arena.

A candidate top-ten placement curve is 25%, 18%, 14%, 10%, 8%, 7%, 6%, 5%, 4%, and 3% within each league allocation. This curve remains a proposed launch parameter until a dry-run epoch verifies that it produces sensible results.

## Reward eligibility and anti-abuse

The current ranked settlement path is payout-safety groundwork, not a payout system. It now provides wallet-bound rooms, immutable match metadata, server-owned outcomes, unique match IDs, atomic idempotent ELO settlement, isolated league/input ratings, and server-enforced boost policy. A reward-bearing epoch still requires a separate immutable eligibility snapshot and review process.

Implemented competitive controls:

- wallet-linked, authenticated player identity bound to the room by the server;
- server-authoritative match start, loadout, boost consumption, and final result;
- one unique settlement ID per match and idempotent result processing;
- one active ranked queue or match reservation per wallet;
- separate Skill and Boosted match types, histories, and input-division ratings;
- paid-special rejection in Skill and a three-charge server cap in Boosted;
- public client acknowledgements that can retry a stored server outcome but cannot submit a winner, health, wallet identity, or rating.

Still required before rewards:

- minimum matches and minimum unique opponents per epoch;
- caps or diminishing eligibility for repeated wallet pairs;
- disconnect, timeout, replay, collusion, and impossible-input checks;
- Sybil and sanctions/compliance review appropriate to the final launch jurisdictions;
- pre-published league and input-division token budgets;
- an epoch-only scoring calculation reproducible from the frozen match set;
- a published review window before claims open.

## Weekly distribution lifecycle

1. Publish the epoch start, close time, rules, active league/input divisions, and token-unit budgets.
2. Close entry and freeze the validated match set.
3. Recompute epoch-only ratings and eligibility from that frozen set; lifetime matchmaking ELO is not the payout score.
4. Apply the 70/30 league allocation independently to both token budgets, then use only the input-division allocations published before the epoch.
5. Calculate the placement curve without increasing either funded budget. Exact ties share the combined allocations of the tied places rather than being broken by spending or social activity.
6. Publish the snapshot, reserve balances, calculations, and excluded-match reasons.
7. Open a short fraud-review window.
8. Finalize a claim manifest with a unique epoch identifier.
9. Let eligible wallets claim through a verified distributor.
10. Roll expired, unclaimed allocations into a future epoch under a published rule.

No backend may claim tokens for a user, hold a user's private key, or bypass explicit wallet approval where a wallet signature is required.

## Treasury and swap controls

The first creator-fee allocation should be observable and operator-approved rather than an unattended hot-wallet bot.

Before `$ANSEM` purchases begin:

- verify and record the exact `$ANSEM` mint;
- use a dedicated treasury or multisig, not an application server key;
- reconcile creator-fee deposits before allocating them;
- batch small receipts to avoid wasteful transactions;
- request an exact-input market quote with a configured slippage ceiling;
- reject stale quotes and excessive price impact;
- restrict intermediate tokens and verify the quoted input/output mints;
- require an operator or multisig signer to approve execution;
- verify finality and actual token receipt before crediting the reserve ledger;
- publish transaction signatures and token amounts without exposing secrets.

Automation can be considered only after the manual, auditable process has run safely.

## Current implementation state

| Component | State on 27 August 2026 |
|---|---|
| Solana game and wallet network | Live |
| Existing boost balance and consumption ledger | Implemented |
| New boost purchases | Disabled |
| Legacy burn settlement | Retired by policy; not a valid target settlement |
| Game-token reward-vault transfer verifier | Not implemented |
| Explicit private, Skill, and Boosted match types | Implemented |
| Wallet-authenticated public matchmaking | Implemented |
| One active ranked queue or match per wallet | Implemented with Redis reservation and TTL recovery |
| Server-owned immutable ranked result | Implemented |
| Atomic, idempotent ELO settlement | Implemented; requires PostgreSQL in deployed multiplayer runtime |
| Separate league and input-division ratings | Implemented |
| Skill paid-special block and Boosted three-charge cap | Implemented in the authoritative engine |
| Reward-eligibility snapshot | Not implemented |
| Epoch-only reward score and anti-collusion filters | Not implemented |
| Creator-fee SOL allocation ledger | Not implemented |
| `$ANSEM` acquisition execution | Not implemented |
| `$ANSEM` Arena Director spend | Not implemented |
| Token reward claims | Not implemented |
| Public economy policy endpoint and Help-linked site page | Implemented |

No public copy may describe an unimplemented row as active.

## Delivery gates

### Gate 0 - policy and safety baseline (complete)

- Publish this architecture and the public Economy & Rewards page.
- Expose a read-only runtime policy endpoint.
- Keep purchases and claims disabled.
- Reject all legacy burn settlement attempts.

### Gate 1 - canonical identities and accounts (pending)

- Launch and verify the StickLash game-token mint.
- Verify the official `$ANSEM` mint.
- Configure dedicated game-token and `$ANSEM` reward reserves.
- Configure the creator-fee payout and operating treasury accounts.
- Publish account labels and ownership controls.

### Gate 2 - game-token boost settlement (pending)

- Replace the client burn builder with a game-token transfer to the reward reserve.
- Replace burn verification with exact destination-transfer verification.
- Migrate database field names away from legacy `smf` and `burn` terminology.
- Run a minimal-value mainnet verification before enabling catalog purchases.

### Gate 3 - league integrity (complete)

- Explicit `private_casual`, `ranked_boosted`, and `ranked_skill` match types are immutable room metadata.
- Authenticated Solana wallets are bound to public ranked rooms and cannot occupy concurrent queues or matches.
- Skill Championship blocks paid special consumption.
- Boosted League enforces the 3-charge per-player limit in the authoritative engine.
- Unique match IDs and immutable server outcomes settle ELO atomically and idempotently.

### Gate 4 - reserves and creator-fee routing (pending)

- Add append-only reserve and creator-fee allocation ledgers.
- Reconcile the first creator-fee SOL deposit manually.
- Execute the first operator-approved `$ANSEM` purchase with published evidence.
- Verify the `$ANSEM` receipt before reserve credit.

### Gate 5 - `$ANSEM` product utility (pending)

- Add one bounded Arena Director action.
- Route its verified `$ANSEM` payment to the `$ANSEM` reward reserve.
- Enforce per-wallet limits and keep the action outside competitive combat.

### Gate 6 - rewards dry run and claims (pending)

- Run at least one non-monetary epoch using the complete eligibility pipeline.
- Recompute epoch-only ratings from eligible matches and verify repeated-pair exclusions.
- Publish active input divisions and their fixed budgets before the dry-run window.
- Publish the dry-run snapshot and resolve observed abuse cases.
- Fund deliberately small token budgets.
- Audit the claim manifest and distributor.
- Enable claims only after all prior gates pass.

## Launch acceptance criteria

The economy is ready for a token-valued competitive epoch only when all of the following are true:

- both token mints and both reserve accounts are verified;
- USDC and burns are absent from boost purchase construction and verification;
- each value-moving path is idempotent and independently verifiable on Solana;
- Skill and Boosted League results cannot affect one another;
- boost spending cannot directly add leaderboard points;
- both epoch budgets are fully funded before competition starts;
- reserve inflows, allocations, claims, and unclaimed rollovers reconcile exactly;
- the public page accurately reflects live feature flags;
- terms, eligibility, tax, and jurisdictional requirements have been reviewed for the intended launch.

## Public-source basis

- ClawPump documentation: <https://clawpump.tech/docs>
- Official AnsemHack page: <https://clawpump.tech/ansemhack>
- Jupiter swap API reference: <https://developers.jup.ag/docs/api-reference/swap/v1/quote>

These sources describe external platform behavior. The 50/50 creator-fee allocation, 100% game-token boost reserve, 70/30 league allocation, and three-charge Boosted League limit are StickLash product decisions.
