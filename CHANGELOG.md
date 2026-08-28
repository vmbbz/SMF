# Changelog

All notable StickLash release changes are tracked here.

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

