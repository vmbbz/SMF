/**
 * calculateFighterPower
 * Computes in-game power from on-chain market metrics.
 *
 * Holders REMOVED — the API returns "N/A" for most tokens, which is a non-numeric
 * string. Any arithmetic on it produces NaN that poisons the entire calculation.
 * Power is now determined by volume, price change momentum, and liquidity depth.
 */
export function calculateFighterPower(token) {
  if (!token) return { health: 100, damageMult: 1.0, speedMult: 1.0, rating: "1.0x" };

  // Parse all fields — coerce non-numeric to 0 so no NaN can propagate
  const volume24h = Number(token.volume24h)      || 0;
  const priceChg  = Number(token.priceChange24h) || 0;
  const liquidity = Number(token.liquidity)      || 0;

  // Volume score: 0→$0 gives 0.5, $100K gives 2.0 (capped)
  const volScore    = Math.max(0.5, Math.min(2.0, volume24h  / 50000));
  // Momentum score: -100% → 0.5, +100% → 2.0
  const changeScore = Math.max(0.5, 1 + priceChg / 100);
  // Liquidity depth: $0 → 0.5, $180K+ → 1.8 (capped)
  const liqScore    = Math.max(0.5, Math.min(1.8, 1 + liquidity / 100000));

  const rawPower  = volScore * changeScore * liqScore;
  const safePower = isFinite(rawPower) && rawPower > 0 ? rawPower : 1.0;

  return {
    health:     Math.round(100 * safePower),
    damageMult: Math.max(0.8, safePower * 1.2),
    speedMult:  Math.max(0.9, safePower * 0.8),
    rating:     safePower.toFixed(1) + "x",
  };
}
