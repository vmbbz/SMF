# Arena Telemetry and Public Evidence

Status: implemented in the StickLash backend and web client on 28 August 2026.

## Purpose

Arena telemetry gives judges, players, and operators a public view of facts the StickLash backend can support. It is deliberately narrower than an analytics dashboard and separate from the reward system.

The design answers six questions without inflating the answer:

1. How many Arena Director responses were recorded?
2. How many multiplayer rounds were finalized by the authoritative server game loop?
3. How many share cards and aggregate wallet sessions were recorded?
4. Which Solana transactions passed the existing server verification path?
5. Is the evidence durable, or will it disappear when the current process restarts?
6. Is the optional Alchemy Solana evidence path configured, fresh, fully covered, cost-bounded, and durably cursor-backed?

The public page is available through **Help -> Live Arena Status** and the `/arena` route. Its read-only JSON source is `/api/arena/status`.

## Evidence pipeline

```text
Birdeye discovery snapshot -----> candidate mint filter
          |                              |
          |                              v
          |                 Alchemy Solana HTTP polling
          |                 | complete cycle + cursor
          v                       v
Arena Director response -----> arena_director_events
          |
          |                         public aggregates
          |                               |
          v                               v
Game / Endless client              /api/arena/status -----> /arena

Authoritative server game loop -> arena_match_events
Share-card creation endpoint    -> arena_share_events
Wallet auth sessions            -> aggregate-only query
Verified boost burn ledger      -> transaction count + Solscan links
```

The public telemetry layer observes these paths. It does not control combat, match settlement, ELO, boost authorization, or rewards. The separate Alchemy enrichment path can influence only the bounded Director score described below.

## Exact metric definitions

### Arena Director

- **Director responses**: successful calls to the Director endpoint that produced a recorded response. This is not a completed-fight count and is not a unique-user count.
- **Selected decisions**: Director responses containing an eligible selected opponent.
- **Unique decision snapshots**: distinct deterministic Director decision IDs.
- **Unique tokens featured**: distinct selected Solana mints across recorded responses.
- **Fresh market selections**: selected responses whose provider provenance identifies a Birdeye fetch or fresh cache inside the configured list TTL.
- **Degraded market selections**: selected responses served while one discovery channel used a fallback or failed while another fresh snapshot remained available.

Provider observation time and provider snapshot time are separate. StickLash never substitutes request time for an unknown market snapshot timestamp.

### Alchemy candidate activity evidence

- **Evidence freshness**: age of the most recently completed Alchemy HTTP poll. It is not the age of Birdeye's market snapshot and does not imply a live subscription.
- **Monitored candidates**: requested, covered, pending, and failed counts for the bounded Birdeye-discovered mint set. Mint values themselves are not exposed in the health object. `activeCandidateCount` is retained for API compatibility and means complete-cycle coverage in HTTP mode.
- **Confirmed candidate transaction observations**: distinct signature hashes inside the configured window whose transactions mention at least one subscribed mint. This is not a trade, buy, sell, USD-volume, revenue, or unique-user count.
- **Recovery cursor**: latest fully covered confirmed slot. The free path rewinds and clamps a bounded `getSignaturesForAddress` cycle; this is not native replay. Public health exposes limits, failures, truncation, and complete-cycle coverage.
- **Reliability and cost**: attempted, completed, and failed poll cycles, sanitized errors, and current/maximum 30-day compute-unit estimates. Estimates exclude retries and other Alchemy traffic.

Only a fresh complete cycle can add the bounded Alchemy activity bonus to Director v0.2. `disabled`, `misconfigured`, `waiting_for_candidates`, `polling`, `stale`, `stopped`, and incomplete-coverage states add no score. Birdeye remains the required discovery/base-scoring provider, so Alchemy availability does not determine whether a selection can be returned.

See [Alchemy Solana Candidate Activity Evidence](ALCHEMY_STREAM.md) for the exact polling, scoring, recovery, cost, failure, and optional transport contracts.

### Matches

