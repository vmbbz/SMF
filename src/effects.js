// src/effects.js
export class Effects {
  constructor() {
    this.particles = [];
    this.pumpLines = [];
    this.weatherModes = ['rain', 'wind', 'snow', 'clear'];
    this.currentWeather = 0;
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
    // More particles for density
    const count = mode === 'snow' ? 60 : (mode === 'rain' ? 120 : (mode === 'wind' ? 45 : 0));

    for (let i = 0; i < count; i++) {
      this.weatherParticles.push({
        x: Math.random() * (window.innerWidth + 300) - 150,
        y: Math.random() * window.innerHeight,
        // Varied speeds create parallax depth
        speed:  mode === 'rain' ? Math.random() * 0.6 + 0.6
              : mode === 'snow' ? Math.random() * 0.4 + 0.2
              : Math.random() * 0.5 + 0.5,
        offset: Math.random() * Math.PI * 2,
        // size = stroke width for rain/wind, radius for snow
        size:   mode === 'rain' ? Math.random() * 1.2 + 0.6
              : mode === 'snow' ? Math.random() * 3.5 + 1.5
              : Math.random() * 2.5 + 1,
        // Far drops = faint, near drops = solid
        alpha:  Math.random() * 0.45 + 0.35,
        drift:  (Math.random() - 0.5) * 0.4,
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

  addCoinRain(x, y) {
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
    // ── Hit / coin / lash particles ──────────────────────────────────────
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      ctx.globalAlpha = Math.min(1, p.life / 20);
      if (p.emoji) {
        p.vy += 0.2;
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

    // ── RAIN ─────────────────────────────────────────────────────────────
    // Real rain: steep diagonal streaks, varied thickness, blue-white gradient
    if (mode === 'rain') {
      ctx.lineCap = 'round';
      for (const p of this.weatherParticles) {
        p.y += 18 * p.speed;
        p.x -= 6 * p.speed + p.drift;
        if (p.y > window.innerHeight + 20) {
          p.y = Math.random() * -80;
          p.x = Math.random() * (window.innerWidth + 300);
        }

        // Streak length scales with speed — faster = longer streak
        const len = 28 * p.speed;

        ctx.globalAlpha = p.alpha;
        ctx.lineWidth = p.size;

        // Glassy gradient: transparent head, bright white-blue tail
        const grd = ctx.createLinearGradient(p.x, p.y, p.x + 6 * p.speed, p.y - len);
        grd.addColorStop(0,   'rgba(180, 220, 255, 0.0)');
        grd.addColorStop(0.4, 'rgba(200, 230, 255, 0.75)');
        grd.addColorStop(1,   'rgba(230, 245, 255, 0.95)');

        ctx.strokeStyle = grd;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 6 * p.speed, p.y - len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';

    // ── WIND ─────────────────────────────────────────────────────────────
    // Horizontal gusts: tapered neon-green streaks with sine drift
    } else if (mode === 'wind') {
      ctx.lineCap = 'round';
      for (const p of this.weatherParticles) {
        p.x -= 10 * p.speed;
        p.y += Math.sin(Date.now() * 0.0015 + p.offset) * 1.8;
        if (p.x < -60) { p.x = window.innerWidth + 60; p.y = Math.random() * window.innerHeight; }

        const lineLen = 28 * p.speed + 8;
        ctx.globalAlpha = p.alpha;
        ctx.lineWidth = p.size;

        const grd = ctx.createLinearGradient(p.x - lineLen, p.y, p.x, p.y);
        grd.addColorStop(0,   'rgba(0, 255, 157, 0.0)');
        grd.addColorStop(0.5, 'rgba(0, 200, 120, 0.55)');
        grd.addColorStop(1,   'rgba(0, 255, 200, 0.85)');

        ctx.strokeStyle = grd;
        ctx.beginPath();
        ctx.moveTo(p.x - lineLen, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';

    // ── SNOW ─────────────────────────────────────────────────────────────
    // Chunky flakes with soft glow halo + bright core, slow drift
    } else if (mode === 'snow') {
      for (const p of this.weatherParticles) {
        p.y += 1.8 * p.speed;
        p.x += Math.sin(Date.now() * 0.0008 + p.offset) * 0.7 + p.drift;
        if (p.y > window.innerHeight + 10) { p.y = -10; p.x = Math.random() * window.innerWidth; }

        // Glow halo
        ctx.globalAlpha = p.alpha * 0.35;
        ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Bright core
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = 'rgba(240, 248, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}

// Global instance
window.effects = new Effects();
