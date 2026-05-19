// src/live-boost-system.js
// Live Boost System — monitors token metrics from the backend cache,
// triggers tiered boost events with cinematic effects when price/volume spikes.
//
// Tiers:
//   micro     1.05–1.20x   Gold shimmer + speed aura + catchphrase
//   runner    1.20–1.45x   Orange burst + 3-hit dash combo on P1
//   spike     1.45–2.0x    Red shockwave + 5-hit combo + P1 levitated 1.5s
//   overdrive 2.0x+        Purple chaos + 10 hadoukens + P1 levitated 3s

import { PlayerEffects } from './player-effects.js';

// Tier thresholds (ratio = new_price / baseline_price at fight start)
// Anything below 1.20x (20% gain) is ignored per product decision.
const TIERS = [
  { id: 'overdrive', minRatio: 2.0  },
  { id: 'spike',     minRatio: 1.45 },
  { id: 'runner',    minRatio: 1.20 },
  // micro (< 20%) intentionally omitted
];

// Catchphrases per tier (micro removed — not triggered below 20%)
const CATCHPHRASES = {
  runner:    (sym) => [
    `$${sym} JUST PUMPED! 🚀`,
    `${sym} going VERTICAL!`,
    `Paper hands REKT again! $${sym} flying 📈`,
    `WAGMI $${sym} LFG!!!`,
  ][Math.floor(Math.random() * 4)],
  spike:     (sym) => [
    `$${sym} ON FIRE! 🔥🔥🔥`,
    `${sym} PRINTING! Stay poor, paper hands!`,
    `BIG PUMP $${sym}! GET REKT! 💀`,
    `$${sym} ABSOLUTE BEAST MODE!`,
  ][Math.floor(Math.random() * 4)],
  overdrive: (sym) => [
    `$${sym} PUMPED 2X! CHAOS MODE! ⚡⚡⚡`,
    `EVERYTHING IS PUMP! $${sym} UNSTOPPABLE!`,
    `Paper handed Mofos couldn't hold — $${sym} WENT PARABOLIC! 🌙`,
    `$${sym} IS THE RUNNER! 10X NEXT?! 🚀🌙`,
  ][Math.floor(Math.random() * 4)],
};

const HADOUKEN_VARIANTS = ['fire', 'electric', 'void', 'plasma', 'default'];

export class LiveBoostSystem {
  constructor(game) {
    this.game = game;
    this.aiOpponent = null;   // game.p2 — the token fighter
    this.humanPlayer = null;  // game.p1 — who gets levitated
    this.tokenMint = null;
    this._lastVolume = 0;
    this._lastPriceChange = 0;
    this._interval = null;
    this._ttsReady = false;
    this._announcerVoice = null;
    this._initTTS();
  }

  // ─────────────────────────────────────────
  // TTS — pick the best available English voice
  // Priority: Google US/UK > Microsoft Neural > any English > default
  // ─────────────────────────────────────────
  _initTTS() {
    if (!window.speechSynthesis) return;

    const pickBestVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return false;

      const PREFERRED = [
        v => v.name === 'Google US English',
        v => v.name === 'Google UK English Male',
        v => v.name === 'Google UK English Female',
        v => v.name.startsWith('Microsoft') && v.lang.startsWith('en') && v.name.includes('Neural'),
        v => v.name.startsWith('Microsoft') && v.lang.startsWith('en'),
        v => v.lang === 'en-US',
        v => v.lang.startsWith('en'),
        v => true,
      ];

      let chosen = null;
      for (const test of PREFERRED) {
        chosen = voices.find(test);
        if (chosen) break;
      }
      this._announcerVoice = chosen || null;
      this._ttsReady = true;
      console.log('[Announcer] TTS ready. Voice:', this._announcerVoice?.name || 'browser default');
      return true;
    };

