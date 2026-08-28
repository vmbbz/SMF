# Alchemy Solana Candidate Activity Evidence

Status: bounded Solana HTTP polling is the free production default. Solana
PubSub is retained as an explicit capability test, and Yellowstone gRPC remains
an explicit paid or sponsored evaluation path. HTTP polling is not described as
a live subscription or native replay.

## Purpose and evidence boundary

Birdeye answers **which tokens should be considered** and supplies the market
measurements that shape their fighters: volume, price movement, liquidity, and
listing state. Alchemy supplies one narrower fact:

> During a recent bounded window, how many confirmed Solana transactions found
> by this backend mentioned a currently monitored candidate mint?

That evidence can add responsiveness between Birdeye discovery refreshes. It
does not prove that an observation was a swap, buy, sale, unique trader,
StickLash user, token amount, USD amount, revenue event, or StickLash-generated
volume. It never affects ELO, leaderboard eligibility, boost settlement, or
reward entitlement.

## Free production flow

```text
Birdeye trending + graduated discovery
                 |
                 | at most 32 candidate mints
                 v
Alchemy Solana HTTP polling every 180 seconds
  getSlot(commitment=confirmed) once
  getSignaturesForAddress once per candidate
                 |
                 | slot clamp + complete-cycle gate
                 v
PostgreSQL completed-cycle cursor + signature-hash dedupe
                 |
                 v
Arena Director v0.2
  Birdeye base score + optional max-8 activity bonus
                 |
                 +----> provider provenance on each decision
                 +----> /api/arena/status -> /arena
```

Only the server lifecycle refresh may replace the candidate set. Director
requests consume matching observations read-only; a client cannot force a poll,
change candidates, or expand the configured cap.

The browser and Android WebView never connect to Alchemy and never receive the
API key. The backend builds the authenticated `/v2/<key>` URL only in memory.
Public output exposes the sanitized Alchemy hostname, never a path, query,
credential, raw signature, or provider response body.

## Why HTTP polling is the default

The existing free Alchemy key works for standard Solana HTTP RPC. During the
28 August production check, the configured Alchemy WebSocket accepted the
connection but returned JSON-RPC `-32601` for both `rootSubscribe` and the
`slotSubscribe` capability fallback. That is account/app behavior, not evidence
that Alchemy's documented PubSub product does not exist. StickLash therefore
defaults to the path verified to be available and leaves PubSub opt-in until an
app can pass the method-support and production proof gates.

Yellowstone gRPC requires PAYG, Enterprise, or sponsored access. Paying before
release interest exists is not required for the game loop, Birdeye discovery,
or the bounded Alchemy signal.

## Poll contract

Each cycle snapshots the current lifecycle-managed candidate set and then:

1. loads the latest completed-cycle cursor;
2. requests the current confirmed slot with `getSlot`;
3. rewinds the cursor by 32 slots;
4. clamps work to at most 512 slots behind the current slot;
5. calls `getSignaturesForAddress` once per candidate, sequentially, with a
   default maximum of 100 signatures;
6. retains only successful signatures inside the bounded slot range;
7. hashes each signature with SHA-256 and merges duplicate mint attribution;
8. accepts the cycle only if every candidate request completed without failure
   or truncation and the candidate set did not change during the cycle; and
9. saves the current slot as the new cursor only after that complete cycle.

Requests are spaced by 200 ms to remain conservative against free-tier
throughput. A candidate change wakes the worker, but the existing minimum
backfill interval still prevents rapid repeated work.

If no cursor exists, the first cycle scans the full bounded 512-slot window. A
result that reaches its signature limit before crossing the requested floor is
reported as truncated. There is no silent pagination or unbounded catch-up.

## Freshness and zero-count rule

The default interval is 180 seconds. The HTTP freshness threshold is the larger
of the configured base threshold and the poll interval plus 50% scheduling
jitter, with at least 30 seconds of jitter. At the default interval this is 270
seconds.

A zero is returned only when all of these are true:

1. at least one candidate exists;
2. the latest poll completed within the freshness threshold;
3. every current candidate was covered by that same complete cycle;
4. no request failed or hit the per-candidate limit; and
5. the activity cache contains zero matching signatures in the active window.

Otherwise the observation count is `null`, `activity.scoreEligible` is false,
and the Director receives no Alchemy bonus. Birdeye selection remains available.

## Cost guard

The public health record exposes estimates rather than hiding request volume.
Using Alchemy's documented method costs as of 28 August 2026:

