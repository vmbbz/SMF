# Changelog

All notable StickLash release changes are tracked here.

## 2026-08-29 - Mobile Fight Controls and Lifecycle

### Fixed

- Made HOME a true end-session action: it destroys the active game loop, unregisters per-game listeners, stops live boost work, clears every game alias and input reference, cancels Endless auto-advance, clears the canvas, and returns to a clean landing state.
- Added an explicit `Game.destroy()` lifecycle so rematches, matchmaking transitions, room expiry, Token Exhibition, and navigation cannot leave stale animation loops or pause listeners behind.
- Snapshot old input and voice adapters before asynchronous teardown so a late cleanup cannot detach controls created by the next fight.
- Made UI pause transitions pause stage music without changing the player's saved music preference; resuming restarts music only when autoplay remains enabled.
- Kept the landing market strip from covering the fight strip, so the visible in-fight context action is always PAUSE/RESUME rather than the landing HELP action.
- Guarded canvas image drawing against completed-but-broken remote images; fighters now fall back to their neon placeholders instead of aborting a render frame.

### Changed

- Replaced the market-strip `?` control during gameplay with a high-visibility PAUSE button and an explicit RESUME state. Outside an active round it remains HELP.
- Removed the fight-blocking developer boost modal and top-HUD boost button.
- Added an animated mobile joypad boost layer for local human-v-AI fights: BOOST remaps LP/LK/HP/HK to MICRO/RUN/SPIKE/OVER, and ATTACK restores normal moves.
- Kept authoritative multiplayer on the existing SP/Hadouken path. The local cinematic boost layer is rejected in Token Exhibition and multiplayer and cannot affect ELO, leaderboards, settlement, or rewards.
- Lowered the compact mobile game-mode panel by 50 pixels so it clears the top menu controls.

## 2026-08-28 - Score-Saturated Alchemy Evidence

### Changed

- Made dense candidate polling score-complete after 31 distinct valid in-window signatures, the exact point where the Director's logarithmic Alchemy bonus reaches its eight-point cap.
- Preserved exact enumeration for sparse candidates and fail-closed behavior for request failures, candidate-set changes, duplicate-only pages, and page-budget truncation.
- Added explicit exact-versus-lower-bound count semantics, saturated-candidate counts, score threshold, and full-window enumeration state to the API and public Arena Status page.
- Added count semantics to Director candidate metrics and deterministic decision snapshots; Arena Director advanced to `0.2.1`.
- Advanced the public arena evidence schema to `2026-08-28.v9`.

### Evidence Boundary

- `coverageComplete` now explicitly means score-complete candidate coverage, not exhaustive enumeration of every dense window.
- A saturated positive observation is rendered as `AT LEAST N`; zero is never labelled as a lower bound and is shown only when the current rolling window is exact.
- Alchemy observations remain neither trades nor volume and cannot affect ELO, leaderboard eligibility, or rewards.

## 2026-08-28 - Dense-Mint Page Allocation

### Changed

- Raised the per-candidate pagination cap from two to five pages after production proved that one current trending mint exceeded 2,000 signatures inside the bounded 512-slot window.
- Kept the shared extra-page budget at eight, so the maximum request and CU ceilings are unchanged while one dense candidate can consume up to four of those extra pages.
- Advanced the public arena evidence schema to `2026-08-28.v8`.

## 2026-08-28 - Bounded Alchemy Retry Evidence

### Added

- Added sanitized final-failure and request-attempt code counts so operators can distinguish HTTP 429, timeout, transport, and non-retryable RPC failures without logging provider URLs or response bodies.
- Added a four-request global retry budget per HTTP poll cycle with bounded 1/2/4/4-second backoff for timeouts, transport failures, HTTP 408/429/5xx, and JSON-RPC 429 responses.

### Cost and Contract

- Included the retry ceiling in public CU estimates. At the 32-candidate cap, the baseline remains 18.72 million CUs, pagination raises the ceiling to 23.328 million, and the complete pagination-plus-retry ceiling is 25.632 million CUs per 30 days before unrelated account traffic.
- Advanced the public arena evidence schema to `2026-08-28.v7`.

## 2026-08-28 - Dense-Candidate Persistence Stabilization

### Fixed

- Replaced per-signature PostgreSQL writes during Alchemy HTTP polling with one bounded insert-and-merge transaction per provider page. Dense token mints can no longer hold a complete cycle open through hundreds of sequential pool acquisitions.
- Preserved signature-hash deduplication and merged mint attribution across rewind overlap and candidates while retaining process-memory fallback for database faults.

### Evidence

- Public reliability health now reports the current poll start, last completed/failed poll duration, and `one_postgres_batch_per_rpc_page` persistence mode.
- Advanced the public arena evidence schema to `2026-08-28.v6`.

## 2026-08-28 - Production Alchemy Polling Hardening

### Fixed

