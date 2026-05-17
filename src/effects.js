// src/effects.js
export class Effects {
  constructor() {
    this.particles = [];
    this.pumpLines = [];
    this.weatherModes = ['rain', 'wind', 'snow', 'clear'];
    this.currentWeather = 0; // index of weatherModes
  }
  
  toggleWeather() {
    this.currentWeather = (this.currentWeather + 1) % this.weatherModes.length;
    console.log("Weather toggled to: " + this.weatherModes[this.currentWeather]);
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
    
    const mode = this.weatherModes[this.currentWeather];
    
    if (mode === 'clear') return;

    if (mode === 'rain') {
      ctx.lineWidth = 1;
      for (let i = 0; i < 15; i++) {
        const speed = 1.0 + (i * 0.15);
        const offset = (Date.now() * speed) % (window.innerWidth + window.innerHeight * 2);
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(0, 255, 157, 0.15)' : 'rgba(255, 0, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(offset - 400 - (i * 10), -100);
        ctx.lineTo(offset, window.innerHeight + 100);
        ctx.stroke();
      }
    } else if (mode === 'wind') {
      for (let i = 0; i < 12; i++) {
        const speed = 0.5 + (i * 0.05);
        const t = Date.now() * 0.001 * speed;
        const x = (t * 200 + i * 150) % window.innerWidth;
        const y = ((Math.sin(t + i) * 100) + window.innerHeight / 2 + i * 30) % window.innerHeight;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 255, 157, 0.4)' : 'rgba(255, 0, 255, 0.4)';
        ctx.fillRect(x, Math.abs(y), 4, 2);
      }
    } else if (mode === 'snow') {
      for (let i = 0; i < 30; i++) {
        const speed = 0.2 + (i * 0.02);
        const t = Date.now() * 0.001 * speed;
        const y = (t * 100 + i * 50) % window.innerHeight;
        const x = (i * (window.innerWidth / 30) + Math.sin(t + i) * 20) % window.innerWidth;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(x, Math.abs(y), Math.random() * 2 + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Global instance (add to main.js)
window.effects = new Effects();