- `getSlot`: 20 compute units;
- `getSignaturesForAddress`: 40 compute units; and
- one cycle: `20 + (40 x candidate_count)` compute units.

At the maximum 32 candidates and one cycle every 180 seconds:

```text
1,300 CU/cycle x 14,400 cycles/30 days = 18,720,000 CU/30 days
```

Alchemy documents 30 million CUs per month on the Free plan. The 18.72 million
figure is therefore a guardrail, not a bill prediction: it excludes retries,
`SOLANA_RPC` traffic, dashboard tests, and every other request using the same
Alchemy account. Operators must keep usage alerts enabled and re-check current
pricing before increasing the candidate cap or poll frequency.

## Dedupe and persistence

When `DATABASE_URL` is healthy, startup creates:

- `alchemy_stream_cursor`: singleton latest completed slot and timestamp; and
- `alchemy_stream_transactions`: recent signature hash, slot, observation time,
  and matching candidate mints.

The same signature may be returned for more than one candidate. The store
merges mint attribution while counting the signature once globally and once for
each matching candidate. Raw signatures, logs, transaction bodies, wallet
addresses, instructions, and provider payloads are not stored.

Rows age out after the configured dedupe-retention window. These tables are
operational ingestion state, not public telemetry, financial ledgers, or reward
sources. Process-memory fallback remains available for development, but public
status becomes `degraded` and reports `cursorDurable: false`.

## Director scoring

Arena Director v0.2 preserves Birdeye as the dominant policy:

| Signal | Maximum points |
|---|---:|
| 24-hour volume | 42 |
| Absolute 24-hour price movement | 23 |
| Liquidity | 25 |
| Graduated-discovery bonus | 10 |
| Confirmed Alchemy candidate activity | 8 |

For `n` observed confirmed transactions in the activity window:

```text
min(log2(1 + n) / 5, 1) * 8
```

The logarithm and eight-point cap prevent noisy activity from overwhelming
market quality. HTTP-poll decisions identify the optional source as
`alchemy_solana_http_candidate_activity`; PubSub and Yellowstone use distinct
source labels. Unknown, stale, partial, or unverified transport labels are not
score-eligible.

## Public health contract

`GET /api/arena/status` retains the legacy top-level name `marketStream` for API
compatibility. Its transport-specific evidence includes:

- `transport: solana_http_polling` and protocol version;
- sanitized endpoint host, state, freshness, last completed cycle, and slot;
- monitored, covered, pending, and failed candidate counts;
- confirmed HTTP method names and zero active WebSocket connections;
- bounded floor, limits, failures, truncation, cursor durability, and coverage;
- attempted, completed, and failed poll cycles;
- current and maximum 30-day compute-unit estimates; and
- an activity count only after the complete-cycle freshness gate passes.

`activeCandidateCount` means candidates covered by the latest complete HTTP
cycle. It does not mean active WebSocket subscriptions.

| Status | Meaning | Activity score allowed? |
|---|---|---:|
| `disabled` | Operator has not enabled the worker | No |
| `misconfigured` | Key, transport, or safe endpoint is invalid | No |
| `waiting_for_candidates` | No lifecycle candidate set exists | No |
| `waiting_for_poll` | Candidate set changed and awaits a complete cycle | No |
| `polling` | A bounded cycle is in progress | No |
| `live` | Fresh complete cycle and durable cursor | Yes |
| `degraded` | Incomplete cycle or non-durable cursor | Only if `activity.scoreEligible` is explicitly true |
| `stale` | Latest completed cycle exceeded its threshold | No |
| `stopped` | Configured worker is not running | No |

