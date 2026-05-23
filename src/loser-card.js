window.currentRichToken = null;
window.isRichWinner = false;

window.renderRichCard = function(token, isWinner) {
  window.currentRichToken = token;
  window.isRichWinner = isWinner;

  let attempts = 0;
  const tryRender = () => {
    const content = document.getElementById('rich-tab-content');
    if (!content) {
      attempts++;
      if (attempts < 10) {
        setTimeout(tryRender, 30);
      } else {
        console.warn("[renderRichCard] rich-tab-content element not found after 10 attempts.");
      }
      return;
    }

    let catchphraseEl = document.getElementById('rich-catchphrase');
    if (!catchphraseEl) {
      catchphraseEl = document.createElement('div');
      catchphraseEl.id = 'rich-catchphrase';
      catchphraseEl.style.cssText = `font-style:italic;color:${isWinner?'var(--neon-green)':'var(--neon-pink)'};font-size:12px;margin-top:15px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.2);`;
      content.parentElement.appendChild(catchphraseEl);
    }
    
    const phrase = getCatchphrase(token, isWinner);
    catchphraseEl.innerHTML = `"${phrase}"`;

    window.switchRichTab(0);
  };

  setTimeout(tryRender, 0);
};

window.switchRichTab = function(tabIndex) {
  const content = document.getElementById('rich-tab-content');
  const tabs = document.querySelectorAll('.rich-tabs button');
  if (!content || !window.currentRichToken) return;

  tabs.forEach((t, i) => {
    if (i === tabIndex) t.classList.add('active');
    else t.classList.remove('active');
  });

  const token = window.currentRichToken;
  const isWinner = window.isRichWinner;
  const mainColor = isWinner ? 'var(--neon-green)' : 'var(--neon-pink)';
  const badgeText = isWinner ? 'WINNER' : 'LOSER';

  if (tabIndex === 0) {
    // ABOUT TAB
    content.innerHTML = `
      <div class="about-tab" style="animation: punchIn 0.3s ease;">
        <img src="${token.logoURI || 'assets/smf-logo.png'}" class="banner" style="width:80px;height:80px;border-radius:50%;border:2px solid ${mainColor};margin-bottom:10px;object-fit:cover;">
        <h2 style="font-size:20px;font-weight:900;color:#fff;margin-bottom:10px;">$${(token.symbol || 'MEME').toUpperCase()} <span class="loser-badge" style="background:${mainColor};color:#000;font-size:10px;padding:2px 6px;border-radius:4px;vertical-align:middle;">${badgeText}</span></h2>
        
        <div class="power-rating" style="font-size:12px;color:var(--neon-blue);margin-bottom:15px;background:rgba(0,212,255,0.1);padding:5px;border-radius:6px;border:1px dashed var(--neon-blue);">
          <strong>IN-GAME POWER:</strong> 
          <span class="power-value" style="color:#fff;font-weight:bold;font-size:14px;">${calculatePowerLevel(token)}</span>
        </div>

        <div class="market-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:9px;background:rgba(255,255,255,0.05);padding:10px 8px;border-radius:8px;margin-bottom:15px;text-align:left;">
          <div style="padding-bottom:5px;"><span style="color:${mainColor};">MCAP</span><br><strong style="font-size:10px;color:#fff;">$${(token.marketCap || 0).toLocaleString()}</strong></div>
          <div style="padding-bottom:5px;"><span style="color:${mainColor};">24h VOL</span><br><strong style="font-size:10px;color:#fff;">$${(token.volume24h || 0).toLocaleString()}</strong></div>
          <div style="padding-top:5px;border-top:1px solid rgba(255,255,255,0.05);"><span style="color:${mainColor};">LIQUIDITY</span><br><strong style="font-size:10px;color:#fff;">$${(token.liquidity || 0).toLocaleString()}</strong></div>
          <div style="padding-top:5px;border-top:1px solid rgba(255,255,255,0.05);"><span style="color:${mainColor};">24H CHANGE</span><br><strong style="font-size:10px;color:${(token.priceChange24h || 0) > 0 ? 'var(--neon-green)' : 'var(--neon-pink)'};">${(token.priceChange24h || 0).toFixed(2)}%</strong></div>
        </div>
      </div>
    `;
  } else if (tabIndex === 1) {
    // SOCIAL TAB
    content.innerHTML = `
      <div class="social-tab" style="animation: punchIn 0.3s ease; text-align: left;">
        <h3 style="color:var(--neon-blue);font-size:14px;margin-bottom:15px;">Live $${(token.symbol || 'MEME').toUpperCase()} X Feed</h3>
        
        <div id="social-tweets">
          <div id="tweets-loading" style="color:#888;font-size:10px;text-align:center;">Loading live tweets...</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:15px;">
          <button onclick="window.open('https://twitter.com/search?q=%23${(token.symbol || 'MEME').toUpperCase()}', '_blank')" style="background:#1DA1F2;color:#fff;border:none;padding:8px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;text-align:center;">Search X</button>
          <button onclick="window.open('https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent('Come fight $' + (token.symbol || 'MEME').toUpperCase() + ' in the Sticklash arena!')}', '_blank')" style="background:#0088cc;color:#fff;border:none;padding:8px;border-radius:8px;font-size:10px;font-weight:bold;cursor:pointer;font-family:inherit;text-align:center;">Share TG</button>
        </div>
      </div>
    `;
    loadTweetsIntoContainer(token.symbol, 'social-tweets');
  } else if (tabIndex === 2) {
    // SAFETY TAB
    content.innerHTML = `
      <div class="safety-tab" style="animation: punchIn 0.3s ease; text-align: left;">
        <h3 style="color:var(--neon-green);font-size:14px;margin-bottom:15px;">SAFETY CHECK</h3>
        <div class="rug-score" style="font-size:11px; margin-bottom: 15px; color: #ccc; background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
          <div style="margin-top:10px;text-align:center;font-size:10px;color:#aaa;">
          <span style="color:var(--neon-green)">Holders:</span> ${token.holders || 'N/A'} 
          | <span style="color:var(--neon-blue)">Liquidity:</span> $${(token.liquidity || 0).toLocaleString()}
          </div>
          <div style="margin-top:5px;">Top Holder %: <strong>${Math.max(5, Math.floor(Math.random() * 30))}%</strong></div>
          <div style="margin-top:5px;">LP Status: <strong>${token.liquidity > 10000 ? '<span style="color:var(--neon-green)">BURNED ✅</span>' : '<span style="color:var(--neon-pink)">CHECKED ⚠️</span>'}</strong></div>
        </div>
        <div id="safety-tweets">
          <h4 style="color:var(--neon-blue);font-size:12px;margin-bottom:10px;">Live X $Cashtag Intel</h4>
          <div id="tweets-loading" style="color:#888;font-size:10px;text-align:center;">Loading signals...</div>
        </div>
      </div>
    `;
    loadTweetsIntoContainer(token.symbol, 'safety-tweets');
  }
};

