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
      <div class="strip-header">
        <span style="font-weight:900;color:var(--neon-blue);text-transform:uppercase;letter-spacing:2px;font-size:12px;margin-right:15px;">Trending on Solana</span>
        <button onclick="window.trendingStrip.toggleMode()" class="toggle-btn" style="background:var(--neon-pink);color:#000;border:none;padding:5px 10px;border-radius:6px;font-weight:bold;cursor:pointer;font-family:inherit;font-size:10px;">
          ${this.isGraduatesOnly ? 'SHOW ALL TRENDING' : 'PUMP.FUN GRADUATES ONLY'}
        </button>
      </div>
      <div class="marquee-container" style="overflow:hidden;white-space:nowrap;margin-top:10px;position:relative;">
        <div class="marquee" id="marquee-inner" style="display:inline-block;animation:marquee 20s linear infinite;"></div>
      </div>
    `;
    
    // Inject keyframes if not exists
    if (!document.getElementById('marquee-style')) {
      const style = document.createElement('style');
      style.id = 'marquee-style';
      style.innerHTML = `
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .token-pill {
          display: inline-flex;
          align-items: center;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 20px;
          padding: 5px 15px 5px 5px;
          margin-right: 15px;
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
    const inner = document.getElementById('marquee-inner');
    if (!inner) return;
    
    // Update button text just in case
    const btn = this.container.querySelector('.toggle-btn');
    if (btn) btn.textContent = this.isGraduatesOnly ? 'SHOW ALL TRENDING' : 'PUMP.FUN GRADUATES ONLY';

    if (this.tokens.length === 0) {
      inner.innerHTML = `<span style="color:#888;">Loading trending tokens...</span>`;
      return;
    }

    inner.innerHTML = this.tokens.map(token => `
      <div class="token-pill" onclick="window.fightToken && window.fightToken('${token.mint}')">
        <img src="${token.logoURI || 'assets/smf-logo.png'}" alt="${token.symbol}">
        <span class="symbol">$${token.symbol}</span>
        <span class="power">⚔️ ${token.power?.rating || '1.0x'}</span>
      </div>
    `).join('');
  }
}

// Ensure global scope availability
window.TrendingStrip = TrendingStrip;
