import { Actions } from "./input.js";
import { calculateFighterPower } from "./token-power-scaling.js";
import { Fighter, HADOUKEN_DATA } from "./fighter.js";
import { DG } from "./ui.js";
import { LiveBoostSystem } from "./live-boost-system.js";
import { loadGameImage } from "./image-utils.js";

// ─────────────────────────────────────────────
// Projectile constants
// ─────────────────────────────────────────────
const PROJECTILE_SPEED = 500;    // px/s
const PROJECTILE_DAMAGE = 25;
const PROJECTILE_HITSTUN = HADOUKEN_DATA.hitstun;
const PROJECTILE_BLOCKSTUN = HADOUKEN_DATA.blockstun;

// ─────────────────────────────────────────────
// Stage — margins as percentage of canvas width
// ─────────────────────────────────────────────
const STAGE_MARGIN = 0.05;

// ─────────────────────────────────────────────
// SNES-style controller button layout
// ─────────────────────────────────────────────
const P1_CONTROLLER = {
  dpad: [
    { action: Actions.UP, label: "W", dx: 0, dy: -1 },
    { action: Actions.DOWN, label: "S", dx: 0, dy: 1 },
    { action: Actions.LEFT, label: "A", dx: -1, dy: 0 },
    { action: Actions.RIGHT, label: "D", dx: 1, dy: 0 },
  ],
  buttons: [
    { action: Actions.MEDIUM_PUNCH, label: "I", dx: 0, dy: -1 }, // top (X position on SNES)
    { action: Actions.LIGHT_KICK, label: "J", dx: -1, dy: 0 }, // left (Y position)
    { action: Actions.LIGHT_PUNCH, label: "U", dx: 1, dy: 0 }, // right (A position)
    { action: Actions.MEDIUM_KICK, label: "K", dx: 0, dy: 1 }, // bottom (B position)
  ],
  shoulders: [
    { action: Actions.HEAVY_KICK, label: "L", side: "left" },
    { action: Actions.HEAVY_PUNCH, label: "O", side: "right" },
  ],
};

const P2_CONTROLLER = {
  dpad: [
    { action: Actions.UP, label: "↑", dx: 0, dy: -1 },
    { action: Actions.DOWN, label: "↓", dx: 0, dy: 1 },
    { action: Actions.LEFT, label: "←", dx: -1, dy: 0 },
    { action: Actions.RIGHT, label: "→", dx: 1, dy: 0 },
  ],
  buttons: [
    { action: Actions.MEDIUM_PUNCH, label: "5", dx: 0, dy: -1 },
    { action: Actions.LIGHT_KICK, label: "1", dx: -1, dy: 0 },
    { action: Actions.LIGHT_PUNCH, label: "4", dx: 1, dy: 0 },
    { action: Actions.MEDIUM_KICK, label: "2", dx: 0, dy: 1 },
  ],
  shoulders: [
    { action: Actions.HEAVY_KICK, label: "3", side: "left" },
    { action: Actions.HEAVY_PUNCH, label: "6", side: "right" },
  ],
};

// ─────────────────────────────────────────────
// Game
// ─────────────────────────────────────────────
export class Game {
  constructor(
    canvas,
    p1Input,
    p2Input,
    sfx = null,
    { p1Label = "P1", p2Label = "P2", stageMusic = null } = {},
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = window.devicePixelRatio || 1;
    this.p1Input = p1Input;
    this.p2Input = p2Input;
    this.sfx = sfx;
    this.stageMusic = stageMusic;
    this.p1Label = p1Label;
    this.p2Label = p2Label;

    // Load custom profile name from localStorage for P1 if available
    try {
      const profileStr = localStorage.getItem('smf_user_profile');
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        if (profile && profile.name) {
          this.p1Label = profile.name;
        }
      }
    } catch (e) {
      console.error('Failed to override P1 HUD label from localStorage:', e);
    }

    // Listen for dynamic profile updates (e.g. name or avatar changes in user profile modal)
    window.addEventListener('smf_profile_updated', (e) => {
      const profile = e.detail;
      if (profile) {
        if (profile.name) {
          this.p1Label = profile.name;
        }
        if (profile.avatar && this.p1) {
          loadGameImage(profile.avatar)
            .then(img => { this.p1.headImage = img; })
            .catch(e => console.warn('[Game] Failed to refresh P1 profile avatar:', e));
        }
      }
    });

    // Game logic works in CSS pixel space
    const logicalW = canvas.width / this.dpr;
    const logicalH = canvas.height / this.dpr;

    const floorY = this.floorY;
    const stageLeft = logicalW * STAGE_MARGIN;
    const stageRight = logicalW * (1 - STAGE_MARGIN);
    const startOffset = (stageRight - stageLeft) * 0.25;

    this.p1 = new Fighter(stageLeft + startOffset, floorY, 1, DG.primary, 1);
    this.p2 = new Fighter(stageRight - startOffset, floorY, -1, DG.secondary, 2);

    this.lastTime = 0;
    this.running = false;
    this.roundOver = false;
    this.roundTimer = 99;
    this.hitSparks = [];
    this.floatingMessages = []; // {text, color, x, y, life, maxLife, fontSize}
    this.screenFlash = null;   // {color, life, maxLife}
    this._lastClashKey = null;
    this.victoryCaptured = false;
    this.waitingForIntro = true; // NEW: Walk-in intro sequence
    this.introTimer = 5.0; // Phase 3: 5 seconds of stats display
    this.bgImage = null; // Background image for the current token

    // Active projectiles (hadouken energy balls)
    this.projectiles = []; // {x, y, vx, owner, active, animTimer}

    // Fight alert state
    this.fightAlert = 0; // countdown timer for "FIGHT!" display
    this.fightAlertDuration = 1.5; // seconds to show
    this.waitingForProviders = true; // true until all adapters signal ready

    // Damage log — recent combat events shown between controllers
    this.damageLog = []; // { text, color, side, time }

    // Live voice transcripts — set by VoiceAdapter / PhoneAdapter
    this.p1Transcript = null; // { segments: [{text, matched}], fade: 0-1 }
    this.p2Transcript = null;

    // Phone info — set by PhoneAdapter
    this.p1PhoneInfo = null; // { number: '+15551234567', connected: false }
    this.p2PhoneInfo = null;

    // Visual button latch — keeps buttons lit for a visible duration
    this._p1Latch = new Map(); // action → remaining seconds
    this._p2Latch = new Map();

    // Prediction manager — set by multiplayer code (null for single player)
    this.predictionManager = null;

    // LLM toast — set by LLMAdapter when AI is unavailable
    this.p1LlmToast = null; // { text, time }
    this.p2LlmToast = null;

    // LLM thinking — set by LLMAdapter while requesting a plan
    this.p1LlmThinking = false;
    this.p2LlmThinking = false;

    // Server-authoritative hadouken boost spend pipeline.
    // pending: async consume in-flight
    // queued: consume approved; inject hadouken on next frame
    this._hadoukenConsumePending = false;
    this._hadoukenConsumeQueued = false;
    this.walletActionPaused = false;
    this.walletActionPauseReason = "";
    this.walletActionPauseReasons = new Set();

