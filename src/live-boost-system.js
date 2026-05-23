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
  runner:    (sym, isHuman, p1Name) => {
    if (isHuman) {
      return [
        `UNLEASHING DEGEN RUNNER! 🚀`,
        `${p1Name} going VERTICAL! 📈`,
        `Liquidating $${sym}! No mercy! 🥊`,
        `WAGMI! ${p1Name} is flying! 📈`,
      ][Math.floor(Math.random() * 4)];
    }
    return [
      `$${sym} JUST PUMPED! 🚀`,
      `${sym} going VERTICAL!`,
      `Paper hands REKT again! $${sym} flying 📈`,
      `WAGMI $${sym} LFG!!!`,
    ][Math.floor(Math.random() * 4)];
  },
  spike:     (sym, isHuman, p1Name) => {
    if (isHuman) {
      return [
        `${p1Name} ON FIRE! 🔥🔥🔥`,
        `Spiking your chart! $${sym} getting body slammed! 🥋`,
        `BIG PUMP FOR ${p1Name}! GET REKT $${sym}! 💀`,
        `${p1Name} IN ABSOLUTE BEAST MODE!`,
      ][Math.floor(Math.random() * 4)];
    }
    return [
      `$${sym} ON FIRE! 🔥🔥🔥`,
      `${sym} PRINTING! Stay poor, paper hands!`,
      `BIG PUMP $${sym}! GET REKT! 💀`,
      `$${sym} ABSOLUTE BEAST MODE!`,
    ][Math.floor(Math.random() * 4)];
  },
  overdrive: (sym, isHuman, p1Name) => {
    if (isHuman) {
      return [
        `${p1Name} PUMPED 2X! CHAOS MODE! ⚡⚡⚡`,
        `UNSTOPPABLE DEGEN OVERDRIVE! ☄️`,
        `Bodying $${sym}! Sending them to the shadow realm! 🌙`,
        `${p1Name} GOING PARABOLIC! 🌙`,
      ][Math.floor(Math.random() * 4)];
    }
    return [
      `$${sym} PUMPED 2X! CHAOS MODE! ⚡⚡⚡`,
      `EVERYTHING IS PUMP! $${sym} UNSTOPPABLE!`,
      `Paper handed Mofos couldn't hold — $${sym} WENT PARABOLIC! 🌙`,
      `$${sym} IS THE RUNNER! 10X NEXT?! 🚀🌙`,
    ][Math.floor(Math.random() * 4)];
  },
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
    
    // Web Audio PCM Player for Deepgram Zeus TTS
    this.playbackCtx = null;
    this._nextPlayTime = 0;
    
    this._initTTS();
  }

  // ─────────────────────────────────────────
  // TTS — pick the best available English voice for local fallback
  // Priority: Natural/Online/Neural/Enhanced > Google > Siri > English > default
  // ─────────────────────────────────────────
  _initTTS() {
    if (!window.speechSynthesis) return;

    const pickBestVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return false;

      const PREFERRED = [
        // 1. Natural, Online, Neural, or Enhanced English voices (ultra-premium Edge/macOS/Chrome voices)
        v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Online') || v.name.includes('Neural') || v.name.includes('Enhanced')),
        // 2. Google premium voices
        v => v.lang.startsWith('en') && v.name.includes('Google'),
        // 3. Apple premium Siri voices
        v => v.lang.startsWith('en') && v.name.includes('Siri'),
        // 4. Any English US
        v => v.lang === 'en-US',
        // 5. Any English
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
      console.log('[Announcer] Browser fallback voice ready:', this._announcerVoice?.name || 'browser default');
      return true;
    };

    window.speechSynthesis.onvoiceschanged = () => pickBestVoice();
    if (!pickBestVoice()) {
      setTimeout(() => pickBestVoice(), 300);
      setTimeout(() => { if (!this._ttsReady) { this._ttsReady = true; } }, 800);
    }
  }

  /** Fetch Linear16 PCM audio from Deepgram TTS and play it */
  async _speakTTS(text) {
    if (!text || !text.trim()) return;
    console.log(`[Announcer Zeus] TTS → "${text}"`);
    
    const resp = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: 'aura-2-zeus-en' }),
    });

    if (!resp.ok) {
      throw new Error(`TTS server returned status ${resp.status}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > 0) {
      this._playAudio(arrayBuffer);
    } else {
      console.warn(`[Announcer Zeus] TTS returned empty audio`);
    }
  }

  /** Decode and play raw linear16 PCM bytes at 24kHz back-to-back */
  _playAudio(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return;

    if (!this.playbackCtx) {
      this.playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }

    const resume = () => {
      if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
        this.playbackCtx.resume().catch(e => console.warn('[Announcer Zeus] Failed to resume playback context:', e));
      }
    };
    resume();

    const int16 = new Int16Array(arrayBuffer);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    try {
      const buffer = this.playbackCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const now = this.playbackCtx.currentTime;
      if (this._nextPlayTime < now) {
        this._nextPlayTime = now;
      }

      const source = this.playbackCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackCtx.destination);
      source.start(this._nextPlayTime);
      this._nextPlayTime += buffer.duration;
      console.log(`[Announcer Zeus] Playing ${(buffer.duration * 1000).toFixed(0)}ms of authoritative announcer audio`);
    } catch (e) {
      console.error('[Announcer Zeus] Audio playback error:', e);
    }
  }

  /** Main entrypoint to announce text with a cinema-grade voice */
  async _announce(text) {
    try {
      await this._speakTTS(text);
    } catch (err) {
      console.warn('[Announcer] Deepgram TTS failed, falling back to browser synthesis:', err);
      this._announceBrowserFallback(text);
    }
  }

  /** Fallback: speak via local browser SpeechSynthesis API */
  _announceBrowserFallback(text) {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const msg = new SpeechSynthesisUtterance(text);
      if (this._announcerVoice) msg.voice = this._announcerVoice;
      msg.pitch  = 0.75;
      msg.rate   = 1.05;
      msg.volume = 1.0;
      window.speechSynthesis.speak(msg);
    } catch(err) {
      console.warn('[Announcer Fallback] Speech blocked by autoplay policy:', err);
    }
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

    // Attach player effects to both fighters
    if (!this.aiOpponent.effects) {
      this.aiOpponent.effects = new PlayerEffects(this.aiOpponent);
    }
    if (!this.humanPlayer.effects) {
      this.humanPlayer.effects = new PlayerEffects(this.humanPlayer);
    }

    // Expose class globally for dev-hack instancing
    window.liveBoostSystemClass = LiveBoostSystem;

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
  triggerTier(tierId, tokenData, boosterName = 'p2') {
    const booster = boosterName === 'p1' ? this.game.p1 : this.game.p2;
    const target = boosterName === 'p1' ? this.game.p2 : this.game.p1;
    this._triggerTier(tierId, tokenData || { symbol: 'TEST' }, 1, booster, target);
  }

  // ─────────────────────────────────────────
  // Tier dispatch
  // ─────────────────────────────────────────
  _triggerTier(tierId, token, ratio, booster = this.aiOpponent, target = this.humanPlayer) {
    const sym = (token.symbol || 'TOKEN').toUpperCase();
    const isHuman = (booster === this.game.p1);
    const p1Name = (this.game.p1Label || 'Guest Fighter').toUpperCase();
    const phrase = CATCHPHRASES[tierId]?.(sym, isHuman, p1Name) || `$${sym} PUMPED!`;

    // Announce + show cinematic message
    this._announce(phrase);
    if (this.game.showBoostMessage) this.game.showBoostMessage(phrase, tierId);
    if (window.haptic) window.haptic.boostActivate?.();

    switch (tierId) {
      case 'micro':     this._doMicro(sym, booster);     break;
      case 'runner':    this._doRunner(sym, booster, target);    break;
      case 'spike':     this._doSpike(sym, booster, target);     break;
      case 'overdrive': this._doOverdrive(sym, booster, target); break;
    }
  }

  // Helper to snap fighters to correct strike range before combo
  _alignFightersForCombo(booster, target, spacing = 80) {
    if (!booster || !target) return;

    // Face each other
    const dir = booster.x < target.x ? 1 : -1;
    booster.facing = dir;
    target.facing = -dir;

    // Ideal positions
    let targetX = target.x;
    let boosterX = target.x - dir * spacing;

    // Stage bounds clamping
    const halfW = target.width / 2;
    const minX = this.game.stageLeft + halfW;
    const maxX = this.game.stageRight - halfW;

    // Clamp boosterX first. If it violates bounds, push targetX in the opposite direction to maintain exact spacing
    if (boosterX < minX) {
      boosterX = minX;
      targetX = boosterX + dir * spacing;
    } else if (boosterX > maxX) {
      boosterX = maxX;
      targetX = boosterX - dir * spacing;
    }

    // Clamp targetX. If targetX is pushed out of bounds, push boosterX back to maintain exact spacing
    if (targetX < minX) {
      targetX = minX;
      boosterX = targetX - dir * spacing;
    } else if (targetX > maxX) {
      targetX = maxX;
      boosterX = targetX + dir * spacing;
    }

    // Apply exact positions
    booster.x = boosterX;
    target.x = targetX;
    
    // Stop all velocity/momentum to prevent physical drift
    booster.vx = 0;
    booster.vy = 0;
    booster.dashTimer = 0;

    target.vx = 0;
    target.vy = 0;
    target.dashTimer = 0;

    // Visual phase sparkles
    this.game.hitSparks.push({
      x: booster.x,
      y: booster.y - 60,
      life: 0.35,
      color: booster === this.game.p1 ? '#00ff9d' : '#ff00ff',
      text: 'PHASE'
    });
  }

  // -----------------------------------------
  // Tier: Micro - aura flash + speed burst (no target stun)
  // -----------------------------------------
  _doMicro(sym, booster) {
    const ai = booster || this.aiOpponent;
    if (!ai) return;
    if (ai.effects) ai.effects.addMicroEffect();
    // Temporary speed boost (3 seconds)
    const prevMult = ai.damageMultiplier || 1;
    ai.damageMultiplier = prevMult * 1.15;
    setTimeout(() => { ai.damageMultiplier = prevMult; }, 3000);
  }

  // -----------------------------------------
  // Tier: Runner - 3-hit combo, brief target stun (0.5s)
  // -----------------------------------------
  _doRunner(sym, booster, target) {
    const ai = booster || this.aiOpponent;
    const p1 = target || this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addRunnerEffect();
    this.game.triggerScreenFlash?.('rgba(255, 136, 0, 0.4)', 0.35);

    // Instant phase snap to target
    this._alignFightersForCombo(ai, p1);

    // Brief levitation of target (0.8s)
    p1.boostLevitate(0.8);

    // Booster dashes toward target then lands 3 hits
    this._runCombo(ai, ['dashForward', 'lightPunch', 'mediumKick', 'heavyPunch'], 220);
  }

  // -----------------------------------------
  // Tier: Spike - 5-hit combo, target levitated 1.5s
  // -----------------------------------------
  _doSpike(sym, booster, target) {
    const ai = booster || this.aiOpponent;
    const p1 = target || this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addSpikeEffect();
    this.game.triggerScreenFlash?.('rgba(255, 34, 68, 0.4)', 0.5);

    // Instant phase snap to target
    this._alignFightersForCombo(ai, p1);

    // Medium levitation of target (1.8s)
    p1.boostLevitate(1.8);

    this._runCombo(ai, [
      'dashForward',
      'lightPunch', 'mediumKick',
      'heavyPunch', 'lightKick', 'heavyKick',
    ], 240);
  }

  // -----------------------------------------
  // Tier: Overdrive - 10 Hadoukens, target levitated 3s
  // -----------------------------------------
  _doOverdrive(sym, booster, target) {
    const ai = booster || this.aiOpponent;
    const p1 = target || this.humanPlayer;
    if (!ai || !p1) return;

    if (ai.effects) ai.effects.addOverdriveEffect();
    this.game.triggerScreenFlash?.('rgba(204, 0, 255, 0.5)', 0.8);

    // Snap initiator close and face each other dynamically with cinematic spacing
    this._alignFightersForCombo(ai, p1, 380);

    // Longer levitation for the full barrage (3.5s)
    p1.boostLevitate(3.5);

    // Visual start trigger
    ai.currentAttack = 'hadouken';
    ai.state = 'attack';
    ai.attackFrame = 18; // Pose frame

    // Fire 10 rapid, guaranteed colorful hadoukens directly in the projectile list!
    let delay = 200;
    const variants = ['fire', 'electric', 'void', 'plasma'];
    const pSpeed = 600; // fast fireballs

    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (this.game.roundOver) return;

        // Keep booster in release pose
        ai.currentAttack = 'hadouken';
        ai.state = 'attack';
        ai.attackFrame = 18;

        const skeleton = ai._buildSkeleton();
        const hand = ai._localToWorld(skeleton.handFront[0], skeleton.handFront[1]);
        const yOffset = (Math.random() * 50 - 25); // chaotic height spread
        const varType = variants[i % variants.length];

        this.game.projectiles.push({
          x: hand[0],
          y: hand[1] + yOffset,
          vx: ai.facing * pSpeed,
          owner: ai === this.game.p1 ? 'p1' : 'p2',
          active: true,
          animTimer: 0,
          variant: varType,
          damage: 5,           // Balanced damage per overdrive hit
          isOverdrive: true,
          isLast: i === 9      // Mark the 10th fireball to deliver the final KO
        });

        // Haptic feedback & sound
        if (window.haptic) window.haptic.vibrate?.(40);
        if (this.game.sfx) this.game.sfx.hadouken?.();

        // Spawn a charge spark on the hand
        this.game.hitSparks.push({
          x: hand[0],
          y: hand[1] + yOffset,
          life: 0.18,
          color: '#cc00ff',
          text: 'HADOU'
        });
      }, delay);
      delay += 240; // 240ms interval = extremely fast, high-action spam
    }
  }

  // -----------------------------------------
  // Helper: run a named move sequence on the booster fighter
  // -----------------------------------------
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

// Expose class globally immediately on module evaluation
window.liveBoostSystemClass = LiveBoostSystem;