- **Authoritative multiplayer rounds**: rounds finalized by the Python server game loop callback.
- **Ranked rounds**: authoritative rounds in either ranked league.
- **Skill / Boosted rounds**: authoritative rounds split by immutable league policy.
- **Private casual rounds**: server-finalized friend-room rounds.
- **Paid boost charges in recorded rounds**: server-authorized paid-special charges consumed in those rounds.

Browser-local AI, LLM, token, Endless, and waiting-room practice fights are excluded. They can entertain or demonstrate market-driven combat, but the current server cannot independently prove their final outcomes.

### Engagement

- **Share cards generated**: successful battle-card files created by the share endpoint. This is not a social post, view, impression, or click count.
- **Wallet sessions created**: durable wallet-auth session records.
- **Active wallet sessions**: unrevoked, unexpired session records at query time.
- **Unique authenticated wallets**: distinct wallet addresses behind those session records, returned only as an aggregate count.

No public response contains a wallet address, player name, room code, auth token, challenge, or session identifier.

### Onchain verification

The onchain count comes only from `boost_purchase_ledger`. A row enters that ledger after the server verifies the configured Solana boost-burn transaction, signer, mint, amount, and transaction result. Recent public entries expose the transaction signature, slot when available, verification time, and a Solscan link.

Gameplay telemetry is never counted as onchain volume. If PostgreSQL is unavailable, the onchain count is `null`, not zero. If PostgreSQL is connected and the verified ledger is empty, zero is an evidence-backed result.

Boost purchases remain disabled under the current economy policy, so a connected ledger can legitimately report zero transactions.

## Persistence and failure behavior

There are two explicit modes:

| Mode | Meaning | Public behavior |
|---|---|---|
| `postgres` | Events and ledgers are durably queryable | Page shows durable status and all retained database events |
| `process_memory` | PostgreSQL is absent or telemetry schema access failed | Page labels the scope as bounded current-process memory; wallet and onchain metrics are `null` |

Each event is written to bounded process memory first. A PostgreSQL write failure therefore does not fail a Director response, invalidate a share card, block a match, or alter ELO. The public API falls back to the bounded in-process view and discloses that the evidence is not durable.

Match telemetry IDs are idempotent. Ranked events use the immutable match ID. Every casual server loop receives a unique telemetry round ID, so a rematch is a new event while a repeated callback cannot double count the same round.

## Insert-only database model

Three purpose-specific tables are created at startup when `DATABASE_URL` is available:

- `arena_director_events`
- `arena_match_events`
- `arena_share_events`

All three reject `UPDATE` and `DELETE` through database triggers. Application code exposes insert and aggregate-read operations only. The model does not store wallet addresses in telemetry tables. Existing private wallet-auth and verified-transaction ledgers are queried only for aggregate or public-transaction evidence.

This insert-only telemetry is not the future reward reserve ledger, creator-fee ledger, eligibility snapshot, or claim ledger. Those value-moving systems remain separate and disabled.

Alchemy ingestion state uses two separate operational tables:

- `alchemy_stream_cursor`
- `alchemy_stream_transactions`

The free default updates its cursor only after every candidate request in a bounded HTTP cycle completes without failure or truncation. Each returned provider page is persisted as one PostgreSQL insert-and-merge batch rather than one connection acquisition per signature. Optional PubSub/Yellowstone transports update the cursor from accepted transport observations. Recent signature-hash rows are deleted after the bounded dedupe-retention window. Duplicate signatures returned for more than one mint merge their attribution. These rows are neither insert-only public telemetry nor a permanent transaction ledger, and they must never feed rewards or leaderboard eligibility.

## Public API contract

The endpoint returns these top-level evidence classes:

```json
{
  "schemaVersion": "2026-08-28.v8",
  "generatedAt": "2026-08-28T00:00:00+00:00",
  "persistence": {
    "mode": "postgres",
    "durable": true,
    "retentionScope": "all retained database events"
  },
  "arenaDirector": {},
  "marketStream": {
    "provider": "alchemy",
    "transport": "solana_http_polling|solana_pubsub|yellowstone_grpc",
    "status": "disabled|misconfigured|waiting_for_candidates|waiting_for_poll|polling|live|degraded|stale|connecting|reconnecting|stopped",
    "freshness": "fresh|stale|unavailable",
    "subscription": {},
    "replay": {},
    "reliability": {},
    "activity": {}
  },
  "matches": {},
  "engagement": {},
  "onchain": {},
  "boundaries": []
}
```

