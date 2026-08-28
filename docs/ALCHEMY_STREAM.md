# Alchemy Solana Candidate Activity Stream

Status: the free-tier Solana PubSub transport is the production default. The
paid Yellowstone implementation remains available only through an explicit
transport setting for a later sponsored-credit evaluation.

## Purpose and evidence boundary

Birdeye answers **which tokens should be considered** and supplies the market
measurements that shape their fighters: volume, price movement, liquidity, and
listing state. Alchemy supplies a separate, deliberately narrow fact:

> During a recent bounded window, how many confirmed Solana transactions
> observed by this backend mentioned a currently monitored candidate mint?

That can make the Arena Director more responsive between discovery refreshes.
It does not prove that an observation was a swap, buy, sale, unique trader,
StickLash user, token amount, USD amount, revenue event, or StickLash-generated
volume. No stream observation affects ELO, leaderboards, boost settlement, or
reward eligibility.

## Production data flow

```text
Birdeye trending + graduated discovery
                 |
                 | at most 32 candidate mints
                 v
Alchemy Solana PubSub on one backend WebSocket
  rootSubscribe (finalized freshness heartbeat)
  logsSubscribe (one confirmed mentions filter per mint)
                 |
                 | bounded queue + signature dedupe
                 v
PostgreSQL slot cursor + recent signature-hash cache
                 ^
                 | bounded getSignaturesForAddress gap backfill
                 |
Alchemy Solana HTTP JSON-RPC
                 |
                 v
Arena Director v0.2
  Birdeye base score + optional max-8 activity bonus
                 |
                 +----> provider provenance on each decision
                 +----> /api/arena/status -> /arena
```

The browser and Android WebView never connect to Alchemy and never receive the
API key. The backend constructs authenticated `/v2/<key>` endpoints only in
memory. Public responses expose the sanitized Alchemy hostname, never a path,
query, credential, provider payload, or raw signature.

## Why PubSub is the default

Alchemy Yellowstone gRPC requires paid or sponsored access. Standard Solana
JSON-RPC and PubSub are available on Alchemy's free plan and are sufficient for
StickLash's current bounded candidate set. Paying before public demand exists
would add cost without changing the game loop or core market discovery.

The default therefore uses `ALCHEMY_STREAM_TRANSPORT=solana_pubsub`. Operators
may later select `yellowstone_grpc` after credits or paid access are confirmed.
This is a transport change only: persistence, dedupe, scoring, failover, and
public evidence boundaries remain shared.

Free does not mean unlimited. PubSub bandwidth and HTTP calls consume account
capacity. Keep the filters and caps in this document, configure Alchemy usage
alerts, and inspect the dashboard before raising any limit.

## PubSub subscription contract

One authenticated WebSocket connects to:

```text
wss://solana-mainnet.g.alchemy.com/v2/<server-only-key>
```

It owns these subscriptions:

- one `rootSubscribe` heartbeat; root notifications represent finalized slots;
- one `logsSubscribe` per candidate mint;
- each log filter contains exactly one `{ "mentions": ["<mint>"] }` value,
  because Solana permits only one pubkey in a `mentions` filter;
- each log subscription requests `commitment: "confirmed"`;
- only successful notifications (`err == null`) become observations; and
- candidate filters are capped at 32 by default and refreshed from Birdeye.

Only the server lifecycle's timed Birdeye refresh loop may replace this filter
set. Public Director and market request parameters can choose how many results
to return, but enrichment is read-only: a client cannot mutate subscriptions,
force filter churn, or trigger HTTP recovery work.

The worker tracks request IDs, acknowledged subscription IDs, pending filters,
failed filters, and removals. A candidate receives no Alchemy score until every
candidate filter in the current set is acknowledged and recovery coverage is
complete. This all-or-nothing gate prevents a token with a working subscription
from receiving an unfair bonus while another token's filter is unavailable.

## Freshness, queueing, and reconnects

The root heartbeat proves that the WebSocket is receiving current Solana data;
it does not prove that candidate transactions occurred. Transport freshness is
the age of the latest accepted root or log notification.

Ingress passes through a bounded queue. If processing cannot accept an update
within five seconds, the connection fails closed, increments `droppedUpdates`,
and reconnects with exponential backoff. Reconnect delays start at one second
and cap at 30 seconds by default. WebSocket and HTTP errors are reduced to safe
codes such as `websocket_http_401` or `http_rpc_timeout`.

The app reports a zero observation count only when all of these are true:

1. the WebSocket is connected and fresh;
2. at least one candidate exists;
3. every current candidate has an acknowledged log subscription;
4. reconnect recovery covers the active observation window; and
5. the queried activity cache actually contains zero matching signatures.

Otherwise the count is `null`, not a misleading zero, and the Alchemy bonus is
disabled.

## HTTP reconnect recovery: not native replay

