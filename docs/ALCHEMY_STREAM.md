# Alchemy Yellowstone Candidate Activity Stream

Status: the adapter, persistence model, Director integration, tests, and public
health contract are implemented. Production must still be configured with an
Alchemy key that has Yellowstone access before StickLash may describe the
stream as live.

## Why this integration exists

Birdeye is good at answering **which tokens should be considered** and at
providing the market measurements that define a fighter: 24-hour volume,
price movement, liquidity, and listing state. It is a snapshot API, not a
continuous transaction stream.

Alchemy Yellowstone adds a different and deliberately narrower fact:

> During a recent bounded window, how many confirmed Solana transactions seen
> by this backend mentioned a currently subscribed candidate mint?

That signal makes the Arena Director more responsive between Birdeye list
refreshes without inventing financial meaning. The adapter does not parse swap
instructions or establish direction, token amount, USD value, trader identity,
or economic ownership. Therefore StickLash calls the signal a **confirmed
candidate transaction observation**, never a trade, buy, sale, user, or unit of
volume.

## Data and control flow

```text
Birdeye trending + graduated discovery
                 |
                 | candidate mints, refreshed every 180s
                 v
Alchemy Yellowstone gRPC
  confirmed slots + successful non-vote transactions
                 |
                 | bounded queue, replay, dedupe
                 v
PostgreSQL cursor + recent signature-hash cache
                 |
                 | fresh per-mint observation count
                 v
Arena Director v0.2
  Birdeye base score + optional max-8 activity bonus
                 |
                 +----> provider provenance on each decision
                 |
                 +----> /api/arena/status -> /arena
```

The browser and Android bundle never connect to Yellowstone and never receive
the Alchemy API key.

## Director scoring boundary

Arena Director v0.2 preserves the established Birdeye policy:

| Signal | Maximum points |
|---|---:|
| 24-hour volume | 42 |
| Absolute 24-hour price movement | 23 |
| Liquidity | 25 |
| Graduated-discovery bonus | 10 |
| Confirmed Alchemy candidate activity | 8 |

Existing thin-liquidity and missing-volume penalties remain in force, and the
final score remains capped at 100.

For `n` observed confirmed transactions in the configured activity window, the
optional bonus is:

```text
min(log2(1 + n) / 5, 1) * 8
```

The logarithm matters. One observation is useful evidence of current activity,
but a noisy token cannot overwhelm liquidity, volume, and movement simply by
generating many transactions. The maximum eight-point weight can influence a
close choice while leaving Birdeye market quality as the dominant policy.

The bonus is score-eligible only while all of these are true:

1. the gRPC connection is active;
2. confirmed slot updates are within `ALCHEMY_STREAM_FRESHNESS_SECONDS`;
3. the token is inside the current bounded candidate subscription; and
4. the observation falls inside `ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS`.

If any condition fails, the Director applies zero Alchemy bonus and omits
`alchemy_yellowstone_candidate_activity` from `inputSources`. Birdeye discovery
and base scoring continue, so an Alchemy outage cannot block opponent selection.

## Subscription contract

The backend uses the official Alchemy Solana mainnet Yellowstone endpoint by
default:

```text
https://solana-mainnet.g.alchemy.com
```

Authentication is the server-only `X-Token` metadata header. Configuration
rejects credentials embedded in endpoint paths and rejects non-Alchemy hosts,
preventing an alternate provider from being mislabeled as Alchemy in public
provenance.

Every active subscription contains:

- confirmed commitment;
- confirmed slot updates with `filter_by_commitment` enabled;
- at most 32 currently discovered candidate mints by default;
- a transaction `account_include` filter, whose values are OR-matched;
- `vote = false`;
- `failed = false`.

The stream observes full confirmed transactions because candidate attribution
requires intersecting static and address-table-loaded account keys with the
subscribed mints. It stores no transaction body, wallet address, instruction,
provider response body, or raw signature.

