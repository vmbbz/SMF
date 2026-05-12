// src/token-utils.js
// IMPROVED — works reliably for real Pump.fun / Solana memes
export async function getTrendingTokens(count = 8) {
  try {
    // Use token-boosts endpoint for trending Solana memes
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const data = await res.json();
    
    // DEBUG: Log full API response structure
    console.log('🔍 RAW API RESPONSE SAMPLE:', data.slice(0, 2));
    
    if (!data || !Array.isArray(data)) {
      console.error("Invalid API response:", data);
      return [];
    }
    
    // FIXED parsing for actual Dexscreener token-boosts response
    const tokens = data
      .filter(item => 
        (item.chainId === 'solana' || item.chainId === 'ethereum') &&
        (item.tokenAddress || item.address)
      )
      .slice(0, count)   // no strict volume filter needed — boosts endpoint already gives hot ones
      .map(item => {
        // Log full item data to see what fields are available
        console.log('🔍 FULL TOKEN DATA:', item);
        
        // Extract real token name from description or URL
        const description = item.description || '';
        const symbolMatch = description.match(/\$([A-Z0-9]+)/i);
        
        let tokenName;
        if (symbolMatch) {
          tokenName = symbolMatch[1]; // From $GREET, $EPIC, etc.
        } else {
          // Extract from URL: 7sgdnqsvugpahh6qyxb3g5gsdk9fazzm299kycxspump -> 7SGDNQSV
          const urlParts = item.url.split('/');
          const urlToken = urlParts[urlParts.length - 1];
          tokenName = urlToken.replace(/pump$/i, '').toUpperCase();
        }
        
        return {
          mint: item.tokenAddress,
          symbol: '$' + tokenName,
          name: tokenName,
          description: item.description,
          logoURI: `https://cdn.dexscreener.com/cms/images/${item.icon}`,
          openGraph: item.openGraph,
          // Social links - map directly
          twitter: item.links?.find(link => link.type === 'twitter')?.url,
          telegram: item.links?.find(link => link.type === 'telegram')?.url,
          website: item.links?.find(link => !link.type)?.url,
          links: item.links,
          // Map all other fields directly
          chainId: item.chainId,
          totalAmount: item.totalAmount,
          amount: item.amount,
          header: item.header,
          url: item.url,
          // Keep the original full item for debugging
          _raw: item
        };
      });

    console.log(`✅ Loaded ${tokens.length} hot tokens`, tokens);
    return tokens;
  } catch (e) {
    console.error("Trending fetch failed:", e);
    return [];
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
