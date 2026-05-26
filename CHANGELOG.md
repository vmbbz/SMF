# Changelog

All notable StickLash release changes are tracked here.

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

