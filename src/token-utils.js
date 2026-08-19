import { API_ROUTES, fetchApiJson } from './api-endpoints.js';
import { getSolscanTrending, getPumpFunGraduates } from './solscan-trending.js';

const CACHE_KEY = 'smf_token_cache';
const CACHE_TTL = 60000;
const TRENDING_CACHE_KEY = 'smf_trending_tokens_cache';
const TRENDING_CACHE_TTL = 180000;

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

function getCachedTrendingTokens() {
  try {
    const payload = JSON.parse(localStorage.getItem(TRENDING_CACHE_KEY) || 'null');
    if (!payload || !Array.isArray(payload.tokens)) return [];
    if (Date.now() - Number(payload.timestamp || 0) > TRENDING_CACHE_TTL) return [];
    return payload.tokens;
  } catch {
    return [];
  }
}

function setCachedTrendingTokens(tokens) {
  try {
    localStorage.setItem(
      TRENDING_CACHE_KEY,
      JSON.stringify({ tokens: Array.isArray(tokens) ? tokens : [], timestamp: Date.now() })
    );
  } catch {}
}

export function isEvmAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address || '').trim());
}

export function getTokenSymbol(token, fallback = 'MEME') {
  if (!token) return fallback;
  const sym = token.symbol || token.tokenSymbol || token.baseToken?.symbol || token.extractedSymbol;
  if (sym && sym !== 'BASE' && sym !== 'Unknown') {
    return String(sym).toUpperCase();
  }
  if (token.name && token.name !== 'Unknown' && token.name !== 'Base Token') {
    return String(token.name).toUpperCase();
  }
  if (token.mint || token.address) {
    const raw = String(token.mint || token.address);
    return raw.length >= 6 ? raw.slice(0, 6).toUpperCase() : fallback;
  }
  return fallback;
}

function buildFallbackTokenFromMint(mint) {
  const raw = String(mint || '').trim();
  const isEvm = isEvmAddress(raw);
  const short = raw.length >= 6 ? raw.slice(0, 6).toUpperCase() : 'MEME';
  return {
    mint: raw,
    address: raw,
    symbol: short,
    name: isEvm ? `Base Token (${short})` : `Token ${short}`,
    logoURI: 'assets/base-logo.png',
    chainId: isEvm ? 'base' : 'solana',
    marketCap: 0,
    volume24h: 0,
    priceChange24h: 0,
    liquidity: 0,
    price: 0,
    holders: 'N/A',
    dexscreenerUrl: raw ? (isEvm ? `https://dexscreener.com/base/${raw}` : `https://dexscreener.com/solana/${raw}`) : '',
  };
}

async function fetchBaseTrendingFromDexscreener(count = 8) {
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=base');
    if (!res.ok) return [];
    const data = await res.json();
    const pairs = data?.pairs || [];
    const basePairs = pairs.filter(p => p.chainId === 'base' && p.baseToken?.address);
    
    return basePairs.slice(0, count).map(p => ({
      mint: p.baseToken.address,
      address: p.baseToken.address,
      symbol: p.baseToken.symbol || 'BASE',
      name: p.baseToken.name || p.baseToken.symbol || 'Base Token',
      logoURI: p.info?.imageUrl || 'assets/base-logo.png',
      chainId: 'base',
      marketCap: p.marketCap || p.fdv || 0,
      volume24h: p.volume?.h24 || 0,
      priceChange24h: p.priceChange?.h24 || 0,
      liquidity: p.liquidity?.usd || 0,
      price: p.priceUsd || 0,
      holders: 'N/A',
      dexscreenerUrl: p.url || `https://dexscreener.com/base/${p.baseToken.address}`,
    }));
  } catch (e) {
    console.error('Dexscreener Base trending fetch error:', e);
    return [];
  }
}

