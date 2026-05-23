# STICKLASH EPIC KICKASS PROPOSAL v2
## Solana MWA First. Spotify Fully Dropped.

Date: May 23, 2026
Owner: Release Hardening Track

---

## 1) Strategic Pivot (Final)

Spotify is removed from product scope and codebase.

Reason:
- Compliance and platform complexity overhead is not worth launch risk.
- Core monetization and trust loop is Solana-native utility: buy boosts, burn $SMF, verify on-chain.
- Focus creates a clearer story for users, Seeker listing review, and market positioning.

New headline:
- "Fight, Boost, Burn on Solana."

---

## 2) Code Cleanup Completed (Spotify Purge)

These changes are now complete in repo:

1. `stick-fighter/index.html`
- Removed Spotify widget HUD mount.
- Removed Spotify Web Playback SDK script include.
- Removed `spotify-widget.js` module include.
- Removed Spotify init hook and help-modal Spotify copy.

2. `stick-fighter/wallet-connect.js`
- Removed Spotify token dependency in profile modal rendering.
- Removed Spotify disconnect button from modal.
- Removed cross-widget profile sync that targeted Spotify UI ids.
- Removed `window.disconnectSpotifyInModal` global.

3. `stick-fighter/server.py`
- Removed Spotify env/session state globals.
- Removed Spotify auth + token + polling endpoints:
  - `/api/spotify/login`
  - `/api/spotify/save-token`
  - `/api/spotify/check`
  - `/auth/spotify/callback`
- Removed Spotify route registration entries.
- Removed stale Spotify mention in endpoint section comment.

4. `src/spotify-widget.js`
- Deleted file.

5. Docs cleanup
- `README.md`: removed Spotify provider row, widget section, setup instructions, and architecture entry.
- `LAUNCH_GUIDE.md`: replaced Spotify redirect section with Solana wallet pre-release checklist.
- `PHASE5.md`: removed Spotify-specific wording.

---

## 3) What Still Must Change For Industrial Robustness

Important truth:
- Boost granting is still client-authoritative in `wallet-connect.js` + localStorage.
- That means a modded client can fake boost credits.

World-class target:
- Server-authoritative entitlement ledger with on-chain signature attestation.

---

## 4) Ultimate Solana MWA Architecture

### 4.1 Trust Model

Client responsibilities:
- Build purchase intent.
- Request wallet signature via MWA.
- Submit signature + intent id to backend.

Backend responsibilities:
- Verify transaction on-chain.
- Verify burn instruction semantic correctness.
- Enforce idempotency (no double-credit).
- Credit boosts only after final verification.
- Write immutable purchase ledger row.

### 4.2 UX Model (Web + Android)

Modal structure (single design language across desktop/mobile/landscape):
- Top: wallet identity chip + network status + risk badge.
- Middle: boost packs with exact token amount + USD estimate + burn explanation.
- Bottom: sticky CTA with 3-step progress:
  1. Prepare
  2. Sign in wallet
  3. Confirmed on-chain

Failure UX:
- Clear reason buckets: rejected, timeout, RPC fail, simulation fail, verification fail.
- One-click retry from same intent id.

---

## 5) Implementation Plan With File-Level Citations

### Phase A: Server-authoritative Purchase Flow

1. `server.py`
- Add `POST /api/boost/create-intent`
  - Inputs: `wallet`, `pack_id`, `expected_smf_amount`.
  - Output: signed `intent_id`, canonical burn policy, expires_at.
- Add `POST /api/boost/confirm`
  - Inputs: `intent_id`, `signature`, `wallet`.
  - Flow: fetch tx, verify burn instruction(s), verify mint, verify minimum burn amount, verify signer.
  - On success: credit boosts and persist ledger.
- Add `GET /api/boost/balance`
  - Returns server-authoritative boost count.

2. DB migration (new file)
- `migrations/2026_05_boost_ledger.sql`
- Tables:
  - `boost_purchase_intents`
  - `boost_purchase_ledger`
  - `player_boost_balances`
- Add unique constraints on `signature` and `intent_id`.

3. `wallet-connect.js`
- Replace local increment/decrement authority with backend sync:
  - Purchase: create intent -> sign/send -> confirm intent -> refresh server balance.
  - Use local cache only as display cache, never as source of truth.

### Phase B: MWA Native Bridge (Android)

1. `android/app/src/main/java/com/solanamemefighter/app/MainActivity.java`
- Register MWA plugin bridge.

2. New plugin files
- `android/app/src/main/java/com/solanamemefighter/app/mwa/MwaPlugin.java`
- `android/app/src/main/java/com/solanamemefighter/app/mwa/MwaSessionStore.java`
- Responsibilities:
  - Open wallet association intent.
  - Handle result callback.
  - Request sign-and-send.
  - Return structured result/errors to JS.

3. `android/app/src/main/AndroidManifest.xml`
- Add required `queries` for wallet intents.
- Add deep link intent handling for callback safety.
- Keep `android:exported` and launch mode consistent with Capacitor routing.

4. New JS adapter
- `src/solana-mwa-client.js`
- Runtime selection:
  - Android Capacitor -> native MWA plugin.
  - Browser -> `window.solana` wallet path.

### Phase C: UI Refinement (World-class modal)

1. `wallet-connect.js`
- Split giant template into composable render functions:
  - `renderWalletHeader()`
  - `renderBoostCatalog()`
  - `renderTxProgress()`
  - `renderErrorPanel()`

2. New style module
- `src/wallet-modal.css`
- Add coherent tokens:
  - spacing scale
  - semantic colors
  - elevation layers
  - motion timings

3. `index.html`
- Hook modal containers for portrait + landscape safe areas.
- Keep interaction surfaces 44px+ touch-safe.

---

## 6) Security Requirements (Non-negotiable)

1. Never trust client-side boost counts.
2. Verify burn semantics on backend before crediting.
3. Use idempotency keys for purchase confirmation.
4. Expire stale intents quickly (e.g., 10 min).
5. Log every failed verification path for abuse analytics.
6. Rate limit intent creation and confirm endpoints.

---

## 7) QA Matrix

1. Wallets
- Phantom mobile
- Backpack mobile
- Solflare mobile

2. Networks
- Mainnet-beta primary
- RPC failover path

3. Device/viewport
- Android portrait
- Android landscape
- Web desktop
- Web mobile landscape

4. Transaction outcomes
- User reject
- Signature timeout
- Insufficient token balance
- Burn instruction mismatch
- Confirmed success with replay attempt

---

## 8) Rollout Plan

1. Feature-flag server-authoritative boosts.
2. Shadow-mode verify tx server-side while old client flow still runs.
3. Switch credit authority to backend.
4. Enable MWA native bridge for Android builds.
5. Remove legacy purchase path.

---

## 9) Canonical References

1. Solana Mobile Wallet Adapter Spec
- https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html

2. Solana Mobile Docs
- https://docs.solanamobile.com/

3. SPL Token Program
- https://spl.solana.com/token

4. Solana Wallet Adapter (web ecosystem baseline)
- https://github.com/anza-xyz/wallet-adapter

5. Android App Links / Intents
- https://developer.android.com/training/app-links

---

## 10) Definition of Done

1. Spotify references removed from runtime codepaths.
2. Boost credits cannot be increased by localStorage manipulation.
3. Every successful boost purchase maps to verified on-chain signature + ledger row.
4. Android app can complete MWA connect + sign + confirm flow end-to-end.
5. Modal UX is responsive and consistent across desktop/mobile/landscape.