## Replay, reconnect, and backpressure

The lifecycle worker implements these recovery rules:

1. persist the latest processed confirmed slot;
2. reconnect with exponential backoff from 1 to 30 seconds;
3. rewind the saved slot by 32 slots to cover overlap and ordinary reorg risk;
4. clamp the request to the provider-reported first available slot when that
   unary method is supported;
5. also clamp to a conservative configured maximum of 6,000 slots;
6. deduplicate replay overlap by SHA-256 hash of the transaction signature;
7. respond to Yellowstone ping messages through the bidirectional request
   stream; and
8. put ingress behind a bounded queue.

If the processing queue remains full for five seconds, the connection is
closed and re-established from the rewound durable cursor. The affected update
is counted in `droppedUpdates`; replay is the recovery mechanism. No unbounded
memory growth is allowed.

Alchemy's overview currently advertises 6,000 replayable slots, while its
historical-replay guide describes a much larger approximate window. StickLash
uses 6,000 as the conservative default and additionally honors
`SubscribeReplayInfo.first_available`. Operators must not increase the local
limit merely to make a stronger public claim; first verify the actual account
entitlement and observed server behavior.

## Persistence model

When `DATABASE_URL` is healthy, startup creates two operational tables:

- `alchemy_stream_cursor`: singleton latest processed slot and timestamp;
- `alchemy_stream_transactions`: recent signature hash, slot, observation
  timestamp, and matching candidate mints.

The second table is a bounded replay-dedupe/activity cache. Rows older than the
configured retention window are deleted. These tables are intentionally not
the insert-only arena telemetry tables, a financial ledger, a leaderboard
source, or a reward eligibility source.

If PostgreSQL fails, the stream may continue with bounded process memory, but
public health reports `cursorDurable: false` and status `degraded`. Production
acceptance requires a durable PostgreSQL cursor.

## Public health contract

`GET /api/arena/status` includes `marketStream` with these evidence classes:

- configuration: enabled, configured, sanitized endpoint host, protocol;
- transport: status, freshness threshold, last connection/update, age, slot;
- subscription: candidate count, cap, filters, refresh and activity windows;
- replay: saved cursor, durability, rewind, requested replay slot and clamp
  reason;
- reliability: reconnects, received/processed/dropped updates and sanitized
  error code;
- activity: observation count for the current candidate set and window;
- failover: explicit Birdeye base-selection behavior.

Important status meanings:

| Status | Meaning | Alchemy score allowed? |
|---|---|---:|
| `disabled` | Operator has not requested the stream | No |
| `misconfigured` | Enabled, but key or safe endpoint is missing/invalid | No |
| `connecting` | Initial connection has not produced a fresh update | No |
| `live` | Fresh transport and durable cursor | Yes |
| `degraded` | Fresh transport but process-memory cursor | Yes, disclosed as non-durable |
| `stale` | Last transport update exceeded freshness threshold | No |
| `reconnecting` | Connection failed/closed and backoff is active | No |
| `stopped` | Configured worker is not running | No |

A zero observation count is returned only while the stream is fresh and at
least one candidate is subscribed. Otherwise the value is `null`, not a
misleading zero.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `ALCHEMY_STREAM_ENABLED` | `0` | Explicit activation gate |
| `ALCHEMY_API_KEY` | empty | Private `X-Token` credential |
| `ALCHEMY_YELLOWSTONE_ENDPOINT` | mainnet Alchemy host | Server endpoint; HTTPS Alchemy hosts only |
| `ALCHEMY_STREAM_FRESHNESS_SECONDS` | `20` | Maximum age for score eligibility |
| `ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS` | `180` | Per-candidate observation window |
| `ALCHEMY_STREAM_MAX_CANDIDATES` | `32` | Bounded account filter size |
| `ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS` | `180` | Birdeye-to-stream filter refresh |
| `ALCHEMY_STREAM_REWIND_SLOTS` | `32` | Reconnect overlap |
| `ALCHEMY_STREAM_MAX_REPLAY_SLOTS` | `6000` | Conservative local replay clamp |
| `ALCHEMY_STREAM_QUEUE_SIZE` | `2048` | Bounded ingress capacity |
| `ALCHEMY_STREAM_DEDUPE_RETENTION_SECONDS` | `21600` | Operational signature-hash retention |
| `ALCHEMY_STREAM_RECONNECT_MIN_SECONDS` | `1` | Initial backoff |
| `ALCHEMY_STREAM_RECONNECT_MAX_SECONDS` | `30` | Maximum backoff |
| `ALCHEMY_STREAM_RPC_TIMEOUT_SECONDS` | `12` | Unary setup timeout |