async function getTrendingTokens(count = 8) {
  try {
    // Primary: Fetch Base ecosystem trending tokens
    const baseTrending = await fetchBaseTrendingFromDexscreener(count);
    if (Array.isArray(baseTrending) && baseTrending.length > 0) {
      setCachedTrendingTokens(baseTrending);
      return baseTrending;
    }

    // Secondary fallback: Solscan trending
    const primary = await getSolscanTrending(count);
    if (Array.isArray(primary) && primary.length > 0) {
      setCachedTrendingTokens(primary);
      return primary;
    }

    // Tertiary fallback: PumpFun grads
    const grads = await getPumpFunGraduates(count);
    if (Array.isArray(grads) && grads.length > 0) {
      setCachedTrendingTokens(grads);
      return grads;
    }

    // Last resort: Return cached feed
    return getCachedTrendingTokens().slice(0, count);
  } catch (e) {
    console.error("Trending fetch failed:", e);
    return getCachedTrendingTokens().slice(0, count);
  }
}

async function getTokenByMint(mint) {
  const cleanMint = String(mint || '').trim();
  if (!cleanMint) return null;

  const cached = getCachedToken(mint);
  if (cached) return cached;

  try {
    let data = null;

    data = await fetchApiJson([
      `${API_ROUTES.TOKEN_DETAILS}/${encodeURIComponent(cleanMint)}`,
      `/api/token/${encodeURIComponent(cleanMint)}`,
    ]);

    if (!data || !data.mint) {
      const inMemoryCandidates = getCachedTrendingTokens();
      const matched = inMemoryCandidates.find(t => String(t?.mint || t?.address || '').toLowerCase() === cleanMint.toLowerCase());
      if (matched) data = matched;
    }

    if (!data || !data.mint) {
      // Direct Dexscreener API lookup for Base / EVM address
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cleanMint}`);
        if (dexRes.ok) {
          const dexData = await dexRes.json();
          const pair = dexData?.pairs?.[0];
          if (pair) {
            data = {
              mint: cleanMint,
              address: cleanMint,
              symbol: pair.baseToken?.symbol || 'BASE',
              name: pair.baseToken?.name || 'Base Token',
              logoURI: pair.info?.imageUrl || 'assets/base-logo.png',
              chainId: pair.chainId || (isEvmAddress(cleanMint) ? 'base' : 'solana'),
              marketCap: pair.marketCap || pair.fdv || 0,
              volume24h: pair.volume?.h24 || 0,
              priceChange24h: pair.priceChange?.h24 || 0,
              liquidity: pair.liquidity?.usd || 0,
              price: pair.priceUsd || 0,
              holders: 'N/A',
              dexscreenerUrl: pair.url || `https://dexscreener.com/base/${cleanMint}`,
            };
          }
        }
      } catch (e) {
        console.error('Dexscreener direct token lookup failed:', e);
      }
    }

    if (!data || !data.mint) {
      data = buildFallbackTokenFromMint(cleanMint);
    }
    
    setCachedToken(cleanMint, data);
    return data;
  } catch (e) {
    console.error("Failed to fetch token by mint:", e);
    return buildFallbackTokenFromMint(cleanMint);
  }
}

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
    return { name: 'Cocky Frog Lord', pitch: 0.8, rate: 1.1, taunts: ['Ribbit your way to shadow realm!', 'My Base chart pumps harder than your kicks!'] };
  }
  if (vibe.includes('fart') || vibe.includes('gas')) {
    return { name: 'Gasbag Supreme', pitch: 1.3, rate: 0.9, taunts: ['You just got FARTED on!', 'Smell the Base gas victory!'] };
  }
  return { 
    name: 'Base Degen Warrior', 
    pitch: 1.0, 
    rate: 1.0, 
    taunts: [
      `You think you can beat ${token.symbol || 'me'} on Base? My liquidity is thicker than your portfolio!`,
      'PUMP IT OR DUMP IT — either way you\'re getting KO\'d!',
      `I just 100x\'d on Base while you were loading this fight 😂`
    ]
  };
}

export { 
  getTrendingTokens, 
  getTokenByMint, 
  generatePersonality
};
