// Compare Dexscreener endpoints
async function compareEndpoints() {
  console.log('=== COMPARING DEXSCREENER ENDPOINTS ===\n');
  
  try {
    // Test token-boosts endpoint
    console.log('📊 TOKEN-BOOSTS ENDPOINT:');
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const boostsData = await boostsRes.json();
    
    console.log(`Total tokens: ${boostsData.length}`);
    
    // Count by chain
    const boostsChains = {};
    boostsData.forEach(token => {
      boostsChains[token.chainId] = (boostsChains[token.chainId] || 0) + 1;
    });
    console.log('By chain:', boostsChains);
    
    // Show sample tokens
    console.log('\nSample tokens (first 5):');
    boostsData.slice(0, 5).forEach((token, i) => {
      console.log(`${i+1}. ${token.chainId}: ${token.tokenAddress?.slice(0, 8)}...`);
      console.log(`   Description: ${token.description?.slice(0, 50)}...`);
      console.log(`   Icon: ${token.icon?.slice(0, 20)}...`);
      console.log(`   OpenGraph: ${token.openGraph?.slice(0, 50)}...`);
      console.log(`   Links: ${token.links?.length || 0}`);
      console.log('');
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test token-profiles endpoint
    console.log('📊 TOKEN-PROFILES ENDPOINT:');
    const profilesRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const profilesData = await profilesRes.json();
    
    console.log(`Total tokens: ${profilesData.length}`);
    
    // Count by chain
    const profilesChains = {};
    profilesData.forEach(token => {
      profilesChains[token.chainId] = (profilesChains[token.chainId] || 0) + 1;
    });
    console.log('By chain:', profilesChains);
    
    // Show sample tokens
    console.log('\nSample tokens (first 5):');
    profilesData.slice(0, 5).forEach((token, i) => {
      console.log(`${i+1}. ${token.chainId}: ${token.tokenAddress?.slice(0, 8)}...`);
      console.log(`   Description: ${token.description?.slice(0, 50)}...`);
      console.log(`   Icon: ${token.icon?.slice(0, 50)}...`);
      console.log(`   OpenGraph: ${token.openGraph?.slice(0, 50)}...`);
      console.log(`   Links: ${token.links?.length || 0}`);
      console.log(`   CTO: ${token.cto}`);
      console.log('');
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Compare Solana tokens only
    const boostsSolana = boostsData.filter(t => t.chainId === 'solana');
    const profilesSolana = profilesData.filter(t => t.chainId === 'solana');
    
    console.log('🔍 SOLANA TOKENS COMPARISON:');
    console.log(`Boosts: ${boostsSolana.length} Solana tokens`);
    console.log(`Profiles: ${profilesSolana.length} Solana tokens`);
    
    // Check for overlapping tokens
    const boostsAddresses = new Set(boostsSolana.map(t => t.tokenAddress));
    const profilesAddresses = new Set(profilesSolana.map(t => t.tokenAddress));
    
    const overlap = [...boostsAddresses].filter(addr => profilesAddresses.has(addr));
    console.log(`Overlapping tokens: ${overlap.length}`);
    
    if (overlap.length > 0) {
      console.log('Overlapping token addresses:');
      overlap.slice(0, 3).forEach(addr => console.log(`  ${addr}`));
    }
    
    console.log('\n📈 RECOMMENDATION:');
    if (boostsSolana.length > profilesSolana.length) {
      console.log('Use TOKEN-BOOSTS for more Solana tokens');
    } else {
      console.log('Use TOKEN-PROFILES for more Solana tokens');
    }
    
    console.log('\n🖼️  IMAGE URL COMPARISON:');
    console.log('Boosts icon format: Hash (needs construction)');
    console.log('Profiles icon format: Full URL (ready to use)');
    console.log('Both have openGraph with full URLs');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the comparison
compareEndpoints();
