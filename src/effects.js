// src/effects.js
export class Effects {
  constructor() {
    this.particles = [];
    this.pumpLines = [];
  }
  
  addHitParticles(x, y, color = '#ff00ff', count = 25) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 40,
        color,
        size: Math.random() * 6 + 3
      });
    }
  }
  
  addCoinRain(x, y) { // victory effect
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: -50,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 8 + 4,
        life: 120,
        color: '#00ff9d',
        size: 12,
        emoji: '🪙'
      });
    }
  }
  
  addLashEffect(x, y, color = '#00ff9d') {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        life: 20,
        color,
        size: Math.random() * 20 + 5,
        isStreak: true
      });
    }
  }
  
  updateAndDraw(ctx) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      
      ctx.globalAlpha = Math.min(1, p.life / 20);
      if (p.emoji) {
        p.vy += 0.2; // Gravity for coins
        ctx.font = '24px system-ui';
        ctx.fillText(p.emoji, p.x, p.y);
      } else if (p.isStreak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
    
    // Premium "Lash" Background Streaks (Market Energy)
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const speed = 0.5 + (i * 0.1);
      const offset = (Date.now() * speed) % (window.innerWidth + window.innerHeight);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(0, 255, 157, 0.08)' : 'rgba(255, 0, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(offset - 500, 0);
      ctx.lineTo(offset, window.innerHeight);
      ctx.stroke();
    }
  }
}

// Global instance (add to main.js)
window.effects = new Effects();
