/**
 * calculateFighterPower
 * Computes in-game power from on-chain market metrics.
 *
 * Design principle: a token with 3x power should deal 3x more damage than
 * a baseline token (1x). But to keep the game playable, damageMult is
 * expressed as a PROPORTIONAL ADDITIVE bonus over the base attack values,
 * NOT a straight multiplier stacked on top of already-scaled attack damage.
 *
 * Damage multiplier is capped at 1.5x (50% extra damage) regardless of
 * how large safePower grows, so even a 75x-power token doesn't one-shot.
 * The HEALTH pool scales up normally so the opponent feels durable, and
 * the rating display still shows the true economic power.
 */
export function calculateFighterPower(token) {
  if (!token) return { health: 100, damageMult: 1.0, speedMult: 1.0, rating: '1.0x' };

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

  // Health scales with full economic power (rich token = more health)
  const health = Math.round(100 * Math.max(0.5, Math.min(10, safePower)));

  // Damage multiplier is CAPPED: baseline 1.0x + tiny proportional bonus.
  // Max is 1.5x (50% extra damage) so even a monster token doesn't one-shot.
  // Formula: 1.0 + (safePower - 1.0) * 0.1, clamped to [0.8, 1.5]
  const damageMult = Math.max(0.8, Math.min(1.5, 1.0 + (safePower - 1.0) * 0.1));

  // Speed scales conservatively: [0.95, 1.2]
  const speedMult = Math.max(0.95, Math.min(1.2, 1.0 + (safePower - 1.0) * 0.05));

  return {
    health,
    damageMult,
    speedMult,
    rating: safePower.toFixed(1) + 'x',
  };
}
