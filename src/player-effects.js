// src/player-effects.js
// Tiered visual aura effects that lock onto the fighter's world position.
export class PlayerEffects {
  constructor(fighter) {
    this.fighter = fighter;
    this.particles = [];
    // Sustained ring pulse: { tier, timer, maxTimer }
    this._activeRing = null;
  }

  /** 🟡 Micro boost — gold shimmer (5–20% gain) */
  addMicroEffect() {
    this._spawnParticles(20, '#ffcc00', 6, 8, true);
    this._activeRing = { tier: 'micro', timer: 0.8, maxTimer: 0.8 };
  }

  /** 🟠 Runner combo — orange burst (20–45% gain) */
  addRunnerEffect() {
    this._spawnParticles(35, '#ff8800', 10, 16, true);
    this._activeRing = { tier: 'runner', timer: 1.2, maxTimer: 1.2 };
  }

  /** 🔴 Spike — red shockwave (45–100% gain) */
  addSpikeEffect() {
    this._spawnParticles(55, '#ff2244', 12, 20, true);
    this._activeRing = { tier: 'spike', timer: 1.8, maxTimer: 1.8 };
    // Extra white flash particles
    this._spawnParticles(20, '#ffffff', 4, 10, false);
  }

  /** ⚡ Overdrive — purple chaos (2x+) */
  addOverdriveEffect() {
    this._spawnParticles(80, '#cc00ff', 14, 24, true);
    this._spawnParticles(40, '#ffff00', 6, 12, true);
    this._spawnParticles(25, '#ffffff', 3, 8, false);
    this._activeRing = { tier: 'overdrive', timer: 3.0, maxTimer: 3.0 };
  }

  _spawnParticles(count, color, minSize, maxSize, isStreak) {
    const baseX = this.fighter.x;
    const baseY = this.fighter.y - 65;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 16 + 4;
      this.particles.push({
        x: baseX + (Math.random() - 0.5) * 20,
        y: baseY + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        life: 1,
        maxLife: 0.7 + Math.random() * 0.5,
        color,
        size: Math.random() * (maxSize - minSize) + minSize,
        isStreak,
      });
    }
  }

  update(dt, ctx) {
    // Update + draw particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt * 60 * 0.1;
      p.y += p.vy * dt * 60 * 0.1;
      p.vy += 0.3; // gravity
      p.life -= dt / p.maxLife;

      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      const alpha = Math.max(0, p.life);
      ctx.globalAlpha = alpha;

      if (p.isStreak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.3;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.4, p.y - p.vy * 0.4);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw sustained ring pulse
    if (this._activeRing) {
      this._activeRing.timer -= dt;
      if (this._activeRing.timer <= 0) {
        this._activeRing = null;
      } else {
        this._drawRing(ctx, this._activeRing);
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  _drawRing(ctx, ring) {
    const t = 1 - (ring.timer / ring.maxTimer); // 0→1 as it fades
    const expandR = 40 + t * 80;
    const alpha = (1 - t) * 0.7;
    const x = this.fighter.x;
    const y = this.fighter.y - 65;

    const colors = {
      micro: '#ffcc00',
      runner: '#ff8800',
      spike: '#ff2244',
      overdrive: '#cc00ff',
    };
    const color = colors[ring.tier] || '#ffffff';

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 - t * 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, expandR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