    window.addEventListener('smf_wallet_action_pause', (e) => {
      const detail = e && e.detail ? e.detail : {};
      this._setWalletActionPause(detail);
    });
  }

  /** Logical (CSS pixel) dimensions */
  get logicalW() {
    return this.canvas.width / this.dpr;
  }
  get logicalH() {
    return this.canvas.height / this.dpr;
  }
  get stageLeft() {
    return this.logicalW * STAGE_MARGIN;
  }
  get stageRight() {
    return this.logicalW * (1 - STAGE_MARGIN);
  }
  get floorY() {
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(max-width: 1024px)').matches;
    if (isMobile) {
      const isLandscape = window.innerWidth > window.innerHeight;
      return isLandscape ? (this.logicalH - 95) : (this.logicalH - 292); // Lowered floor Y by 80px in landscape (offset 95 instead of 175) to clear HUD
    }
    return this.logicalH - 230;
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();

    if (this.stageMusic && this.stageMusic.startForFight) {
      this.stageMusic.startForFight();
    }

    this._loop(this.lastTime);
  }

  _setWalletActionPause(detail = {}) {
    const wasPaused = this.walletActionPaused;
    const reason = String(detail.reason || 'wallet_action');

    if (detail.paused) {
      this.walletActionPauseReasons.add(reason);
    } else if (detail.clearAll || reason === '*') {
      this.walletActionPauseReasons.clear();
    } else {
      this.walletActionPauseReasons.delete(reason);
    }

    const reasons = Array.from(this.walletActionPauseReasons);
    this.walletActionPaused = reasons.length > 0;
    this.walletActionPauseReason = reasons[reasons.length - 1] || '';

    if (wasPaused && !this.walletActionPaused) {
      this._resumeAfterUiPause();
    }
  }

  _resumeAfterUiPause() {
    this.lastTime = performance.now();
    this._dt = 0.016;

    try {
      this.p1Input?.endFrame?.();
      this.p2Input?.endFrame?.();
    } catch (_) {
      // Input managers should never block the fight from resuming.
    }

    if (this.stageMusic && this.stageMusic.startForFight && this.running && !this.roundOver) {
      this.stageMusic.startForFight();
    }
  }

  /** All providers ready — show "FIGHT!" alert then start the round */
  showFightAlert() {
    this.waitingForProviders = false;
    this.fightAlert = this.fightAlertDuration;
    
    // Play boxing bell & low gong SFX
    if (this.sfx && this.sfx.playFightStartSound) {
      this.sfx.playFightStartSound();
    }
    
    if (this.p2.tokenData) {
      window.liveBoostSystem = new LiveBoostSystem(this);
      window.liveBoostSystem.start(this.p2, this.p2.tokenData);
    }
  }

  _loop(timestamp) {
    if (!this.running) {
      if (this.stageMusic && this.stageMusic.stopForMenu) {
        this.stageMusic.stopForMenu();
      }
      return;
    }

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    // Update floor position on resize
    this.p1.floorY = this.floorY;
    this.p2.floorY = this.floorY;

    if (this.walletActionPaused) {
      this._dt = 0;
      this._draw();
      this.p1Input.endFrame();
      this.p2Input.endFrame();
      requestAnimationFrame((t) => this._loop(t));
      return;
    }

    // Tick timed adapters (CommandAdapter holds)
    this.p1Input.update(dt);
    this.p2Input.update(dt);

    this._dt = dt;
    this._update(dt);
    if (this.predictionManager) this.predictionManager.updateSmoothing(dt);
    this._draw();

    this.p1Input.endFrame();
    this.p2Input.endFrame();

    requestAnimationFrame((t) => this._loop(t));
  }

  _isP1ReadyForHadouken() {
    return (
      this.p1.state !== "attack" &&
      !this.p1.isStunned &&
      !this.p1.isLevitated &&
      this.p1.hadoukenCooldown <= 0 &&
      this.p1.grounded
    );
  }

  _showOutOfPremiumBoosts() {
    this.showBoostMessage("⚠️ Out of premium boosts!", "spike");
    this.floatingMessages.push({
      text: "Click Solana profile button to buy more!",
      color: "#ff00ff",
      x: this.logicalW / 2,
      y: this.logicalH * 0.3 + 45,
      life: 1,
      maxLife: 2.0,
      fontSize: 24
    });
  }

  _promptBoostRefillFlow(profile) {
    if (!profile || !profile.walletConnected || profile.walletReadOnly) {
      this._showOutOfPremiumBoosts();
      return;
    }

    if (window.isMultiplayerMatch) {
      this._showOutOfPremiumBoosts();
      this.showBoostMessage("⚠️ Refill boosts after this round.", "spike");
      return;
    }

    if (typeof window.requestBoostRefillFlow === 'function') {
      window.requestBoostRefillFlow({ autoPause: true });
      this.showBoostMessage("⚠️ Fight paused. Refill boosts.", "runner");
      return;
    }

    this._showOutOfPremiumBoosts();
  }

  _update(dt) {
    // Waiting for providers or showing fight alert — no game logic
    // Intro sequence — walk in and show stats
    if (this.waitingForIntro) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.waitingForIntro = false;
        this.showFightAlert(); // Trigger "FIGHT!" after intro
      }
      return;
    }

    if (this.fightAlert > 0) {
      this.fightAlert -= dt;
      return;
    }

    if (this.roundOver) return;
    if (this.walletActionPaused) return;

    this.roundTimer -= dt;
    if (this.roundTimer <= 0) {
      this.roundTimer = 0;
      this.roundOver = true;
      if (window.liveBoostSystem) window.liveBoostSystem.stop();
      return;
    }

    // Update facing
    if (this.p1.x < this.p2.x) {
      this.p1.facing = 1;
      this.p2.facing = -1;
    } else {
      this.p1.facing = -1;
      this.p2.facing = 1;
    }

    // Update adapter facing for semantic commands (voice/LLM)
    for (const adapter of this.p1Input.adapters) {
      if (adapter.setFacing) adapter.setFacing(this.p1.facing);
    }
    for (const adapter of this.p2Input.adapters) {
      if (adapter.setFacing) adapter.setFacing(this.p2.facing);
    }

    const p1Actions = this.p1Input.getActions();
    const p1Pressed = this.p1Input.getJustPressed();
    const p2Actions = this.p2Input.getActions();
    const p2Pressed = this.p2Input.getJustPressed();

    let skipHadoukenConsumeCheck = false;
    if (this._hadoukenConsumeQueued && this._isP1ReadyForHadouken()) {
      // Server approved one boost spend; inject the hadouken press now.
      p1Pressed.add(Actions.HADOUKEN);
      p1Actions.add(Actions.HADOUKEN);
      this._hadoukenConsumeQueued = false;
      skipHadoukenConsumeCheck = true;
    }

    if (this._hadoukenConsumePending && p1Pressed.has(Actions.HADOUKEN)) {
      // Prevent duplicate consume requests while one is already in-flight.
      p1Pressed.delete(Actions.HADOUKEN);
      p1Actions.delete(Actions.HADOUKEN);
    }

    // Intercept Hadouken attack for P1 (the human player) to validate premium boosts.
    if (
      p1Pressed.has(Actions.HADOUKEN) &&
      this._isP1ReadyForHadouken() &&
      !skipHadoukenConsumeCheck
    ) {
      try {
        const profileStr = localStorage.getItem('smf_user_profile');
        let profile = { name: "Guest Fighter", avatar: "", boosts: 15, walletConnected: false, walletReadOnly: false, walletAuthenticated: false, walletAddress: "", smfBalance: 0 };
        if (profileStr) {
          profile = JSON.parse(profileStr);
        } else {
          // If no profile exists, save default with 15 starter boosts
          localStorage.setItem('smf_user_profile', JSON.stringify(profile));
        }

        if (typeof profile.boosts !== 'number') {
          profile.boosts = 15;
        }

        if (
          profile.walletConnected &&
          !profile.walletReadOnly &&
          profile.walletAddress &&
          typeof window.consumeBoostForHadouken === 'function'
        ) {
          // Wallet-linked profile: require authoritative server consume before firing hadouken.
          p1Pressed.delete(Actions.HADOUKEN);
          p1Actions.delete(Actions.HADOUKEN);

          if (!this._hadoukenConsumePending) {
            this._hadoukenConsumePending = true;
            window.consumeBoostForHadouken(profile.walletAddress)
              .then((consumeResult) => {
                if (consumeResult && consumeResult.ok) {
                  this._hadoukenConsumeQueued = true;
                  return;
                }
                if (consumeResult && consumeResult.status === 409) {
                  this._promptBoostRefillFlow(profile);
                  return;
                }
                if (consumeResult && consumeResult.status === 401) {
                  this.showBoostMessage("⚠️ Secure wallet sign-in required.", "spike");
                  if (!window.isMultiplayerMatch && typeof window.requestWalletSecurityFlow === 'function') {
                    window.requestWalletSecurityFlow({ autoPause: true });
                  }
                  return;
                }
                this.showBoostMessage("⚠️ Boost verification failed.", "spike");
              })
              .catch((err) => {
                console.error('Failed to consume boost on server:', err);
                this.showBoostMessage("⚠️ Boost verification failed.", "spike");
              })
              .finally(() => {
                this._hadoukenConsumePending = false;
              });
          }
        } else if (profile.walletConnected && profile.walletReadOnly) {
          p1Pressed.delete(Actions.HADOUKEN);
          p1Actions.delete(Actions.HADOUKEN);
          this.showBoostMessage("⚠️ Read-only wallet cannot spend boosts.", "spike");
          if (typeof window.showWalletConnect === 'function') {
            window.showWalletConnect({ focusStore: true });
          }
        } else {
          // Guest/offline fallback for non-wallet profiles.
          if (profile.boosts > 0) {
            profile.boosts -= 1;
            localStorage.setItem('smf_user_profile', JSON.stringify(profile));

            // Update UI counts if elements exist
            const boostEl1 = document.getElementById('boost-balance-count');
            const boostEl2 = document.getElementById('profile-boosts-count');
            if (boostEl1) boostEl1.textContent = profile.boosts;
            if (boostEl2) boostEl2.textContent = profile.boosts;

            // Dispatch custom event to notify other widgets (e.g. user panel) of the change
            window.dispatchEvent(new CustomEvent('smf_profile_updated', { detail: profile }));
          } else {
            // INTERCEPT: Out of premium boosts! Cancel hadouken by removing it from the pressed actions set
            p1Pressed.delete(Actions.HADOUKEN);
            p1Actions.delete(Actions.HADOUKEN);
            this._showOutOfPremiumBoosts();
          }
        }
      } catch (e) {
        console.error('Failed to validate or deduct premium boosts:', e);
      }
    }

    this.p1.update(
      dt,
      p1Actions,
      p1Pressed,
      this.p2,
      this.stageLeft,
      this.stageRight,
    );
    this.p2.update(
      dt,
      p2Actions,
      p2Pressed,
      this.p1,
      this.stageLeft,
      this.stageRight,
    );

    // Dispatch fighter events → SFX
    if (this.sfx) {
      this._dispatchFighterSfx(this.p1);
      this._dispatchFighterSfx(this.p2);
    }

    // Handle hadouken fire events → spawn projectiles
    this._handleProjectileSpawn(this.p1, 'p1');
    this._handleProjectileSpawn(this.p2, 'p2');

    // Update projectiles (movement + collision)
    this._updateProjectiles(dt, p1Actions, p2Actions);

    // Check attack clash first — if both hitboxes collide, both take damage
    const clashed = this._checkClash(this.p1, this.p2);

    // Normal hit checks only if no clash occurred
    if (!clashed) {
      this._checkHit(this.p1, this.p2, p2Actions);
      this._checkHit(this.p2, this.p1, p1Actions);
    }

    // Track impact points for swept collision next frame
    this.p1.updateImpactTracking();
    this.p2.updateImpactTracking();

    this.hitSparks = this.hitSparks.filter((s) => {
      s.life -= dt;
      return s.life > 0;
    });

    this.damageLog = this.damageLog.filter((e) => {
      e.time -= dt;
      return e.time > 0;
    });

    // Tick down LLM toast timers
    if (this.p1LlmToast) {
      this.p1LlmToast.time -= dt;
      if (this.p1LlmToast.time <= 0) this.p1LlmToast = null;
    }
    if (this.p2LlmToast) {
      this.p2LlmToast.time -= dt;
      if (this.p2LlmToast.time <= 0) this.p2LlmToast = null;
    }

    if (this.p1.health <= 0 || this.p2.health <= 0) {
      this.roundOver = true;
    }
  }

  _checkClash(f1, f2) {
    const h1 = f1.getAttackHitbox();
    const h2 = f2.getAttackHitbox();
    if (!h1 || !h2) return false;

    // Prevent multi-clash on same attack frame pair
    const clashKey = `${f1.attackFrame},${f2.attackFrame}`;
    if (this._lastClashKey === clashKey) return false;

    // Check if the two attack hitboxes overlap
    if (
      !(
        h1.x < h2.x + h2.w &&
        h1.x + h1.w > h2.x &&
        h1.y < h2.y + h2.h &&
        h1.y + h1.h > h2.y
      )
    ) {
      return false;
    }

    this._lastClashKey = clashKey;

    // Both fighters take the other's attack damage at limb multiplier (0.5x)
    const d1 = f1.getAttackData();
    const d2 = f2.getAttackData();
    f1.attackHasHit = true;
    f2.attackHasHit = true;
    if (d1) f2.applyHit(d1, 0.5 * (f1.damageMultiplier || 1), f1.x);
    if (d2) f1.applyHit(d2, 0.5 * (f2.damageMultiplier || 1), f2.x);

    // Clash spark at midpoint
    const cx = (h1.x + h1.w / 2 + h2.x + h2.w / 2) / 2;
    const cy = (h1.y + h1.h / 2 + h2.y + h2.h / 2) / 2;
    this.hitSparks.push({
      x: cx,
      y: cy,
      life: 0.5,
      color: "#ffffff",
      text: "CLASH!",
    });
    this._logEvent("CLASH!", "#ffffff", "center");

    if (this.sfx) this.sfx.clash();

    this._injectVoiceContext(
      f1,
      this._buildContext(f1, f2, "CLASH! Both attacks collided mid-air!"),
    );
    this._injectVoiceContext(
      f2,
      this._buildContext(f2, f1, "CLASH! Both attacks collided mid-air!"),
    );

    return true;
  }

  _checkHit(attacker, defender, defenderActions) {
    // getAttackHit checks attackHasHit internally — returns null if already hit
    const result = attacker.getAttackHit(defender);
    if (!result) return;

    const { hitData, zone, multiplier } = result;
    // Grab hitbox position for spark BEFORE marking as hit
    const hitbox = attacker.getAttackHitbox();
    const sparkX = hitbox
      ? hitbox.x + hitbox.w / 2
      : (attacker.x + defender.x) / 2;
    const sparkY = hitbox ? hitbox.y + hitbox.h / 2 : defender.y - 70;

    // Mark this attack as having connected — prevents further hits
    attacker.attackHasHit = true;

    const atkSide = attacker === this.p1 ? "p1" : "p2";

    if (defender.isBlocking(defenderActions) && defender.grounded) {
      defender.applyBlock(hitData);
      this.hitSparks.push({
        x: sparkX,
        y: sparkY,
        life: 0.15,
        color: "#4488ff",
        text: "BLOCK",
      });
      this._logEvent("BLOCKED", "#4488ff", atkSide);
      if (this.sfx) this.sfx.block();
      this._injectVoiceContext(
        defender,
        this._buildContext(defender, attacker, "You BLOCKED an attack! Nice."),
      );
      this._injectVoiceContext(
        attacker,
        this._buildContext(
          attacker,
          defender,
          "Your attack was BLOCKED by the opponent.",
        ),
      );
    } else {
      const finalMultiplier = multiplier * (attacker.damageMultiplier || 1);
      defender.applyHit(hitData, finalMultiplier, attacker.x);
      const totalDmg = Math.round(hitData.damage * finalMultiplier * 10) / 10;
      let color = "#ffcc00";
      let text = `${totalDmg}`;
      let logText = `${totalDmg} dmg`;
      let hitDesc = `You got HIT for ${totalDmg} damage!`;
      let atkDesc = `You LANDED a hit for ${totalDmg} damage!`;
      if (zone === "head") {
        color = "#ff6600";
        text = `${totalDmg} HEAD!`;
        logText = `${totalDmg} HEAD`;
        if (this.sfx) {
          if (Math.random() < 0.5 && typeof this.sfx.playHeavyWhipImpact === 'function') {
            this.sfx.playHeavyWhipImpact();
          } else {
            this.sfx.headshot();
          }
        }
        if (window.haptic) window.haptic.headshot();
        hitDesc = `HEADSHOT! You took ${totalDmg} damage to the head!`;
        atkDesc = `HEADSHOT! You nailed them in the head for ${totalDmg}!`;
      } else if (zone === "crotch") {
        color = "#ff00ff";
        text = `${totalDmg} CROTCH!`;
        logText = `${totalDmg} CROTCH`;
        if (this.sfx) this.sfx.crotchshot();
        if (window.haptic) window.haptic.heavyHit();
        hitDesc = `CROTCH SHOT! You took ${totalDmg} damage below the belt!`;
        atkDesc = `LOW BLOW! You hit them in the crotch for ${totalDmg}!`;
      } else {
        const isArmOrLeg = zone === "arm" || zone === "leg";
        if (isArmOrLeg) {
          color = "#88aaaa";
          logText = `${totalDmg} ${zone}`;
        }
        if (this.sfx) {
          const isKick = attacker.currentAttack && attacker.currentAttack.toLowerCase().includes("kick");
          if (isKick && isArmOrLeg && typeof this.sfx.playHeavyWhipImpact === "function") {
            this.sfx.playHeavyWhipImpact();
          } else {
            this.sfx.hit();
          }
        }
        if (window.haptic) window.haptic.lightHit();
      }
      this.hitSparks.push({ x: sparkX, y: sparkY, life: 0.4, color, text });
      
      // Add visual particles
      if (window.effects) {
        if (typeof window.effects.addHitParticles === 'function') {
          window.effects.addHitParticles(sparkX, sparkY, color);
        }
        if (typeof window.effects.addLashEffect === 'function') {
          window.effects.addLashEffect(sparkX, sparkY, color);
        }
      }
      
      this._logEvent(logText, color, atkSide);
      this._injectVoiceContext(
        defender,
        this._buildContext(defender, attacker, hitDesc),
      );
      this._injectVoiceContext(
        attacker,
        this._buildContext(attacker, defender, atkDesc),
      );
    }
  }

  _logEvent(text, color, side) {
    this.damageLog.push({ text, color, side, time: 3.0 });
    if (this.damageLog.length > 8) this.damageLog.shift();
  }

  /** Build fight state context string for voice agent injection */
  _buildContext(fighter, opponent, event) {
    const side = fighter === this.p1 ? "P1" : "P2";
    const opSide = fighter === this.p1 ? "P2" : "P1";
    const dist = Math.abs(fighter.x - opponent.x);
    const facing = fighter.facing === 1 ? "right" : "left";
    const opFacing = opponent.facing === 1 ? "right" : "left";
    const airborne = !fighter.grounded ? ", airborne" : "";
    const opAirborne = !opponent.grounded ? ", airborne" : "";

    return `[FIGHT CONTEXT] ${event}
You (${side}): health=${fighter.health}/200, state=${fighter.state}${airborne}, facing ${facing}
Opponent (${opSide}): health=${opponent.health}/200, state=${opponent.state}${opAirborne}, facing ${opFacing}
Distance: ${Math.round(dist)}px | Timer: ${Math.ceil(this.roundTimer)}s`;
  }

  /** Send context to voice adapters for a specific fighter */
  _injectVoiceContext(fighter, context) {
    const input = fighter === this.p1 ? this.p1Input : this.p2Input;
    for (const adapter of input.adapters) {
      if (adapter.injectContext) {
        adapter.injectContext(context);
      }
    }
  }

  _dispatchFighterSfx(fighter) {
    for (const evt of fighter.events) {
      if (evt === "somersault") this.sfx.somersault();
      else if (evt === "dash") this.sfx.dash();
      else if (evt === "hadouken:windup") this.sfx.hadoukenCharge();
      else if (evt === "hadouken:fire") this.sfx.hadoukenFire();
      else if (evt.startsWith("punch:")) this.sfx.whoosh();
      else if (evt.startsWith("kick:")) this.sfx.whoosh();
    }
  }

  // ─────────────────────────────────────────
  // Projectile management
  // ─────────────────────────────────────────

  _handleProjectileSpawn(fighter, owner) {
    for (const evt of fighter.events) {
      if (evt === 'hadouken:fire') {
        const hasActive = this.projectiles.some(p => p.owner === owner && p.active);
        const variant = fighter.nextHadoukenVariant || 'default';
        
        // Only one active projectile normally, but bypass if overdrive variant
        if (!hasActive || variant !== 'default') {
          const skeleton = fighter._buildSkeleton();
          const hand = fighter._localToWorld(skeleton.handFront[0], skeleton.handFront[1]);
          // Add random y offset if overdrive for chaotic spam
          const yOffset = variant !== 'default' ? (Math.random() * 60 - 30) : 0;
          this.projectiles.push({
            x: hand[0],
            y: hand[1] + yOffset,
            vx: fighter.facing * PROJECTILE_SPEED,
            owner,
            active: true,
            animTimer: 0,
            variant: variant
          });
          fighter.nextHadoukenVariant = null;
        }
      }
    }
  }

  _updateProjectiles(dt, p1Actions, p2Actions) {
    for (const proj of this.projectiles) {
      if (!proj.active) continue;
      proj.x += proj.vx * dt;
      proj.animTimer += dt;

      // Off stage?
      if (proj.x < this.stageLeft - 30 || proj.x > this.stageRight + 30) {
        proj.active = false;
        continue;
      }

      // Collision with opponent
      const target = proj.owner === 'p1' ? this.p2 : this.p1;
      const targetActions = proj.owner === 'p1' ? p2Actions : p1Actions;
      const attacker = proj.owner === 'p1' ? this.p1 : this.p2;

      // Skip if target already stunned (unless levitating, which is a cinematic state)
      if ((target.state === 'hitstun' || target.state === 'blockstun') && !target.isLevitated) continue;

      // Projectile hitbox (mid-height circle, 24x24)
      const pRect = { x: proj.x - 12, y: proj.y - 12, w: 24, h: 24 };
      // Target body bounding box
      const tRect = {
        x: target.x - target.width / 2,
        y: target.y - target.height,
        w: target.width,
        h: target.height,
      };

      // AABB overlap
      if (
        pRect.x < tRect.x + tRect.w && pRect.x + pRect.w > tRect.x &&
        pRect.y < tRect.y + tRect.h && pRect.y + pRect.h > tRect.y
      ) {
        proj.active = false;
        const atkSide = proj.owner;

        if (target.isBlocking(targetActions) && target.grounded) {
          target.applyBlock({ blockstun: PROJECTILE_BLOCKSTUN, hitstun: PROJECTILE_HITSTUN, damage: PROJECTILE_DAMAGE });
          this.hitSparks.push({ x: proj.x, y: proj.y, life: 0.15, color: '#4488ff', text: 'BLOCK' });
          this._logEvent('BLOCKED', '#4488ff', atkSide);
          if (this.sfx) this.sfx.block();
        } else {
          const baseDmg = proj.damage !== undefined ? proj.damage : PROJECTILE_DAMAGE;
          const finalProjDmg = Math.round(baseDmg * (attacker.damageMultiplier || 1));

          if (proj.isOverdrive && !proj.isLast) {
            // Keep at least 1 HP so the full overdrive combo completes beautifully
            target.health = Math.max(1, target.health - finalProjDmg);
          } else {
            target.health = Math.max(0, target.health - finalProjDmg);
          }

          target.state = 'hitstun';
          target.stunFrames = PROJECTILE_HITSTUN;
          const dir = target.x > attacker.x ? 1 : -1;
          target.vx = dir * 200;
          target.currentAttack = null;

          this.hitSparks.push({ x: proj.x, y: proj.y, life: 0.5, color: DG.primary, text: `${finalProjDmg}` });
          this._logEvent(`${finalProjDmg} dmg`, DG.primary, atkSide);
          if (this.sfx) this.sfx.hit();
        }

        if (target.health <= 0) {
          this.roundOver = true;
          if (window.liveBoostSystem) window.liveBoostSystem.stop();
        }
      }
    }

    // Clean up inactive
    this.projectiles = this.projectiles.filter(p => p.active);
  }

  _drawProjectile(ctx, proj) {
    ctx.save();

    const variant = proj.variant || 'default';
    const t = proj.animTimer || 0;
    const dir = proj.vx >= 0 ? 1 : -1;
    const pulse = 1 + Math.sin(t * 18) * 0.08;
    const wobble = Math.sin(t * 26 + (proj.owner === 'p2' ? 1.7 : 0)) * 2.2;
    const flicker = Math.sin(t * 41) * 0.5;

    let scale = pulse;
    let palette = {
      glow: 'rgba(255, 84, 20, 0.28)',
      outer: '#ff3b12',
      mid: '#ff8a00',
      hot: '#ffd85a',
      core: '#fff7c2',
      stroke: '#5b1200',
      spark: '#ffd24a'
    };

    if (variant === 'fire') {
      scale *= 1.12;
      palette = { ...palette, glow: 'rgba(255, 52, 0, 0.34)', outer: '#ff1900', mid: '#ff7800', hot: '#ffe05c' };
    } else if (variant === 'plasma') {
      palette = {
        glow: 'rgba(0, 229, 255, 0.28)',
        outer: '#00d5ff',
        mid: '#42fff2',
        hot: '#d9ffff',
        core: '#ffffff',
        stroke: '#003b59',
        spark: '#8ffcff'
      };
    } else if (variant === 'void') {
      scale *= 1.22;
      palette = {
        glow: 'rgba(165, 64, 255, 0.30)',
        outer: '#4b0082',
        mid: '#a02cff',
        hot: '#ff6cff',
        core: '#ffe6ff',
        stroke: '#180020',
        spark: '#d65cff'
      };
    } else if (variant === 'electric') {
      palette = {
        glow: 'rgba(255, 236, 48, 0.30)',
        outer: '#ffb300',
        mid: '#ffe100',
        hot: '#ffffff',
        core: '#fffde0',
        stroke: '#573a00',
        spark: '#fff26b'
      };
    }

    ctx.translate(proj.x, proj.y);
    ctx.scale(dir * scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Soft 2D aura, kept flat so it does not read as a glossy sphere.
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.ellipse(-18, 0, 54, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';

    // Outer hand-drawn flame silhouette.
    const outerGrad = ctx.createLinearGradient(-70, 0, 18, 0);
    outerGrad.addColorStop(0, 'rgba(255,255,255,0)');
    outerGrad.addColorStop(0.18, palette.outer);
    outerGrad.addColorStop(0.62, palette.mid);
    outerGrad.addColorStop(1, palette.hot);
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = outerGrad;
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.bezierCurveTo(8, -13 - flicker, -22, -18 + wobble, -48, -8);
    ctx.quadraticCurveTo(-67, -2 - wobble, -78, 1);
    ctx.quadraticCurveTo(-60, 6 + flicker, -48, 12 + wobble);
    ctx.bezierCurveTo(-20, 21 - flicker, 8, 13 + wobble, 18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.stroke();

    // Hot inner lick, like an inked animation cel rather than a radial ball.
    const innerGrad = ctx.createLinearGradient(-46, 0, 15, 0);
    innerGrad.addColorStop(0, 'rgba(255,255,255,0)');
    innerGrad.addColorStop(0.35, palette.mid);
    innerGrad.addColorStop(0.72, palette.hot);
    innerGrad.addColorStop(1, palette.core);
    ctx.globalAlpha = 0.98;
    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.bezierCurveTo(5, -7, -10, -9 - flicker, -28, -3);
    ctx.quadraticCurveTo(-41, 1 + wobble, -48, 5);
    ctx.quadraticCurveTo(-31, 5 - flicker, -20, 10);
    ctx.bezierCurveTo(-4, 13, 8, 7, 13, 0);
    ctx.closePath();
    ctx.fill();

    // Sketch strokes and speed lines sell the 2D frame-by-frame feel.
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = palette.hot;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * 6 + Math.sin(t * 20 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(-58 - i * 6, y * 0.6);
      ctx.quadraticCurveTo(-34, y - 5, 6, y * 0.25);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.8;
    ctx.fillStyle = palette.spark;
    for (let i = 0; i < 5; i++) {
      const sx = -46 - i * 9 + Math.sin(t * 30 + i * 2.1) * 6;
      const sy = (i % 2 ? 1 : -1) * (14 + i * 2) + Math.cos(t * 24 + i) * 3;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(0.35 + i * 0.45);
      ctx.fillRect(-2, -1, 8 - i * 0.7, 2);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Show a large cinematic floating message above the stage center.
   * tier: 'micro'|'runner'|'spike'|'overdrive'
   */
  showBoostMessage(text, tier) {
    const tierStyles = {
      micro:     { color: '#ffcc00', fontSize: 38 },
      runner:    { color: '#ff8800', fontSize: 46 },
      spike:     { color: '#ff2244', fontSize: 54 },
      overdrive: { color: '#cc00ff', fontSize: 64 },
    };
    const style = tierStyles[tier] || { color: '#ffffff', fontSize: 46 };
    this.floatingMessages.push({
      text,
      color: style.color,
      x: this.logicalW / 2,
      y: this.logicalH * 0.3,
      life: 1,
      maxLife: tier === 'overdrive' ? 3.5 : 2.0,
      fontSize: style.fontSize,
    });
  }

  /** Flash the entire screen with a translucent color burst. */
  triggerScreenFlash(color, duration = 0.4) {
    this.screenFlash = { color, life: 1, maxLife: duration };
  }

  /** Legacy small floating text (hit sparks) — kept for compatibility. */
  showFloatingText(text, color) {
    this.hitSparks.push({
      x: this.p2.x,
      y: this.p2.y - 120,
      life: 2.0,
      color,
      text,
      isHuge: true,
    });
  }

  _drawBackground(ctx, w, h) {
    // Fill base black
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Try to draw opponent's cover image as a dimmed background
    const bgImg = this.p2.headerImage || this.p2.headImage;
    if (bgImg && bgImg.complete) {
      // Subtle pulse based on time
      const pulse = 0.35 + Math.sin(performance.now() / 2000) * 0.15;
      ctx.globalAlpha = pulse;
      
      const scale = Math.max(w / bgImg.width, h / bgImg.height);
      const iw = bgImg.width * scale;
      const ih = bgImg.height * scale;
      ctx.drawImage(bgImg, (w - iw) / 2, (h - ih) / 2, iw, ih);
      ctx.globalAlpha = 1;
    }

    // Add a dark vignette
    const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)'); // Lighter vignette for brighter background
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Add glowing arena scanline effect
    ctx.strokeStyle = 'rgba(0, 255, 157, 0.05)';
    ctx.lineWidth = 1;
    const timeOffset = (performance.now() / 50) % 40;
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + timeOffset);
      ctx.lineTo(w, y + timeOffset);
      ctx.stroke();
    }
  }

  _drawIntroStats(ctx) {
    const w = this.logicalW;
    const h = this.logicalH;
    
    ctx.save();
    
    if (window.isMultiplayerMatch) {
      const cardW = 520;
      const cardH = 220;
      const x = w / 2 - cardW / 2;
      const y = h / 2 - cardH / 2 - 20;

      // 1. Outer container (glassmorphism back panel)
      ctx.fillStyle = 'rgba(10, 10, 15, 0.88)';
      ctx.shadowColor = 'rgba(0, 229, 255, 0.25)';
      ctx.shadowBlur = 25;
      
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 20);
      ctx.fill();
      
      // Dual-colored border (neon green to neon pink gradient)
      const borderGrad = ctx.createLinearGradient(x, y, x + cardW, y);
      borderGrad.addColorStop(0, '#00ff9d');
      borderGrad.addColorStop(0.5, '#00e5ff');
      borderGrad.addColorStop(1, '#ff00ff');
      ctx.strokeStyle = borderGrad;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0; // reset shadow

      // 2. Title header
      ctx.font = 'bold 12px system-ui';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MULTIPLAYER ARENA PvP', w / 2, y + 25);

      // 3. Player 1 Info (Left side)
      const p1X = x + cardW * 0.25;
      const avatarY = y + cardH * 0.45;
      
      // Neon green aura around P1 avatar
      ctx.shadowColor = '#00ff9d';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#0a0a0f';
      ctx.strokeStyle = '#00ff9d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p1X, avatarY, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw P1 Avatar Image or default icon
      if (this.p1 && this.p1.headImage && this.p1.headImage.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p1X, avatarY, 34, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(this.p1.headImage, p1X - 34, avatarY - 34, 68, 68);
        ctx.restore();
      } else {
        // Draw elegant placeholder stickhead
        ctx.strokeStyle = '#00ff9d';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p1X, avatarY - 4, 12, 0, Math.PI * 2); // head
        ctx.moveTo(p1X, avatarY + 8);
        ctx.lineTo(p1X, avatarY + 22); // body
        ctx.moveTo(p1X - 10, avatarY + 12);
        ctx.lineTo(p1X + 10, avatarY + 12); // arms
        ctx.stroke();
      }

      // P1 Label Name
      ctx.font = 'bold 22px system-ui';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(this.p1Label, p1X, y + cardH * 0.76);

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#00ff9d';
      ctx.fillText('HOST · P1', p1X, y + cardH * 0.88);

      // 4. Player 2 Info (Right side)
      const p2X = x + cardW * 0.75;
      
      // Neon pink aura around P2 avatar
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#0a0a0f';
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p2X, avatarY, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw P2 Avatar Image or default icon
      if (this.p2 && this.p2.headImage && this.p2.headImage.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p2X, avatarY, 34, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(this.p2.headImage, p2X - 34, avatarY - 34, 68, 68);
        ctx.restore();
      } else {
        // Draw elegant placeholder stickhead
        ctx.strokeStyle = '#ff00ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p2X, avatarY - 4, 12, 0, Math.PI * 2); // head
        ctx.moveTo(p2X, avatarY + 8);
        ctx.lineTo(p2X, avatarY + 22); // body
        ctx.moveTo(p2X - 10, avatarY + 12);
        ctx.lineTo(p2X + 10, avatarY + 12); // arms
        ctx.stroke();
      }

      // P2 Label Name
      ctx.font = 'bold 22px system-ui';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(this.p2Label, p2X, y + cardH * 0.76);

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#ff00ff';
      ctx.fillText('CHALLENGER · P2', p2X, y + cardH * 0.88);

      // 5. Center "VS" Emblem
      const centerX = w / 2;
      const centerY = y + cardH * 0.45;
      
      // Pulse animation for VS circle border
      const pulse = 1 + 0.05 * Math.sin(Date.now() / 150);
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12 * pulse;
      ctx.fillStyle = '#0a0a0f';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 24 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw "VS" text inside circle
      ctx.font = 'bold 22px system-ui';
      ctx.fillStyle = '#fff';
      ctx.fillText('VS', centerX, centerY);

      ctx.restore();
      return;
    }

    // Helper to draw a stat card
    const drawCard = (x, y, title, token, isP1) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.strokeStyle = isP1 ? '#00ff9d' : '#ff00ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 150, y - 100, 300, 200, 15);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Title
      ctx.font = 'bold 24px system-ui';
      ctx.fillStyle = isP1 ? '#00ff9d' : '#ff00ff';
      ctx.fillText(title, x, y - 70);
      
      if (!token) {
        ctx.font = '20px monospace';
        ctx.fillStyle = '#888';
        ctx.fillText('NO MARKET DATA', x, y);
        return;
      }

      const power = calculateFighterPower(token);
      const displayName = token.symbol || token.name || '???';

      // Token name / symbol (large)
      ctx.font = 'bold 28px system-ui';
      ctx.fillStyle = '#fff';
      ctx.fillText(`$${displayName}`, x, y - 45);

      // Power rating
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = isP1 ? '#00ff9d' : '#ff00ff';
      ctx.fillText(`⚔️ POWER: ${power.rating}`, x, y - 12);

      // Market stats
      ctx.font = '13px monospace';
      ctx.fillStyle = '#aaa';
      const mc  = token.marketCap  ? `$${(token.marketCap/1000).toFixed(1)}K`   : '??';
      const vol = token.volume24h  ? `$${(token.volume24h/1000).toFixed(1)}K`   : '??';
      const chg = (token.priceChange24h !== undefined && token.priceChange24h !== null)
        ? `${Number(token.priceChange24h).toFixed(2)}%` : '??%';
      ctx.fillText(`MCAP: ${mc}`, x, y + 18);
      ctx.fillText(`VOL:  ${vol}`, x, y + 38);
      ctx.fillText(`CHG:  ${chg}`, x, y + 58);
    };

    // Render only the AI token (P2) to keep UI clean for the human
    drawCard(w / 2, h / 2 - 40, 'OPPONENT INTEL', this.p2.marketData || this.p2.tokenData, false);

    ctx.restore();
  }
  _draw() {
    const { ctx, canvas, dpr } = this;

    // Clear at physical resolution, then scale to CSS pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Draw Dynamic Token Background
    this._drawBackground(ctx, canvas.width, canvas.height);

    // Scale context so all drawing is in CSS pixel space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Intro stats card moved after fighters render
    const w = this.logicalW;
    const h = this.logicalH;
    const floorY = this.floorY;

    // Floor line with subtle gradient
    const floorGrad = ctx.createLinearGradient(
      this.stageLeft,
      0,
      this.stageRight,
      0,
    );
    floorGrad.addColorStop(0, DG.gradStart || '#00ff9d');
    floorGrad.addColorStop(1, DG.gradEnd || '#ff00ff');
    ctx.strokeStyle = '#00ff9d';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#00ff9d';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(this.stageLeft - 200, floorY);
    ctx.lineTo(this.stageRight + 200, floorY);
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset shadow
    ctx.globalAlpha = 1;

    // Neon Ropes (Phase 3)
    ctx.save();
    ctx.lineWidth = 4;
    ctx.shadowBlur = 15;
    
    // Left Rope
    ctx.strokeStyle = DG.primary;
    ctx.shadowColor = DG.primary;
    ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 100) * 0.2;
    ctx.beginPath();
    ctx.moveTo(this.stageLeft, floorY - 300);
    ctx.lineTo(this.stageLeft, floorY);
    ctx.stroke();

    // Right Rope
    ctx.strokeStyle = DG.secondary;
    ctx.shadowColor = DG.secondary;
    ctx.beginPath();
    ctx.moveTo(this.stageRight, floorY - 300);
    ctx.lineTo(this.stageRight, floorY);
    ctx.stroke();
    ctx.restore();

    // Glowing Floor Grid (Phase 3)
    ctx.save();
    // Solid Neon Floor Line
    ctx.strokeStyle = "rgba(0, 255, 157, 0.6)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0, 255, 157, 0.8)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(w, floorY);
    ctx.stroke();

    // Perspective Grid (Vertical only)
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0, 255, 157, 0.15)";
    ctx.lineWidth = 1;
    for (let i = -15; i <= 15; i++) {
      const x = w/2 + i * 80;
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(w/2 + i * 250, floorY + 250);
      ctx.stroke();
    }
    ctx.restore();

    // Fighters (with visual smoothing offsets for prediction corrections)
    const pm = this.predictionManager;
    if (pm) {
      this.p1.x += pm.smoothP1.dx;
      this.p1.y += pm.smoothP1.dy;
      this.p2.x += pm.smoothP2.dx;
      this.p2.y += pm.smoothP2.dy;
    }
    this.p1.draw(ctx);
    this.p2.draw(ctx);
    if (this.p1.effects) this.p1.effects.update(this._dt, ctx);
    if (this.p2.effects) this.p2.effects.update(this._dt, ctx);
    if (window.__SMF_DEBUG_HITBOXES === true) {
      this.p1.drawHitboxes(ctx);
      this.p2.drawHitboxes(ctx);
    }

    // Projectiles (drawn between fighters and hit sparks)
    for (const proj of this.projectiles) {
      if (proj.active) this._drawProjectile(ctx, proj);
    }

    if (pm) {
      this.p1.x -= pm.smoothP1.dx;
      this.p1.y -= pm.smoothP1.dy;
      this.p2.x -= pm.smoothP2.dx;
      this.p2.y -= pm.smoothP2.dy;
    }

    if (this.waitingForIntro) {
      this._drawIntroStats(ctx);
    }

    // Hit sparks + damage text
    for (const spark of this.hitSparks) {
      const alpha = Math.min(1, spark.life / 0.2);
      const rise = (0.4 - spark.life) * 40;

      const size = 18 * alpha;
      ctx.fillStyle = spark.color;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillRect(spark.x - size / 2, spark.y - size / 2 - rise, size, size);

      if (spark.text) {
        ctx.globalAlpha = alpha;
        ctx.font = spark.isHuge ? "bold 24px monospace" : "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = spark.color;
        ctx.fillText(spark.text, spark.x, spark.y - 12 - rise);
      }

      ctx.globalAlpha = 1;
    }

    // ── Cinematic Floating Boost Messages ──
    const dt2 = this._dt || 0.016;
    for (let i = this.floatingMessages.length - 1; i >= 0; i--) {
      const msg = this.floatingMessages[i];
      msg.life -= dt2 / msg.maxLife;
      if (msg.life <= 0) { this.floatingMessages.splice(i, 1); continue; }
      const alpha = msg.life > 0.8 ? 1 : msg.life / 0.8;
      const rise = (1 - msg.life) * 30;
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = `bold ${msg.fontSize}px 'Orbitron', monospace`;
      ctx.shadowColor = msg.color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = msg.color;
      ctx.fillText(msg.text, msg.x, msg.y - rise);
      // Subtle white stroke for readability
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeText(msg.text, msg.x, msg.y - rise);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // ── Screen Flash Overlay ──
    if (this.screenFlash) {
      this.screenFlash.life -= dt2 / this.screenFlash.maxLife;
      if (this.screenFlash.life <= 0) {
        this.screenFlash = null;
      } else {
        const flashAlpha = this.screenFlash.life * 0.45;
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = this.screenFlash.color;
        ctx.fillRect(0, 0, w, this.logicalH);
        ctx.globalAlpha = 1;
      }
    }

    // Effects (particles, coin rain, etc.)
    if (window.effects) {
      window.effects.updateAndDraw(ctx);
    }

    // HUD
    this._drawHUD();

    // Voice transcripts — just above the floor
    const txY = this.floorY + 16;
    this._drawTranscript(ctx, this.p1Transcript, w / 2, txY, DG.primary);
    this._drawTranscript(ctx, this.p2Transcript, w / 2, txY + 16, DG.secondary);

    // Controller overlays — merge held + justPressed, decompose compound actions
    const dt = this._dt || 0.016;
    const p1Visual = this._buildVisualActions(
      this.p1Input,
      this.p1.facing,
      this._p1Latch,
      dt,
    );
    const p2Visual = this._buildVisualActions(
      this.p2Input,
      this.p2.facing,
      this._p2Latch,
      dt,
    );
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(max-width: 1024px)').matches;
    if (!isMobile) {
      const ctrlY = this.floorY + 24;
      this._drawController(ctx, P1_CONTROLLER, 30, ctrlY, p1Visual, DG.primary);
      this._drawController(
        ctx,
        P2_CONTROLLER,
        w - 200,
        ctrlY,
        p2Visual,
        DG.secondary,
      );

      // Damage log between controllers
      this._drawDamageLog(ctx, w, this.floorY + 160);
    }

    // Phone number display — shown until call connects
    this._drawPhoneInfo(ctx, w, h);

    // LLM toast indicators
    this._drawLlmToast(ctx, this.p1LlmToast, 30 + 85, this.floorY + 16, DG.primary);
    this._drawLlmToast(ctx, this.p2LlmToast, w - 200 + 85, this.floorY + 16, DG.secondary);

    // LLM thinking indicators (shown when no error toast is active)
    if (this.p1LlmThinking && !this.p1LlmToast) {
      this._drawLlmThinking(ctx, 30 + 85, this.floorY + 16, DG.primary);
    }
    if (this.p2LlmThinking && !this.p2LlmToast) {
      this._drawLlmThinking(ctx, w - 200 + 85, this.floorY + 16, DG.secondary);
    }

    // "Waiting..." overlay
    if (this.waitingForProviders) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(performance.now() / 300) * 0.3;
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = DG.slate;
      ctx.fillText("Connecting...", w / 2, this.floorY / 2);
      ctx.restore();
    }

    // "FIGHT!" alert overlay
    if (this.fightAlert > 0) {
      const progress = 1 - this.fightAlert / this.fightAlertDuration;
      const alpha =
        progress < 0.1
          ? progress / 0.1 // fade in
          : progress > 0.7
            ? (1 - progress) / 0.3 // fade out
            : 1;
      const scale = 1 + Math.sin(progress * Math.PI) * 0.15; // subtle pulse

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.round(64 * scale)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Gradient text effect
      const grad = ctx.createLinearGradient(w / 2 - 80, 0, w / 2 + 80, 0);
      grad.addColorStop(0, DG.gradStart || '#00ff9d');
      grad.addColorStop(1, DG.gradEnd || '#ff00ff');
      ctx.fillStyle = grad;
      ctx.fillText("FIGHT!", w / 2, h / 2);
      ctx.restore();
    }

    if (this.walletActionPaused) {
      const reason = this.walletActionPauseReason || 'wallet_action';
      const statusCopy = reason === 'boost_refill_required'
        ? 'REFILL BOOSTS TO RESUME'
        : reason === 'help_modal'
          ? 'CLOSE HELP TO RESUME'
          : 'COMPLETE WALLET ACTION';
      ctx.save();
      ctx.fillStyle = 'rgba(5, 8, 12, 0.78)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText('PAUSED', w / 2, h / 2 - 28);
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = '#e8eef5';
      ctx.fillText(statusCopy, w / 2, h / 2 + 4);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#9fb1c2';
      ctx.fillText(reason === 'help_modal' ? 'Your fight state is held safely.' : 'Open Profile/Wallet modal and complete the flow.', w / 2, h / 2 + 28);
      ctx.restore();
    }
  }

  _drawHUD() {
    const { ctx } = this;
    const w = this.logicalW;
    const p1MaxHealth = this.p1.healthMax || 100;
    const p2MaxHealth = this.p2.healthMax || 100;
    const isMobileHud = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(max-width: 1024px)').matches;
    const isLandscapeHud = isMobileHud && window.innerWidth > window.innerHeight;
    const timerWidth = isMobileHud ? 78 : 72;
    const margin = 40;
    const gap = 10;
    const barW = (w - margin * 2 - timerWidth - gap * 2) / 2;
    const barH = 20;

    const barY = 20;

    // P1 health — gradient fill
    const p1BarX = margin;
    ctx.fillStyle = DG.charcoal;
    ctx.fillRect(p1BarX, barY, barW, barH);
    const p1Pct = Math.max(0, Math.min(1, this.p1.health / p1MaxHealth));
    if (p1Pct > 0.25) {
      const g1 = ctx.createLinearGradient(p1BarX, 0, p1BarX + barW, 0);
      g1.addColorStop(0, DG.gradStart || '#00ff9d');
      g1.addColorStop(1, DG.gradEnd || '#ff00ff');
      ctx.fillStyle = g1;
    } else {
      ctx.fillStyle = DG.danger;
    }
    ctx.fillRect(p1BarX, barY, barW * p1Pct, barH);
    ctx.strokeStyle = DG.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(p1BarX, barY, barW, barH);

    // P2 health — gradient fill (reversed)
    const p2BarX = w - margin - barW;
    ctx.fillStyle = DG.charcoal;
    ctx.fillRect(p2BarX, barY, barW, barH);
    const p2Pct = Math.max(0, Math.min(1, this.p2.health / p2MaxHealth));
    if (p2Pct > 0.25) {
      const g2 = ctx.createLinearGradient(p2BarX, 0, p2BarX + barW, 0);
      g2.addColorStop(0, DG.gradEnd || '#ff00ff');
      g2.addColorStop(1, DG.gradStart || '#00ff9d');
      ctx.fillStyle = g2;
    } else {
      ctx.fillStyle = DG.danger;
    }
    const p2Fill = barW * p2Pct;
    ctx.fillRect(p2BarX + barW - p2Fill, barY, p2Fill, barH);
    ctx.strokeStyle = DG.border;
    ctx.strokeRect(p2BarX, barY, barW, barH);

    // Draw P1 circular mini-avatar next to health bar
    if (this.p1.headImage && this.p1.headImage.complete) {
      ctx.save();
      const p1AvatarX = p1BarX - 12;
      const p1AvatarY = barY + barH / 2;
      const r = 9;
      // Draw border
      ctx.beginPath();
      ctx.arc(p1AvatarX, p1AvatarY, r + 1, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff9d';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Clip to circular area
      ctx.beginPath();
      ctx.arc(p1AvatarX, p1AvatarY, r, 0, Math.PI * 2);
      ctx.clip();
      
      // Draw image
      ctx.drawImage(this.p1.headImage, p1AvatarX - r, p1AvatarY - r, r * 2, r * 2);
      ctx.restore();
    }

    // Draw P2 circular mini-avatar next to health bar
    if (this.p2.headImage && this.p2.headImage.complete) {
      ctx.save();
      const p2AvatarX = p2BarX + barW + 12;
      const p2AvatarY = barY + barH / 2;
      const r = 9;
      // Draw border
      ctx.beginPath();
      ctx.arc(p2AvatarX, p2AvatarY, r + 1, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Clip to circular area
      ctx.beginPath();
      ctx.arc(p2AvatarX, p2AvatarY, r, 0, Math.PI * 2);
      ctx.clip();
      
      // Draw image
      ctx.drawImage(this.p2.headImage, p2AvatarX - r, p2AvatarY - r, r * 2, r * 2);
      ctx.restore();
    }

    // Labels
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = DG.primary;
    ctx.fillText("P1", p1BarX, barY - 5);
    ctx.font = "11px monospace";
    ctx.fillStyle = DG.slate;
    ctx.fillText(this.p1Label, p1BarX + 26, barY - 5);

    ctx.font = "bold 14px monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = DG.secondary;
    ctx.fillText("P2", p2BarX + barW, barY - 5);
    ctx.font = "11px monospace";
    ctx.fillStyle = DG.slate;
    ctx.fillText(this.p2Label, p2BarX + barW - 26, barY - 5);

    // Timer
    ctx.fillStyle = DG.text;
    const timerFontSize = isLandscapeHud ? 36 : (isMobileHud ? 34 : 32);
    const timerY = barY + barH + (isMobileHud ? 7 : 4);
    ctx.font = `bold ${timerFontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.strokeText(Math.ceil(this.roundTimer).toString(), w / 2, timerY);
    ctx.fillText(Math.ceil(this.roundTimer).toString(), w / 2, timerY);

    // Round over text
    if (this.roundOver) {
      ctx.fillStyle = DG.text;
      ctx.font = "bold 48px monospace";
      ctx.textAlign = "center";
      let text = "TIME!";
      if (this.p1.health <= 0 && this.p2.health <= 0) text = "DOUBLE KO!";
      else if (this.p1.health <= 0) text = "P2 WINS!";
      else if (this.p2.health <= 0) text = "P1 WINS!";
      else if (this.p1.health > this.p2.health) text = "P1 WINS!";
      else if (this.p2.health > this.p1.health) text = "P2 WINS!";
      else text = "DRAW!";

      // Pause fight music immediately when the round ends
      if (this.stageMusic && this.stageMusic.stopForMenu) {
        this.stageMusic.stopForMenu();
      }

      // Premium Victory Overlay (Phase 3)
      if (!this.victoryOverlayTriggered) {
        this.victoryOverlayTriggered = true;
        const winnerNum = (this.p1.health > this.p2.health) ? 1 : 2;
        const winner = winnerNum === 1 ? this.p1 : this.p2;
        const loser = winnerNum === 1 ? this.p2 : this.p1;
        
        // Play victory chime arpeggio or sad defeat minor chime
        if (this.sfx) {
          this.sfx.playKoScream();
          if (winnerNum === 1) {
            this.sfx.playVictorySound();
          } else {
            this.sfx.playDefeatSound();
          }
        }

        // Deepgram Zeus winner announcer!
        if (window.liveBoostSystem) {
          const sym = (loser.tokenData?.symbol || winner.tokenData?.symbol || 'MEME').toUpperCase();
          const p1Label = (this.p1Label || 'GUEST FIGHTER').toUpperCase();
          let msg = "";
          if (winnerNum === 1) {
            msg = `VICTORY! ${p1Label} DEFEATS $${sym}! GET REKT!`;
          } else {
            msg = `K.O.! $${sym} WHOOPED YOU! DOMINATION!`;
          }
          window.liveBoostSystem._announce(msg);
        }

        if (window.showVictoryOverlay) {
          window.showVictoryOverlay(winnerNum, winner.tokenData, loser.tokenData);
        }
      }

      ctx.fillText(text, w / 2, this.logicalH / 2);
    }
  }

  // ─────────────────────────────────────────
  // Build visual action set for controller overlay
  // Merges held + justPressed, decomposes compound actions,
  // and latches edge-triggered actions so they stay lit visibly.
  // ─────────────────────────────────────────
  _buildVisualActions(input, facing, latch, dt) {
    const LATCH_TIME = 0.2; // seconds to keep button lit

    // Collect raw actions
    const raw = new Set(input.getActions());
    const pressed = input.getJustPressed();
    for (const a of pressed) raw.add(a);

    // Decompose compound actions into their visual button equivalents
    const decomposed = new Set();
    for (const a of raw) {
      decomposed.add(a);
      if (a === Actions.JUMP || a === Actions.SOMERSAULT) {
        decomposed.add(Actions.UP);
      } else if (a === Actions.DASH_FORWARD) {
        decomposed.add(facing === 1 ? Actions.RIGHT : Actions.LEFT);
      } else if (a === Actions.DASH_BACK) {
        decomposed.add(facing === 1 ? Actions.LEFT : Actions.RIGHT);
      } else if (a === Actions.DASH_LEFT) {
        decomposed.add(Actions.LEFT);
      } else if (a === Actions.DASH_RIGHT) {
        decomposed.add(Actions.RIGHT);
      }
    }

    // Latch newly active actions
    for (const a of decomposed) {
      latch.set(a, LATCH_TIME);
    }

    // Tick down and build final set
    const visual = new Set();
    for (const [action, remaining] of latch) {
      const next = remaining - dt;
      if (next > 0) {
        latch.set(action, next);
        visual.add(action);
      } else {
        latch.delete(action);
      }
    }

    // Always include currently held actions
    for (const a of raw) visual.add(a);

    return visual;
  }

  // ─────────────────────────────────────────
  // Voice transcript — ghosted text above the fight
  // ─────────────────────────────────────────
  _drawTranscript(ctx, transcript, cx, y, playerColor) {
    if (!transcript || !transcript.segments || transcript.segments.length === 0)
      return;

    const alpha = transcript.fade > 0 ? transcript.fade : 0.7;

    ctx.save();
    ctx.font = "12px monospace";
    ctx.textBaseline = "middle";

    // Measure total width to center
    const gap = 6;
    let totalW = 0;
    const widths = transcript.segments.map((seg) => {
      const w = ctx.measureText(seg.text).width;
      totalW += w + gap;
      return w;
    });
    totalW -= gap; // remove trailing gap

    let x = cx - totalW / 2;

    for (let i = 0; i < transcript.segments.length; i++) {
      const seg = transcript.segments[i];
      if (seg.matched) {
        // Matched action words — brighter, player color
        ctx.globalAlpha = alpha * 1.0;
        ctx.fillStyle = playerColor;
        ctx.font = "bold 12px monospace";
      } else {
        // Unmatched — softer but still readable
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = DG.slate;
        ctx.font = "12px monospace";
      }
      ctx.textAlign = "left";
      ctx.fillText(seg.text, x, y);
      x += widths[i] + gap;
    }

    ctx.restore();
  }

  // ─────────────────────────────────────────
  // Damage log — rendered between the two controllers
  // ─────────────────────────────────────────
  _drawDamageLog(ctx, w, h) {
    if (this.damageLog.length === 0) return;

    ctx.save();
    ctx.font = "11px monospace";
    ctx.textBaseline = "top";

    const centerX = w / 2;
    const startY = h - 128;
    const lineH = 14;

    for (let i = 0; i < this.damageLog.length; i++) {
      const entry = this.damageLog[i];
      const alpha = Math.min(1, entry.time / 0.5); // fade out in last 0.5s
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = entry.color;

      const y = startY + i * lineH;

      if (entry.side === "p1") {
        // P1 dealt damage — show with arrow: "P1 ► 6 dmg"
        ctx.textAlign = "center";
        ctx.fillText(`P1 \u25B8 ${entry.text}`, centerX, y);
      } else if (entry.side === "p2") {
        ctx.textAlign = "center";
        ctx.fillText(`${entry.text} \u25C2 P2`, centerX, y);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(entry.text, centerX, y);
      }
    }

    ctx.restore();
  }

  // ─────────────────────────────────────────
  // Phone number HUD — shown until call connects
  // ─────────────────────────────────────────
  _drawLlmToast(ctx, toast, cx, y, color) {
    if (!toast) return;
    ctx.save();
    const alpha = Math.min(1, toast.time / 0.5); // fade out in last 0.5s
    ctx.globalAlpha = alpha * 0.85;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(toast.text, cx, y);
    ctx.restore();
  }

  _drawLlmThinking(ctx, cx, y, color) {
    ctx.save();
    // Pulsing opacity for subtle "thinking" feel
    ctx.globalAlpha = 0.4 + 0.3 * Math.sin(performance.now() / 300);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText('AI thinking...', cx, y);
    ctx.restore();
  }

  _drawPhoneInfo(ctx, w, h) {
    const infos = [
      { info: this.p1PhoneInfo, color: DG.primary, label: 'P1', x: w * 0.25 },
      { info: this.p2PhoneInfo, color: DG.secondary, label: 'P2', x: w * 0.75 },
    ];

    for (const { info, color, label, x } of infos) {
      if (!info) continue;

      ctx.save();
      const y = h / 2 + 30;

      if (info.connected) {
        ctx.globalAlpha = 0.5;
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText('CONNECTED', x, y);
      } else {
        ctx.globalAlpha = 0.7 + Math.sin(performance.now() / 400) * 0.2;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = DG.slate;
        ctx.fillText(`${label} CALL:`, x, y);
        ctx.font = 'bold 22px monospace';
        ctx.fillStyle = color;
        ctx.fillText(info.number || '...', x, y + 24);
      }

      ctx.restore();
    }
  }

  // ─────────────────────────────────────────
  // SNES-style controller overlay
  // ─────────────────────────────────────────
  _drawController(ctx, layout, x, y, activeActions, playerColor) {
    ctx.save();

    const btnSize = 18;
    const btnGap = 22;
    const dpadX = x + 30;
    const dpadY = y + 30;
    const faceX = x + 130;
    const faceY = y + 30;

    // Controller shell — SVG-based SNES outline, solid knockout background
    // SVG body path from svgrepo SNES controller (viewBox 0 0 76 76)
    // Left lobe center: (23.75, 39.58), Right lobe center: (50.67, 39.58)
    const svgLx = 23.75, svgRx = 50.6667, svgCy = 39.5833;
    const scale = (faceX - dpadX) / (svgRx - svgLx);
    const tx = dpadX - svgLx * scale;
    const ty = dpadY - svgCy * scale;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const body = new Path2D(
      "M 23.75,49.0833C 18.5033,49.0833 14.25,44.83 14.25,39.5833" +
      "C 14.25,34.3366 18.5033,30.0833 23.75,30.0833L 50.6667,30.0833" +
      "C 55.9134,30.0833 60.1667,34.3366 60.1667,39.5833" +
      "C 60.1667,44.83 55.9134,49.0833 50.6667,49.0833" +
      "C 47.8531,49.0833 45.3252,47.8602 43.5857,45.9167" +
      "L 30.831,45.9167C 29.0915,47.8602 26.5636,49.0833 23.75,49.0833Z",
    );

    // Solid knockout fill — completely covers background
    ctx.globalAlpha = 1;
    ctx.fillStyle = DG.bg;
    ctx.fill(body);

    // Tinted overlay on top
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = DG.charcoal;
    ctx.fill(body);

    // Border
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = playerColor;
    ctx.lineWidth = 1 / scale;
    ctx.stroke(body);

    // D-pad recess circle
    const recess = new Path2D(
      "M 23.75,33.25C 20.2522,33.25 17.4166,36.0856 17.4166,39.5834" +
      "C 17.4166,43.0812 20.2522,45.9167 23.75,45.9167" +
      "C 27.2478,45.9167 30.0833,43.0812 30.0833,39.5834" +
      "C 30.0833,36.0856 27.2478,33.25 23.75,33.25Z",
    );
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = playerColor;
    ctx.fill(recess);

    // Face button recess circle
    ctx.save();
    ctx.translate(svgRx - svgLx, 0);
    ctx.fill(recess);
    ctx.restore();

    ctx.restore(); // undo scale+translate

    // D-pad — solid knockout per button
    for (const btn of layout.dpad) {
      const bx = dpadX + btn.dx * btnGap;
      const by = dpadY + btn.dy * btnGap;
      const active = activeActions.has(btn.action);

      // Solid knockout + button face
      ctx.globalAlpha = 1;
      ctx.fillStyle = DG.bg;
      ctx.fillRect(bx - btnSize / 2, by - btnSize / 2, btnSize, btnSize);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = DG.charcoal;
      ctx.fillRect(bx - btnSize / 2, by - btnSize / 2, btnSize, btnSize);

      // Border — highlights on active
      ctx.strokeStyle = active ? playerColor : DG.pebble;
      ctx.lineWidth = active ? 2 : 1;
      ctx.globalAlpha = active ? 0.8 : 0.3;
      ctx.strokeRect(bx - btnSize / 2, by - btnSize / 2, btnSize, btnSize);

      // Label
      ctx.globalAlpha = active ? 0.9 : 0.5;
      ctx.fillStyle = active ? DG.text : DG.slate;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(btn.label, bx, by);
    }

    // Face buttons — solid knockout per button
    for (const btn of layout.buttons) {
      const bx = faceX + btn.dx * btnGap;
      const by = faceY + btn.dy * btnGap;
      const active = activeActions.has(btn.action);
      const r = btnSize / 2;

      // Solid knockout + button face
      ctx.globalAlpha = 1;
      ctx.fillStyle = DG.bg;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = DG.charcoal;
      ctx.fill();

      // Border — highlights on active
      ctx.strokeStyle = active ? playerColor : DG.pebble;
      ctx.lineWidth = active ? 2 : 1;
      ctx.globalAlpha = active ? 0.8 : 0.3;
      ctx.stroke();

      // Label
      ctx.globalAlpha = active ? 0.9 : 0.5;
      ctx.fillStyle = active ? DG.text : DG.slate;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(btn.label, bx, by);
    }

    // Shoulder buttons — solid knockout
    for (const btn of layout.shoulders) {
      const sx = btn.side === "left" ? dpadX - 20 : faceX - 20;
      const sy = y - 14;
      const sw = 40;
      const sh = 14;
      const active = activeActions.has(btn.action);

      // Solid knockout + button face
      ctx.globalAlpha = 1;
      ctx.fillStyle = DG.bg;
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, sh, 4);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = DG.charcoal;
      ctx.fill();

      // Border — highlights on active
      ctx.strokeStyle = active ? playerColor : DG.pebble;
      ctx.lineWidth = active ? 2 : 1;
      ctx.globalAlpha = active ? 0.8 : 0.3;
      ctx.stroke();

      // Label
      ctx.globalAlpha = active ? 0.9 : 0.5;
      ctx.fillStyle = active ? DG.text : DG.slate;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(btn.label, sx + sw / 2, sy + sh / 2);
    }

    ctx.restore();
  }
}
