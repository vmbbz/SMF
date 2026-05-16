export function calculateFighterPower(token) {
  if (!token) return { health: 100, damageMult: 1.0, speedMult: 1.0, rating: "1.0x" };

  const holderScore = Math.min(2.5, (token.holders || 100) / 400);        // community strength
  const volScore     = Math.max(0.5, Math.min(2.0, (token.volume24h || 0) / 50000));
  const changeScore  = Math.max(0.5, 1 + (token.priceChange24h || 0) / 100);
  const liqScore     = Math.max(0.5, Math.min(1.8, 1 + (token.liquidity || 0) / 100000));

  const rawPower = holderScore * volScore * changeScore * liqScore;

  return {
    health: Math.round(100 * rawPower),
    damageMult: Math.max(0.8, rawPower * 1.2),
    speedMult: Math.max(0.9, rawPower * 0.8),
    rating: rawPower.toFixed(1) + "x"
  };
}
