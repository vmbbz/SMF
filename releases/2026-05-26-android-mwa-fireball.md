# 2026-05-26 - Android MWA Return + 2D Hadouken Release

## Summary

This release refreshes the Android APK with the hardened Solana Mobile Wallet Adapter flow and the new 2D Hadouken fireball visual pass.

The important release goal is trust and feel:

- Phantom/MWA wallet approvals should return to StickLash more reliably.
- Wallet auth now supports native Sign-In with Solana verification.
- Hadouken projectiles now look like stylized 2D fireball sketches instead of glossy 3D glass balls.

## Artifact

| Field | Value |
|---|---|
| APK | `android/app/release/stickler-app-release.apk` |
| Mirror APK | `android/app/release/app-release.apk` |
| Application ID | `com.solanamemefighter.app` |
| Version name | `1.0` |
| Version code | `1` |
| APK size | `88,897,739` bytes |
| APK SHA-256 | `797907C74DBD6005465DD1ADABA816D018F02A8DAD0BBFEC64A8A0D5BAD3ED0A` |
| APK signing scheme | v2 verified |
| Signer SHA-256 | `84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76` |

## Changes

### Android Wallet / Solana MWA

- Added native Android `signIn` support in `SolanaMwaPlugin.kt`.
- Added native resume notification so the web layer can recover when the wallet app returns focus.
- Added frontend wallet bridge timeout protection.
- Added wallet connect in-flight guard to stop rapid double-taps from launching overlapping Phantom flows.
- Added native SIWS verification path through `POST /api/wallet-auth/verify-siws`.
- Preserved the older connect/sign-message fallback path for wallets that do not complete SIWS cleanly.

### Gameplay Visuals

- Replaced radial-gradient sphere Hadouken rendering with flat 2D cel-style fireball art.
- Added tapered flame shape, inner hot lick, ember dashes, and sketch speed strokes.
- Kept projectile gameplay unchanged: speed, collision, hitbox, damage, and boost consume logic are untouched.

## Verification Performed

- `node --check src/game.js`
- `gradlew assembleRelease`
- `apksigner verify --verbose --print-certs android/app/release/stickler-app-release.apk`
- APK content check confirmed `assets/public/src/game.js` contains:
  - `Outer hand-drawn flame silhouette`
  - `Soft 2D aura`
  - `Sketch strokes`

## Required Smoke Test

Run this on a real Android phone before announcing publicly:

1. Fresh-install `stickler-app-release.apk`.
2. Launch StickLash in portrait and landscape.
3. Start a fight and fire Hadouken.
4. Confirm the projectile looks like a 2D flame with a tail, not a glass orb.
5. Open the wallet modal and connect Phantom.
6. Choose an account in Phantom.
7. Confirm the app returns to StickLash and the wallet state updates.
8. If SIWS does not complete, confirm the fallback sign-in prompt still appears and gameplay resumes after closing the modal.
9. Confirm Live Market stream still loads or falls back gracefully if Birdeye quota is limited.

## Known Risks

- Android `versionName` and `versionCode` are still `1.0` and `1`. Bump them before a store-style release cadence.
- APK files are large for normal Git history. GitHub accepts this artifact, but GitHub Releases or Git LFS are cleaner long-term.
- Wallet behavior depends on installed wallet app behavior. Phantom, Solflare, and Backpack should each get a real-device pass.
- Birdeye free-tier exhaustion can still affect market freshness; server caching/fallbacks reduce but do not eliminate this risk.

## GitHub Release Copy

Title:

```text
StickLash Android v1.0 - MWA Return + 2D Hadouken
```

Tag suggestion:

```text
android-v1.0-2026-05-26-mwa-fireball
```

Body:

```text
This Android release refreshes StickLash with hardened Solana Mobile Wallet Adapter return handling, native Sign-In with Solana verification, and a new 2D sketch-style Hadouken fireball visual pass.

Highlights:
- Native Android MWA SIWS sign-in path.
- Wallet resume/callback recovery for Phantom return flow.
- Timeout and double-tap guards around wallet launch.
- Backend SIWS verification endpoint.
- Hadouken visuals changed from glossy 3D orb to 2D flame sketch with tail, embers, and speed strokes.

APK:
- stickler-app-release.apk
- SHA-256: 797907C74DBD6005465DD1ADABA816D018F02A8DAD0BBFEC64A8A0D5BAD3ED0A
- Signer SHA-256: 84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76

Before public blast:
- Fresh install on Android.
- Test Phantom wallet connect return.
- Fire Hadouken in portrait and landscape.
- Confirm market stream loads or fallback behaves gracefully.
```