- Suppressed `httpx` and `httpcore` request logging below WARNING because an authenticated Alchemy Solana HTTP URL contains the server-only key in its path.
- Replaced the one-page busy-candidate failure with bounded pagination: up to 1,000 signatures per page, at most two pages per candidate, and at most eight extra pages across one cycle.
- Kept the all-or-nothing evidence gate: exhausting a candidate or global page budget remains visible as truncation and returns `null` rather than a misleading partial count.

### Cost and Contract

- The 32-candidate baseline remains 18.72 million CUs per 30 days at a 180-second interval. The bounded pagination ceiling is 23.328 million CUs, excluding retries and all other account traffic.
- Public recovery health now reports pages requested, extra pages used, per-candidate and per-cycle page caps, and baseline versus bounded cost estimates.
- Advanced the public arena evidence schema to `2026-08-28.v5`.

## 2026-08-28 - Bounded Free-Tier Alchemy HTTP Evidence

### Added

- Added `solana_http_polling`, a server-only default that runs one confirmed `getSlot` plus one rate-spaced `getSignaturesForAddress` request per current Birdeye candidate every 180 seconds.
- Added all-or-nothing poll coverage, durable completed-cycle cursoring, 32-slot rewind, 512-slot clamping, a 100-signature per-candidate cap, signature-hash dedupe, and fail-closed truncation handling.
- Added public poll-cycle counters and compute-unit estimates for the current and maximum candidate sets. At the 32-candidate cap and 180-second interval, the documented method assumptions estimate 18.72 million CUs per 30 days before retries or other app traffic.

### Changed

- Made `solana_http_polling` the free production default after the configured production Alchemy WebSocket returned JSON-RPC method-not-found for both `rootSubscribe` and its `slotSubscribe` fallback.
- Kept `solana_pubsub` as an explicit account-capability evaluation path and `yellowstone_grpc` as an explicit paid/credit path; neither is a release dependency.
- Updated Director provenance, Help copy, `/arena`, operator docs, and the public evidence contract to distinguish bounded polling from a live subscription or native replay.
- Advanced the public arena evidence schema to `2026-08-28.v4`.

### Safety and Cost Gates

- A cycle supplies a zero or positive activity observation only after every candidate request completes inside the bounded window; any failure, truncation, stale cycle, or candidate-set change returns `null` and contributes no score.
- The lifecycle refresh owns the candidate set. Public Director requests remain read-only and cannot trigger Alchemy calls.
- Default maximum usage is estimated below the documented 30-million-CU free allowance, but the estimate excludes retries and all other Alchemy traffic; operators must keep dashboard alerts enabled.

## 2026-08-28 - Free-Tier Alchemy Solana Stream

### Added

- Added a server-only Alchemy Solana PubSub transport that works with the existing free-tier app key: one finalized root heartbeat and one confirmed `logsSubscribe` filter per candidate mint.
- Added bounded `getSignaturesForAddress` reconnect backfill with a durable slot cursor, 32-slot overlap, per-candidate history caps, serialized cooldowns, truncation evidence, and signature-hash deduplication.
- Added active, pending, and failed subscription counts plus explicit recovery mode and coverage completeness to public arena health.
- Added explicit coverage provenance so judges can distinguish a complete bounded backfill from a complete continuously observed live window.
- Added a provider-capability fallback from unsupported `rootSubscribe` to the finalized `root` field of `slotSubscribe`, with the selected heartbeat source disclosed publicly.

### Changed

- Made `solana_pubsub` the default Alchemy transport. Paid Yellowstone remains available only through `ALCHEMY_STREAM_TRANSPORT=yellowstone_grpc` for a later credit-funded evaluation.
- Arena Director provenance now distinguishes `alchemy_solana_pubsub_candidate_activity` from Yellowstone and rejects unknown transport labels.
- Public Director requests now consume matching stream evidence read-only; only the timed server lifecycle may mutate candidate filters or trigger candidate backfill.
- Public Help and `/arena` copy now describe PubSub and bounded HTTP recovery rather than claiming Yellowstone or native replay.
- Public arena evidence schema advanced to `2026-08-28.v3` for transport-specific subscription and recovery evidence.

### Safety and Cost Gates

- No candidate receives an Alchemy bonus until every current filter is acknowledged, transport freshness is current, and observation-window coverage is complete.
- Backfill failures or truncation produce `null` activity evidence instead of a misleading zero; eligibility returns only after every filter and the root heartbeat remain active for one complete scoring window, while the old recovery fault stays visible.
- The Alchemy key remains backend-only, endpoint configuration rejects embedded credentials, and free-tier usage remains bounded to at most 32 candidate filters and 25 backfill signatures per candidate by default.

## 2026-08-28 - Autonomous Token Exhibition

### Added

- Replaced Agent Lab with a spectator-only Token Exhibition that randomly pairs two distinct real mints from the fresh and already loaded Solana market pool.
- Added symmetric token names, icons, market stats, bounded arena power, and visible Momentum Rush, Reversal Hunter, Liquidity Tank, Volume Pressure, and Degen Wildcard combat styles.
- Added local-only tactical agents for both corners, fresh-pair rerolls, token-aware intro/result cards, and autonomous exhibition share copy.
- Added a public Help guide and `docs/TOKEN_EXHIBITION.md` covering selection, scaling, AI behavior, failure handling, and economic boundaries.

