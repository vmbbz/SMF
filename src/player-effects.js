// src/player-effects.js
export class PlayerEffects {
  constructor(fighter) {
    this.fighter = fighter;
    this.particles = [];
  }

  addBoostEffect() {
    const baseX = this.fighter.x;
    const baseY = this.fighter.y - 60;
    for (let i = 0; i < 45; i++) {
      this.particles.push({
        x: baseX,
        y: baseY,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 0.5) * 18 - 3,
        life: 50,
        color: '#00ffff',
        size: Math.random() * 9 + 4,
        isStreak: true
      });
    }
  }

  update(dt, ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt * 60;
      p.vy += 0.4;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = p.life / 50;
      if (p.isStreak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}
