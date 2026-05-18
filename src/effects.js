// src/effects.js
export class Effects {
  constructor() {
    this.particles = [];
    this.pumpLines = [];
    this.weatherModes = ['rain', 'wind', 'snow', 'clear'];
    this.currentWeather = 0; // index of weatherModes
    this.weatherParticles = [];
    this._initWeather();
  }
  
  toggleWeather() {
    this.currentWeather = (this.currentWeather + 1) % this.weatherModes.length;
    console.log("Weather toggled to: " + this.weatherModes[this.currentWeather]);
    this._initWeather();
  }

  _initWeather() {
    this.weatherParticles = [];
    const mode = this.weatherModes[this.currentWeather];
    const count = mode === 'snow' ? 40 : (mode === 'rain' ? 30 : (mode === 'wind' ? 25 : 0));
    
    for (let i = 0; i < count; i++) {
      this.weatherParticles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        speed: Math.random() * 0.5 + 0.5,
        offset: Math.random() * Math.PI * 2,
        size: Math.random() * 2 + 1,
        colorIndex: i % 2
      });
    }
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
      for (const p of this.weatherParticles) {
        p.y += 15 * p.speed;
        p.x -= 5 * p.speed;
        if (p.y > window.innerHeight) { p.y = -50; p.x = Math.random() * window.innerWidth + 200; }
        
        ctx.strokeStyle = p.colorIndex === 0 ? 'rgba(0, 255, 157, 0.2)' : 'rgba(255, 0, 255, 0.2)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 10 * p.speed, p.y - 30 * p.speed);
        ctx.stroke();
      }
    } else if (mode === 'wind') {
      for (const p of this.weatherParticles) {
        p.x -= 8 * p.speed;
        p.y += Math.sin(Date.now() * 0.002 + p.offset) * 2;
        if (p.x < -10) { p.x = window.innerWidth + 10; p.y = Math.random() * window.innerHeight; }
        
        ctx.fillStyle = p.colorIndex === 0 ? 'rgba(0, 255, 157, 0.4)' : 'rgba(255, 0, 255, 0.4)';
        ctx.fillRect(p.x, p.y, p.size * 2, p.size);
      }
    } else if (mode === 'snow') {
      for (const p of this.weatherParticles) {
        p.y += 1.5 * p.speed;
        p.x += Math.sin(Date.now() * 0.001 + p.offset) * 0.5;
        if (p.y > window.innerHeight) { p.y = -10; p.x = Math.random() * window.innerWidth; }
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Global instance (add to main.js)
window.effects = new Effects();
