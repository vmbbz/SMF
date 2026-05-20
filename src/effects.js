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
        // Rain & wind bumped up for clear visibility against dark bg
        size:   mode === 'rain' ? Math.random() * 1.5 + 1.5   // 1.5–3px thick streaks
              : mode === 'snow' ? Math.random() * 3.5 + 1.5
              : Math.random() * 2.5 + 1.5,                    // 1.5–4px wind lines
        // High alpha — both modes need to pop against the dark arena
        alpha:  mode === 'rain' ? Math.random() * 0.25 + 0.75  // 0.75–1.0
              : mode === 'wind' ? Math.random() * 0.20 + 0.70  // 0.70–0.90
              : Math.random() * 0.45 + 0.35,
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
    // White + light-blue dual-tone streaks — clearly visible on dark bg
    if (mode === 'rain') {
      ctx.lineCap = 'round';
      ctx.shadowBlur = 3;
      ctx.shadowColor = 'rgba(180, 220, 255, 0.6)';
      for (const p of this.weatherParticles) {
        p.y += 18 * p.speed;
        p.x -= 6 * p.speed + p.drift;
        if (p.y > window.innerHeight + 20) {
          p.y = Math.random() * -80;
          p.x = Math.random() * (window.innerWidth + 300);
        }

        const len = 30 * p.speed;
        const tx  = p.x + 6 * p.speed;  // tail end
        const ty  = p.y - len;

        ctx.globalAlpha = p.alpha;
        ctx.lineWidth = p.size;

        // White head → light-blue body → slightly deeper blue tail
        // All stops fully opaque so the drop is solid & visible
        const grd = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grd.addColorStop(0,    'rgba(150, 200, 255, 0.85)');
        grd.addColorStop(0.45, 'rgba(210, 235, 255, 0.95)');
        grd.addColorStop(1,    'rgba(255, 255, 255, 1.0)');

        ctx.strokeStyle = grd;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.lineCap = 'butt';

    // ── WIND ─────────────────────────────────────────────────────────────
    // Bright cyan-teal gusts — tapered, clearly visible against dark arena
    } else if (mode === 'wind') {
      ctx.lineCap = 'round';
      ctx.shadowBlur = 5;
      ctx.shadowColor = 'rgba(0, 255, 180, 0.7)';
      for (const p of this.weatherParticles) {
        p.x -= 10 * p.speed;
        p.y += Math.sin(Date.now() * 0.0015 + p.offset) * 1.8;
        if (p.x < -60) { p.x = window.innerWidth + 60; p.y = Math.random() * window.innerHeight; }

        const lineLen = 36 * p.speed + 10;  // longer streaks
        ctx.globalAlpha = p.alpha;
        ctx.lineWidth = p.size;

        // Fade-in from tail → fully solid bright cyan at the head
        const grd = ctx.createLinearGradient(p.x - lineLen, p.y, p.x, p.y);
        grd.addColorStop(0,    'rgba(0, 220, 160, 0.15)');
        grd.addColorStop(0.4,  'rgba(0, 255, 190, 0.75)');
        grd.addColorStop(1,    'rgba(100, 255, 220, 1.0)');

        ctx.strokeStyle = grd;
        ctx.beginPath();
        ctx.moveTo(p.x - lineLen, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
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