Solana PubSub does not replay missed notifications. StickLash therefore performs
a bounded recovery pass through Alchemy HTTP JSON-RPC:

1. load the latest processed slot from PostgreSQL;
2. fetch the current confirmed slot with `getSlot`;
3. rewind the cursor by 32 slots;
4. clamp the floor to at most 512 slots behind the current slot;
5. call `getSignaturesForAddress` once per candidate with a default limit of 25;
6. retain only successful signatures inside the slot range;
7. hash each signature with SHA-256 and merge duplicate mint attribution; and
8. expose failures or truncation publicly.

This is **bounded HTTP signature backfill**, not Yellowstone replay. If a result
hits its per-candidate limit before reaching the requested floor, health reports
`truncatedCandidates > 0`, marks coverage incomplete, returns a `null` activity
count, and applies no Alchemy score. Repeated reconnects serialize backfills and
defer them to the configured minimum interval to protect free-tier usage.

If no cursor exists on first activation, or a candidate is newly added, the
worker requests the full bounded candidate window instead of pretending that a
new global cursor represents that mint's history. If this initial backfill is
unavailable or truncated, the activity count remains `null` until every current
candidate filter and the finalized-root heartbeat are acknowledged and one full
activity window has subsequently been observed continuously. At that point the
failed historical gap is outside the scored window, `coverageBasis` changes to
`continuous_live_window`, and the old failure/truncation remains visible as
reliability evidence rather than permanently disabling current observations.

## Dedupe and persistence

When `DATABASE_URL` is healthy, startup creates two operational tables:

- `alchemy_stream_cursor`: singleton latest processed slot and timestamp;
- `alchemy_stream_transactions`: recent signature hash, slot, observation time,
  and matching candidate mints.

The same signature may arrive from two mint subscriptions. The store merges the
mint set while counting the signature once globally and once for each mentioned
candidate. Raw signatures, logs, transaction bodies, account lists, wallet
addresses, instructions, and provider responses are not stored.

Rows older than the configured dedupe-retention window are pruned. These tables
are operational recovery state, not permanent analytics, public telemetry,
financial ledgers, or reward sources. If PostgreSQL fails, bounded process
memory remains available but public status becomes `degraded` and explicitly
reports a non-durable cursor.

## Director scoring

Arena Director v0.2 preserves Birdeye as the dominant policy:

| Signal | Maximum points |
|---|---:|
| 24-hour volume | 42 |
| Absolute 24-hour price movement | 23 |
| Liquidity | 25 |
| Graduated-discovery bonus | 10 |
| Confirmed Alchemy candidate activity | 8 |

For `n` observed confirmed transactions in the configured activity window:

```text
min(log2(1 + n) / 5, 1) * 8
```

The logarithm and eight-point cap prevent noisy activity from overwhelming
market quality. PubSub decisions identify the optional source as
`alchemy_solana_pubsub_candidate_activity`; paid Yellowstone decisions identify
`alchemy_yellowstone_candidate_activity`. Unknown or stale transport labels are
not score-eligible.

Birdeye discovery and base scoring continue through every Alchemy failure.

## Public health contract

`GET /api/arena/status` returns `marketStream` with:

- `transport`: `solana_pubsub` or `yellowstone_grpc`;
- configuration and sanitized endpoint host;
- connection state, freshness, latest update, and latest slot;
- requested, active, pending, and failed candidate filter counts;
- recovery mode, durable cursor, floor slot, limits, failures, truncation,
  coverage completeness, and whether completeness came from bounded backfill or
  a subsequently observed continuous live window;
- reconnect, receive, process, drop, and sanitized-error counters; and
- an activity count only when the evidence gate is complete.

| Status | Meaning | Activity score allowed? |
|---|---|---:|
| `disabled` | Operator has not enabled the worker | No |
| `misconfigured` | Key, transport, or safe endpoint is missing/invalid | No |
| `connecting` | Connection has not produced fresh evidence | No |
| `live` | Fresh, complete candidate coverage and durable cursor | Yes |
| `degraded` | Fresh but non-durable or recovery/filter coverage is incomplete | Only when `activity.scoreEligible` is explicitly true |
| `stale` | Latest transport update exceeded the threshold | No |
| `reconnecting` | Connection failed and backoff is active | No |
| `stopped` | Configured worker is not running | No |

