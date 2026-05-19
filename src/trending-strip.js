import { getSolscanTrending, getPumpFunGraduates } from './solscan-trending.js';

export class TrendingStrip {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.isGraduatesOnly = false;
    this.tokens = [];
  }

  async init() {
    if (!this.container) return;
    this.render();
    await this.loadTokens();
    setInterval(() => this.loadTokens(), 30000); // refresh every 30s
  }

  async loadTokens() {
    this.tokens = this.isGraduatesOnly
      ? await getPumpFunGraduates(12)
      : await getSolscanTrending(12);
    this.renderTokens();
  }

  toggleMode() {
    this.isGraduatesOnly = !this.isGraduatesOnly;
    this.loadTokens();
  }

  render() {
    this.container.innerHTML = `
      <div class="strip-header" style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:900;color:var(--neon-blue);text-transform:uppercase;letter-spacing:1px;font-size:9px;margin-right:15px;text-shadow:0 0 10px var(--neon-blue);">🚀 LIVE STREAM</span>
        <button onclick="window.${this.container.id === 'fight-trending-strip' ? 'fightTrendingStrip' : 'trendingStrip'}.toggleMode()" class="toggle-btn" style="background:var(--neon-pink);color:#000;border:none;padding:4px 8px;border-radius:4px;font-weight:bold;cursor:pointer;font-family:inherit;font-size:9px;">
          ${this.isGraduatesOnly ? 'ALL TRENDING' : 'PUMP.FUN GRADS'}
        </button>
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
          font-weight: bold;
          color: #fff;
          margin-right: 10px;
        }
        .token-pill .power {
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
      inner.innerHTML = `<span style="color:#888;">Loading trending tokens...</span>`;
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