`SOLANA_RPC` remains a separate JSON-RPC endpoint. StickLash does not scrape a
key out of that URL or silently activate Yellowstone.

## Production activation and proof gate

1. Confirm Yellowstone access for the intended Alchemy app/account.
2. Add `ALCHEMY_API_KEY` as a secret environment value in Render.
3. Keep `ALCHEMY_YELLOWSTONE_ENDPOINT` on the correct Solana network.
4. Set `ALCHEMY_STREAM_ENABLED=1` and deploy.
5. Confirm startup reports both the durable cursor and worker startup without
   printing a credential.
6. Request `/api/arena/status` and require:
   - `marketStream.status == "live"`;
   - `marketStream.freshness == "fresh"`;
   - `marketStream.replay.cursorDurable == true`;
   - a recent `lastUpdateAt` and advancing `lastSlot`;
   - `droppedUpdates == 0` during the acceptance window.
7. Request `/api/arena/director/next`. Confirm the Alchemy input source appears
   only while fresh and its provider snapshot is marked score-eligible.
8. Restart once and verify the saved cursor is reused with a rewound
   `requestedFromSlot`, while replay duplicates do not inflate observations.
9. Let the stream become unavailable in a controlled non-production test and
   verify Birdeye still returns a Director selection with no Alchemy bonus.

Until those checks pass on the deployed service, public copy must say the
Alchemy adapter is implemented but not live. Do not use an API key in a URL,
browser bundle, screenshot, log, commit, or issue.

## Allowed and prohibited claims

Allowed after the production proof gate:

- "Alchemy Yellowstone streams confirmed Solana candidate activity into the
  Arena Director."
- "StickLash persists a replay cursor and exposes stream freshness/failover."
- "Recent confirmed candidate activity contributes a bounded optional score."

Not supported by this adapter:

- "Alchemy supplies StickLash prices or USD volume."
- "Every observation is a trade or a unique trader."
- "Observed activity is StickLash-generated onchain volume."
- "The stream proves revenue, leaderboard eligibility, or reward entitlement."
- "No updates were ever missed" solely because `droppedUpdates` is zero.

## Protocol provenance and references

The Python bindings are generated from the signed
`rpcpool/yellowstone-grpc` release `v15.1.2+solana.4.2.0`. Exact asset hashes
and the Apache-2.0 protocol license are retained under
`vendor/yellowstone/v15.1.2/`.

- [Alchemy Yellowstone overview](https://www.alchemy.com/docs/reference/yellowstone-grpc-overview)
- [Alchemy SubscribeRequest reference](https://www.alchemy.com/docs/reference/yellowstone-grpc-subscribe-request)
- [Alchemy transaction filters](https://www.alchemy.com/docs/reference/yellowstone-grpc-subscribe-transactions)
- [Alchemy best practices](https://www.alchemy.com/docs/reference/yellowstone-grpc-best-practices)
- [Alchemy historical replay](https://www.alchemy.com/docs/reference/yellowstone-grpc-historical-replay)
- [Pinned Yellowstone release](https://github.com/rpcpool/yellowstone-grpc/releases/tag/v15.1.2%2Bsolana.4.2.0)