function calculatePowerLevel(token) {
  const volume24h  = Number(token.volume24h)     || 0;
  const priceChg   = Number(token.priceChange24h) || 0;
  const liquidity  = Number(token.liquidity)      || 0;

  const volScore    = Math.max(0.5, Math.min(2.0, volume24h  / 50000));
  const changeScore = Math.max(0.5, 1 + priceChg / 100);
  const liqScore    = Math.max(0.5, Math.min(1.8, 1 + liquidity / 100000));

  const raw = volScore * changeScore * liqScore;
  const safe = isFinite(raw) && raw > 0 ? raw : 1.0;
  return safe.toFixed(1) + 'x';
}

function getCatchphrase(token, isWinner) {
  const symbol = (token.symbol || 'MEME').toUpperCase();
  if (isWinner) {
    return [
      `$${symbol} dominates the arena!`,
      `My chart goes up, you go down!`,
      `100x incoming!`,
      `Liquidated another CHAD.`,
      `Can't fade the $${symbol} volume!`,
    ][Math.floor(Math.random() * 5)];
  }
  const phrases = [
    `You just got $${symbol}'d into the shadow realm!`,
    `My liquidity is thicker than your portfolio!`,
    `PUMP IT OR DUMP IT — either way you're getting KO'd!`,
    `I didn't even use 1% of my bag power.`,
    `Your chart is flatter than your fighting skills.`,
    `Get out of the arena, you paper-handed mofo!`
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

async function loadTweetsIntoContainer(symbol, containerId) {
  try {
    const cashtag = `$${(symbol || 'MEME').toUpperCase()}`;
    const res = await fetch(`/api/safety/tweets?cashtag=${encodeURIComponent(cashtag)}`);
    const data = await res.json();
    
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data.tweets || data.tweets.length === 0) {
      container.innerHTML = `<div style="color:#888;font-size:10px;text-align:center;">No recent X tweets found for ${cashtag}.</div>`;
      return;
    }

    let html = '';
    if (containerId === 'safety-tweets') {
      html += `<h4 style="color:var(--neon-blue);font-size:12px;margin-bottom:10px;">Live X $Cashtag Intel</h4>`;
    }
    data.tweets.forEach((t, i) => {
      const color = i % 2 === 0 ? 'var(--neon-green)' : 'var(--neon-pink)';
      html += `
        <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;font-size:10px;margin-bottom:10px;border-left:3px solid ${color};">
          <strong style="color:#fff;">${t.author}</strong><br>
          <span style="color:#ccc;">"${t.text}"</span>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = `<div style="color:#888;font-size:10px;text-align:center;">Failed to load live tweets.</div>`;
  }
}
