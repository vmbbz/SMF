# Arena Telemetry and Public Evidence

Status: implemented in the StickLash backend and web client on 28 August 2026.

## Purpose

Arena telemetry gives judges, players, and operators a public view of facts the StickLash backend can support. It is deliberately narrower than an analytics dashboard and separate from the reward system.

The design answers five questions without inflating the answer:

1. How many Arena Director responses were recorded?
2. How many multiplayer rounds were finalized by the authoritative server game loop?
3. How many share cards and aggregate wallet sessions were recorded?
4. Which Solana transactions passed the existing server verification path?
5. Is the evidence durable, or will it disappear when the current process restarts?

The public page is available through **Help -> Live Arena Status** and the `/arena` route. Its read-only JSON source is `/api/arena/status`.

## Evidence pipeline

```text
Birdeye discovery snapshot
          |
          v
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

Telemetry observes these paths. It does not control opponent scoring, combat, match settlement, ELO, boost authorization, or rewards.

## Exact metric definitions

### Arena Director

- **Director responses**: successful calls to the Director endpoint that produced a recorded response. This is not a completed-fight count and is not a unique-user count.
- **Selected decisions**: Director responses containing an eligible selected opponent.
- **Unique decision snapshots**: distinct deterministic Director decision IDs.
- **Unique tokens featured**: distinct selected Solana mints across recorded responses.
- **Fresh market selections**: selected responses whose provider provenance identifies a Birdeye fetch or fresh cache inside the configured list TTL.
- **Degraded market selections**: selected responses served while one discovery channel used a fallback or failed while another fresh snapshot remained available.

Provider observation time and provider snapshot time are separate. StickLash never substitutes request time for an unknown market snapshot timestamp.

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

## Public API contract

The endpoint returns these top-level evidence classes:

```json
{
  "schemaVersion": "2026-08-28.v1",
  "generatedAt": "2026-08-28T00:00:00+00:00",
  "persistence": {
    "mode": "postgres",
    "durable": true,
    "retentionScope": "all retained database events"
  },
  "arenaDirector": {},
  "matches": {},
  "engagement": {},
  "onchain": {},
  "boundaries": []
}
```

The page treats a missing or `null` durable metric as **NOT AVAILABLE**. It does not coerce missing evidence to zero. Every metric group includes a plain-language definition so labels cannot quietly drift into stronger claims.

## Security and privacy properties

- The endpoint is read-only and contains no admin mutation path.
- Telemetry tables store no wallet addresses, names, auth material, IP addresses, or user-agent strings.
- Match telemetry trusts the room's frozen authoritative ranked result, not winner or identity fields submitted by a browser.
- Recent Director entries link only public token mints.
- Recent onchain entries link only public Solana transaction signatures already accepted by the verification ledger.
- Provider errors are reduced to error types; credentials and provider response bodies are not stored.
- Test configuration globally removes deployed `REDIS_URL` and `DATABASE_URL` values before each test, preventing unit tests from mutating deployed services.

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

Do not seed, backfill, or simulate public counters for a demo. A small real number is stronger evidence than an inflated number with ambiguous provenance.

## Known limitations and next work

- Browser-local AI and Endless outcomes are not server-attested, so the page does not claim a completed "fights directed" count.
- Birdeye list provenance is implemented; Alchemy Yellowstone replay cursors and stream-health evidence are not.
- Social impression/click telemetry is not implemented; only generated cards are counted.
- Reward epochs, anti-collusion eligibility, reserve accounting, and token claims are not derived from these counters.
- Multi-region aggregation depends on every instance sharing the same PostgreSQL database.

The next evidence improvement should be a server-issued AI-fight lifecycle receipt only if the server can independently bind a Director decision to a start and final outcome. Until then, Director responses and authoritative multiplayer rounds remain separate.
