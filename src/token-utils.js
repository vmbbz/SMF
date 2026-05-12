// src/token-utils.js
// IMPROVED — works reliably for real Pump.fun / Solana memes

// Helper functions for smart name extraction
function extractNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    const pathname = new URL(url).pathname;
    
    // Extract from domain (e.g., greenkittencrew.com -> GreenKittenCrew)
    const domain = hostname.replace('www.', '').replace('.com', '').replace('.io', '').replace('.xyz', '').replace('.fun', '').replace('.app', '').replace('.net', '').replace('.org', '');
    
    // Extract from path (e.g., /trollnaldo -> Trollnaldo)
    const pathParts = pathname.split('/').filter(part => part.length > 0);
    const pathName = pathParts[pathParts.length - 1];
    
    // Prefer domain name, fallback to path
    const bestName = domain.length > 2 ? domain : pathName;
    return bestName.charAt(0).toUpperCase() + bestName.slice(1);
  } catch {
    return null;
  }
}

function extractNameFromTwitter(url) {
  try {
    // Handle different Twitter URL formats
    // https://x.com/PVEcoinPump -> PVEcoinPump
    // https://x.com/i/communities/2020241545933283739 -> skip (community ID)
    const match = url.match(/x\.com\/([^\/\?]+)/);
    if (match) {
      const handle = match[1];
      // Skip if it's a community ID (numbers)
      if (!/^\d+$/.test(handle)) {
        return handle;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractNameFromTelegram(url) {
  try {
    // Extract from Telegram URL
    // https://t.me/poposhitcoin -> poposhitcoin
    // https://t.me/GreenKittenCrewGKC -> GreenKittenCrewGKC
    const match = url.match(/t\.me\/([^\/\?]+)/);
    if (match) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function getTrendingTokens(count = 8) {
  try {
    // Use token-boosts endpoint for trending tokens (more Solana tokens, better trending)
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
        
        // Smart symbol extraction: description -> URL -> address fallback
        const description = item.description || '';
        const symbolMatch = description.match(/\$([A-Z0-9]+)/i);
        let symbol = symbolMatch ? symbolMatch[1] : null;
        
        // Fallback to URL extraction
        if (!symbol) {
          const urlParts = item.url.split('/');
          const urlToken = urlParts[urlParts.length - 1];
          symbol = urlToken.replace(/pump$/i, '').toUpperCase();
        }
        
        // Final fallback to address
        if (!symbol) {
          symbol = item.tokenAddress.slice(0, 8);
        }
        
        // Smart name extraction from links: website -> twitter -> telegram
        let name = symbol; // Default to symbol
        if (item.links && item.links.length > 0) {
          // Try website first (most likely to have good name)
          const website = item.links.find(link => !link.type);
          if (website && website.url) {
            const websiteName = extractNameFromUrl(website.url);
            if (websiteName && websiteName.length > 2) {
              name = websiteName;
            }
          }
          
          // If no good website name, try twitter
          if (name === symbol) {
            const twitter = item.links.find(link => link.type === 'twitter');
            if (twitter && twitter.url) {
              const twitterName = extractNameFromTwitter(twitter.url);
              if (twitterName && twitterName.length > 2) {
                name = twitterName;
              }
            }
          }
          
          // If still no good name, try telegram
          if (name === symbol) {
            const telegram = item.links.find(link => link.type === 'telegram');
            if (telegram && telegram.url) {
              const telegramName = extractNameFromTelegram(telegram.url);
              if (telegramName && telegramName.length > 2) {
                name = telegramName;
              }
            }
          }
        }
        
        return {
          mint: item.tokenAddress,
          symbol: symbol,
          name: name,
          description: item.description,
          logoURI: item.openGraph, // Use openGraph for full image URLs (icon is just hash)
          openGraph: item.openGraph,
          twitter: item.links?.find(link => link.type === 'twitter')?.url,
          telegram: item.links?.find(link => link.type === 'telegram')?.url,
          website: item.links?.find(link => !link.type)?.url,
          links: item.links,
          chainId: item.chainId,
          totalAmount: item.totalAmount,
          amount: item.amount,
          header: item.header,
          url: item.url,
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
