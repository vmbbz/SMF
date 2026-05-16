export async function getSolscanTrending(count = 12) {
  try {
    console.log(`[SolscanTrending] Fetching ${count} trending tokens...`);
    const res = await fetch(`/api/trending?count=${count}`);
    const tokens = await res.json();
    return tokens.map(t => ({
      mint: t.tokenAddress,
      symbol: t.symbol || 'MEME',
      name: t.name || t.symbol || 'Unknown',
      logoURI: t.logo,
      marketCap: t.marketCap || 0,
      volume24h: t.volume24h || 0,
      priceChange24h: t.priceChange24h || 0,
      liquidity: t.liquidity || 0,
      dexscreenerUrl: t.dexscreenerUrl,
      solscanUrl: t.solscanUrl,
      platform: 'pumpfun',
    }));
  } catch (e) {
    console.error('[SolscanTrending] Failed:', e);
    return [];
  }
}

export async function getPumpFunGraduates(count = 8) {
  try {
    const res = await fetch(`/api/graduates?count=${count}`);
    return await res.json();
  } catch (e) {
    console.error('[Graduates] Failed:', e);
    return [];
  }
}

export async function getSolscanDetails(mint) {
  try {
    const res = await fetch(`/api/token/${mint}`);
    return await res.json();
  } catch (e) {
    console.error('[SolscanDetails] Failed:', e);
    return null;
  }
}
