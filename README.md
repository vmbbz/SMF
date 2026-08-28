![STICKLASH Arena Banner](assets/sticklash-bg.png)

<div align="center">
  <img src="https://img.shields.io/badge/Solana--Mobile-Seeker--Optimized-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana Seeker Ready">
  <img src="https://img.shields.io/badge/Deepgram-Zeus--Announcer-000000?style=for-the-badge&logo=deepgram&logoColor=white" alt="Deepgram Aura 2 Zeus">
  <img src="https://img.shields.io/badge/WebRTC-P2P--Multiplayer-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC P2P">
  <img src="https://img.shields.io/badge/Twitter/X-Viral--Share-000000?style=for-the-badge&logo=x&logoColor=white" alt="Viral Share">
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI Backend">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License">
</div>

# STICKLASH 🥊⚡

> **The world's first Solana meme-token fighting game.**
> Real on-chain data powers your opponent's health, damage, and speed. Fight trending tokens live from Pump.fun and Birdeye. Every match is different because the blockchain never stops.

### 🎬 Official Promo Video
![STICKLASH Trailer](assets/STICKLASH-Promo.mp4)

---

### 📲 Download & Play (Android APK)
🚀 **[Download the STICKLASH Android Preview APK](https://github.com/vmbbz/SMF/releases/download/android-v1.0-2026-08-16-social-cleanup-preview/sticklash-android-preview-2026-08-16.apk)** — *Debug-signed preview build for Android Solana wallet play; not Play/production-signed.*

[SHA-256 checksum](https://github.com/vmbbz/SMF/releases/download/android-v1.0-2026-08-16-social-cleanup-preview/sticklash-android-preview-2026-08-16.apk.sha256)

Release notes:
* [Latest Android release notes](releases/2026-05-26-android-mwa-fireball.md)
* [Changelog](CHANGELOG.md)
* [Release process](RELEASE_PROCESS.md)

---

## 🎮 Overview & Core Mechanics

STICKLASH is a 2D stickman fighting game where **Pump.fun / Solana meme tokens are your AI opponents**. Token market metrics — 24h volume, price change, liquidity — are pulled live and directly translate into in-game power stats. A token that just pumped 2× hits harder, moves faster, and has more health. One that's bleeding out on DexScreener is a pushover.

Built with vanilla Canvas2D, a custom combat engine, and a Litestar/Python backend for live market data.

### Production Deployment

Production runs as the Render web service `SMF` using this repository's `Dockerfile`. Render tracks the `main` branch and automatically builds and deploys each pushed commit directly; GitHub Actions runners and the retired Fly.io configuration are not part of the production path.

- Canonical site: <https://www.sticklash.fun>
- Render service origin: <https://smf-lzf3.onrender.com>
- Health check: <https://www.sticklash.fun/health>
- Public arena evidence: <https://www.sticklash.fun/arena>
- Arena status API: <https://www.sticklash.fun/api/arena/status>

After every production push, confirm the Render deploy is live for the intended commit before treating the release as complete. The health route must return HTTP `200`, the arena page must render, and the status API must report `persistence.mode: "postgres"` with `durable: true` in production. If Alchemy evidence is enabled, also require the reported transport to match the deployed setting, fresh and complete candidate coverage, a durable cursor, and an advancing observed slot. HTTP polling may be called fresh activity evidence, but never a live subscription or native replay.

### Autonomous Arena Director

The server-side **StickLash Arena Director v0.2** merges live trending and graduated-token candidates, scores them using volume, volatility, liquidity, and discovery signals, and selects the next opponent for Trending and Endless modes. When fresh, complete Alchemy Solana evidence exists, confirmed transactions mentioning monitored candidate mints add a logarithmic bonus capped at eight points. The free production default is bounded HTTP polling every 180 seconds. It is not a live WebSocket subscription; PubSub and paid Yellowstone gRPC remain explicit evaluation transports. Stale, partial, or unavailable Alchemy evidence adds nothing and never blocks Birdeye-based selection. Each decision includes a deterministic decision ID, policy version, ranked candidates, reason codes, provider snapshots, and sanitized errors so the autonomous choice can be explained and audited. If the Director endpoint is unavailable, gameplay falls back to the existing local market queue.

See [AnsemHack Readiness](ANSEMHACK_READINESS.md), [Token Exhibition](docs/TOKEN_EXHIBITION.md), [Alchemy Solana Candidate Activity Stream](docs/ALCHEMY_STREAM.md), [Arena Telemetry and Public Evidence](docs/ARENA_TELEMETRY.md), [Economy, Leagues, Leaderboards, and Rewards](docs/ECONOMY_AND_REWARDS.md), and [Gameplay Pause Ownership](docs/GAMEPLAY_PAUSE.md). The app exposes the same public boundaries through **Help → Live Arena Status** at <https://sticklash.fun/arena> and **Help → Economy & Rewards** at <https://sticklash.fun/economy>.

The Arena Status page reports separate evidence classes: Director API responses, Alchemy polling/transport health and bounded recovery state, server-authoritative multiplayer rounds, generated share cards, aggregate wallet sessions, and server-verified Solana ledger transactions. It never calls Alchemy observations trades or volume, Director responses completed fights, share cards impressions, wallet sessions paying users, or gameplay events onchain volume. Without durable evidence, unavailable metrics remain unavailable rather than becoming a misleading zero.

### Ranked Competition and Reward Status

Only wallet-authenticated **Public Ranked** fights against randomly matched online humans update competitive ELO. Skill Championship blocks paid specials; Boosted League has separate ELO and a server-enforced maximum of three paid boost charges per fighter per match. Private rooms, AI/LLM opponents, token arenas, Endless mode, and practice while waiting do not count.

Token rewards are **not live**. Ranked fights currently update ELO only: there is no per-win payout and no match creates a claimable game-token or `$ANSEM` balance. Future rewards require a separately announced, pre-funded epoch with minimum-match and unique-opponent rules, an immutable snapshot, review, and explicit wallet claims.

---

## 🎨 Design & Traditional Eastern Aesthetics

STICKLASH is loaded with premium Web3 and traditional Eastern aesthetics:
* **🏮 Shojumaru Traditional Chinese Font**: The UI is wrapped in Google Font's gorgeous `'Shojumaru'` stylized font, giving the wallet modal, leaderboard, and user profiles a legendary martial arts vibe.
* **🎵 Procedural Guzheng & Pipa Plucks**: Powered by the Web Audio API, the background music dynamically synthesizes high-pitched traditional Chinese string plucks with C5–A6 pentatonic melodies, immediate pick-strike sawtooth transients, and a warm string resonance tail.
* **🛎️ Chinese Gong Splash ("dhsssss")**: A custom synthesized Chinese Gong sweep triggers at fight start and every 32 beats, blending a deep low-frequency pitch sweep with 7 high-frequency square wave oscillators routed through bandpass filters to form a sweeping metallic splash.
* **🥋 Physical Whip Impact SFX (`whip_impact.wav`)**: Hits landing on the opponent's limbs (**arm** or **leg**) trigger a whip cracking impact sound, keeping physical kick sweeps and roundhouses sounding phenomenally distinct!
* **📱 Adaptive Viewport Stage Adjustments**: Built-in landscape auto-detection drops the floor Y coordinate to `logicalH - 95px` (exactly **80px lower** than legacy builds), shifting the fighters clear of the top HUD bars and timer for balanced mobile gaming.

---

## ⚡ Cloud Service Providers & SaaS Integrations

The STICKLASH backend and infrastructure are powered by standard-setting Web3 and SaaS providers:

| Provider | Service | Integration | Badge |
|---|---|---|---|
| **Upstash** | Serverless Redis | Multi-region WebRTC signaling, matchmaking queue, & active room lobby storage | `![Upstash](https://img.shields.io/badge/Upstash-Serverless--Redis-FF4F00?style=flat-square&logo=redis&logoColor=white)` |
| **Deepgram** | Aura 2 Zeus & Flux v2 | Dynamic 24kHz Zeus voice lines, WebSocket speech capture, & AI-fighter command pipeline | `![Deepgram](https://img.shields.io/badge/Deepgram-Aura--Zeus-13EF95?style=flat-square&logo=deepgram&logoColor=black)` |
| **Solana Web3** | On-Chain SPL Program | Phantom/Backpack/Solflare wallet pairing, token balance reads, and server-verified boost balances; new purchases stay disabled until game-token transfers to the reward reserve are implemented | `![Solana](https://img.shields.io/badge/Solana-SPL--Token-9945FF?style=flat-square&logo=solana&logoColor=white)` |
| **Alchemy** | Solana HTTP RPC; optional PubSub/Yellowstone | The free default runs one confirmed `getSlot` plus one bounded `getSignaturesForAddress` request per candidate every 180 seconds, with signature dedupe, PostgreSQL cursoring, truncation gates, Birdeye failover, and public cost/health evidence. PubSub and Yellowstone stay explicit evaluation paths. | `![Alchemy](https://img.shields.io/badge/Alchemy-Solana--RPC-1FC7D4?style=flat-square&logo=alchemy&logoColor=white)` |
| **Twitter / X** | Web Intent API | Zero-auth viral gameplay sharing, automated screenshot capture matching, & ELO brag links | `![Twitter](https://img.shields.io/badge/Twitter/X-Viral--Share-000000?style=flat-square&logo=x&logoColor=white)` |
| **Birdeye** | DeFi Market API | Live on-chain price data, market cap scaling, & pump.fun graduated feeds | `![Birdeye](https://img.shields.io/badge/Birdeye-DeFi--Data-00C2FF?style=flat-square&logo=coinmarketcap&logoColor=white)` |
| **Supabase** | PostgreSQL | Persistent multi-player ELO rating records, match stats, & active leaderboard graphs | `![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)` |
| **DexScreener** | Search & Pairs API | Real-time fallback pair valuations, 24h volume tracking, & token icon metadata augmentation | `![DexScreener](https://img.shields.io/badge/DexScreener-Pairs--API-333333?style=flat-square&logo=dexscreener&logoColor=white)` |

---

## 🏗️ Backend Architecture & Caching Pipeline

STICKLASH uses a Litestar Python backend to balance real-time Web3 queries, multiplayer WebRTC signaling, agent decisions, and low-latency voice streams:

```
                                  [ STICKLASH Frontend ]
                                     /       |        \
                       WebRTC Signals  Voice STT  Token Data
                                 /           |          \
                 (Upstash Redis)       (Deepgram)      [ Litestar Server ]
                        |                    |          /        |         \
                 [Signaling Mgr]      [Flux v2 STT] [Birdeye] [Alchemy] [PostgreSQL]
                        |                    |          |       HTTP RPC     |
                 [Matchmaking]         [Zeus Announcer] |          |      telemetry
                                                     [Arena Director]
                                                           |
                                                     (DexScreener detail)
```

### 1. Bounded Market Data and Alchemy Evidence Pipeline

`BirdeyeService` is intentionally list-only: trending and graduated discovery snapshots use a shared 180-second cache and coalesce concurrent refreshes. `DexScreenerService` handles per-token fight details so active gameplay does not re-enable expensive Birdeye overview polling or background prewarming.

When explicitly enabled, the default `AlchemySolanaHttpPollingStream` runs a server-only cycle every 180 seconds: one confirmed `getSlot`, then one rate-spaced `getSignaturesForAddress` request for each of at most 32 current Birdeye candidates. Busy candidates may use one additional 1,000-signature page, with at most eight extra pages shared by a cycle. The cycle rewinds a durable slot cursor by 32 slots, clamps work to a 512-slot window, deduplicates signature hashes, and becomes score-eligible only when every candidate completes without failure or truncation. A public Director request can read matching evidence but cannot replace candidates or trigger RPC work. PostgreSQL stores the latest completed-cycle cursor and a pruned dedupe cache. The public status exposes baseline and bounded 30-day compute-unit estimates. Authenticated provider URLs are suppressed from HTTP client logs. `solana_pubsub` remains optional because the current production app returned method-not-found for both heartbeat methods; `yellowstone_grpc` remains paid/credit gated. The API key stays server-only in every mode.

### 2. Upstash WebRTC Signaling & Room State Machine
Multiplayer rooms, WebRTC SDP exchange, and matchmaking queues are managed on the **Upstash Serverless Redis** cluster. 
* By forcing secure SSL connections (`rediss://`), Litestar securely holds transient game lobby state.
* If Redis or PostgreSQL connection errors are encountered (e.g. during local developer bootstrap), the server initiates **Safe Mode**, falling back gracefully to in-memory mocks so that single-player, custom arena, and BGM music engines continue to run flawlessly offline.

### 3. Boost Ledger and Planned Reward-Vault Settlement
Firing **Hadouken projectiles** in wallet-linked P1 mode can consume server-authoritative **Premium Boosts**:
* **The Hadouken Intercept**: When P1 presses the Special attack button (`Actions.HADOUKEN`), wallet-linked players trigger a server-authoritative consume flow (`POST /api/boost/consume`) before the projectile fires. Each user begins with **15 free starter boosts**, and every Hadouken spends **1 boost**.
* **Zero Boost Lockout**: If boosts reach 0, firing Hadouken is blocked and a warning `⚠️ Out of premium boosts!` displays. The store also shows that replenishment purchases are currently paused.
* **Purchases Are Gated**: New boost purchases are disabled. The retired adapter still contains legacy SPL-burn parsing for historical compatibility, but the purchase gate rejects burn settlement.
* **Approved Target**: Boost packs will be paid only in the launched game token, with 100% transferred to the game-token reward reserve. Boosts will be credited only after the server verifies the exact signer, mint, reserve destination, amount, finality, and unused signature.

### 4. Solana Mobile Wallet Adapter Security
The Android APK includes a native Solana Mobile Wallet Adapter bridge so mobile wallets can verify the dApp and sign secure actions without exposing keys to STICKLASH.
* **Native MWA bridge**: `android/app/src/main/java/com/solanamemefighter/app/SolanaMwaPlugin.kt` caches the Android `ActivityResultSender` during plugin load and reuses it for wallet connect, message signing, transaction signing, and disconnect flows. Fresh Phantom auth tokens are also applied to the in-memory adapter immediately so the next secure action does not reopen as a cold wallet session.
* **Explicit wallet journey**: `wallet-connect.js` separates wallet connect from StickLash security sign-in. After Phantom returns the account, the modal shows the connected address and asks for one free message signature before authenticated boost routes can be used; the independent purchase-policy gate remains disabled.
* **Wallet sign-in session**: `POST /api/wallet-auth/challenge` creates a short-lived Solana sign-in challenge, `POST /api/wallet-auth/verify` verifies the wallet signature server-side with PyNaCl, and boost purchase/consume routes require the resulting bearer token. Gameplay boost spends use only an existing signed session, so a Hadouken never triggers a surprise wallet signature in the middle of a fight.
* **On-chain proof before future credit**: The current confirm route contains the retired burn verifier, but purchase creation is blocked. It must be replaced by exact game-token reward-vault transfer verification before new purchases are enabled.
* **DApp identity relationship**: Android App Links and Digital Asset Links bind `https://sticklash.fun` to package `com.solanamemefighter.app` and release certificate fingerprint `84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76`.
* **Public verification file**: The backend serves `.well-known/assetlinks.json` at `https://sticklash.fun/.well-known/assetlinks.json`. Wallets and Android can use this relationship to confirm the APK/domain identity instead of trusting an arbitrary app name.

#### Verify Digital Asset Links After Deploy
Run one of these after deploying to `sticklash.fun`:

```powershell
Invoke-RestMethod https://sticklash.fun/.well-known/assetlinks.json | ConvertTo-Json -Depth 10
```

```bash
curl -i https://sticklash.fun/.well-known/assetlinks.json
```

The response must be HTTP `200`, JSON, and include:

```json
{
  "package_name": "com.solanamemefighter.app",
  "sha256_cert_fingerprints": [
    "84:86:97:57:2F:90:2C:DC:01:7B:30:C3:87:D3:D2:A8:8D:47:E4:11:CA:B9:54:BA:B1:05:95:98:9D:DE:1D:76"
  ]
}
```

Optional Google statement check:

```powershell
$url = 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sticklash.fun&relation=delegate_permission/common.handle_all_urls'
Invoke-RestMethod $url | ConvertTo-Json -Depth 10
```

If the direct URL returns `404`, the app-domain relationship is not live yet. Deploy the repo/backend first, then re-check.

---

## ✨ Feature Overview

### 🏟️ Game Modes

| Mode | Description |
|---|---|
| **Trending Arena** | Fight a random token from the current Birdeye trending list |
| **Endless Pump Stream** | Auto-queues 12 trending tokens; 8-second countdown auto-advances to the next fight after each win or loss |
| **Custom Fight** | Paste any Solana token mint address and fight that specific token |
| **Token Exhibition** | Watch two distinct real tokens fight autonomously with symmetric identity, bounded market-powered stats, and visible tactical styles; no controls, paid boosts, ELO, leaderboard credit, or rewards |
| **Multiplayer** | WebRTC peer-to-peer 2P local or remote matches (requires auth) |

### ⚔️ Combat Engine

- **Custom RAF game loop** — deterministic 60fps canvas rendering with fixed-timestep physics
- **Full move set**: light/heavy punch, light/heavy kick, jump, crouch, dash, block, Hadouken (projectile)
- **Hitbox system**: limb-specific collision with head/crotch shot bonuses and clash detection
- **Combo engine**: buffered input system with timing windows for multi-hit strings
- **AI combat**: provider-backed command planning for supported modes plus a zero-provider, state-aware behavior tree for both Token Exhibition fighters
- **Damage log**: real-time HUD showing recent hits between the two fighters

### 📊 Token Power Scaling

Token market data is converted into three in-game stats:

| Stat | Source | Range |
|---|---|---|
| **Health** | Volume × price change × liquidity (safePower formula) | 50–1000 HP |
| **Damage Multiplier** | Proportional cap: `1.0 + (power-1) × 0.1` | 0.8× – 1.5× |
| **Speed Multiplier** | Conservative: `1.0 + (power-1) × 0.05` | 0.95× – 1.2× |

> Even a 75× power token caps at 1.5× damage — the game stays playable no matter how insane the pump is.

### 🚀 Live Boost System

When the currently-fought token's price pumps **during your fight**, timed boost events fire:

| Tier | Trigger | Effect |
|---|---|---|
| 🟠 **Runner** | +20–45% price gain | 3-hit dash combo on P1, brief stun |
| 🔴 **Spike** | +45–100% price gain | 5-hit combo + P1 levitated 1.5s |
| 🟣 **Overdrive** | +100%+ (2× pump) | 10 Hadoukens + P1 levitated 3s, chaos mode |

### ⚠️ Survival Strategy
> **You MUST rely on active buy pressure or burn Live Boosts to stand a chance against pumping high-volume opponent tokens. Trying to fight a 2× pump vanilla will result in getting completely whipped — LMAO WHIPLASH!**

### 🏆 Victory Screen

- **Winner/Loser dual cards** with flip animation — click to toggle between them (in single-player/trending modes)
- **Dedicated PvP Victory Cards**: Side-by-side glassmorphic cards showing Winner (green border) and Loser (pink border) actual OIDC profile images and display names with animated old-to-new ELO transition (e.g. `1200 → 1224 (+24)`).
- **Rematch Integration**: Bypasses the results screen in multiplayer, allowing instant room rematch re-entry and selections via uvicorn/Litestar.
- **Rich card tabs**: ABOUT (market stats), SOCIAL, SAFETY
- **BUY button**: direct DexScreener link for the token
- **Share to X**: pre-filled tweet with match result, including custom PvP adaptive share copy with opponent names
- **Endless mode session header**: Round counter, W/L record, streak badge (🔥 3 STREAK / 💀 ON TILT)
- **8-second auto-advance countdown**: animated progress bar, cancels if you click any button manually

### 🎙️ Voice Controls & Deepgram TTS Announcer

- **Deepgram Aura 2 Zeus Integration**: All voice lines and announcer shouts (like *"FIGHT!"* or *"KNOCKOUT!"*) are rendered dynamically with Deepgram's **Aura 2 Zeus** (deep, authoritative male voice) running at **24,000Hz**.
- **WebSocket STT Stream**: Player mic is captured at 16,000Hz and streamed via `/ws/stt` proxy to Deepgram Flux v2.
- **Phonetic Homophone Cleaning**: Robust client-side pre-processing strips punctuation and maps slurred phrases (e.g. *"how do you can"*, *"hurricane"*, *"outer scan"*) to clean game moves (*"hadouken"*), raising recognition to 100% accuracy.
- **Zero-Latency Combat Verbalisations**: Getting hit or landing hits bypasses the slow LLM network roundtrip (~1s) and picks a local random reactive phrase, executing it instantly (~100ms) for high-performance combat game feel.
- **LLM Context Injection**: General conversational chat routes through Anthropic Claude / Gemini with a structured try/catch backup, falling back gracefully to pre-scripted phrases on rate limits.

### 🎮 Mobile Virtual Joystick

- **Left side**: analog joystick (130px base) — 8-direction movement, deadzone 18%
  - Push up = JUMP
  - Left/right = walk/dash
  - Down = crouch
- **Right side** attack grid:
  - ⚡ **SP** (top, octagon shape, gold pulsing glow) — Hadouken/Special
  - 👊 LP — Light Punch
  - 🦵 LK — Light Kick
  - 🔥 HP — Heavy Punch
  - 💥 HK — Heavy Kick
- **Only visible during gameplay** — hidden on the landing/home screen
- **3-layer reliability**: re-registers on every `resetAndFight`, watchdog polling every 500ms, `_showMobileControls` polling until `p1Input` is available

### 🌦️ Weather System

- **Live weather overlay on the game stage canvas**
- **Controlled by the "WEATHER" toggle in the HUD**

---

## 🏗️ Architecture

```
stick-fighter/
├── index.html              # Main shell — game canvas, UI panels, mobile joystick, scripts
├── server.py               # Litestar routes, wallet verification, multiplayer, voice, and static app
├── arena_director.py       # Explainable autonomous market-opponent policy
├── arena_telemetry.py      # Insert-only public evidence store and privacy-safe aggregates
├── alchemy_stream.py       # Shared persistence/scoring plus optional Yellowstone transport
├── alchemy_pubsub.py       # Free HTTP polling plus optional PubSub and public provenance
├── birdeye_service.py      # Birdeye discovery-list proxy and caching
├── yellowstone_proto/      # Generated bindings for the pinned Apache-2.0 protocol
├── src/
│   ├── main.js             # Orchestration layer — game lifecycle, loadOpponent, resetAndFight, nextFight
│   ├── arena-director-client.js # Director API client, UI announcement, decision event
│   ├── arena-status-page.js # Help-linked public evidence page for /arena
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

### Key Globals / API Surface

| Global | Owner | Purpose |
|---|---|---|
| `window.loadOpponent(token, forceRestart?)` | `main.js` | Load a token fighter into P2 |
| `window.resetAndFight(token)` | `main.js` | Full teardown + fresh game start (the single source of truth for "next fight") |
| `window.nextFight()` | `main.js` | Requests an Arena Director decision, then uses queue/strip/API fallbacks before resetAndFight |
| `window.fightToken(mint)` | `index.html` | Fetches token by mint and calls loadOpponent |
| `window.startEndlessMode()` | `index.html` | Starts an Arena Director-selected opponent and enables automatic next fights |
| `window.latestArenaDirectorDecision` | `arena-director-client.js` | Latest auditable market-agent decision shown by the active client |
| `window.showVictoryOverlay(winnerNum, token, loserToken, options?)` | `main.js` | Renders mode-aware human, token, or autonomous-exhibition results |
| `window.currentTokenExhibitionPair` | `main.js` | Current two-token spectator matchup; never used for ELO or rewards |
| `window.endlessSession` | `main.js` | `{active, round, wins, losses, streak}` — session state for endless mode |
| `window._cancelEndlessCountdown()` | `main.js` | Cancels 8s auto-advance timer |
| `window._showMobileControls()` | `index.html` | Shows joystick UI + registers adapter with current p1Input |
| `window.liveBoostSystem` | `main.js` | LiveBoostSystem instance for current fight |
| `window.currentGame` / `window.game` | `main.js` | Current Game instance (both aliases kept for compatibility) |

---

## 🔑 Environment Variables

```env
BIRDEYE_API_KEY=your_key_here
# Explicitly gated; bounded free-tier HTTP polling is the default transport.
ALCHEMY_STREAM_ENABLED=0
ALCHEMY_API_KEY=your_server_only_key
# solana_http_polling (default), solana_pubsub (optional), or yellowstone_grpc
ALCHEMY_STREAM_TRANSPORT=solana_http_polling
ALCHEMY_STREAM_POLL_INTERVAL_SECONDS=180
ALCHEMY_SOLANA_WS_ENDPOINT=wss://solana-mainnet.g.alchemy.com
ALCHEMY_SOLANA_HTTP_ENDPOINT=https://solana-mainnet.g.alchemy.com
# Used only when ALCHEMY_STREAM_TRANSPORT=yellowstone_grpc
ALCHEMY_YELLOWSTONE_ENDPOINT=https://solana-mainnet.g.alchemy.com
# Enables durable ranked, wallet, boost, and arena telemetry persistence
DATABASE_URL=postgresql://user:password@host/database
# Server-only/private endpoint used by backend workers
SOLANA_RPC=https://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
# Client-safe endpoint exposed to browser/mobile web client
SOLANA_RPC_PUBLIC=https://api.mainnet-beta.solana.com
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

## 🎯 Design Principles

1. **Token data is the game** — no fake stats. Every fight reflects real market conditions at that moment.
2. **Playable no matter the pump** — damage multiplier capped at 1.5× so even a 100× token can't one-shot you.
3. **Seamless "Next Fight"** — `resetAndFight()` is the single authoritative teardown that clears all state (RAF loop, boost system, game instance, p1Input registration) before starting fresh.
4. **Mobile-first resilience** — joystick registration uses 3 independent layers so it can't silently lose its connection to a new game instance.
5. **Server-side caching** — all users share one cached trending list; individual price polls are staggered with jitter to stay within API rate limits.

---

## 📄 License

MIT — build on it, fight with it, ship it.
