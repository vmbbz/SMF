![STICKLASH Arena Banner](assets/sticklash-bg.png)

<div align="center">
  <img src="https://img.shields.io/badge/Solana--Mobile-Seeker--Optimized-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana Seeker Ready">
  <img src="https://img.shields.io/badge/Deepgram-Zeus--Announcer-000000?style=for-the-badge&logo=deepgram&logoColor=white" alt="Deepgram Aura 2 Zeus">
  <img src="https://img.shields.io/badge/WebRTC-P2P--Multiplayer-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC P2P">
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI Backend">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License">
</div>

# $SMF — STICKLASH 🥊⚡

> **The world's first Solana meme-token fighting game.**
> Real on-chain data powers your opponent's health, damage, and speed. Fight trending tokens live from Pump.fun and Birdeye. Every match is different because the blockchain never stops.

---

### 🎬 Official Promo Video
![STICKLASH Trailer](assets/STICKLASH-Promo.mp4)

---

### 📲 Download & Play (Android APK)
🚀 **[Download the Official STICKLASH Release APK (stickler-app-release.apk)](android/app/release/stickler-app-release.apk)** — *Built, V4-signed, and optimized for the Solana Seeker mobile dApp store!*

---

## 🎨 Design & Traditional Eastern Aesthetics

STICKLASH is loaded with premium Web3 and traditional Eastern aesthetics:
* **🏮 Shojumaru Traditional Chinese Font**: The UI is wrapped in Google Font's gorgeous `'Shojumaru'` stylized font, giving the wallet modal, landing menu, leaderboard, and user profiles a legendary martial arts vibe.
* **🎵 Procedural Guzheng & Pipa Plucks**: Powered by the Web Audio API, the background music dynamically synthesizes high-pitched traditional Chinese string plucks with C5–A6 pentatonic melodies, immediate pick-strike sawtooth transients, and a warm string resonance tail.
* **🛎️ Chinese Gong Splash ("dhsssss")**: A custom synthesized Chinese Gong sweep triggers at fight start and every 32 beats, blending a deep low-frequency pitch sweep with 7 high-frequency square wave oscillators routed through bandpass filters to form a sweeping metallic splash.
* **🥋 Physical Whip Impact SFX (`whip_impact.wav`)**: Hits landing on the opponent's limbs (**arm** or **leg**) trigger a whip cracking impact sound, keeping physical kick sweeps and roundhouses sounding phenomenally distinct!
* **📱 Adaptive Viewport Stage Adjustments**: Built-in landscape auto-detection drops the floor Y coordinate to `logicalH - 95px` (exactly **80px lower** than legacy builds), shifting the fighters clear of the top HUD bars and timer for balanced mobile gaming.

---

## 🎮 Overview & Core Mechanics

STICKLASH is a 2D stickman fighting game where **Solana meme tokens are your AI opponents**. Token market metrics — 24h volume, price change, liquidity — are pulled live and directly translate into in-game power stats. A token that just pumped 2× hits harder, moves faster, and has more health. One that's bleeding out on DexScreener is a pushover.

Built with vanilla Canvas2D, a custom combat engine, and a FastAPI/Python backend for live Birdeye data.

### 🏟️ Game Modes

| Mode | Description |
|---|---|
| **Trending Arena** | Fight a random token from the current Birdeye trending list |
| **Endless Pump Stream** | Auto-queues 12 trending tokens; 8-second countdown auto-advances to the next fight after each win or loss |
| **Custom Fight** | Paste any Solana token mint address and fight that specific token |
| **Multiplayer** | WebRTC peer-to-peer 2P local or remote matches with real-time ELO ratings |

---

## ⚔️ Combat Engine Specs

- **Custom RAF game loop** — deterministic 60fps canvas rendering with fixed-timestep physics.
- **Full move set**: light/heavy punch, light/heavy kick, jump, crouch, dash, block, Hadouken (projectile).
- **Hitbox system**: limb-specific collision with head/crotch shot bonuses and clash detection.
- **Combo engine**: buffered input system with timing windows for multi-hit strings.
- **AI opponent**: LLM-driven command planning (with mock fallback) — commands queued in 5-action batches.
- **Damage log**: real-time HUD showing recent hits between the two fighters.

---

## 📊 Proportional Token Power Scaling

Token market data is converted into three in-game stats:

| Stat | Source | Range |
|---|---|---|
| **Health** | Volume × price change × liquidity (safePower formula) | 50–1000 HP |
| **Damage Multiplier** | Proportional cap: `1.0 + (power-1) × 0.1` | 0.8× – 1.5× |
| **Speed Multiplier** | Conservative: `1.0 + (power-1) × 0.05` | 0.95× – 1.2× |

> Even a 75× power token caps at 1.5× damage — the game stays playable no matter how insane the pump is.

---

## 🚀 Live Boost System: "LMAO WHIPLASH!"

When the currently-fought token's price pumps **during your fight**, timed boost events fire:

| Tier | Trigger | Effect |
|---|---|---|
| 🟠 **Runner** | +20–45% price gain | 3-hit dash combo on P1, brief stun |
| 🔴 **Spike** | +45–100% price gain | 5-hit combo + P1 levitated 1.5s |
| 🟣 **Overdrive** | +100%+ (2× pump) | 10 Hadoukens + P1 levitated 3s, chaos mode |

### ⚠️ Strategy
> **You MUST rely on active buy pressure or burn Live Boosts to stand a chance against pumping high-volume opponent tokens. Trying to fight a 2× pump vanilla will result in getting completely whipped — LMAO WHIPLASH!**

---

