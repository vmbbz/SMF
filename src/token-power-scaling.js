export function calculateFighterPower(token) {
  if (!token) return { health: 100, damageMult: 1.0, speedMult: 1.0, rating: "1.0x" };

  // Safely parse numeric fields — treat missing/string values as 0
  const holders   = typeof token.holders === 'number' && token.holders > 0 ? token.holders : 0;
  const volume24h = Number(token.volume24h) || 0;
  const priceChg  = Number(token.priceChange24h) || 0;
  const liquidity = Number(token.liquidity) || 0;

  const holderScore  = holders > 0 ? Math.min(2.5, holders / 400) : 0.8; // neutral 0.8 if unknown
  const volScore     = Math.max(0.5, Math.min(2.0, volume24h / 50000));
  const changeScore  = Math.max(0.5, 1 + priceChg / 100);
  const liqScore     = Math.max(0.5, Math.min(1.8, 1 + liquidity / 100000));

  const rawPower = holderScore * volScore * changeScore * liqScore;
  const safePower = isFinite(rawPower) && rawPower > 0 ? rawPower : 1.0;

  return {
    health:    Math.round(100 * safePower),
    damageMult: Math.max(0.8, safePower * 1.2),
    speedMult:  Math.max(0.9, safePower * 0.8),
    rating:    safePower.toFixed(1) + "x",
  };
}
