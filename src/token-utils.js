const CACHE_KEY = 'smf_token_cache';
const CACHE_TTL = 60000;

export function getCachedToken(mint) {
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  const entry = cache[mint];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

export function setCachedToken(mint, data) {
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  cache[mint] = { data, timestamp: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

async function getTrendingTokens(count = 8) {
  try {
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
    console.error("Trending fetch failed:", e);
    return [];
  }
}

async function getTokenByMint(mint) {
  const cached = getCachedToken(mint);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/token/${mint}`);
    const data = await res.json();
    if (!data) throw new Error('Token not found');
    
    const mappedToken = {
      mint: data.price?.data?.tokenAddress || data.holders?.tokenAddress || mint,
      symbol: data.symbol || data.price?.data?.symbol || '$UNKNOWN',
      name: data.price?.data?.name || data.holders?.tokenName || 'Unknown Meme',
      logoURI: data.holders?.tokenLogo || data.price?.data?.logo || `assets/smf-logo.png`,
      marketCap: data.holders?.marketCap || 0,
      volume24h: data.holders?.totalVolume?.['24h'] || 0,
      priceChange24h: data.holders?.pricePercentChange?.['24h'] || 0,
      liquidity: data.holders?.totalLiquidityUsd || 0,
      holders: data.holders?.holders || 100,
    };
    
    setCachedToken(mint, mappedToken);
    return mappedToken;
  } catch (e) {
    console.error("Failed to fetch token by mint:", e);
    return null;
  }
}

// Simple personality generator (we can make it smarter later)
function generatePersonality(token) {
  if (!token) {
    return {
      name: 'CHAD',
      pitch: 1.0,
      rate: 1.0,
      taunts: [
        "Stay humble, stay degen.",
        "Victory is just another day at the office.",
        "I didn't even use 1% of my power.",
        "Moon soon. See you at the top."
      ]
    };
  }
  const vibe = (token.symbol || 'MEME').toLowerCase();
  if (vibe.includes('pepe') || vibe.includes('frog')) {
    return { name: 'Cocky Frog Lord', pitch: 0.8, rate: 1.1, taunts: ['Ribbit your way to shadow realm!', 'My chart pumps harder than your kicks!'] };
  }
  if (vibe.includes('fart') || vibe.includes('gas')) {
    return { name: 'Gasbag Supreme', pitch: 1.3, rate: 0.9, taunts: ['You just got FARTED on!', 'Smell the victory!'] };
  }
  return { 
    name: 'Degen Warrior', 
    pitch: 1.0, 
    rate: 1.0, 
    taunts: [
      `You think you can beat ${token.symbol || 'me'}? My liquidity is thicker than your portfolio!`,
      'PUMP IT OR DUMP IT — either way you\'re getting KO\'d!',
      `I just 100x\'d while you were loading this fight 😂`
    ]
  };
}

export { 
  getTrendingTokens, 
  getTokenByMint, 
  generatePersonality
};
