# Solana Meme Battle ($SMF) - Official Project Plan

## 🥊 The Vision
**Solana Meme Battle ($SMF)** is a high-fidelity, viral-ready stickman fighting game where the Solana meme ecosystem comes to life as playable fighters. By integrating real-time market data from Dexscreener and Pump.fun, $SMF transforms price charts into interactive combat.

---

## 🚀 Phase 1: Foundation (COMPLETED)
- [x] **Core Combat Engine**: Procedural stickman physics with 6+ attack types.
- [x] **Premium UI/UX**: Neon/Glassmorphic theme with centralized "Meme Panel" navigation.
- [x] **Meme Head Rendering**: Real-time fetching and anchoring of token logos to fighter skeletons.
- [x] **Viral Victory Loop**: "K.O." overlay with coin rain effects and "Share to X" integration.
- [x] **Stability Hardening**: Null-safe DOM interactions and hardened screen transitions.

---

## 🔥 Phase 2: Epic Upgrades (CURRENT)
### 1. AI Intelligence & Combat Logic
- [x] **Fix AI Stasis**: Resolved module-scoped variable conflicts; AI is active.
- [ ] **Data Enrichment**: Implement sub-calls to Dexscreener `/tokens` API to fetch 24h price change, liquidity, and volume to mathematically scale fighter stats.
- [ ] **Lashing System**: Implement a "Whip-Lash" move set and particle effects for high-impact combat.

### 2. High-Fidelity Visuals
- [x] **Logo Pop**: Increased token head radius to 35px.
- [ ] **Neck Offset**: Adjust skeletal rendering to place heads on a "longer neck," preventing torso occlusion and showing off limb movement.
- [x] **Dynamic Arenas**: Basic implementation of token backgrounds.
- [ ] **Enhanced Walk-ins**: Increase intro time to 5 seconds with premium typography and "Stat-Cards" (Price Change %, Volume, Market Cap).

### 3. Market-Driven Utility
- [ ] **Walk-out CTAs**: Post-fight "Buy $TICKER" buttons on the victory screen (especially after AI wins).
- [ ] **"Fight for your Bags" (1v1)**: Allow real users to battle; winner takes bragging rights.
- **Social Power Ups**: Integration with X/Twitter engagement (#SMF). More likes/retweets = higher damage or speed for your chosen token.
- **Runner Mode (AI vs AI)**: A "Watch to Earn" or discovery mode where the top 2 trending tokens fight automatically. Users can discover the day's "Runners" through combat.

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
- **Phase 4 (The Arena)**: On-chain ELO system and leaderboard tied to $SMF token holders.
- **Phase 5 (Viral Takeover)**: Integrated Telegram Mini-App (TMA) and Solana Seeker mobile APK release.

---

## 🎯 "Lash" Logic & Meme Utility
- **$SMF Utility**: Holding $SMF boosts your "Lash Resistance" and "Damage Multiplier."
- **Community Branding**: Every win is a billboard for the token. "I just body-slammed $PEPE with $SMF tech."
- **Whip-Lash Effects**: Signature particle streaks that match the token's primary color, creating a visual spectacle during market pumps.

**LFG! WOOOOOOOO!** 🥋🚀💥
