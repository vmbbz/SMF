# StickLash AnsemHack Readiness

Verified on 27 August 2026 against the official AnsemHack page and the current StickLash codebase.

## Entry thesis

**StickLash is an autonomous Solana meme-fight arena.** A market agent watches live trending and newly graduated tokens, explains which opponent deserves the next fight, converts market activity into combat power, and hands the match to an AI fighter. Players can fight the market themselves or watch the agents run the arena.

This keeps the existing StickLash identity and makes the agent load-bearing. The product stops working as designed if the Arena Director is removed: opponent selection, market reasoning, autonomous match scheduling, and the spectator loop all depend on it.

## Verified competition facts

- The event runs from 19 August to 1 October 2026 on Solana.
- Eligibility requires all three actions by 19 September: register the project, publish the generated X announcement and follow `@clawpumptech`, and tokenize on ClawPump or EasyA Kickstart.
- A ClawPump entry is automatically eligible for Overall Winner and can stack the ClawPump x pump.fun and Inference Markets tracks. EasyA Kickstart is an alternative launch surface and cannot be stacked with the ClawPump tracks.
- The current headline pool is $345,000: $250,000 in $ANSEM, $60,000 sponsor cash, and $10,000 compute. Alchemy evaluation credits are an additional eligibility-based benefit rather than guaranteed prize cash.
- Alchemy offers eligible teams an application for up to $25,000 in credits for a 90-day evaluation; approval and terms remain Alchemy's decision.
- Registered teams receive Helius RPC credits for the hackathon period.
- Judges explicitly score builders onboarded, real Solana onchain volume, attention, a net-new live $ANSEM use case, and early deployment.
- Inference Markets requires UsePod inference markets to be load-bearing. Ordinary AI matchmaking or model calls do not satisfy that track by themselves.

Primary sources:

- [Official AnsemHack page](https://clawpump.tech/ansemhack)
- [ClawPump developer documentation](https://clawpump.tech/docs)
- [Alchemy Solana Fund](https://www.alchemy.com/blog/introducing-alchemy-solana-fund)
- [Alchemy Yellowstone gRPC overview](https://www.alchemy.com/docs/reference/yellowstone-grpc-overview)
- [Alchemy Solana DAS APIs](https://www.alchemy.com/docs/reference/alchemy-das-apis-for-solana)

## Current product evidence

StickLash already has a credible foundation:

- The public service and `/health` endpoint are live at `sticklash.fun`.
- The production market endpoint returns current Solana trending-token metrics.
- Birdeye supplies cached trending and newly listed token discovery; DexScreener supplies active-fight token details.
- Market volume, momentum, and liquidity already alter opponent health, damage, and speed.
- Arena Director v0.1 is implemented server-side and drives the first and subsequent Endless opponents with deterministic scoring, reason codes, a visible announcement, and a client-side market-queue fallback.
- The game has AI and behavior-tree fighter controllers, AI-versus-AI simulation, an endless fight loop, voice control, multiplayer, victory sharing, and an Android build.
- Solana wallet ownership is verified server-side, existing boost balances are server-authoritative, and new boost purchases are disabled while the retired burn path is replaced by game-token reward-vault transfers.
- Public ranked now has wallet-bound random matchmaking, immutable Skill/Boosted room policies, separate league/input ELO, server-owned results, idempotent settlement, a Skill paid-special block, and a three-charge Boosted cap.
- Arena Director responses, authoritative multiplayer outcomes, and generated share cards now enter privacy-safe insert-only telemetry. `/api/arena/status` and the Help-linked `/arena` page separate these counters from aggregate wallet sessions and server-verified Solana transaction signatures.
- The backend can use an Alchemy Solana RPC through `SOLANA_RPC`, although the current discovery pipeline is not yet an Alchemy stream.
- The JavaScript test runner is declared and repeatable; the current browser suite exercises the restored landing paths, wallet/session boundaries, AI fallback, WebRTC, and public economy copy.

## Material gaps

- There is no Alchemy Yellowstone consumer, Solana DAS adapter, stream health telemetry, or replay cursor yet.
- There is no registered AnsemHack project identity, verified project X handle, launched ClawPump token, canonical game-token mint, or confirmed $ANSEM mint in configuration.
- The README correctly describes Alchemy as an optional RPC and planned stream; the submission and demo must preserve that boundary until stream evidence exists.
- Browser-local AI and Endless outcomes are not server-attested, so the public page correctly reports Director responses rather than claiming completed "fights directed." Social impressions are also not instrumented; only generated share cards are counted.
- Reward reserves, epoch eligibility, anti-collusion scoring, snapshots, and token claims remain deliberately disabled and unimplemented.
- After all non-breaking npm fixes, the production audit still reports 8 transitive advisories in the Solana Web3/SPL chain; npm's suggested forced resolutions are breaking downgrades and were rejected. The development-only Capacitor 6 CLI also retains `tar` advisories. These require isolated SDK/Capacitor migration testing, not an unsafe `npm audit fix --force`; until then, the CLI must process only trusted project inputs.

## Track strategy

The primary target is **ClawPump x pump.fun**, with automatic consideration for **Overall Winner**. StickLash fits the builder side as a novel agentic market interface and spectator product; it should not claim to be a profitable trading agent.

Inference Markets remains out of scope unless the product later buys, routes, resells, or otherwise makes UsePod inference capacity economically load-bearing. EasyA should only replace ClawPump if the team deliberately gives up stackable ClawPump eligibility.

## Implemented vertical slices: Arena Director and public evidence

The explainable server-side agent, Endless-game integration, insert-only telemetry, and public Arena Status view are implemented. The public evidence model intentionally keeps Director responses, authoritative server rounds, shares, wallet sessions, and verified Solana transactions separate.

### Decision policy

The director merges trending and graduated token candidates, removes duplicates and the current opponent, applies minimum data-quality safeguards, and scores each candidate using:

- 24-hour volume for audience and activity;
- absolute price movement for fight drama;
- liquidity for safety and market depth;
- a graduated-token discovery bonus;
- explicit penalties for missing or thin market data.

Every response includes a decision ID, policy version, timestamp, selected opponent, scored candidates, reason codes, input sources, and fallback state. Selection is deterministic for the same candidate snapshot so it can be tested and explained on stream.

### Runtime flow

```text
Birdeye discovery + DexScreener detail
                 |
                 v
        StickLash Arena Director
        score -> select -> explain
                 |
                 v
        AI fighter executes match
                 |
                 v
     result/share/onchain telemetry
```

The web app and Android bundle use the same director endpoint. If it is unavailable, the existing local trending queue remains a graceful fallback rather than blocking gameplay.

### Implemented acceptance criteria

- A public endpoint returns a versioned, auditable next-opponent decision from live normalized market candidates.
- Duplicate mints and the current opponent cannot be selected.
- Candidate scoring is bounded, deterministic, unit tested, and accompanied by human-readable reasons.
- Empty or failed provider results produce a valid no-candidate response instead of an exception.
- Endless mode calls the director for its first fight and every automatic next fight.
- The selected token still passes through existing detail hydration and market-power scaling.
- The UI visibly identifies the Arena Director's pick without blocking the match.
- Existing market endpoints remain backward compatible.
- Each Director response includes public-safe provider snapshot time, observation time, freshness, fallback state, and telemetry persistence state.
- Authoritative multiplayer outcomes are idempotently recorded without wallet addresses or player names in telemetry tables.
- `/api/arena/status` returns explicit durable or bounded-memory scope, and `/arena` renders missing durable evidence as not available instead of zero.
- Backend tests, JavaScript syntax checks, Capacitor sync, and the Android build pass before release.

## Follow-on architecture

### Alchemy data plane

Use Alchemy in two bounded roles after account approval:

- `SOLANA_RPC` for private server-side transaction verification and standard Solana JSON-RPC.
- A narrow Yellowstone gRPC worker for relevant pump.fun and token activity, with filtered subscriptions, reconnect backoff, replay from the last processed slot, and no browser-exposed API key.

Alchemy's generic Token API documentation is EVM-oriented. For Solana metadata and fungible assets, use the Solana DAS endpoints or standard Solana RPC methods instead. Alchemy documentation currently differs on Yellowstone plan prerequisites, so account entitlement must be confirmed before gRPC becomes a release dependency.

The stream should enrich the director; it should not replace Birdeye/DexScreener until observed coverage and failover behavior are proven.

### Judge-facing evidence

Implemented: Director responses and authoritative multiplayer outcomes are stored in insert-only PostgreSQL tables with provider timestamps, fallback state, selected market metrics, and idempotent round identities. Share-card creation is recorded in its own insert-only table. Existing wallet sessions are exposed only as aggregates, and only signatures already accepted by the server's Solana verification ledger appear as onchain evidence.

The public `/arena` page and `/api/arena/status` endpoint disclose whether evidence is durable PostgreSQL data or bounded current-process memory. Browser-local AI fights are excluded from match totals, Director responses are not called completed fights, share cards are not called impressions, wallet sessions are not called paying users, and missing onchain evidence is not coerced to zero. See [Arena Telemetry and Public Evidence](docs/ARENA_TELEMETRY.md).

### Token utility boundary

The game token and `$ANSEM` have separate jobs. The launched StickLash token will pay for boost packs, with 100% of verified receipts entering the game-token reward reserve. Bounded Arena Director actions will spend `$ANSEM` into a separate `$ANSEM` reward reserve without changing human ranked combat power.

Confirmed creator-fee SOL follows a separate 50/50 flow: 50% operations and infrastructure, 50% reserved for market purchases of `$ANSEM` that enter the `$ANSEM` reward reserve. Competitive budgets are split 70% to an equal-power Skill Championship and 30% to a separate Boosted League capped at three paid boost charges per player per match. See [Economy, Leagues, Leaderboards, and Rewards](docs/ECONOMY_AND_REWARDS.md) for the full decision and delivery gates.

Do not implement staking, dual-token boost payments, burns, or unattended token distributions. Do not configure an `$ANSEM` mint until it is verified from an official source. Every value-moving action must use an authorized treasury or explicit user-wallet approval and independent server-side transaction verification.

## Delivery sequence

Completed foundations:

1. Arena Director v0.1 selects and explains Endless opponents with a tested fallback.
2. Repeatable JavaScript tests and explicit web-to-Android asset sync are configured.
3. Wallet-bound, server-authoritative Skill and Boosted ranked settlement is implemented; token rewards remain off.
4. Privacy-safe insert-only Arena Director, authoritative-match, and share telemetry is implemented with durable/fallback disclosure.
5. The Help-linked `/arena` status page exposes honest judge-facing counters and verified-transaction links without leaking wallet or room identities.

Next work, in order:

1. Register the project and apply for Alchemy and Helius credits through the official flows; these are human account actions.
2. Add the Alchemy provider behind the normalized market interface and prove reconnect, replay, fallback, and stream-health telemetry.
3. Rehearse the `/arena` evidence page in a stream-ready 15-minute demo without seeding counters.
4. Finalize both token identities and reserve accounts, then replace the retired burn path with the documented 100% game-token reward-vault transfer.
5. Add the creator-fee SOL allocation ledger and execute one operator-approved `$ANSEM` market purchase before considering automation.
6. Add one bounded, visible `$ANSEM` Arena Director spend after verifying the official mint.
7. Build the epoch-only eligibility snapshot and anti-collusion rules on top of the completed ranked settlement, run a non-monetary epoch, and publish the dry-run evidence.
8. Add an audited claim path and enable deliberately small funded claims only after all reserve and dry-run gates pass.
9. Freeze the submission build early enough to collect real usage, shares, and verified onchain evidence before 19 September.

## Demo story

The 15-minute stream should show four things in order: the live Solana market entering the director, an explainable opponent decision, an AI-controlled fight whose stats derive from that market snapshot, and a verifiable player action or share. The close should show real metrics and transaction links, then explain token utility and the post-hackathon product path without claiming unimplemented volume or rewards.