Always use `activity.scoreEligible`, not status text alone, when interpreting a
Director decision.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `ALCHEMY_STREAM_ENABLED` | `0` | Explicit activation gate |
| `ALCHEMY_API_KEY` | empty | Server-only Alchemy app key |
| `ALCHEMY_STREAM_TRANSPORT` | `solana_pubsub` | Free PubSub default or explicit paid Yellowstone |
| `ALCHEMY_SOLANA_WS_ENDPOINT` | mainnet Alchemy WSS host | PubSub host without `/v2/key` |
| `ALCHEMY_SOLANA_HTTP_ENDPOINT` | mainnet Alchemy HTTPS host | Recovery RPC host without `/v2/key` |
| `ALCHEMY_YELLOWSTONE_ENDPOINT` | mainnet Alchemy HTTPS host | Paid transport only; no key in path |
| `ALCHEMY_STREAM_FRESHNESS_SECONDS` | `20` | Maximum transport age |
| `ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS` | `180` | Per-candidate count window |
| `ALCHEMY_STREAM_MAX_CANDIDATES` | `32` | Bounded log-subscription count |
| `ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS` | `180` | Birdeye filter refresh |
| `ALCHEMY_STREAM_REWIND_SLOTS` | `32` | Recovery overlap |
| `ALCHEMY_STREAM_BACKFILL_MAX_SLOTS` | `512` | Free-path slot gap cap |
| `ALCHEMY_STREAM_BACKFILL_LIMIT_PER_CANDIDATE` | `25` | Free-path history cap |
| `ALCHEMY_STREAM_BACKFILL_MIN_INTERVAL_SECONDS` | `60` | Reconnect cost guard |
| `ALCHEMY_STREAM_QUEUE_SIZE` | `2048` | Bounded ingress capacity |
| `ALCHEMY_STREAM_DEDUPE_RETENTION_SECONDS` | `21600` | Signature-hash retention |
| `ALCHEMY_STREAM_RECONNECT_MIN_SECONDS` | `1` | Initial reconnect delay |
| `ALCHEMY_STREAM_RECONNECT_MAX_SECONDS` | `30` | Maximum reconnect delay |
| `ALCHEMY_STREAM_RPC_TIMEOUT_SECONDS` | `12` | Connection/RPC timeout |
| `ALCHEMY_STREAM_MAX_REPLAY_SLOTS` | `6000` | Yellowstone-only replay clamp |

Endpoint settings accept only credential-free Alchemy hosts with the expected
scheme. `SOLANA_RPC` remains a separate backend RPC setting and never silently
enables activity streaming.

## Production activation and proof gate

1. Create an Alchemy Solana Mainnet app on the free plan.
2. Store `ALCHEMY_API_KEY` as a secret Render environment value.
3. Set `ALCHEMY_STREAM_TRANSPORT=solana_pubsub` and
   `ALCHEMY_STREAM_ENABLED=1`.
4. Keep the endpoint variables on their credential-free defaults and deploy.
5. Require `/health` HTTP 200 and durable PostgreSQL persistence.
6. Inspect `/api/arena/status` and require:
   - `transport == "solana_pubsub"`;
   - `status == "live"`;
   - `freshness == "fresh"`;
   - active candidate count equals requested candidate count;
   - `replay.cursorDurable == true`;
   - `replay.coverageComplete == true`;
   - zero backfill failures and truncations;
   - a recent update and advancing slot; and
   - no credential anywhere in the response or logs.
7. Request one Director decision. The PubSub input source may appear only while
   `activity.scoreEligible` is true.
8. Restart once and verify bounded backfill occurs without duplicate inflation.
9. Disable or interrupt Alchemy in a controlled environment and verify Birdeye
   still selects an opponent with no Alchemy bonus.

Do not seed or simulate public counters for a demo.

## Optional Yellowstone evaluation later

After Alchemy credits or paid access are approved, set
`ALCHEMY_STREAM_TRANSPORT=yellowstone_grpc` in a controlled evaluation service.
That path retains confirmed slot/transaction filters, native replay cursoring,
ping responses, backpressure, dedupe, and public provenance. Do not call the
production path Yellowstone unless live telemetry reports that exact transport.

## Allowed and prohibited claims

Allowed after the production proof gate:

- "Alchemy Solana PubSub supplies confirmed candidate-activity observations."
- "StickLash exposes stream freshness, candidate coverage, bounded recovery,
  dedupe, and Birdeye failover."
- "Recent confirmed candidate activity contributes a capped optional score."

Not supported:

- "Every observation is a trade or unique trader."
- "Alchemy supplies StickLash prices or USD volume."
- "The stream proves StickLash revenue or generated onchain volume."
- "The stream creates leaderboard points or reward entitlement."
- "PubSub has native replay" or "no event can be missed."

## References

- [Alchemy Solana subscription endpoints](https://www.alchemy.com/docs/reference/solana-subscription-api-endpoints)
- [Alchemy `logsSubscribe`](https://www.alchemy.com/docs/reference/logs-subscribe)
- [Alchemy pricing plans](https://www.alchemy.com/docs/reference/pricing-plans)
- [Alchemy compute-unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs)
- [Alchemy Yellowstone quickstart](https://www.alchemy.com/docs/reference/yellowstone-grpc-quickstart)
- [Solana `logsSubscribe`](https://solana.com/docs/rpc/websocket/logssubscribe)
- [Solana `getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress)
