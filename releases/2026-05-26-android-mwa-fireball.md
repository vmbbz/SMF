# 2026-05-26 - Android MWA Return + 2D Hadouken Release

## Summary

This release refreshes the Android APK with the hardened Solana Mobile Wallet Adapter flow, the new 2D Hadouken fireball visual pass, victory sharing fixes, and a mobile-landscape Live Boost usability patch.

The important release goal is trust and feel:

- Phantom/MWA wallet approvals should return to StickLash more reliably.
- Wallet auth now supports native Sign-In with Solana verification.
- Hadouken projectiles now look like stylized 2D fireball sketches instead of glossy 3D glass balls.
- Victory sharing now generates a proper battle card and public share-card route instead of localhost-only Twitter links.
- Live Boost defaults to P1/Human, has a close button, and supports outside-tap dismissal on mobile.
- Music now uses a custom bamboo-flute icon instead of sharing the home/temple icon.

## Artifact

| Field | Value |
|---|---|
| APK | `android/app/release/stickler-app-release.apk` |
| Mirror APK | `android/app/release/app-release.apk` |
| Application ID | `com.solanamemefighter.app` |
| Version name | `1.0` |
| Version code | `1` |
| APK size | `88,901,360` bytes |
| APK SHA-256 | `82D499C2E112D2977B4968C18A273A21E8FA55CAFE137B88BC1891AF5A8AC84C` |
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

### Victory Share / Social

- Replaced the localhost Twitter intent path with canonical `https://sticklash.fun` sharing.
- Added battle-card image composition from the game canvas.
- Added mobile Web Share file support when the device supports file sharing.
- Added backend share-card storage and public Open Graph/Twitter Card routes.
- Added fallback share panel with PNG download, copy link, and X composer actions.

### Live Boost UX

- Added a close button to the Live Boost modal.
- Added outside tap/click dismissal, including mobile `touchstart`, while preventing accidental game controls underneath.
- Changed boost target default from P2/AI to P1/Human.
- Resets the target to P1 whenever the boost menu opens.
- Reduced the match countdown font from the previous oversized bump.
- Hid the hotkey tip only in compact mobile landscape to preserve tap targets.

### HUD Music Icon

- Replaced the duplicate temple/home icon on the music menu with a custom inline SVG bamboo-flute icon.
- Synced the icon through source, `www`, and Android packaged assets before building the APK.

## Verification Performed

- `node --check src/game.js`
- `node --check src/main.js`
- `python -m py_compile server.py`
- `uv run pytest tests/test_server.py::test_health tests/test_server.py::test_share_card_endpoint_serves_public_x_card -q`
- `gradlew assembleRelease`
- `apksigner verify --verbose --print-certs android/app/release/stickler-app-release.apk`
- APK content check confirmed `assets/public/src/game.js` contains:
  - `Outer hand-drawn flame silhouette`
  - `Soft 2D aura`
  - `Sketch strokes`
- APK content check confirmed `assets/public/src/main.js` contains:
  - `boostTarget = 'p1'`
  - `dismissBoostMenuFromOutside`
  - `/api/share-card`
- APK content check confirmed `assets/public/index.html` contains:
  - `boost-menu-close`
  - `music-flute-icon`

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
10. Open Live Boost in mobile landscape, tap outside the card, and confirm it closes without firing an attack.
11. Reopen Live Boost and confirm P1/Human is selected by default.
12. Finish a fight and confirm share creates a battle card instead of a localhost-only X link.
13. Confirm the HUD music button uses the flute icon while home still uses the temple icon.

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
This Android release refreshes StickLash with hardened Solana Mobile Wallet Adapter return handling, native Sign-In with Solana verification, a 2D sketch-style Hadouken fireball visual pass, victory sharing fixes, and mobile landscape boost UX polish.

Highlights:
- Native Android MWA SIWS sign-in path.
- Wallet resume/callback recovery for Phantom return flow.
- Timeout and double-tap guards around wallet launch.
- Backend SIWS verification endpoint.
- Hadouken visuals changed from glossy 3D orb to 2D flame sketch with tail, embers, and speed strokes.
- Battle-card sharing with canonical sticklash.fun URLs.
- Live Boost close/outside-tap dismissal.
- Live Boost now defaults safely to P1/Human.
- Countdown timer reduced from the oversized previous bump.
- Music menu now uses a custom flute icon instead of duplicating the home temple icon.

APK:
- stickler-app-release.apk
- SHA-256: 82D499C2E112D2977B4968C18A273A21E8FA55CAFE137B88BC1891AF5A8AC84C
- Signer SHA-256: 84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76

Before public blast:
- Fresh install on Android.
- Test Phantom wallet connect return.
- Fire Hadouken in portrait and landscape.
- Confirm market stream loads or fallback behaves gracefully.
```

