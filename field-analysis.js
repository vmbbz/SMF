// Analyze field richness of both endpoints
async function analyzeFields() {
  console.log('=== FIELD RICHNESS ANALYSIS ===\n');
  
  try {
    // Get data from both endpoints
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const boostsData = await boostsRes.json();
    
    const profilesRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const profilesData = await profilesRes.json();
    
    // Analyze TOKEN-BOOSTS fields
    console.log('📊 TOKEN-BOOSTS FIELD ANALYSIS:');
    const boostsFields = new Set();
    boostsData.forEach(token => {
      Object.keys(token).forEach(key => boostsFields.add(key));
    });
    console.log('Available fields:', Array.from(boostsFields));
    
    // Check field completeness
    const boostsCompleteness = {
      url: boostsData.filter(t => t.url).length,
      chainId: boostsData.filter(t => t.chainId).length,
      tokenAddress: boostsData.filter(t => t.tokenAddress).length,
      description: boostsData.filter(t => t.description).length,
      icon: boostsData.filter(t => t.icon).length,
      openGraph: boostsData.filter(t => t.openGraph).length,
      links: boostsData.filter(t => t.links && t.links.length > 0).length,
      totalAmount: boostsData.filter(t => t.totalAmount).length,
      amount: boostsData.filter(t => t.amount).length,
      header: boostsData.filter(t => t.header).length,
    };
    
    console.log('Field completeness (out of ' + boostsData.length + '):');
    Object.entries(boostsCompleteness).forEach(([field, count]) => {
      const percentage = ((count / boostsData.length) * 100).toFixed(1);
      console.log(`  ${field}: ${count}/${boostsData.length} (${percentage}%)`);
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Analyze TOKEN-PROFILES fields
    console.log('📊 TOKEN-PROFILES FIELD ANALYSIS:');
    const profilesFields = new Set();
    profilesData.forEach(token => {
      Object.keys(token).forEach(key => profilesFields.add(key));
    });
    console.log('Available fields:', Array.from(profilesFields));
    
    // Check field completeness
    const profilesCompleteness = {
      url: profilesData.filter(t => t.url).length,
      chainId: profilesData.filter(t => t.chainId).length,
      tokenAddress: profilesData.filter(t => t.tokenAddress).length,
      description: profilesData.filter(t => t.description).length,
      icon: profilesData.filter(t => t.icon).length,
      openGraph: profilesData.filter(t => t.openGraph).length,
      links: profilesData.filter(t => t.links && t.links.length > 0).length,
      totalAmount: profilesData.filter(t => t.totalAmount).length,
      amount: profilesData.filter(t => t.amount).length,
      header: profilesData.filter(t => t.header).length,
      cto: profilesData.filter(t => t.cto !== undefined).length,
      updatedAt: profilesData.filter(t => t.updatedAt).length,
    };
    
    console.log('Field completeness (out of ' + profilesData.length + '):');
    Object.entries(profilesCompleteness).forEach(([field, count]) => {
      const percentage = ((count / profilesData.length) * 100).toFixed(1);
      console.log(`  ${field}: ${count}/${profilesData.length} (${percentage}%)`);
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Check for missing symbol/name fields
    console.log('🔍 SYMBOL/NAME FIELD ANALYSIS:');
    console.log('TOKEN-BOOSTES:');
    console.log(`  Has "symbol" field: ${boostsFields.has('symbol')}`);
    console.log(`  Has "name" field: ${boostsFields.has('name')}`);
    
    console.log('TOKEN-PROFILES:');
    console.log(`  Has "symbol" field: ${profilesFields.has('symbol')}`);
    console.log(`  Has "name" field: ${profilesFields.has('name')}`);
    
    console.log('\n📝 DESCRIPTION ANALYSIS:');
    const boostsDescLength = boostsData.filter(t => t.description).map(t => t.description.length);
    const profilesDescLength = profilesData.filter(t => t.description).map(t => t.description.length);
    
    console.log(`TOKEN-BOOSTS descriptions: ${boostsDescLength.length} tokens, avg length: ${boostsDescLength.length > 0 ? (boostsDescLength.reduce((a, b) => a + b, 0) / boostsDescLength.length).toFixed(1) : 0}`);
    console.log(`TOKEN-PROFILES descriptions: ${profilesDescLength.length} tokens, avg length: ${profilesDescLength.length > 0 ? (profilesDescLength.reduce((a, b) => a + b, 0) / profilesDescLength.length).toFixed(1) : 0}`);
    
    // Show sample descriptions with symbols
    console.log('\n💬 SAMPLE DESCRIPTIONS WITH SYMBOLS:');
    console.log('TOKEN-BOOSTES:');
    boostsData.filter(t => t.description && t.description.includes('$')).slice(0, 3).forEach((token, i) => {
      console.log(`  ${i+1}. ${token.description.slice(0, 80)}...`);
    });
    
    console.log('TOKEN-PROFILES:');
    profilesData.filter(t => t.description && t.description.includes('$')).slice(0, 3).forEach((token, i) => {
      console.log(`  ${i+1}. ${token.description.slice(0, 80)}...`);
    });
    
    console.log('\n🎯 RECOMMENDATION:');
    if (boostsDescLength.length > profilesDescLength.length) {
      console.log('TOKEN-BOOSTS has more descriptions');
    } else {
      console.log('TOKEN-PROFILES has more descriptions');
    }
    
    console.log('\n💡 SYMBOL EXTRACTION STRATEGY:');
    console.log('1. Look for $SYMBOL patterns in descriptions');
    console.log('2. Extract from URL path as fallback');
    console.log('3. Use address slice as last resort');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the analysis
analyzeFields();
