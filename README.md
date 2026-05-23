# $SMF — STICKLASH 🥊⚡

> **The world's first Solana meme-token fighting game.**
> Real on-chain market data powers your opponent's health, damage, and speed. Fight trending tokens live from Pump.fun and Birdeye. Every match is dynamic because the blockchain never sleeps. 

---

### 🎬 Official Promo Video
![STICKLASH Trailer](assets/STICKLASH-Promo.mp4)

---

## 📱 Mobile App Downloads (Android)

Get straight into the arena with our pre-built packages:
* **📥 [Download Debug APK (Developer Edition)](file:///C:/Users/cosyc/StickFight/stick-fighter/android/app/build/intermediates/apk/debug/app-debug.apk)** — *Pre-compiled build for instant local testing and development analysis.*
* **🚀 GitHub Releases** — Download both debug and fully optimized release builds directly from the GitHub repository release section.

---

## 🎨 Design & Viral Aesthetics

STICKLASH is loaded with premium Web3 and traditional Eastern aesthetics:
* **🏮 Shojumaru Traditional Chinese Font**: The UI is wrapped in Google Font's gorgeous `'Shojumaru'` stylized font, giving the wallet modal, leaderboard, and user profiles a legendary martial arts vibe.
* **🎵 Procedural Guzheng & Pipa Plucks**: Powered by the Web Audio API, the background music dynamically synthesizes high-pitched traditional Chinese string plucks with C5–A6 pentatonic melodies, immediate pick-strike sawtooth transients, and a warm string resonance tail.
* **🛎️ Chinese Gong Splash ("dhsssss")**: A custom synthesized Chinese Gong sweep triggers at fight start and every 32 beats, blending a deep low-frequency pitch sweep with 7 high-frequency square wave oscillators routed through bandpass filters to form a sweeping metallic splash.
* **🥋 Physical Whip Impact SFX (`whip_impact.wav`)**: Hits landing on opponent's limbs (**arm** or **leg**) trigger a whip cracking impact sound, keeping physical kick sweeps and roundhouses sounding phenomenally distinct!
* **📱 Adaptive Viewport Stage Adjustments**: Built-in landscape auto-detection drops the floor Y coordinate to `logicalH - 95px` (exactly **80px lower** than legacy builds), shifting the fighters clear of the top HUD bars and timer for balanced mobile gaming.

---

## 🚀 Live Boost System: "LMAO WHIPLASH!"

Opponent stats are scaled directly from live token metrics. When a token is pumping hard in real-time, **Live Boosts** fire immediately to empower the opponent bot:

| Tier | Price Pump Trigger | Combat Effect |
|---|---|---|
| 🟠 **Runner** | `+20% to +45%` gain | Automatic 3-hit forward dash combo + brief stun |
| 🔴 **Spike** | `+45% to +100%` gain | 5-hit combo + P1 levitated in the air for `1.5s` |
| 🟣 **Overdrive** | `+100%+` (2× pump) | 10 rapid Hadoukens + P1 levitated for `3s` in full chaos |

### ⚠️ Survival Strategy
> **You MUST rely on active buy pressure or burn Live Boosts to stand a chance against pumping high-volume opponent tokens. Trying to fight a 2× pump vanilla will result in getting completely whipped — LMAO WHIPLASH!**

---

## 🎮 Game Features & Controls

### 🏟️ Game Modes
* **Trending Arena**: Fight a random token currently trending on Solana.
* **Endless Pump Stream**: An endless gauntlet of 12 trending tokens; includes an 8-second auto-advance victory bar.
* **Custom Fight**: Paste any Solana token mint address to fetch and fight it directly.
* **Multiplayer**: Peer-to-peer WebRTC matches with real-time profile picture ELO updates.

### 🎮 Touch Joysticks
* **Left Joystick**: Dynamic 8-directional virtual stick (Push up = JUMP, Down = CROUCH).
* **Right Attack Grid**: LP (Light Punch), LK (Light Kick), HP (Heavy Punch), HK (Heavy Kick), and a pulsing gold **SP** button for Hadouken energy projectiles.

---

## 🛠️ Step-by-Step Spotify Integration & Pairing Setup

To connect Spotify inside your mobile APK WebView and resolve authentication redirect errors:

### 1. Configure the `.env` File
In order for server-side code token exchanging to function, copy your client secret from the Spotify dashboard and append it to `stick-fighter/.env`:
```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

### 2. Configure Authorized Redirect URIs
Spotify's security policies require you to explicitly whitelist your exact callback URLs. 
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Select your App, click **Edit Settings**.
3. Under the **Redirect URIs** section, you **must add both of the following URLs**:
   * `https://sticklash.fun/auth/spotify/callback` *(Production server)*
   * `http://localhost:8000/auth/spotify/callback` *(Local testing)*
4. Save the settings. 

*This completely eliminates the `redirect_uri not matching configuration` error regardless of whether you verify via Email or SMS.*

---

## 📦 How to Build a Release APK

To package a fully optimized, production-ready signed Release APK for distribution:

### Option A: Via Android Studio (Recommended)
1. Open the `./android` folder inside **Android Studio**.
2. Go to **Build ➔ Generate Signed Bundle / APK...** in the top menu.
3. Select **APK** and click **Next**.
4. Create a new Keystore Path (`.jks` file) or select your existing release key, fill out the keystore passwords and alias, then click **Next**.
5. Set the Build Variant to **release** and select **V4 (Full Signature)**.
6. Click **Create / Finish**. The signed release APK will be generated under:
   `android/app/release/app-release.apk`

### Option B: Via Command Line (Gradle)
1. Open PowerShell and navigate to the android directory:
   ```bash
   cd android
   ```
2. Run the Gradle build task:
   ```powershell
   ./gradlew assembleRelease
   ```
3. Locate the compiled release APK under:
   `android/app/build/intermediates/apk/release/app-release-unsigned.apk`

---

## 📱 Solana Seeker Mobile dApp Store Publishing Guide

STICKLASH is fully optimized for listing in the official **Solana Seeker Mobile dApp Store**!

### 1. Publisher Console Registration
* Visit the [Solana dApp Store Publisher Console](https://publisher.solanamobile.com).
* Log in using a publisher wallet. Publishing a dApp is done entirely on-chain by minting a **dApp Release NFT** representing your application's cryptographic metadata.

### 2. Key Listing Specifications
* **On-Chain Solana Integration**: Leverage our dual-mode Wallet Connect panel. Inside the Solana Seeker dApp Store browser, `window.solana` is natively injected, allowing players to connect Phantom/Backpack/Solflare directly, query live `$SMF` ATA balances, and sign transactions.
* **Target SDK Requirements**: 
  * Targets **SDK 34 (Android 14)** as mandated by the Seeker Mobile Store.
  * Integration of Google's security requirements: HTTPS-only Android Scheme and clear CORS policies inside `server.py` to prevent unauthorized domain access.

---

## 🚀 Product Hunt Launch Blueprint

To maximize the viral impact of STICKLASH:

### 1. Assets Checklist
* **🎬 Teaser Promo Video**: Add a high-energy, 30-second gameplay clip showcasing a player getting absolutely slammed by a pumping token (Overdrive Hadouken rain) to the top of the README.md and Product Hunt gallery.
* **🎨 Glassmorphic Screenshots**: Feature the winner/loser victory flip animations and PvP leaderboard ranks.

### 2. Post Schedule
1. **Launch at 12:01 AM PST**: Start on Product Hunt right as the daily leaderboard resets.
2. **Promotional Tweet (X)**: Tweet a pre-filled match victory link:
   > 🥋 I just got completely whipped by $PEPE on @StickLash! High volume boosts are insane. Buy pressure or LMAO WHIPLASH! Fight live: smf.sticklash.com 
3. **Engage the Community**: Offer `$SMF` token rewards or live tournament lobbies on Discord to players who post screenshots of their endless streak on Product Hunt comments!

---

## 🏗️ Technical Stack
* **Frontend**: Vanilla HTML/CSS/JS (Direct Canvas 2D frame drawing)
* **Mobile Shell**: Apache Capacitor / Gradle
* **Announcer**: Deepgram Aura 2 Zeus TTS Announcer (24,000Hz)
* **Backend**: FastAPI / Litestar / Redis / PostgreSQL
* **API Feed**: Solana Birdeye API Proportional Scaling Core

---

## 📄 License
MIT — build on it, fight with it, ship it.
