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
- Final launch branding restores visible `$SMF` copy after the prerelease `$XXX` mask.
- Native APK market data now has multi-origin API fallback for Render/domain transition resilience.

## Artifact

| Field | Value |
|---|---|
| APK | `android/app/release/stickler-app-release.apk` |
| Mirror APK | `android/app/release/app-release.apk` |
| Application ID | `com.solanamemefighter.app` |
| Version name | `1.0` |
| Version code | `1` |
| APK size | `88,907,792` bytes |
| APK SHA-256 | `391BEC3E1D7C17D9CF03DD98AEE5AF5A20F8795874DC7F6DAB2DCB389D49600A` |
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
- Restored the original Solana logo as the fighter fallback image.
- Repaired the intended image routing: P1 profile photos drive P1 fighter/headbar/user menu, P2 token logos drive AI fighter/headbar/cards, and token cover/banner art drives the stage background when available.
- Added DexScreener header/openGraph cover capture on token detail refresh for richer stage backgrounds.

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

### Final Branding / Native Market Feed

- Restored `$SMF` in wallet copy, boost burn messages, share text, docs, manifest, server logs, and tests.
- Added an `$SMF-STICKLASH` application metadata marker while preserving the intentional `sticklashfun` browser title.
- Added native WebView API origin fallbacks for:
  - `https://sticklash.fun`
  - `https://www.sticklash.fun`
  - `https://smf-lzf3.onrender.com`
- Routed token trending, graduate scan, token detail, and next-fight fetches through the shared fallback helper.

## Verification Performed

- `node --check src/api-endpoints.js`
- `node --check src/solscan-trending.js`
- `node --check src/token-utils.js`
- `node --check src/main.js`
- `node --check wallet-connect.js`
- `python -m py_compile server.py`
- `uv run pytest tests/test_server.py::test_health tests/test_server.py::test_index_returns_html tests/test_server.py::test_room_route_returns_html tests/test_auth.py::TestMultiplayerRoute::test_multiplayer_serves_html tests/test_server.py::test_share_card_endpoint_serves_public_x_card -q`
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
  - `MUSIC_FLUTE_SVG`
  - `ensureMusicMenuIcon`
- APK content check confirmed `assets/public/index.html` contains:
  - `boost-menu-close`
  - `music-flute-icon`
  - `$SMF-STICKLASH`
- APK content check confirmed these packaged files contain `$SMF` and do not contain `$XXX`:
  - `assets/public/index.html`
  - `assets/public/wallet-connect.js`
  - `assets/public/src/main.js`
  - `assets/public/manifest.json`
- APK content check confirmed image hardening is packaged:
  - `assets/public/src/image-utils.js`
  - `assets/public/src/trending-strip.js` uses `proxiedImageUrl`
  - `assets/public/src/fighter.js` uses `loadGameImage` and `SOLANA_DEFAULT_HEAD_IMAGE`
  - `assets/public/src/loser-card.js` uses `smfProxiedImageUrl`
- Real-device APK screenshot confirmed:
  - P2 fighter head renders the token logo.
  - P2 health-bar avatar renders the token logo.
  - Stage background uses token banner/cover art when available.
  - P1 falls back to the restored Solana logo when no user photo is set.
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
14. Confirm wallet/boost/share copy says `$SMF`, not `$XXX`.
15. Confirm APK Live Market and game-mode token selection load data on the current production domain.

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
This Android release refreshes StickLash with hardened Solana Mobile Wallet Adapter return handling, native Sign-In with Solana verification, a 2D sketch-style Hadouken fireball visual pass, victory sharing fixes, mobile landscape boost UX polish, final $SMF branding, and native APK market-feed resilience.

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
- Final public branding restored from $XXX back to $SMF.
- Native APK market fetches now try sticklash.fun, www.sticklash.fun, and the Render service origin.

APK:
- stickler-app-release.apk
- SHA-256: 391BEC3E1D7C17D9CF03DD98AEE5AF5A20F8795874DC7F6DAB2DCB389D49600A
- Signer SHA-256: 84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76

Before public blast:
- Fresh install on Android.
- Test Phantom wallet connect return.
- Fire Hadouken in portrait and landscape.
- Confirm market stream loads or fallback behaves gracefully.
```

