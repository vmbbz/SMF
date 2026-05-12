// src/token-utils.js
// IMPROVED — works reliably for real Pump.fun / Solana memes
export async function getTrendingTokens(count = 8) {
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=&chainId=solana');
    const data = await res.json();
    
    // Take top volume Raydium pairs that look like memes (high volume + short symbol)
    const pairs = data.pairs
      .filter(p => 
        p.dexId === 'raydium' && 
        p.baseToken.symbol && 
        p.volume?.h24 > 100000 && // real pumping activity
        !p.baseToken.symbol.includes('USDC') // skip stables
      )
      .sort((a, b) => b.volume.h24 - a.volume.h24)
      .slice(0, count);

    return pairs.map(p => ({
      mint: p.baseToken.address,
      symbol: '$' + (p.baseToken.symbol || 'MEME'),
      name: p.baseToken.name || 'Hot Meme',
      logoURI: p.baseToken.logoURI || `https://dd.dexscreener.com/ds-data/tokens/solana/${p.baseToken.address}.png`
    }));
  } catch (e) {
    console.error("Trending fetch failed", e);
    return []; // fallback
  }
}

export async function getTokenByMint(mint) {
  // Fallback for pasted address (Birdeye public endpoint — no key needed for basic meta)
  const res = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${mint}&chain=solana`);
  const data = await res.json();
  if (!data.success) throw new Error('Token not found');
  
  return {
    mint,
    symbol: data.data.symbol || '$UNKNOWN',
    name: data.data.name || 'Unknown Meme',
    logoURI: data.data.logoURI || `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png` 
  };
}

// Simple personality generator (we can make it smarter later)
export function generatePersonality(token) {
  const vibe = token.symbol.toLowerCase();
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
      `You think you can beat ${token.symbol}? My liquidity is thicker than your portfolio!`,
      'PUMP IT OR DUMP IT — either way you\'re getting KO\'d!',
      `I just 100x\'d while you were loading this fight 😂`
    ]
  };
}
