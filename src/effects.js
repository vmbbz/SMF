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
  
  updateAndDraw(ctx) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.vy += 0.15; // gravity for coins
      
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      
      ctx.globalAlpha = p.life / 40;
      if (p.emoji) {
        ctx.font = '18px system-ui';
        ctx.fillText(p.emoji, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
    
    // Dynamic pump background lines (market sauce)
    ctx.strokeStyle = 'rgba(0, 255, 157, 0.15)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const offset = (Date.now() / 800 + i * 40) % (window.innerHeight + 100);
      ctx.beginPath();
      ctx.moveTo(0, offset);
      ctx.quadraticCurveTo(window.innerWidth/2, offset + 30, window.innerWidth, offset);
      ctx.stroke();
    }
  }
}

// Global instance (add to main.js)
window.effects = new Effects();
