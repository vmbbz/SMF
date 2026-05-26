# Solana Meme Battle ($XXX) - Official Project Plan

## 🥊 The Vision
**Solana Meme Battle ($XXX)** is a high-fidelity, viral-ready stickman fighting game where the Solana meme ecosystem comes to life as playable fighters. By integrating real-time market data from Dexscreener and Pump.fun, $XXX transforms price charts into interactive combat.

---

## 🚀 Phase 1: Foundation (COMPLETED)
- [x] **Core Combat Engine**: Procedural stickman physics with 6+ attack types.
- [x] **Premium UI/UX**: Neon/Glassmorphic theme with centralized "Meme Panel" navigation.
- [x] **Meme Head Rendering**: Real-time fetching and anchoring of token logos to fighter skeletons.
- [x] **Viral Victory Loop**: "K.O." overlay with coin rain effects and "Share to X" integration.
- [x] **Stability Hardening**: Null-safe DOM interactions and hardened screen transitions.

---

## 🔥 Phase 2: Epic Upgrades (COMPLETED)
### 1. AI Intelligence & Combat Logic
- [x] **Fix AI Stasis**: Resolved module-scoped variable conflicts; AI is active.
- [x] **Data Enrichment**: Extended to fetch 24h volume, price change, and liquidity, mathematically scaling health (50-1000 HP), damage (0.8x-1.5x), and speed (0.95x-1.2x) via Birdeye integration.
- [x] **Lashing System**: Integrated real-time Runner Coin Boosts, triggering localized cyan particle effects, levitations, and auto-combo sequences (Punch → Kick → Heavy) mid-fight.

### 2. High-Fidelity Visuals
- [x] **Logo Pop**: Increased token head radius to 35px with real-time scaling and position adjustments.
- [x] **Neck Offset**: Modified procedural skeletal bone offsets to position head logos optimally, showing full limb motion without torso overlap.
- [x] **Dynamic Arenas**: Visual backgrounds customized dynamically based on current meme token.
- [x] **Enhanced Walk-ins**: Features full stat cards displaying Price Change %, Volume, and Market Cap.

### 3. Market-Driven Utility
- [x] **Walk-out CTAs**: Added glassmorphic Victory tabs (ABOUT, SOCIAL, SAFETY) with direct "BUY" buttons linking to DexScreener.
- [x] **"Fight for your Bags" (1v1)**: WebRTC 2-player peer-to-peer remote/local matchmaking with custom room codes, ELO rating adjustments, and active sync.
- [x] **Social Power Ups**: Fully integrated pre-filled X (Twitter) sharing with adaptive match summaries.
- [x] **Runner Mode (AI vs AI)**: Endless Stream mode automatically advances through hot trending tokens every 8 seconds.

---

## 💎 Phase 3: Premium Multiplayer Experience & Hardening (COMPLETED)
- [x] **Real Profile Avatars**: Seamless OIDC claims parsing to pull actual player avatar photos and names, dynamically binding them to stickmen heads.
- [x] **Super-Aligned Sizing**: Custom-tailored layout boundaries for lobbies and controllers, optimized for high-end PC (`max-width: 760px`/`520px`) and responsive mobile views.
- [x] **Dedicated PvP Victory Screen**: Renders side-by-side glassmorphic winner (green) and loser (pink) cards featuring names, photos, and animated ELO rating differences.
- [x] **Rematch Loop**: Wired rematch button with instant backend room resets, taking players back to controller selection seamlessly.
- [x] **Quality Assurance**: 100% test coverage verified green with corrected auth test assertions.

---

## 🛠️ Technical Architecture
- **Engine**: HTML5 Canvas with procedural skeletal animation.
- **Backend**: Python (Litestar) for AI logic, coordination, and future multiplayer relay.
- **Data APIs**: Dexscreener (Trending), Birdeye (Metadata), Helius (Assets).
- **Social**: Twitter/X Web Intent API for viral sharing.
- **Mobile**: PWA architecture for "Add to Home Screen" support, paving the way for a Capacitor-based APK.

---

## 📈 Roadmap to Mainnet
- **Phase 3 (The Pump)**: Endless "Pump Stream" mode where tokens spawn based on live Raydium buys.
- **Phase 4 (The Arena)**: On-chain ELO system and leaderboard tied to $XXX token holders.
- **Phase 5 (Viral Takeover)**: Integrated Telegram Mini-App (TMA) and Solana Seeker mobile APK release.

---

## 🎯 "Lash" Logic & Meme Utility
- **$XXX Utility**: Holding $XXX boosts your "Lash Resistance" and "Damage Multiplier."
- **Community Branding**: Every win is a billboard for the token. "I just body-slammed $PEPE with $XXX tech."
- **Whip-Lash Effects**: Signature particle streaks that match the token's primary color, creating a visual spectacle during market pumps.

**LFG! WOOOOOOOO!** 🥋🚀💥
