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
- The game has AI and behavior-tree fighter controllers, AI-versus-AI simulation, an endless fight loop, voice control, multiplayer, victory sharing, and an Android build.
- Solana wallet ownership is verified server-side, and boost purchases require a confirmed SPL burn before server-authoritative boosts are credited.
- The backend can use an Alchemy Solana RPC through `SOLANA_RPC`, although the current discovery pipeline is not yet an Alchemy stream.

## Material gaps

- Endless mode currently rotates a client-side queue. It does not make or expose an autonomous market decision.
- The fighter agent reacts inside a match, but no central agent selects matchups, explains its reasoning, or leaves an audit trail.
- There is no Alchemy Yellowstone consumer, Solana DAS adapter, stream health telemetry, or replay cursor yet.
- There is no registered AnsemHack project identity, verified project X handle, launched ClawPump token, canonical game-token mint, or confirmed $ANSEM mint in configuration.
- The README describes Alchemy capabilities more strongly than the current implementation proves.
- Agent decisions, fights, shares, wallet activity, and onchain transactions are not yet combined into judge-facing metrics.
- JavaScript test files exist, but Jest is not declared as a development dependency and the npm scripts are recursively self-referential.

## Track strategy

The primary target is **ClawPump x pump.fun**, with automatic consideration for **Overall Winner**. StickLash fits the builder side as a novel agentic market interface and spectator product; it should not claim to be a profitable trading agent.

Inference Markets remains out of scope unless the product later buys, routes, resells, or otherwise makes UsePod inference capacity economically load-bearing. EasyA should only replace ClawPump if the team deliberately gives up stackable ClawPump eligibility.

## First vertical slice: Arena Director v0.1

The first implementation adds an explainable server-side agent and routes the real endless-game loop through it.

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

### Acceptance criteria

- A public endpoint returns a versioned, auditable next-opponent decision from live normalized market candidates.
- Duplicate mints and the current opponent cannot be selected.
- Candidate scoring is bounded, deterministic, unit tested, and accompanied by human-readable reasons.
- Empty or failed provider results produce a valid no-candidate response instead of an exception.
- Endless mode calls the director for its first fight and every automatic next fight.
- The selected token still passes through existing detail hydration and market-power scaling.
- The UI visibly identifies the Arena Director's pick without blocking the match.
- Existing market endpoints remain backward compatible.
- Backend tests, JavaScript syntax checks, Capacitor sync, and the Android build pass before release.

## Follow-on architecture

### Alchemy data plane

Use Alchemy in two bounded roles after account approval:

- `SOLANA_RPC` for private server-side transaction verification and standard Solana JSON-RPC.
- A narrow Yellowstone gRPC worker for relevant pump.fun and token activity, with filtered subscriptions, reconnect backoff, replay from the last processed slot, and no browser-exposed API key.

Alchemy's generic Token API documentation is EVM-oriented. For Solana metadata and fungible assets, use the Solana DAS endpoints or standard Solana RPC methods instead. Alchemy documentation currently differs on Yellowstone plan prerequisites, so account entitlement must be confirmed before gRPC becomes a release dependency.

The stream should enrich the director; it should not replace Birdeye/DexScreener until observed coverage and failover behavior are proven.

### Judge-facing evidence

Persist append-only agent decisions and match outcomes with provider timestamps and selected metrics. Build a small public arena status view showing fights directed, unique tokens featured, decisions with live data, shares generated, wallet sessions, verified burns, and linked Solana transaction signatures. Never label simulated activity as onchain volume.

### Token utility boundary

Do not implement staking, pooled rewards, treasury distributions, or dual-token burns until the game token, exact $ANSEM mint, custody model, economics, jurisdictions, and ClawPump rules are confirmed. The first credible utility can remain non-custodial: verified holdings unlock a bounded daily arena action or discount, while all value-moving actions require an explicit wallet approval and server-side transaction verification.

## Delivery sequence

1. Ship Arena Director v0.1 and route the public endless demo through it.
2. Repair repeatable test tooling and add agent decision telemetry.
3. Register the project and apply for Alchemy and Helius credits through the official flows; these are human account actions.
4. Add the Alchemy provider behind the existing normalized market interface and prove it with replay/failover evidence.
5. Add the public arena status view and a stream-ready 15-minute demo flow.
6. Finalize token identity and one safe, visible utility before tokenization.
7. Freeze the submission build early enough to collect real usage, shares, and onchain evidence before 19 September.

## Demo story

The 15-minute stream should show four things in order: the live Solana market entering the director, an explainable opponent decision, an AI-controlled fight whose stats derive from that market snapshot, and a verifiable player action or share. The close should show real metrics and transaction links, then explain token utility and the post-hackathon product path without claiming unimplemented volume or rewards.
