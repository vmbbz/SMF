# Changelog

All notable StickLash release changes are tracked here.

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

