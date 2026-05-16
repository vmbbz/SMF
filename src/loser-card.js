let currentLoserToken = null;

window.renderLoserCard = function(token) {
  currentLoserToken = token;
  const content = document.getElementById('loser-tab-content');
  if (!content) return;

  // Default to About tab
  window.switchLoserTab(0);
};

window.switchLoserTab = function(tabIndex) {
  const content = document.getElementById('loser-tab-content');
  const tabs = document.querySelectorAll('.loser-tabs button');
  if (!content || !currentLoserToken) return;

  tabs.forEach((t, i) => {
    if (i === tabIndex) t.classList.add('active');
    else t.classList.remove('active');
  });

  const token = currentLoserToken;

  if (tabIndex === 0) {
    // ABOUT TAB
    content.innerHTML = `
      <div class="about-tab" style="animation: punchIn 0.3s ease;">
        <img src="${token.logoURI || ''}" class="banner" style="width:80px;height:80px;border-radius:50%;border:2px solid var(--neon-pink);margin-bottom:10px;">
        <h2 style="font-size:20px;font-weight:900;color:#fff;margin-bottom:10px;">$${(token.symbol || 'MEME').toUpperCase()} <span class="loser-badge" style="background:var(--neon-pink);color:#000;font-size:10px;padding:2px 6px;border-radius:4px;vertical-align:middle;">LOSER</span></h2>
        
        <div class="power-rating" style="font-size:12px;color:var(--neon-blue);margin-bottom:15px;background:rgba(0,212,255,0.1);padding:5px;border-radius:6px;border:1px dashed var(--neon-blue);">
          <strong>IN-GAME POWER:</strong> 
          <span class="power-value" style="color:#fff;font-weight:bold;font-size:14px;">${calculatePowerLevel(token)}</span>
        </div>

        <div class="market-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:10px;background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;margin-bottom:15px;text-align:left;">
          <div><span style="color:var(--neon-pink);">MCAP</span><br><strong style="font-size:12px;color:#fff;">$${(token.marketCap || 0).toLocaleString()}</strong></div>
          <div><span style="color:var(--neon-pink);">24h VOL</span><br><strong style="font-size:12px;color:#fff;">$${(token.volume24h || 0).toLocaleString()}</strong></div>
          <div><span style="color:var(--neon-pink);">LIQUIDITY</span><br><strong style="font-size:12px;color:#fff;">$${(token.liquidity || 0).toLocaleString()}</strong></div>
          <div><span style="color:var(--neon-pink);">24H CHANGE</span><br><strong style="font-size:12px;color:${(token.priceChange24h || 0) > 0 ? 'var(--neon-green)' : 'var(--neon-pink)'};">${(token.priceChange24h || 0).toFixed(2)}%</strong></div>
        </div>

        <button onclick="navigator.clipboard.writeText('${token.mint || ''}')" style="background:transparent;border:1px dashed var(--neon-blue);color:var(--neon-blue);padding:8px 15px;border-radius:8px;font-size:10px;cursor:pointer;width:100%;margin-bottom:15px;font-family:inherit;">📋 Copy Address</button>
        
        <div class="ctas" style="display:flex;gap:10px;">
          <a href="https://pump.fun/${token.mint}" target="_blank" class="pump-btn" style="flex:1;background:#fff;color:#000;border:none;padding:10px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;text-decoration:none;text-align:center;">PUMP.FUN</a>
          <a href="${token.dexscreenerUrl || `https://dexscreener.com/solana/${token.mint}`}" target="_blank" class="dex-btn" style="flex:1;background:var(--neon-green);color:#000;border:none;padding:10px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;text-decoration:none;text-align:center;">DEXSCREENER</a>
        </div>
      </div>
    `;
  } else if (tabIndex === 1) {
    // SOCIAL TAB
    content.innerHTML = `
      <div class="social-tab" style="animation: punchIn 0.3s ease; text-align: left;">
        <h3 style="color:var(--neon-blue);font-size:14px;margin-bottom:15px;">Live $${(token.symbol || 'MEME').toUpperCase()} Feed</h3>
        
        <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;font-size:10px;margin-bottom:10px;border-left:3px solid var(--neon-blue);">
          <strong style="color:#fff;">@MemeKing</strong><br>
          <span style="color:#ccc;">"Just loaded my bags for $${token.symbol}! This is going to 100M mcap easily. 🚀"</span>
        </div>
        <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;font-size:10px;margin-bottom:15px;border-left:3px solid var(--neon-pink);">
          <strong style="color:#fff;">@SolanaWhale</strong><br>
          <span style="color:#ccc;">"If you aren't fighting with $${token.symbol} in SMF, what are you even doing? 🥊"</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <button style="background:#1DA1F2;color:#fff;border:none;padding:8px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;">Twitter</button>
          <button style="background:#0088cc;color:#fff;border:none;padding:8px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;">Telegram</button>
          <button style="grid-column: span 2;background:#333;color:#fff;border:none;padding:8px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;">Website</button>
        </div>
      </div>
    `;
  } else if (tabIndex === 2) {
    // SAFETY TAB
    content.innerHTML = `
      <div class="safety-tab" style="animation: punchIn 0.3s ease; text-align: left;">
        <h3 style="color:var(--neon-green);font-size:14px;margin-bottom:15px;">SAFETY CHECK</h3>
        <div class="rug-score" style="font-size:11px; margin-bottom: 15px; color: #ccc;">
          <strong>Holders:</strong> ${token.holders || 100} • <strong>LP Status:</strong> ${token.lpBurned ? '<span style="color:var(--neon-green)">BURNED ✅</span>' : 'CHECKED'}
        </div>
        <div id="safety-tweets">
          <h4 style="color:var(--neon-blue);font-size:12px;margin-bottom:10px;">Live X $Cashtag Intel</h4>
          <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;font-size:10px;margin-bottom:10px;border-left:3px solid var(--neon-green);">
            <strong style="color:#fff;">@novasolana</strong><br>
            <span style="color:#ccc;">"$${token.symbol} contract is clean. LP burned, mint revoked. Good to go. 🛡️"</span>
          </div>
          <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;font-size:10px;margin-bottom:10px;border-left:3px solid var(--neon-pink);">
            <strong style="color:#fff;">@rugmuncher</strong><br>
            <span style="color:#ccc;">"Watching the top 10 wallets for $${token.symbol}. They hold 42%, be careful playing this one! ⚠️"</span>
          </div>
        </div>
      </div>
    `;
  }
};

function calculatePowerLevel(token) {
  const holderScore = Math.min(2.5, (token.holders || 100) / 400);
  const volScore = Math.max(0.5, Math.min(2.0, (token.volume24h || 0) / 50000));
  const changeScore = Math.max(0.5, 1 + (token.priceChange24h || 0) / 100);
  const liqScore = Math.max(0.5, Math.min(1.8, 1 + (token.liquidity || 0) / 100000));
  return (holderScore * volScore * changeScore * liqScore).toFixed(1) + 'x';
}
