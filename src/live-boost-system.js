// src/live-boost-system.js
import { calculateFighterPower } from './token-power-scaling.js';
import { PlayerEffects } from './player-effects.js';

export class LiveBoostSystem {
  constructor(game) {
    this.game = game;
    this.opponent = null;
    this.tokenMint = null;
    this.lastVolume = 0;
    this.interval = null;
    this._initTTS();
  }

  _initTTS() {
    this.announcerVoice = null;
    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => 
        v.name.includes('UK English Male') || 
        v.name.includes('David') || 
        v.name.includes('Daniel') || 
        v.name.includes('Alex') ||
        (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
      );
      this.announcerVoice = preferred || voices[0];
    };
    
    if (window.speechSynthesis) {
      setVoice();
      window.speechSynthesis.onvoiceschanged = setVoice;
    }
  }

  announceText(text) {
    if (!window.speechSynthesis) return;
    const msg = new SpeechSynthesisUtterance(text);
    if (this.announcerVoice) msg.voice = this.announcerVoice;
    msg.pitch = 0.7; // Deep voice
    msg.rate = 1.1;  // Slightly hype pace
    msg.volume = 1.0;
    window.speechSynthesis.speak(msg);
  }

  start(opponent, token) {
    this.opponent = opponent;
    this.tokenMint = token.mint;
    this.lastVolume = token.volume24h || 0;
    this.opponent.effects = new PlayerEffects(opponent);
    // Poll less aggressively on frontend, e.g. 15s to be cache-friendly
    this.interval = setInterval(() => this.checkBoost(), 15000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  async checkBoost() {
    if (!this.tokenMint) return;
    try {
      const res = await fetch(`/api/token/${this.tokenMint}`);
      if (!res.ok) return;
      const fresh = await res.json();
      if (!fresh) return;

      const freshVol = fresh.volume24h || 0;
      const spikeRatio = this.lastVolume > 0 ? (freshVol / this.lastVolume) : 1;
      
      const superSpike = spikeRatio > 2.0;
      const volumeSpike = spikeRatio > 1.45;

      if (superSpike) {
        this.triggerSuperCombo(fresh);
        this.lastVolume = freshVol;
      } else if (volumeSpike) {
        this.triggerRunnerCombo(fresh);
        this.lastVolume = freshVol;
      }
    } catch (err) {
      console.warn('[LiveBoostSystem] Error checking boost:', err);
    }
  }

  triggerSuperCombo(freshToken) {
    const opponent = this.opponent;
    const text = `$${freshToken.symbol} PUMPED 2X! OVERDRIVE!`;
    
    if (this.game.showFloatingText) this.game.showFloatingText(text, '#ff00ff');
    this.announceText(text);

    if (opponent.effects) opponent.effects.addBoostEffect();

    opponent.isStunned = true;
    opponent.stunFrames = 300; // 5 seconds stun
    opponent.vy = -180; // Higher levitate

    this.executeSuperHadoukenCombo(opponent);
  }

  triggerRunnerCombo(freshToken) {
    const opponent = this.opponent;
    const text = `$${freshToken.symbol} JUST PUMPED!`;

    // Notification
    if (this.game.showFloatingText) this.game.showFloatingText(text, '#00ffff');
    this.announceText(text);

    // Localized boost effect
    if (opponent.effects) opponent.effects.addBoostEffect();

    // Force-field stun + levitate
    opponent.isStunned = true;
    opponent.stunFrames = 210; // ~3.5 seconds
    opponent.vy = -140; // strong levitate

    // Trigger full combo sequence
    this.executeComboSequence(opponent);
  }

  executeSuperHadoukenCombo(fighter) {
    let delay = 0;
    const variants = ['plasma', 'fire', 'void', 'electric', 'default'];
    
    // 10 rapid-fire hadoukens
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (fighter.isStunned) {
          fighter.currentAttack = 'hadouken';
          fighter.attackFrame = 0;
          fighter.attackHasHit = false;
          fighter.nextHadoukenVariant = variants[Math.floor(Math.random() * variants.length)];
          // Bypass cooldown
          fighter.hadoukenCooldown = 0;
        }
      }, delay);
      delay += 350; // Fire every 350ms
    }
  }

  executeComboSequence(fighter) {
    const combo = [
      'lightPunch',
      'mediumKick',
      'heavyPunch',
      'dashForward',
      'heavyKick'
    ];

    let delay = 0;
    combo.forEach(move => {
      setTimeout(() => {
        if (fighter.isStunned) {
          if (move === 'dashForward') {
            fighter.dashTimer = 0.15; // DASH_DURATION
            fighter.dashDir = fighter.facing;
            fighter.currentAttack = null;
          } else {
            fighter.currentAttack = move;
            fighter.attackFrame = 0;
            fighter.attackHasHit = false;
          }
        }
      }, delay);
      delay += 280; // tight, aggressive combo timing
    });
  }
}
