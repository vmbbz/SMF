// src/effects.js
export class Effects {
  constructor() {
    this.particles = [];
    this.pumpLines = [];
    this.weatherModes = ['rain', 'wind', 'snow', 'clear'];
    this.currentWeather = 1;
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
    const count = mode === 'snow' ? 60 : (mode === 'rain' ? 120 : (mode === 'wind' ? 70 : 0));

    for (let i = 0; i < count; i++) {
      if (mode === 'wind') {
        const isLeaf = i < 45; // 45 leaves, 25 wind gusts
        if (isLeaf) {
          const leafColors = [
            '#e74c3c', // Autumn Crimson Maple
            '#e67e22', // Amber Orange
            '#f1c40f', // Golden Yellow
            '#27ae60', // Vibrant Garden Green
            '#ff5e62', // Pink/Coral Maple
            '#fb5607', // Deep Sunset Red-orange
          ];
          this.weatherParticles.push({
            type: 'leaf',
            x: Math.random() * (window.innerWidth + 200) - 100,
            y: Math.random() * (window.innerHeight + 100) - 50,
            speed: Math.random() * 0.7 + 0.5,
            size: Math.random() * 8 + 6, // 6px to 14px size
            color: leafColors[Math.floor(Math.random() * leafColors.length)],
            angle: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.05,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.03 + 0.015,
            offset: Math.random() * Math.PI * 2,
            alpha: Math.random() * 0.25 + 0.65, // 0.65–0.90
          });
        } else {
          // Wind gust particle (thin line)
          this.weatherParticles.push({
            type: 'gust',
            x: Math.random() * (window.innerWidth + 300) - 150,
            y: Math.random() * window.innerHeight,
            speed: Math.random() * 0.8 + 0.8, // faster
            size: Math.random() * 1.5 + 0.8, // thin line thickness
            alpha: Math.random() * 0.15 + 0.1, // faint/soft glowing winds
            offset: Math.random() * Math.PI * 2,
          });
        }
      } else {
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
          size:   mode === 'rain' ? Math.random() * 1.5 + 1.5   // 1.5-3px thick streaks
                : mode === 'snow' ? Math.random() * 3.5 + 1.5
                : Math.random() * 2.5 + 1.5,                    // 1.5-4px wind lines
          // High alpha — both modes need to pop against the dark arena
          alpha:  mode === 'rain' ? Math.random() * 0.25 + 0.75  // 0.75-1.0
                : Math.random() * 0.45 + 0.35,
          drift:  (Math.random() - 0.5) * 0.4,
        });
      }
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
      // High-performance light-weight rain drawing (no shadowBlur, no dynamic gradients per particle!)
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

        // Double-pass glowing effect without slow shadowBlur:
        // Pass 1: Semi-transparent thicker blue glow
        ctx.globalAlpha = p.alpha * 0.4;
        ctx.lineWidth = p.size * 2;
        ctx.strokeStyle = '#00d4ff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Pass 2: Bright white core drop
        ctx.globalAlpha = p.alpha;
        ctx.lineWidth = p.size;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';

    // ── WIND ─────────────────────────────────────────────────────────────
    // Beautiful organic leaves tumbling and wobbling + glowing wind streaks
    } else if (mode === 'wind') {
      for (const p of this.weatherParticles) {
        if (p.type === 'leaf') {
          // Update leaf position
          p.x -= 3.2 * p.speed; // drift left
          // Fluttering falling speed and wavy sine movement
          p.y += Math.sin(Date.now() * 0.0018 + p.offset) * 1.3 + 0.8 * p.speed;
          p.angle += p.rotationSpeed;
          p.wobble += p.wobbleSpeed;

          // Recycle when out of bounds
          if (p.x < -30) {
            p.x = window.innerWidth + 30;
            p.y = Math.random() * (window.innerHeight + 100) - 50;
            p.angle = Math.random() * Math.PI * 2;
          }

          // Draw the leaf
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle + Math.sin(p.wobble) * 0.25);
          ctx.globalAlpha = p.alpha;

          // Leaf shape
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          // quadratic curve for upper-right leaf side
          ctx.quadraticCurveTo(p.size * 0.55, -p.size * 0.2, 0, p.size);
          // quadratic curve for lower-left leaf side
          ctx.quadraticCurveTo(-p.size * 0.55, -p.size * 0.2, 0, -p.size);
          ctx.fill();

          // Leaf center stem
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.lineWidth = Math.max(0.8, p.size * 0.08);
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.75);
          ctx.lineTo(0, p.size * 1.15);
          ctx.stroke();

          ctx.restore();
        } else {
          // Faint, fast-moving wind gusts for cinematic layer of depth
          p.x -= 12 * p.speed; // fast
          p.y += Math.sin(Date.now() * 0.001 + p.offset) * 0.8;

          if (p.x < -150) {
            p.x = window.innerWidth + 150;
            p.y = Math.random() * window.innerHeight;
          }

          const lineLen = 60 * p.speed + 20;
          ctx.globalAlpha = p.alpha;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';

          // Soft teal/cyan/white wind gust lines
          const grd = ctx.createLinearGradient(p.x - lineLen, p.y, p.x, p.y);
          grd.addColorStop(0, 'rgba(0, 255, 180, 0.0)');
          grd.addColorStop(0.5, 'rgba(0, 255, 180, 0.2)');
          grd.addColorStop(1, 'rgba(255, 255, 255, 0.4)');

          ctx.strokeStyle = grd;
          ctx.beginPath();
          ctx.moveTo(p.x - lineLen, p.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
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
