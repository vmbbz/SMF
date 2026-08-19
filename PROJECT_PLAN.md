# MemeFight ($BMF) - Official Project Plan

## 🥊 The Vision
**MemeFight ($BMF)** is a high-fidelity, viral-ready stickman fighting game where meme tokens come to life as playable fighters. By integrating real-time market data, MemeFight transforms price charts into interactive combat.
**Phase**: Rebrand & Base Blockchain Blue Integration  
**Goal**: Build a Web3 gamified application featuring stickman karate mechanics with meme token integration

## Core Concept
A Web3 game where players control stickman characters performing karate moves, integrated with cryptocurrency/meme token mechanics for a gamified DeFi experience.

## Current Understanding
Based on the project title and "GO PHASE 1" context, this appears to be:
- A stickman fighting/karate game
- Web3 integration with meme tokens
- Gamified tokenomics
- Sprint/hackathon development approach

## Technical Stack (To Be Defined)
**Frontend**: [To be specified]
**Backend**: [To be specified] 
**Blockchain**: [To be specified - likely Ethereum-compatible]
**Smart Contracts**: [To be specified]
**Token Standard**: [To be specified - likely ERC-20]

## Key Features (To Be Detailed)
- Stickman karate fighting mechanics
- Meme token integration
- Web3 wallet connectivity
- Gamified token rewards/earnings
- [Additional features to be defined]

## Repositories & Services (To Be Added)
- [Repository links to be provided]
- [Services to be used to be specified]

## Development Phases
### Phase 1: Complete ✅
- ✅ Fork deepgram/stick-fighter repository
- ✅ Clone and setup local environment
- ✅ Create token-utils.js with Dexscreener/Birdeye APIs
- ✅ Modify fighter.js to support token logos and personalities
- ✅ Update UI with meme panel and game logic
- ✅ Add victory screenshot and X post functionality
- ✅ Test local deployment
- ✅ Deploy to GitHub repository (https://github.com/vmbbz/SMF.git)

### Future Phases
- [To be defined based on user requirements]

## Notes
- This document will be updated as more details are provided
- User will provide specific code implementations for each step
- Plan serves as reference for development workflow
>>>>>>> 0c024be (feat: rebrand to MemeFight () and update theme to Base blockchain blue (#0000FF))

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
- **Phase 4 (The Arena)**: On-chain ELO system and leaderboard tied to $SMF token holders.
- **Phase 5 (Viral Takeover)**: Integrated Telegram Mini-App (TMA) and Solana Seeker mobile APK release.

---

## 🎯 "Lash" Logic & Meme Utility
- **$SMF Utility**: Holding $SMF boosts your "Lash Resistance" and "Damage Multiplier."
- **Community Branding**: Every win is a billboard for the token. "I just body-slammed $PEPE with $SMF tech."
- **Whip-Lash Effects**: Signature particle streaks that match the token's primary color, creating a visual spectacle during market pumps.

**LFG! WOOOOOOOO!** 🥋🚀💥