The page treats a missing or `null` durable metric as **NOT AVAILABLE**. It does not coerce missing evidence to zero. Every metric group includes a plain-language definition so labels cannot quietly drift into stronger claims.

For Alchemy activity specifically, zero is evidence-backed only when the latest cycle is fresh, every current candidate is covered, and no request failed or truncated. All other states return a `null` observation count.

## Security and privacy properties

- The endpoint is read-only and contains no admin mutation path.
- Telemetry tables store no wallet addresses, names, auth material, IP addresses, or user-agent strings.
- Match telemetry trusts the room's frozen authoritative ranked result, not winner or identity fields submitted by a browser.
- Recent Director entries link only public token mints.
- Recent onchain entries link only public Solana transaction signatures already accepted by the verification ledger.
- Provider errors are reduced to error types; credentials and provider response bodies are not stored.
- Alchemy endpoint validation accepts only credential-free Alchemy hosts with the expected HTTPS/WSS scheme; authenticated `/v2/<key>` URLs exist only inside backend memory, and the public API returns only a sanitized hostname.
- Alchemy transaction bodies, wallet addresses, instructions, and raw signatures are not stored. Dedupe uses a SHA-256 signature hash.
- Test configuration globally removes deployed `REDIS_URL`, `DATABASE_URL`, and Alchemy stream values before each test, preventing unit tests from connecting to deployed services.

## Deployment verification

Before calling the page durable:

1. Deploy with an explicit `DATABASE_URL`.
2. Confirm startup logs include `Durable PostgreSQL persistence enabled`.
3. Request `/api/arena/status` and confirm `persistence.durable` is `true`.
4. Request one Director decision and confirm `decisionsReturned` increases by one.
5. Create one test share card and confirm only `shareCardsGenerated` increases.
6. Complete one server multiplayer round and confirm `authoritativeMultiplayerRounds` increases exactly once.
7. Confirm the JSON contains no wallet address, room code, player name, auth token, or challenge.
8. Confirm the `/arena` page renders zero only for connected durable ledgers and renders unavailable metrics as **NOT AVAILABLE**.
9. If Alchemy is intentionally disabled, confirm `marketStream.status` is `disabled` and its observation count is `null`.
10. If Alchemy is enabled on the free default, require `transport: "solana_http_polling"`, `status: "live"`, `freshness: "fresh"`, complete active-candidate coverage, zero active subscriptions, `replay.cursorDurable: true`, `replay.coverageComplete: true`, an advancing slot, no final poll failure/truncation, bounded retry evidence and poll duration, page-batched persistence, and no credential in the response or logs.
11. Restart the service and confirm it requests a rewound bounded floor without duplicate signatures inflating the current observation window. Do not describe HTTP polling as a live subscription or native replay.

Do not seed, backfill, or simulate public counters for a demo. A small real number is stronger evidence than an inflated number with ambiguous provenance.

## Known limitations and next work

- Browser-local AI and Endless outcomes are not server-attested, so the page does not claim a completed "fights directed" count.
- The free-tier Alchemy HTTP adapter, optional PubSub adapter, and optional paid Yellowstone adapter share one public health contract. Any deployed claim remains gated on the transport-specific production checks in `ALCHEMY_STREAM.md`.
- Social impression/click telemetry is not implemented; only generated cards are counted.
- Reward epochs, anti-collusion eligibility, reserve accounting, and token claims are not derived from these counters.
- Multi-region aggregation depends on every instance sharing the same PostgreSQL database.

The next evidence improvement should be a server-issued AI-fight lifecycle receipt only if the server can independently bind a Director decision to a start and final outcome. Until then, Director responses and authoritative multiplayer rounds remain separate.
