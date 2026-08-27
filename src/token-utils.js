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

function buildFallbackTokenFromMint(mint) {
  const raw = String(mint || '').trim();
  const short = raw.length >= 6 ? raw.slice(0, 6).toUpperCase() : 'MEME';
  return {
    mint: raw,
    symbol: short,
    name: `Token ${short}`,
    logoURI: 'assets/smf-logo.png',
    marketCap: 0,
    volume24h: 0,
    priceChange24h: 0,
    liquidity: 0,
    price: 0,
    holders: 'N/A',
    dexscreenerUrl: raw ? `https://dexscreener.com/solana/${raw}` : '',
  };
}

async function getTrendingTokens(count = 8) {
  try {
    const primary = await getSolscanTrending(count);
    if (Array.isArray(primary) && primary.length > 0) {
      setCachedTrendingTokens(primary);
      return primary;
    }

    // If trending is empty/rate-limited, fall back to grads.
    const grads = await getPumpFunGraduates(count);
    if (Array.isArray(grads) && grads.length > 0) {
      setCachedTrendingTokens(grads);
      return grads;
    }

    // Last resort: return recent cached feed so gameplay can still start.
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
      // If details endpoint blips, salvage from cached/live list by mint match.
      const inMemoryCandidates = getCachedTrendingTokens();
      const matched = inMemoryCandidates.find(t => String(t?.mint || '') === cleanMint);
      if (matched) data = matched;
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