Always interpret `activity.scoreEligible`; never infer eligibility from status
text alone.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `ALCHEMY_STREAM_ENABLED` | `0` | Explicit activation gate |
| `ALCHEMY_API_KEY` | empty | Server-only Alchemy app key |
| `ALCHEMY_STREAM_TRANSPORT` | `solana_http_polling` | Free default; optional PubSub or Yellowstone |
| `ALCHEMY_SOLANA_HTTP_ENDPOINT` | mainnet Alchemy HTTPS host | HTTP host without `/v2/key` |
| `ALCHEMY_SOLANA_WS_ENDPOINT` | mainnet Alchemy WSS host | Optional PubSub host without `/v2/key` |
| `ALCHEMY_YELLOWSTONE_ENDPOINT` | mainnet Alchemy HTTPS host | Paid transport only |
| `ALCHEMY_STREAM_POLL_INTERVAL_SECONDS` | `180` | Poll cadence; clamped to 60-1800 |
| `ALCHEMY_STREAM_FRESHNESS_SECONDS` | `20` | Base threshold; polling cadence adds jitter allowance |
| `ALCHEMY_STREAM_ACTIVITY_WINDOW_SECONDS` | `180` | Per-candidate count window |
| `ALCHEMY_STREAM_MAX_CANDIDATES` | `32` | Candidate and request cap |
| `ALCHEMY_STREAM_CANDIDATE_REFRESH_SECONDS` | `180` | Birdeye candidate refresh |
| `ALCHEMY_STREAM_REWIND_SLOTS` | `32` | Cursor overlap |
| `ALCHEMY_STREAM_BACKFILL_MAX_SLOTS` | `512` | Bounded slot window |
| `ALCHEMY_STREAM_BACKFILL_LIMIT_PER_CANDIDATE` | `100` | Signature cap; max 1000 |
| `ALCHEMY_STREAM_BACKFILL_MIN_INTERVAL_SECONDS` | `60` | Repeat-work guard |
| `ALCHEMY_STREAM_DEDUPE_RETENTION_SECONDS` | `21600` | Signature-hash retention |
| `ALCHEMY_STREAM_RPC_TIMEOUT_SECONDS` | `12` | HTTP/connection timeout |
| `ALCHEMY_STREAM_MAX_REPLAY_SLOTS` | `6000` | Yellowstone-only replay clamp |

Endpoint settings accept only credential-free Alchemy hosts with the expected
scheme. `SOLANA_RPC` is a separate backend setting and does not silently enable
candidate activity evidence.

## Production activation and proof gate

1. Store `ALCHEMY_API_KEY` as a secret environment value.
2. Set `ALCHEMY_STREAM_TRANSPORT=solana_http_polling` and
   `ALCHEMY_STREAM_ENABLED=1`.
3. Keep the credential-free HTTP endpoint default and deploy.
4. Require `/health` HTTP 200 and durable PostgreSQL persistence.
5. Inspect `/api/arena/status` and require:
   - `transport == "solana_http_polling"`;
   - `status == "live"` and `freshness == "fresh"`;
   - active candidate coverage equals candidate count;
   - `subscription.connectionCount == 0`;
   - `replay.cursorDurable == true` and `coverageComplete == true`;
   - zero failures and truncations;
   - a recent completed poll and advancing slot; and
   - no credential in the response or logs.
6. Request one Director decision. The HTTP input source may appear only while
   `activity.scoreEligible` is true.
7. Restart once and verify the cursor rewinds without duplicate inflation.
8. Disable Alchemy in a controlled environment and confirm Birdeye still
   selects an opponent with no Alchemy bonus.

Do not seed or simulate public counters.

## Optional transports

`solana_pubsub` remains implemented with one confirmed `logsSubscribe` mentions
filter per candidate, heartbeat fallback, bounded recovery, reconnect, and
backpressure. It may be selected only after the exact Alchemy app proves
`rootSubscribe` or `slotSubscribe`, all candidate subscriptions, restart
recovery, and public freshness in a controlled environment.

After credits or PAYG access exists, `yellowstone_grpc` may be evaluated for
native replay and lower-latency delivery. Do not call the production path
PubSub, WebSocket streaming, or Yellowstone unless live telemetry reports that
exact transport and its proof gate passes.

## Claim boundary

Allowed after HTTP production proof:

- "Alchemy Solana HTTP polling supplies bounded confirmed candidate-activity
  observations."
- "StickLash exposes freshness, complete-cycle coverage, durable recovery,
  dedupe, cost estimates, and Birdeye failover."
- "Recent confirmed candidate activity contributes a capped optional score."

Not supported:

- "Alchemy is live-streaming StickLash data" while HTTP polling is selected.
- "Every observation is a trade or unique trader."
- "Alchemy supplies StickLash prices or USD volume."
- "The evidence proves StickLash revenue or generated onchain volume."
- "The observations create leaderboard points or reward entitlement."
- "HTTP polling or PubSub has native replay" or "no event can be missed."

## References

- [Alchemy Solana HTTP endpoints](https://www.alchemy.com/docs/reference/solana-api-endpoints)
- [Alchemy Solana subscription endpoints](https://www.alchemy.com/docs/reference/solana-subscription-api-endpoints)
- [Alchemy pricing plans](https://www.alchemy.com/docs/reference/pricing-plans)
- [Alchemy compute-unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs)
- [Alchemy Yellowstone quickstart](https://www.alchemy.com/docs/reference/yellowstone-grpc-quickstart)
- [Solana `getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress)
