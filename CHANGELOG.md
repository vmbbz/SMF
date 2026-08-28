# Changelog

All notable StickLash release changes are tracked here.

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