### Safety and Fairness

- Exhibition fighters make no LLM-provider calls and accept no keyboard, touch, phone, voice, or remote input.
- The mode stops one-sided live-market boosts, bypasses paid-boost settlement without consuming inventory, and cannot update ELO, leaderboards, or reward eligibility.
- Fewer than two distinct valid mints produces a visible retry state; StickLash does not fabricate token opponents.

### Verification

- Added deterministic tests for mint de-duplication, distinct pairing, rerolls, style thresholds, bounded power, non-mutating tactical transforms, and zero provider requests.

## 2026-08-28 - Modal Pause Ownership

### Fixed

- Closing Help after visiting Economy & Rewards or Arena Status now releases every informational-overlay pause and resumes the active fight.
- Read-only pages no longer show the false "complete wallet action" instruction.
- Help-to-page and page-to-Help handoffs retain an uninterrupted pause, preventing the round timer or fighters from advancing between overlays.

### Changed

- Informational overlays and token-switch confirmation now use the neutral `smf_gameplay_pause` event; actual wallet flows retain `smf_wallet_action_pause`.
- The game owns one reason-aware pause ledger across both event channels, so closing one surface releases only its own reason and cannot override another active safety pause.
- Added reason-specific, mobile-length pause copy for Help, Rewards, Arena Status, token switching, wallet connection, wallet security, and boost purchase flows.

## 2026-08-28 - Mobile Menu and Practice Clarity

### Changed

- Removed the obsolete seven-day launch timeline from Help and expanded the mobile guide to a readable 96vw/94dvh surface with larger type, spacing, and controls.
- Compacted the mobile home panel and placed Trending and Endless side by side so Help and the live-market footer remain reachable.
- Expanded the AI opponent picker on mobile and clarified that its two cards are distinct LLM personas rather than market tokens.
- Reframed AI practice as a spectator-only Agent Lab: the chosen LLM fights a stable local simulation benchmark with touch controls hidden, outside ELO and rewards.
- Added the loaded-token count to the scrolling market strip so its narrow mobile viewport is not mistaken for a two-token feed.

## 2026-08-28 - Alchemy Yellowstone Evidence Gate

### Added

- Server-only Alchemy Yellowstone gRPC adapter for confirmed activity involving bounded Birdeye-discovered candidate mints.
- Durable PostgreSQL replay cursor and pruned signature-hash dedupe cache with 32-slot rewind, replay-window clamping, ping handling, bounded ingress, and exponential reconnect.
- Public `marketStream` health and provenance in `/api/arena/status`, rendered on the Help-linked `/arena` page.
- Pinned Apache-2.0 Yellowstone protocol bindings with release hashes and license provenance.
- Operator runbook and claim boundaries in `docs/ALCHEMY_STREAM.md`.

### Changed

- Arena Director upgraded to v0.2 with a logarithmic confirmed-activity bonus capped at eight points.
- Birdeye remains required for discovery/base scoring; stale or unavailable Alchemy streaming contributes no bonus and cannot block selection.
- Public arena evidence schema advanced to `2026-08-28.v2`.

### Safety Gates

- Streaming remains explicitly disabled until `ALCHEMY_STREAM_ENABLED=1` and a server-only key with Yellowstone access are configured.
- Production may claim live Alchemy streaming only after fresh status, an advancing confirmed slot, a durable cursor, restart replay/dedupe, and Birdeye failover are verified.
- Stream observations are not labeled trades, USD volume, revenue, unique users, leaderboard eligibility, or rewards.

## 2026-05-26 - Android MWA Return + 2D Hadouken Release

Release notes: [releases/2026-05-26-android-mwa-fireball.md](releases/2026-05-26-android-mwa-fireball.md)

### Added

- Native Android Solana MWA Sign-In with Solana flow for wallet auth.
- Backend SIWS verification endpoint: `POST /api/wallet-auth/verify-siws`.
- Android wallet resume/callback recovery so Phantom approvals can return cleanly to the game.
- 90-second wallet bridge timeout and double-tap guard to prevent overlapping wallet launches.
- 2D sketch-style Hadouken fireballs with flame tails, ember strokes, and flat cel-shaded motion.
- Official release-note structure under `releases/`.

### Changed

- Android APK is refreshed with synced `www` and Capacitor assets.
- Hadouken projectile visuals no longer use glossy radial-gradient glass balls.
- Wallet connect UX now reports "wallet ready" only when a secure boost session exists.

### Verified

- `node --check src/game.js`
- `gradlew assembleRelease`
- APK v2 signature verification with `apksigner`
- APK content check for the new Hadouken render markers

### Known Follow-Ups

- Bump Android `versionCode` and `versionName` before a formal store submission.
- Prefer GitHub Release assets or Git LFS for APK distribution if APK churn becomes heavy.
- Real-device smoke test required after every wallet-flow release.

