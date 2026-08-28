# StickLash AnsemHack Readiness

Verified on 28 August 2026 against the official AnsemHack page and the current StickLash codebase.

## Entry thesis

**StickLash is an autonomous Solana meme-fight arena.** A market agent watches live trending and newly graduated tokens, explains which opponent deserves the next fight, converts market activity into combat power, and hands the match to an AI fighter. Players can fight the market themselves or watch the agents run the arena.

This keeps the existing StickLash identity and makes the agent load-bearing. The product stops working as designed if the Arena Director is removed: opponent selection, market reasoning, autonomous match scheduling, and the spectator loop all depend on it.

## Verified competition facts

- The event runs from 19 August to 1 October 2026 on Solana.
- Eligibility requires all three actions by 19 September: register the project, publish the generated X announcement and follow `@clawpumptech`, and tokenize on ClawPump or EasyA Kickstart.
- A ClawPump entry is automatically eligible for Overall Winner and can stack the ClawPump x pump.fun and Inference Markets tracks. EasyA Kickstart is an alternative launch surface and cannot be stacked with the ClawPump tracks.
- The official page's $345,000 headline combines $250,000 in `$ANSEM`, $60,000 in sponsor cash, $10,000 in UsePod compute, and up to $25,000 in Alchemy credits. The Alchemy component is application- and approval-based infrastructure credit, not guaranteed prize cash.
- Alchemy offers eligible teams an application for up to $25,000 in credits for a 90-day evaluation; approval and terms remain Alchemy's decision.
- Alchemy does **not** have a separate judged prize track or an Alchemy-specific winner in the published award list. Its credits are a sponsor benefit, and Alchemy is represented on the shared judging panel.
- Registered teams receive Helius RPC credits for the hackathon period.
- Judges explicitly score builders onboarded, real Solana onchain volume, attention, a net-new live $ANSEM use case, and early deployment.
- Inference Markets requires UsePod inference markets to be load-bearing. Ordinary AI matchmaking or model calls do not satisfy that track by themselves.

Primary sources:

- [Official AnsemHack page](https://clawpump.tech/ansemhack)
- [ClawPump developer documentation](https://clawpump.tech/docs)
- [Alchemy Solana Fund](https://www.alchemy.com/blog/introducing-alchemy-solana-fund)
- [Alchemy Solana Fund application](https://www.alchemy.com/solana-20m-fund)
- [Alchemy Yellowstone gRPC overview](https://www.alchemy.com/docs/reference/yellowstone-grpc-overview)
- [Alchemy Solana DAS APIs](https://www.alchemy.com/docs/reference/alchemy-das-apis-for-solana)

### Awards versus sponsor benefits

| Opportunity | Can StickLash win it? | Entry treatment |
|---|---:|---|
| Overall Winner | Yes | Automatic for every eligible ClawPump entry |
| ClawPump x pump.fun | Yes | Select as the primary judged track and tokenize on ClawPump |
| Inference Markets | Not with the current architecture | Select only if UsePod inference markets become load-bearing |
| EasyA Kickstart | Only as an alternative | Cannot be combined with the ClawPump tracks |
| Alchemy Solana credits | **No; there is no Alchemy award** | Apply separately; approval may provide up to $25,000 in credits valid for 90 days |
| Helius RPC credits | Registration benefit, not an award | Unlock through the registered-team flow |

Alchemy should still be prominent in the submission because it supplies real,
auditable infrastructure and an Alchemy representative participates in the
shared judging panel. It must not be presented as a fifth prize track, and a
credit approval must not be described as a hackathon win.

## Current product evidence

StickLash already has a credible foundation:

- The public service is deployed directly from `main` to Render, and the `/health` endpoint is live at `sticklash.fun`; the repository's retired Fly.io workflow is not part of production.
- The production `/api/marketfeed/v2/trending-scan` endpoint returned HTTP 200 with 16 current Solana trending-token records during the 28 August audit.
- Birdeye supplies cached trending and newly listed token discovery; DexScreener supplies active-fight token details.
- Market volume, momentum, and liquidity already alter opponent health, damage, and speed.
- Arena Director v0.2.1 is implemented server-side and drives the first and subsequent Endless opponents with deterministic scoring, reason codes, a visible announcement, and a client-side market-queue fallback. A fresh Alchemy candidate-activity signal can add at most eight logarithmically weighted points and reaches that cap at 31 distinct confirmed observations.
- The game has AI and behavior-tree fighter controllers, AI-versus-AI simulation, an endless fight loop, voice control, multiplayer, victory sharing, and an Android build.
- Solana wallet ownership is verified server-side, existing boost balances are server-authoritative, and new boost purchases are disabled while the retired burn path is replaced by game-token reward-vault transfers.
- Public ranked now has wallet-bound random matchmaking, immutable Skill/Boosted room policies, separate league/input ELO, server-owned results, idempotent settlement, a Skill paid-special block, and a three-charge Boosted cap.
- Arena Director responses, authoritative multiplayer outcomes, and generated share cards now enter privacy-safe insert-only telemetry. `/api/arena/status` and the Help-linked `/arena` page separate these counters from aggregate wallet sessions and server-verified Solana transaction signatures.
- The backend can use an Alchemy Solana RPC through `SOLANA_RPC`. A separate server-only free-tier adapter polls confirmed candidate activity every 180 seconds with a durable score-complete-cycle cursor, bounded rewind, overlap dedupe, distinct-signature score saturation, exact/lower-bound count labels, truncation gates, Birdeye fallback, and public health/cost evidence. Optional PubSub and paid Yellowstone remain explicit later transports.
- The JavaScript test runner is declared and repeatable; the current browser suite exercises the restored landing paths, wallet/session boundaries, AI fallback, WebRTC, and public economy copy.

## Material gaps

The gaps below are ordered by consequence. Optional sponsor upgrades are kept
separate from eligibility and production blockers.

### Deadline and eligibility blockers

- No AnsemHack registration receipt or public StickLash entry has been recorded. Registration is only one of three requirements; the project must also publish the generated X announcement, follow `@clawpumptech`, and tokenize by 19 September 2026.
- The official project X identity is still intentionally blank in the product. The hackathon requires a reachable project X handle, and the same handle must verify the tokenized entry. A handle must therefore be selected before registration; `[@]` cannot satisfy this external requirement.
- No launched ClawPump token or token link has been recorded. The canonical StickLash game-token mint consequently remains unset.
- The Alchemy Solana Fund form has been prepared, but submission, approval, credit amount, redemption, and activation are not yet evidenced. Alchemy credits are useful infrastructure support, not an eligibility substitute or prize-track entry.
- Helius hackathon credits have not been activated; the official page says they unlock for registered teams, so this follows registration.

### Production-proof gap

- Commit `bfec907` is deployed from `main`. Production `/health` returned HTTP 200, `/api/arena/status` reported schema `2026-08-28.v9` with durable PostgreSQL persistence, and the restarted process restored its durable Alchemy cursor at slot `442434693`.
- The first two recovered v9 cycles used 16 active candidates, advanced the cursor from the restored slot through `442436791` to `442437355`, and both completed with exact-window semantics and zero candidate failures or truncations. Their rolling-window counts changed naturally from 96 to 63 distinct confirmed observations as old signatures aged out; those observations are not trades, users, or USD volume.
- One controlled Director request moved only `decisionsReturned` and `selectedDecisions` from 23 to 24. Authoritative matches, shares, and wallet sessions remained zero; the fresh durable decision identified `alchemy_solana_http_candidate_activity` as an input source.
- Documentation commit `ea9bc9d` then triggered a controlled production restart. The new process retained all 24 durable Director decisions, restored the prior cursor at `442437355`, requested from `442437323`—the configured 32-slot rewind—and advanced to `442437835` in one fresh exact-window cycle with 16 active candidates and zero failures or truncations.
- Cold-start candidate acquisition is still memory-dependent. A Birdeye HTTP 429 left the restarted worker at `waiting_for_candidates` until the market cache recovered and the next 180-second refresh ran. Persisting the last valid candidate set, or adding a bounded startup retry independent of the normal cadence, remains a production-resilience gap.
- Explicit duplicate-stability evidence and a controlled Birdeye-failover exercise still need to be captured. Unit and integration tests cover these policies, but the readiness file must distinguish test proof from production proof.
- The deployed Alchemy app did not support the tested WebSocket heartbeat methods. Production may claim bounded Alchemy HTTP candidate-activity evidence only—not PubSub, a live WebSocket stream, Yellowstone, or native replay.

### Traction and judge-facing evidence gap

- After the controlled proof request, the durable public counters showed 24 selected Director responses but zero authoritative multiplayer rounds, ranked rounds, generated share cards, wallet sessions, unique authenticated wallets, and verified transactions. These zeros must not be seeded. Real playtests, shares, wallet sessions, and later verified product transactions are needed to demonstrate usage and attention.
- Browser-local AI, Trending, Endless, and Token Exhibition outcomes are not server-attested. The public page therefore reports Director responses rather than claiming completed "fights directed." Social impressions and clicks are also not instrumented; only generated share cards can currently be counted.

### Token and reward-system gap

- The official `$ANSEM` mint is not verified in configuration. The game-token reward reserve, `$ANSEM` reward reserve, creator-fee payout wallet, and operating treasury are also unset.
- Game-token boost transfers, creator-fee allocation, `$ANSEM` market purchases, bounded `$ANSEM` Director actions, funded reward epochs, anti-collusion eligibility, snapshots, manifests, and claims remain deliberately disabled or unimplemented. Current ranked play changes ELO only and promises no token payout.
- The submission must preserve the published separation between Skill Championship and Boosted League, and between leaderboard placement and pre-funded reward reserves. No unimplemented economy mechanism may be described as live.

### Security and dependency debt

- The current production dependency audit reports 8 advisories in the Solana Web3/SPL dependency chain: 5 moderate and 3 high. npm's advertised fixes are breaking downgrades and must not be applied with `npm audit fix --force`.
- The full development audit adds one high and one critical advisory through Capacitor 6 CLI's `tar` chain. Capacitor requires an isolated major-version migration; until then, its CLI must process trusted project inputs only.

### Optional upgrades, not current blockers

- Solana DAS metadata enrichment is not implemented. It may improve token metadata quality but is not required for AnsemHack eligibility or the existing market-fighter loop.
- Alchemy Yellowstone gRPC remains a credit-funded or paid evaluation path. It would improve latency and native replay evidence, but the bounded HTTP implementation is the honest no-payment production path today.

## Track strategy

The primary target is **ClawPump x pump.fun**, with automatic consideration for **Overall Winner**. StickLash fits the builder side as a novel agentic market interface and spectator product; it should not claim to be a profitable trading agent.

Inference Markets remains out of scope unless the product later buys, routes, resells, or otherwise makes UsePod inference capacity economically load-bearing. EasyA should only replace ClawPump if the team deliberately gives up stackable ClawPump eligibility.

Alchemy is an infrastructure and evidence strategy, not a selectable award
strategy. The strongest credible use is to show that a sponsor integration is
already a real bounded input to the Arena Director, publish its health and failover
evidence, and use approved credits to evaluate Yellowstone without making the
paid transport a release dependency.

## Registration-ready copy

### Alchemy Solana Fund application

- **Company:** `StickLash`
- **Website:** `https://www.sticklash.fun/`
- **Current provider:** select Alchemy when available; otherwise use
  `Alchemy Solana HTTP RPC + Birdeye market data`
- **Telegram and promo code:** leave blank unless an official project value exists

Project and infrastructure description:

> StickLash is an agentic Solana meme-token fighting game being prepared for
> AnsemHack. Birdeye discovers trending and graduated tokens and supplies market
> data, while our explainable Arena Director converts volume, price movement,
> liquidity, and bounded Alchemy-confirmed candidate activity into auditable
> opponent selections and combat stats. Players can fight market-driven AI
> opponents or spectate autonomous token-versus-token exhibitions, and our
> public Arena Status page reports provider provenance, freshness, recovery, and
> usage evidence.
>
> We currently use Alchemy Solana HTTP RPC in production for bounded
> confirmed-activity polling with PostgreSQL cursoring, rewind recovery,
> signature deduplication, rate-limit retries, and Birdeye failover. We are
> requesting credits to support hackathon and launch traffic and to evaluate
> Alchemy Yellowstone gRPC and lower-latency Solana infrastructure during the
> 90-day evaluation. Website: https://www.sticklash.fun/ — Source:
> https://github.com/vmbbz/SMF

### AnsemHack registration

- **Project name:** `StickLash`
- **Project X handle:** required and still unresolved; do not invent one
- **Ticker:** leave blank until the canonical token is launched
- **Website:** `https://www.sticklash.fun/`
- **Token link:** leave blank until launch, then attach it through the official entry flow
- **Track:** select `ClawPump x pump.fun`; Overall Winner is automatic
- **Do not select:** Inference Markets without a load-bearing UsePod design;
  EasyA Kickstart while pursuing the ClawPump track

One-line project description:

> StickLash is an autonomous Solana meme-fight arena where an explainable market
> agent selects live token opponents from Birdeye and Alchemy evidence, turns
> market stats into combat power, and lets players fight or spectate
> AI-controlled token battles.

## Implemented vertical slices: Arena Director, Alchemy adapter, and public evidence

The explainable server-side agent, Endless-game integration, insert-only telemetry, and public Arena Status view are implemented. The public evidence model intentionally keeps Director responses, authoritative server rounds, shares, wallet sessions, and verified Solana transactions separate.

### Decision policy

The director merges trending and graduated token candidates, removes duplicates and the current opponent, applies minimum data-quality safeguards, and scores each candidate using:

- 24-hour volume for audience and activity;
- absolute price movement for fight drama;
- liquidity for safety and market depth;
- a graduated-token discovery bonus;
- explicit penalties for missing or thin market data;
- a fresh, logarithmic Alchemy bonus capped at eight points for recent confirmed transactions mentioning a candidate mint; 31 distinct observations prove that maximum.

Alchemy activity is intentionally subordinate to the market fundamentals. It can break a close race but cannot replace Birdeye discovery, establish price/volume, or keep scoring after the stream becomes stale.

Every response includes a decision ID, policy version, timestamp, selected opponent, scored candidates, reason codes, input sources, and fallback state. Selection is deterministic for the same candidate snapshot so it can be tested and explained on stream.

### Runtime flow

```text
Birdeye discovery + DexScreener detail
                 |            Alchemy Solana HTTP polling
                 |            bounded confirmed activity
                 |                    |
                 v                    v
        StickLash Arena Director v0.2.1
        base score + bounded bonus -> select -> explain
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
- The default Alchemy worker uses one confirmed `getSlot` plus one bounded `getSignaturesForAddress` request per candidate every 180 seconds; its key never enters browser or Android assets.
- Score-complete cycles rewind a persisted slot, clamp history, deduplicate overlap, and expose cursor durability, score coverage, full-window enumeration state, saturation, truncation, sanitized reliability counters, and compute-unit estimates without claiming a live subscription or native replay.
- Stale, partial, or unavailable Alchemy evidence contributes no score and cannot block Birdeye-based Director selection.
- Authoritative multiplayer outcomes are idempotently recorded without wallet addresses or player names in telemetry tables.
- `/api/arena/status` returns explicit durable or bounded-memory scope, and `/arena` renders missing durable evidence as not available instead of zero.
- Backend tests, JavaScript syntax checks, Capacitor sync, and the Android build pass before release.

## Follow-on architecture

### Alchemy data plane

The code supports Alchemy in four bounded roles:

- `SOLANA_RPC` for private server-side transaction verification and standard Solana JSON-RPC.
- A free-tier Solana HTTP worker for current candidate activity, with bounded confirmed requests, durable cursoring, signature-hash dedupe, exact or score-saturated candidate coverage, and no browser-exposed API key.
- An optional Solana PubSub worker retained for app accounts that pass the WebSocket method-support and production proof gates.
- An optional Yellowstone gRPC transport retained for a later sponsored-credit or paid evaluation, not as a current release dependency.

Alchemy's generic Token API documentation is EVM-oriented. For Solana metadata and fungible assets, use the Solana DAS endpoints or standard Solana RPC methods instead. Yellowstone account entitlement must be confirmed before gRPC becomes a release dependency.

The adapter follows that boundary: it enriches the Director with at most eight points and becomes score-ineligible when stale or coverage is incomplete. Birdeye/DexScreener remain the base path. Passing the HTTP proof gate permits a bounded Alchemy polling claim, not an Alchemy-powered live-streaming claim. See [Alchemy Solana Candidate Activity Evidence](docs/ALCHEMY_STREAM.md).

### Judge-facing evidence

Implemented: Director responses and authoritative multiplayer outcomes are stored in insert-only PostgreSQL tables with provider timestamps, fallback state, selected market metrics, and idempotent round identities. Share-card creation is recorded in its own insert-only table. Existing wallet sessions are exposed only as aggregates, and only signatures already accepted by the server's Solana verification ledger appear as onchain evidence.

The public `/arena` page and `/api/arena/status` endpoint disclose whether evidence is durable PostgreSQL data or bounded current-process memory. Browser-local AI fights are excluded from match totals, Director responses are not called completed fights, share cards are not called impressions, wallet sessions are not called paying users, and missing onchain evidence is not coerced to zero. See [Arena Telemetry and Public Evidence](docs/ARENA_TELEMETRY.md).

### Token utility boundary

The game token and `$ANSEM` have separate jobs. The launched StickLash token will pay for boost packs, with 100% of verified receipts entering the game-token reward reserve. Bounded Arena Director actions will spend `$ANSEM` into a separate `$ANSEM` reward reserve without changing human ranked combat power.

Confirmed creator-fee SOL follows a separate 50/50 flow: 50% operations and infrastructure, 50% reserved for market purchases of `$ANSEM` that enter the `$ANSEM` reward reserve. Competitive budgets are split 70% to an equal-power Skill Championship and 30% to a separate Boosted League capped at three paid boost charges per player per match. See [Economy, Leagues, Leaderboards, and Rewards](docs/ECONOMY_AND_REWARDS.md) for the full decision and delivery gates.

Do not implement staking, dual-token boost payments, burns, or unattended token distributions. Do not configure an `$ANSEM` mint until it is verified from an official source. Every value-moving action must use an authorized treasury or explicit user-wallet approval and independent server-side transaction verification.

## Delivery sequence

Completed foundations:

1. Arena Director v0.2.1 selects and explains Endless opponents with a tested fallback and bounded optional Alchemy activity signal.
2. Repeatable JavaScript tests and explicit web-to-Android asset sync are configured.
3. Wallet-bound, server-authoritative Skill and Boosted ranked settlement is implemented; token rewards remain off.
4. Privacy-safe insert-only Arena Director, authoritative-match, and share telemetry is implemented with durable/fallback disclosure.
5. The Help-linked `/arena` status page exposes honest judge-facing counters and verified-transaction links without leaking wallet or room identities.
6. The free-tier Alchemy HTTP adapter, optional PubSub/Yellowstone transports, durable cursor schema, bounded recovery/dedupe logic, freshness and coverage gates, public cost/health contract, and Birdeye failover tests are implemented.
7. Commit `bfec907` is deployed with production schema v9; consecutive fresh exact-window Alchemy cycles, a controlled durable restart with exact 32-slot rewind, cursor advancement, and one isolated Director telemetry delta are publicly evidenced.

Next work, in order:

1. Submit the in-progress Alchemy credit application, then register StickLash on the official AnsemHack page under ClawPump x pump.fun; do not claim Inference Markets unless UsePod becomes load-bearing. Apply for Helius credits through the official team flow after registration.
2. Harden cold-start candidate recovery, then capture explicit duplicate stability and controlled Birdeye-failover evidence. The v9 deployment, fresh score-complete cycles, exact semantics, controlled restart/rewind, durable cursoring, and Director counter delta are already proven.
3. Rehearse the `/arena` evidence page in a stream-ready 15-minute demo without seeding counters.
4. Finalize both token identities and reserve accounts, then replace the retired burn path with the documented 100% game-token reward-vault transfer.
5. Add the creator-fee SOL allocation ledger and execute one operator-approved `$ANSEM` market purchase before considering automation.
6. Add one bounded, visible `$ANSEM` Arena Director spend after verifying the official mint.
7. Build the epoch-only eligibility snapshot and anti-collusion rules on top of the completed ranked settlement, run a non-monetary epoch, and publish the dry-run evidence.
8. Add an audited claim path and enable deliberately small funded claims only after all reserve and dry-run gates pass.
9. Freeze the submission build early enough to collect real usage, shares, and verified onchain evidence before 19 September.

## Demo story

The 15-minute stream should show four things in order: the live Solana market entering the director, an explainable opponent decision, an AI-controlled fight whose stats derive from that market snapshot, and a verifiable player action or share. The close should show real metrics and transaction links, then explain token utility and the post-hackathon product path without claiming unimplemented volume or rewards.
