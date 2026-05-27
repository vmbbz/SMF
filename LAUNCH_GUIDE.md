# STICKLASH Launch & Packaging Guide 🚀📦

This document outlines the detailed processes for building production-ready mobile binaries, registering with the Solana Mobile Seeker Store, and executing a strong launch campaign.

---

## 🔑 1. Solana Wallet Pre-Release Checklist

Before publishing, validate wallet UX and transaction trust signals:

1. Test wallet connect, disconnect, and reconnect flows in Phantom and Backpack.
2. Confirm burn transaction prompts clearly show token mint and amount before signing.
3. Verify final signatures on Solscan from the in-app confirmation state.
4. Run network failure tests and ensure users get actionable retry messaging.
5. Validate mobile landscape and portrait modal behavior for wallet and boost purchase panels.

---

## 📦 2. How to Build a Release APK

To package a fully optimized, signed release binary (`.apk`) for the Solana Seeker Store:

### Option A: Via Android Studio (Recommended)
1. Open the `./android` directory inside **Android Studio**.
2. From the top menu, go to **Build ➔ Generate Signed Bundle / APK...**
3. Select **APK** and click **Next**.
4. Create a new Keystore Path (`.jks` file) or select your existing release key, enter your keystore password, key alias, and key password, then click **Next**.
5. Set the Build Variant to **release** and check **V4 (Full Signature)**.
6. Click **Finish**. The optimized signed release APK will be compiled under:
   `android/app/release/app-release.apk`

### Option B: Via Command Line (Gradle)
1. Open your terminal and navigate to the `android/` directory:
   ```bash
   cd android
   ```
2. Run the Gradle release task:
   ```powershell
   ./gradlew assembleRelease
   ```
3. Locate your compiled release build at:
   `android/app/build/intermediates/apk/release/app-release-unsigned.apk`

---

## 📱 3. Solana Seeker Mobile dApp Store Publishing Guide

STICKLASH is fully optimized for native publication in the official **Solana Mobile dApp Store**!

### Publisher Console Registration
* Visit the [Solana dApp Store Publisher Console](https://publisher.solanamobile.com).
* Log in using a publisher wallet. Publishing a dApp is done entirely on-chain by minting a **dApp Release NFT** representing your application's cryptographic metadata.

### Key Listing Specifications
* **On-Chain Solana Integration**: Leverage our dual-mode Wallet Connect panel. Inside the Solana Seeker dApp Store browser, `window.solana` is natively injected, allowing players to connect Phantom/Backpack/Solflare directly, query live `$SMF` ATA balances, and sign transactions.
* **Target SDK Requirements**: 
  * Targets **SDK 34 (Android 14)** as mandated by the Seeker Mobile Store.
  * Integration of Google's security requirements: HTTPS-only Android Scheme and clear CORS policies inside `server.py` to prevent unauthorized domain access.

---

## 🚀 4. Product Hunt Launch Blueprint

To maximize the viral impact of STICKLASH:

### Assets Checklist
* **🎬 Teaser Promo Video**: Add a high-energy, 30-second gameplay clip showcasing a player getting absolutely slammed by a pumping token (Overdrive Hadouken rain) to the top of the README.md and Product Hunt gallery.
* **🎨 Glassmorphic Screenshots**: Feature the winner/loser victory flip animations and PvP leaderboard ranks.

### Post Schedule
1. **Launch at 12:01 AM PST**: Start on Product Hunt right as the daily leaderboard resets.
2. **Promotional Tweet (X)**: Tweet a pre-filled match victory link:
   > 🥋 I just got completely whipped by $PEPE on @StickLash! High volume boosts are insane. Buy pressure or LMAO WHIPLASH! Fight live: https://sticklash.fun
3. **Engage the Community**: Offer `$SMF` token rewards or live tournament lobbies on Discord to players who post screenshots of their endless streak on Product Hunt comments!