    window.speechSynthesis.onvoiceschanged = () => pickBestVoice();
    if (!pickBestVoice()) {
      setTimeout(() => pickBestVoice(), 300);
      setTimeout(() => { if (!this._ttsReady) { this._ttsReady = true; } }, 800);
    }
  }

  _announce(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    if (this._announcerVoice) msg.voice = this._announcerVoice;
    msg.pitch  = 0.75;
    msg.rate   = 1.05;
    msg.volume = 1.0;
    window.speechSynthesis.speak(msg);
  }

  // ─────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────
  start(aiOpponent, token) {
    this.aiOpponent = aiOpponent;
    this.humanPlayer = this.game.p1;
    this.tokenMint = token?.mint;

    // Use spot price as primary metric (changes fast) + volume as secondary
    this._baselinePrice  = Number(token?.price)       || 0;
    this._baselineVolume = Number(token?.volume24h)   || 0;
    this._lastPrice      = this._baselinePrice;
    this._lastVolume     = this._baselineVolume;

    // Attach player effects to AI opponent
    if (!this.aiOpponent.effects) {
      this.aiOpponent.effects = new PlayerEffects(this.aiOpponent);
    }

    // Announce the fight start once TTS is ready
    const sym = (token?.symbol || 'MEME').toUpperCase();
    setTimeout(() => this._announce(`FIGHT! ${sym} enters the arena!`), 900);

    // Poll every 60s to align with server-side cache TTL.
    // First check after 30s (gives server cache time to warm for this mint).
    const jitter = Math.random() * 8000;
    setTimeout(() => this._checkBoost(), 30000 + jitter);
    this._interval = setInterval(() => this._checkBoost(), 60000 + jitter);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
  }

  // ─────────────────────────────────────────
  // Polling + tier detection
  // ─────────────────────────────────────────
  async _checkBoost() {
    if (!this.tokenMint || this.game.roundOver) return;
    try {
      const res = await fetch(`/api/token/${this.tokenMint}`);
      if (!res.ok) return;
      const fresh = await res.json();
      if (!fresh) return;

      const freshPrice  = Number(fresh.price)      || 0;
      const freshVolume = Number(fresh.volume24h)  || 0;

      // Primary: spot price ratio vs baseline (most sensitive to real-time moves)
      const priceRatio = this._baselinePrice > 0 ? (freshPrice / this._baselinePrice) : 1;
      // Secondary: volume spike vs last snapshot
      const volRatio   = this._lastVolume    > 0 ? (freshVolume / this._lastVolume)   : 1;

      // Use the larger signal
      const ratio = Math.max(priceRatio, volRatio);

      // Must be >= 1.20 (20%) to trigger anything
      if (ratio < 1.20) {
        // Update snapshots so next compare is relative to this moment
        this._lastPrice  = freshPrice;
        this._lastVolume = freshVolume;
        return;
      }

      // Find matching tier (TIERS sorted highest first)
      const tier = TIERS.find(t => ratio >= t.minRatio);
      if (tier) {
        this._triggerTier(tier.id, fresh, ratio);
        // Reset baseline so the same pump doesn't fire twice
        this._baselinePrice  = freshPrice;
        this._baselineVolume = freshVolume;
      }

      this._lastPrice  = freshPrice;
      this._lastVolume = freshVolume;
    } catch (err) {
      console.warn('[LiveBoostSystem] poll error:', err);
    }
  }

  // ─────────────────────────────────────────
  // Public: allow manual trigger for testing
  // ─────────────────────────────────────────
  triggerTier(tierId, tokenData) {
    this._triggerTier(tierId, tokenData || { symbol: 'TEST' }, 1);
  }

  // ─────────────────────────────────────────
  // Tier dispatch
  // ─────────────────────────────────────────
  _triggerTier(tierId, token, ratio) {
    const sym = (token.symbol || 'TOKEN').toUpperCase();
    const phrase = CATCHPHRASES[tierId]?.(sym) || `$${sym} PUMPED!`;

    // Announce + show cinematic message
    this._announce(phrase);
    if (this.game.showBoostMessage) this.game.showBoostMessage(phrase, tierId);
    if (window.haptic) window.haptic.boostActivate?.();

    switch (tierId) {
      case 'micro':     this._doMicro(sym);     break;
      case 'runner':    this._doRunner(sym);    break;
      case 'spike':     this._doSpike(sym);     break;
      case 'overdrive': this._doOverdrive(sym); break;
    }
  }

  // ─────────────────────────────────────────
  // Tier: 🟡 Micro — aura flash + speed burst on AI (no P1 stun)
  // ─────────────────────────────────────────
  _doMicro(sym) {
    const ai = this.aiOpponent;
    if (!ai) return;
    if (ai.effects) ai.effects.addMicroEffect();
    // Temporary speed boost (3 seconds)
    const prevMult = ai.damageMultiplier || 1;
    ai.damageMultiplier = prevMult * 1.15;
    setTimeout(() => { ai.damageMultiplier = prevMult; }, 3000);
  }

  // ─────────────────────────────────────────
  // Tier: 🟠 Runner — 3-hit combo, brief P1 stun (0.5s)
  // ─────────────────────────────────────────
  _doRunner(sym) {
    const ai = this.aiOpponent;
    const p1 = this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addRunnerEffect();
    this.game.triggerScreenFlash?.('#ff8800', 0.35);

    // Brief levitation of P1 (0.5s — just long enough to eat the combo)
    p1.boostLevitate(0.8);

    // AI dashes toward P1 then lands 3 hits
    this._runCombo(ai, ['dashForward', 'lightPunch', 'mediumKick', 'heavyPunch'], 220);
  }

  // ─────────────────────────────────────────
  // Tier: 🔴 Spike — 5-hit combo, P1 levitated 1.5s
  // ─────────────────────────────────────────
  _doSpike(sym) {
    const ai = this.aiOpponent;
    const p1 = this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addSpikeEffect();
    this.game.triggerScreenFlash?.('#ff2244', 0.5);

    p1.boostLevitate(1.8);

    this._runCombo(ai, [
      'dashForward',
      'lightPunch', 'mediumKick',
      'heavyPunch', 'lightKick', 'heavyKick',
    ], 240);
  }

  // ─────────────────────────────────────────
  // Tier: ⚡ Overdrive — 10 Hadoukens, P1 levitated 3s
  // ─────────────────────────────────────────
  _doOverdrive(sym) {
    const ai = this.aiOpponent;
    const p1 = this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addOverdriveEffect();
    this.game.triggerScreenFlash?.('#cc00ff', 0.8);

    // Longer levitation for the full barrage
    p1.boostLevitate(3.5);

    // Fire 10 randomised Hadoukens
    let delay = 300;
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (this.game.roundOver) return;
        ai.hadoukenCooldown = 0;
        ai.currentAttack = 'hadouken';
        ai.attackFrame = 0;
        ai.attackHasHit = false;
        ai.nextHadoukenVariant = HADOUKEN_VARIANTS[Math.floor(Math.random() * HADOUKEN_VARIANTS.length)];
        ai.state = 'attack';
      }, delay);
      delay += 340;
    }
  }

  // ─────────────────────────────────────────
  // Helper: run a named move sequence on the AI fighter
  // ─────────────────────────────────────────
  _runCombo(fighter, moves, intervalMs) {
    let delay = 0;
    for (const move of moves) {
      setTimeout(() => {
        if (this.game.roundOver) return;
        if (move === 'dashForward') {
          fighter.dashTimer = 0.18;
          fighter.dashDir = fighter.facing;
          fighter.state = 'idle';
          fighter.currentAttack = null;
        } else {
          fighter.currentAttack = move;
          fighter.attackFrame = 0;
          fighter.attackHasHit = false;
          fighter.state = 'attack';
        }
      }, delay);
      delay += intervalMs;
    }
  }
}