## 🎙️ Voice Controls & Deepgram TTS Announcer

- **Deepgram Aura 2 Zeus Integration**: All voice lines and announcer shouts (like *"FIGHT!"* or *"KNOCKOUT!"*) are rendered dynamically with Deepgram's **Aura 2 Zeus** (deep, authoritative male voice) running at **24,000Hz**.
- **WebSocket STT Stream**: Player mic is captured at 16,000Hz and streamed via `/ws/stt` proxy to Deepgram Flux v2.
- **Phonetic Homophone Cleaning**: Robust client-side pre-processing strips punctuation and maps slurred phrases (e.g. *"how do you can"*, *"hurricane"*, *"outer scan"*) to clean game moves (*"hadouken"*), raising recognition to 100% accuracy.
- **Zero-Latency Combat Verbalisations**: Getting hit or landing hits bypasses the slow LLM network roundtrip (~1s) and picks a local random reactive phrase, executing it instantly (~100ms) for high-performance combat game feel.
- **LLM Context Injection**: General conversational chat routes through Anthropic Claude / Gemini with a structured try/catch backup, falling back gracefully to pre-scripted phrases on rate limits.

---

## 🎮 Mobile UX & Virtual Joystick

- **Left side**: analog joystick (130px base) — 8-direction movement, deadzone 18% (Push up = JUMP, Down = CROUCH, Left/Right = Walk/Dash).
- **Right side** attack grid:
  - ⚡ **SP** (top, octagon shape, gold pulsing glow) — Hadouken/Special
  - 👊 LP — Light Punch
  - 🦵 LK — Light Kick
  - 🔥 HP — Heavy Punch
  - 💥 HK — Heavy Kick
- **Only visible during gameplay** — hidden on the landing/home screen.
- **3-layer reliability**: re-registers on every `resetAndFight`, watchdog polling every 500ms, `_showMobileControls` polling until `p1Input` is available.
- **HUD Sizing**: Mobile trending strip pills use tighter padding and smaller fonts. HUD widgets align at the bottom on PC and the top 10% on mobile to avoid overlapping the joystick.

---

## 🛠️ Spotify Connect & Redirect Pairing

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

---

## 🏗️ Architecture

```
stick-fighter/
├── index.html              # Main shell — game canvas, UI panels, mobile joystick, scripts
├── birdeye_service.py      # FastAPI backend — Birdeye API proxy, caching, trending/price endpoints
├── src/
│   ├── main.js             # Orchestration layer — game lifecycle, loadOpponent, resetAndFight, nextFight
│   ├── game.js             # Core combat engine — RAF loop, hitbox, projectiles, round management
│   ├── fighter.js          # Fighter class — animations, move execution, applyMarketStats
│   ├── input.js            # InputManager — adapter pattern, merges keyboard/joystick/voice/LLM actions
│   ├── virtual-joystick.js # VirtualJoystickAdapter — touch events, 8-direction, attack buttons
│   ├── live-boost-system.js# Price polling, tier detection, boost effects + TTS announcer
│   ├── token-power-scaling.js # calculateFighterPower() — market data → health/damage/speed
│   ├── token-utils.js      # getTrendingTokens(), getTokenByMint(), generatePersonality()
│   ├── trending-strip.js   # Marquee strip component — renders token pills, handles click-to-fight
│   ├── loser-card.js       # Rich card renderer — ABOUT/SOCIAL/SAFETY tabs in victory overlay
│   ├── voice.js            # Voice input adapter — STT WebSocket + LLM command pipeline
│   ├── llm.js              # LLM adapter — queues 5-action battle plans via /api/llm/command
│   ├── webrtc.js           # WebRTC peer-to-peer multiplayer
│   ├── spotify-widget.js   # Spotify Web Playback SDK integration
│   ├── effects.js          # Visual effects — coin rain, particle systems
│   ├── player-effects.js   # Per-fighter aura/glow effects for boost tiers
│   ├── sfx.js              # Sound effects manager
│   ├── session.js          # Session state model
│   ├── ui.js               # Mode selection UI
│   └── auth.js             # Authentication helpers
└── assets/
    ├── smf-logo.png
    ├── sticklash-bg.png
    └── smf-bg.jpg
```

---

## 🔌 Backend API & Caching Strategy

The Python FastAPI backend (`birdeye_service.py`) proxies Birdeye and exposes:

| Endpoint | Description |
|---|---|
| `GET /api/trending?count=N` | Top N trending Solana tokens with full market data |
| `GET /api/token/{mint}` | Full token data by mint address |
| `GET /api/price/{mint}` | Current spot price (cached, refreshed on schedule) |
| `GET /api/graduated?count=N` | Pump.fun graduated tokens only |
| `POST /api/llm/command` | LLM battle plan endpoint |
| `POST /api/voice/tts` | TTS audio generation |
| `WS /api/voice/stt` | Real-time speech-to-text WebSocket |

- **Trending list**: refreshed every ~60s, shared across all users (Birdeye rate limit aware).
- **Price data**: per-mint cache, refreshed on poll schedule.
- **Live boost checks**: 30s warm-up after fight start, then 60s poll interval with ±8s jitter.
- Utilisation target: **~8% of Birdeye quota** for ~200 concurrent users with headroom.

---

## 🔑 Environment Variables

```env
BIRDEYE_API_KEY=your_key_here
```

---

## 🚀 Running Locally

```bash
# Backend
cd stick-fighter
uv run python birdeye_service.py

# Frontend (separate terminal)
python -m http.server 3000
# Then open http://localhost:3000
```

---

## 📄 License

MIT — build on it, fight with it, ship it.
