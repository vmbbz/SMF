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
      <div class="strip-header">
        <div class="strip-title-wrap" aria-label="Live market stream">
          <span class="strip-signal-dot"></span>
          <span class="strip-title">LIVE MARKET</span>
        </div>
        <button class="strip-info-btn" type="button" onclick="window.openHelpModal && window.openHelpModal()" title="Game Guide">?</button>
        <div class="strip-actions">
          <button onclick="window.${this.container.id === 'fight-trending-strip' ? 'fightTrendingStrip' : 'trendingStrip'}.toggleMode()" class="toggle-btn strip-mode-btn" type="button">
            ${this.isGraduatesOnly ? 'ALL TRENDING' : 'PUMP.FUN GRADS'}
          </button>
        </div>
      </div>
      <div class="marquee-container">
        <div class="marquee" id="${this.container.id}-inner"></div>
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
        .strip-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
          align-items: center;
          column-gap: 8px;
          width: 100%;
          min-height: 28px;
        }
        .strip-title-wrap {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          height: 28px;
        }
        .strip-signal-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--neon-green);
          box-shadow: 0 0 10px rgba(0, 255, 157, 0.85);
          flex: 0 0 auto;
        }
        .strip-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: var(--font-display, 'Shojumaru', 'Press Start 2P', sans-serif);
          font-size: 10px;
          line-height: 1;
          color: var(--neon-blue);
          text-shadow: 0 0 10px rgba(0, 212, 255, 0.7);
        }
        .strip-info-btn {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 1px solid rgba(255, 0, 255, 0.75);
          background: rgba(0, 0, 0, 0.62);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          font-size: 9px;
          line-height: 1;
          box-shadow: 0 0 9px rgba(255, 0, 255, 0.48);
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .strip-info-btn:hover {
          transform: scale(1.12);
          border-color: var(--neon-green);
        }
        .strip-actions {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          min-width: 0;
          height: 28px;
        }
        .strip-mode-btn {
          height: 24px;
          max-width: 148px;
          border: 1px solid rgba(255, 0, 255, 0.72);
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255, 0, 255, 0.95), rgba(0, 212, 255, 0.88));
          color: #050505;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 10px;
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          font-size: 8px;
          line-height: 1;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 0 12px rgba(255, 0, 255, 0.28);
        }
        .marquee-container {
          overflow: hidden;
          white-space: nowrap;
          margin-top: 6px;
          position: relative;
          width: 100%;
          min-height: 30px;
        }
        .marquee {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          animation: marquee 40s linear infinite;
          will-change: transform;
        }
        .token-pill {
          display: inline-flex;
          align-items: center;
          height: 28px;
          background: rgba(255,255,255,0.09);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 20px;
          padding: 2px 10px 2px 3px;
          margin-right: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          vertical-align: middle;
        }
        .token-pill:hover {
          background: rgba(255,0,255,0.2);
          border-color: var(--neon-pink);
          transform: scale(1.05);
        }
        .token-pill img {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          margin-right: 8px;
          flex: 0 0 auto;
        }
        .token-pill .symbol {
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          font-weight: bold;
          color: #fff;
          margin-right: 8px;
          font-size: 9px;
          line-height: 1;
        }
        .token-pill .power {
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          color: var(--neon-green);
          font-weight: 900;
          font-size: 9px;
          line-height: 1;
        }
        .market-loading-text {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          color: rgba(255, 255, 255, 0.62);
          font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
          font-size: 8px;
          line-height: 1.35;
        }
        @media (max-width: 1024px) {
          .strip-header {
            grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr);
            column-gap: 6px;
            min-height: 26px;
          }
          .strip-title-wrap,
          .strip-actions {
            height: 26px;
          }
          .strip-title {
            font-size: 9px;
          }
          .strip-info-btn {
            width: 22px;
            height: 22px;
            font-size: 10px;
          }
          .strip-mode-btn {
            height: 22px;
            max-width: 112px;
            padding: 0 7px;
            font-size: 7px;
          }
          .marquee-container,
          .marquee {
            min-height: 26px;
          }
          .marquee-container {
            margin-top: 5px;
            padding-bottom: 4px;
          }
          .token-pill {
            height: 24px;
            padding: 2px 7px 2px 2px;
            margin-right: 6px;
            border-radius: 14px;
          }
          .token-pill img {
            width: 18px;
            height: 18px;
            margin-right: 5px;
          }
          .token-pill .symbol,
          .token-pill .power {
            font-size: 7px;
          }
          .token-pill .symbol {
            margin-right: 5px;
          }
          .market-loading-text {
            min-height: 24px;
            font-size: 7px;
          }
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
      inner.innerHTML = `<span class="market-loading-text">Loading market stream...</span>`;
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
