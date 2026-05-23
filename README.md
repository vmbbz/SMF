# $SMF — STICKLASH 🥊⚡

> **The world's first Solana meme-token fighting game.**
> Real on-chain data powers your opponent's health, damage, and speed. Fight trending tokens live from Pump.fun and Birdeye. Every match is different because the blockchain never stops.

### 🎬 Official Promo Video
![STICKLASH Trailer](assets/STICKLASH-Promo.mp4)

---

## 🎮 Overview

STICKLASH is a 2D stickman fighting game where **Pump.fun / Solana meme tokens are your AI opponents**. Token market metrics — 24h volume, price change, liquidity — are pulled live and directly translate into in-game power stats. A token that just pumped 2× hits harder, moves faster, and has more health. One that's bleeding out on DexScreener is a pushover.

Built with vanilla Canvas2D, a custom combat engine, and a FastAPI/Python backend for live Birdeye data.

---

## ✨ Feature Overview

### 🏟️ Game Modes

| Mode | Description |
|---|---|
| **Trending Arena** | Fight a random token from the current Birdeye trending list |
| **Endless Pump Stream** | Auto-queues 12 trending tokens; 8-second countdown auto-advances to the next fight after each win or loss |
| **Custom Fight** | Paste any Solana token mint address and fight that specific token |
| **Multiplayer** | WebRTC peer-to-peer 2P local or remote matches (requires auth) |

### ⚔️ Combat Engine

- **Custom RAF game loop** — deterministic 60fps canvas rendering with fixed-timestep physics
- **Full move set**: light/heavy punch, light/heavy kick, jump, crouch, dash, block, Hadouken (projectile)
- **Hitbox system**: limb-specific collision with head/crotch shot bonuses and clash detection
- **Combo engine**: buffered input system with timing windows for multi-hit strings
- **AI opponent**: LLM-driven command planning (with mock fallback) — commands queued in 5-action batches
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

Price polling: every 60s with 30s warm-up delay, server-side Birdeye cache shared across all users.

### 📈 Live Market Feed (Trending Strip)

- Scrolling marquee at the bottom of the screen showing live trending tokens
- Each pill shows: token icon, symbol, 24h price change (green/red)
- Click any pill to instantly fight that token
- Toggle between **ALL TRENDING** and **PUMP.FUN GRADUATES ONLY**
- Two strip instances: one on the landing page, one during combat

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

- Live weather overlay on the game stage canvas
- Controlled by the "WEATHER" toggle in the HUD

### 🎵 Spotify Widget

- Connects via Spotify Web Playback SDK
- Shows currently playing track name, play/pause, next track controls
- Appears in the HUD widget bar (responsive: bottom of screen on PC, top 10% on mobile)

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
    └── smf-bg.jpg
```

### Key Globals / API Surface

| Global | Owner | Purpose |
|---|---|---|
| `window.loadOpponent(token, forceRestart?)` | `main.js` | Load a token fighter into P2 |
| `window.resetAndFight(token)` | `main.js` | Full teardown + fresh game start (the single source of truth for "next fight") |
| `window.nextFight()` | `main.js` | Picks next token (pumpQueue → trending strip → API fallback) and calls resetAndFight |
| `window.fightToken(mint)` | `index.html` | Fetches token by mint and calls loadOpponent |
| `window.startEndlessMode()` | `index.html` | Loads 12 trending tokens into pumpQueue, sets endlessSession.active |
| `window.showVictoryOverlay(winnerNum, token, loserToken)` | `main.js` | Renders victory screen + session stats + countdown |
| `window.endlessSession` | `main.js` | `{active, round, wins, losses, streak}` — session state for endless mode |
| `window._cancelEndlessCountdown()` | `main.js` | Cancels 8s auto-advance timer |
| `window._showMobileControls()` | `index.html` | Shows joystick UI + registers adapter with current p1Input |
| `window.liveBoostSystem` | `main.js` | LiveBoostSystem instance for current fight |
| `window.currentGame` / `window.game` | `main.js` | Current Game instance (both aliases kept for compatibility) |

---

## 🔌 Backend API

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

### Caching Strategy

- **Trending list**: refreshed every ~60s, shared across all users (Birdeye rate limit aware)
- **Price data**: per-mint cache, refreshed on poll schedule
- **Live boost checks**: 30s warm-up after fight start, then 60s poll interval with ±8s jitter
- Utilisation target: **~8% of Birdeye quota** for ~200 concurrent users with headroom

---

## 📱 Mobile UX

- Viewport: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- Virtual joystick only appears on touch devices (`hover:none and pointer:coarse`)
- Joystick hidden on landing screen, revealed when a fight starts
- Mobile trending strip pills: tighter padding, smaller font (media query ≤768px)
- HUD widgets: `bottom: 77px` on PC, `top: 10%` on mobile (doesn't overlap joystick)
- All HUD widget text capped at `12px` on mobile

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

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Canvas 2D API |
| Game Engine | Custom RAF loop (no framework) |
| Backend | Python FastAPI + uvicorn |
| Data | Birdeye API (trending, prices), Pump.fun graduated feed |
| Voice STT | Deepgram WebSocket (Flux v2 model) |
| Voice TTS | Deepgram Speak API (Aura 2 Zeus at 24kHz) |
| AI Commands | LLM via `/api/voice/llm` |
| Multiplayer | WebRTC peer-to-peer |
| Music | Spotify Web Playback SDK |
| Fonts | Press Start 2P (Google Fonts) |

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
