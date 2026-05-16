// Test the name extraction with sample data from logs
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

// Test with sample data from logs
console.log('=== TESTING NAME EXTRACTION ===\n');

// Sample 1: Trollnaldo
console.log('🏈 TROLLNALDO:');
console.log('Website:', extractNameFromUrl('https://trollnaldo.fun/'));
console.log('Telegram:', extractNameFromTelegram('https://t.me/trolnaldo'));
console.log('Expected: Trollnaldo\n');

// Sample 2: Green Kitten Crew
console.log('🐱 GREEN KITTEN CREW:');
console.log('Website:', extractNameFromUrl('https://greenkittencrew.com'));
console.log('Twitter:', extractNameFromTwitter('https://x.com/i/communities/2020241545933283739')); // Should skip
console.log('Telegram:', extractNameFromTelegram('https://t.me/GreenKittenCrewGKC'));
console.log('Expected: GreenKittenCrew\n');

// Sample 3: PVE Coin
console.log('💰 PVE COIN:');
console.log('Website:', extractNameFromUrl('https://www.pvecoin.io/'));
console.log('Twitter:', extractNameFromTwitter('https://x.com/PVEcoinPump'));
console.log('Expected: Pvecoin\n');

// Sample 4: POPO
console.log('💩 POPO:');
console.log('Website:', extractNameFromUrl('http://popo-sol.xyz/'));
console.log('Telegram:', extractNameFromTelegram('https://t.me/poposhitcoin'));
console.log('Expected: Popo\n');

// Test the full logic
function testSmartNameExtraction(links, symbol) {
  let name = symbol;
  if (links && links.length > 0) {
    // Try website first
    const website = links.find(link => !link.type);
    if (website && website.url) {
      const websiteName = extractNameFromUrl(website.url);
      if (websiteName && websiteName.length > 2) {
        name = websiteName;
      }
    }
    
    // If no good website name, try twitter
    if (name === symbol) {
      const twitter = links.find(link => link.type === 'twitter');
      if (twitter && twitter.url) {
        const twitterName = extractNameFromTwitter(twitter.url);
        if (twitterName && twitterName.length > 2) {
          name = twitterName;
        }
      }
    }
    
    // If still no good name, try telegram
    if (name === symbol) {
      const telegram = links.find(link => link.type === 'telegram');
      if (telegram && telegram.url) {
        const telegramName = extractNameFromTelegram(telegram.url);
        if (telegramName && telegramName.length > 2) {
          name = telegramName;
        }
      }
    }
  }
  return name;
}

console.log('🧪 FULL LOGIC TEST:');
console.log('Trollnaldo:', testSmartNameExtraction([
  {url: 'https://trollnaldo.fun/'},
  {type: 'telegram', url: 'https://t.me/trolnaldo'}
], 'DHOUZHHR16ZJCQZPOGNUG7GI9MK9VMTPFQPSZTF'));

console.log('GreenKittenCrew:', testSmartNameExtraction([
  {url: 'https://greenkittencrew.com'},
  {type: 'twitter', url: 'https://x.com/i/communities/2020241545933283739'},
  {type: 'telegram', url: 'https://t.me/GreenKittenCrewGKC'}
], 'GPXY56UALMCNKKBPNWKRDEEG6DWVBFAFYSSG48MR'));

console.log('PVEcoin:', testSmartNameExtraction([
  {url: 'https://www.pvecoin.io/'},
  {type: 'twitter', url: 'https://x.com/PVEcoinPump'}
], 'G73G9NSYGA55DQ78JQVULZENFEPKDQP14GD3ATUQ'));
