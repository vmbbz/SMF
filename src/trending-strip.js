import { getSolscanTrending, getPumpFunGraduates } from './solscan-trending.js';

export class TrendingStrip {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.isGraduatesOnly = false;
    this.tokens = [];
    this.refreshTimer = null;
    this.loading = false;
  }

  async init() {
    if (!this.container || this.refreshTimer) return;
    this.render();
    await this.loadTokens();
    this.refreshTimer = setInterval(() => {
      void this.loadTokens();
    }, 30000); // refresh every 30s
  }

  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async loadTokens() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (this.loading) return;
    this.loading = true;
    try {
      this.tokens = this.isGraduatesOnly
        ? await getPumpFunGraduates(12)
        : await getSolscanTrending(12);
    } catch (err) {
      console.warn('[trending-strip] Failed to load tokens:', err);
    } finally {
      this.loading = false;
      this.renderTokens();
    }
  }

  toggleMode() {
    this.isGraduatesOnly = !this.isGraduatesOnly;
    this.loadTokens();
  }

  render() {
    this.container.innerHTML = `
      <div class="strip-header" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <span style="font-family: var(--font-display, 'Shojumaru', 'Press Start 2P', sans-serif); font-weight:900;color:var(--neon-blue);text-transform:uppercase;letter-spacing:1px;font-size:9px;margin-right:15px;text-shadow:0 0 10px var(--neon-blue); flex:1; text-align:left;">🚀 LIVE STREAM</span>
        <div onclick="window.openHelpModal && window.openHelpModal()" style="display:inline-flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); border:1px solid var(--neon-pink); width:18px; height:18px; border-radius:50%; font-family:var(--font-display, 'Shojumaru', 'Press Start 2P', sans-serif); font-size:10px; color:#fff; cursor:pointer; box-shadow:0 0 8px var(--neon-pink); transition:all 0.2s; user-select:none; margin:0 auto; flex:0 0 auto;" onmouseover="this.style.transform='scale(1.25)';" onmouseout="this.style.transform='scale(1)';" title="Game Guide">i</div>
        
        <div style="flex:1; text-align:right;">
          <button onclick="window.${this.container.id === 'fight-trending-strip' ? 'fightTrendingStrip' : 'trendingStrip'}.toggleMode()" class="toggle-btn" style="background:var(--neon-pink);color:#000;border:none;padding:4px 8px;border-radius:4px;font-weight:bold;cursor:pointer;font-family:var(--font-print, 'Press Start 2P', system-ui, sans-serif);font-size:9px;display:inline-block;">
            ${this.isGraduatesOnly ? 'ALL TRENDING' : 'PUMP.FUN GRADS'}
          </button>
        </div>
      </div>
      <div class="marquee-container" style="overflow:hidden;white-space:nowrap;margin-top:6px;position:relative;width:100%;">
        <div class="marquee" id="${this.container.id}-inner" style="display:inline-block;animation:marquee 40s linear infinite;"></div>
      </div>
    `;

    // Inject keyframes if not exists
    if (!document.getElementById('marquee-style')) {
      const style = document.createElement('style');
      style.id = 'marquee-style';
      style.innerHTML = `
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .token-pill {
          display: inline-flex;
          align-items: center;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 20px;
          padding: 4px 12px 4px 4px;
          margin-right: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .token-pill:hover {
          background: rgba(255,0,255,0.2);
          border-color: var(--neon-pink);
          transform: scale(1.05);
        }
        .token-pill img {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          margin-right: 10px;
        }
        .token-pill .symbol {
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          font-weight: bold;
          color: #fff;
          margin-right: 10px;
        }
        .token-pill .power {
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          color: var(--neon-green);
          font-weight: 900;
          font-size: 12px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  renderTokens() {
    const inner = document.getElementById(`${this.container.id}-inner`);
    if (!inner) return;

    // Update button text just in case
    const btn = this.container.querySelector('.toggle-btn');
    if (btn) btn.textContent = this.isGraduatesOnly ? 'ALL TRENDING' : 'PUMP.FUN GRADS';

    if (this.tokens.length === 0) {
      inner.innerHTML = `<span style="color:#888; font-size: 10px; font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif); letter-spacing: 0.5px;">Loading trending tokens...</span>`;
      return;
    }

    const itemsHtml = this.tokens.map(token => {
      const chg = Number(token.priceChange24h) || 0;
      const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
      const chgColor = chg >= 0 ? '#00ff9d' : '#ff2244';
      return `
      <div class="token-pill" onclick="window.fightToken && window.fightToken('${token.mint}')">
        <img src="${token.logoURI || 'assets/smf-logo.png'}" alt="${token.symbol}" onerror="this.src='assets/smf-logo.png'">
        <span class="symbol">$${token.symbol}</span>
        <span class="power" style="color:${chgColor}">${chgStr}</span>
      </div>`;
    }).join('');

    // Duplicate list for continuous infinite marquee
    inner.innerHTML = itemsHtml + itemsHtml;
  }
}

// Ensure global scope availability
window.TrendingStrip = TrendingStrip;
