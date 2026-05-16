export function calculateFighterPower(token) {
    const volScore = Math.max(0.5, Math.min(2.0, (token.volume24h || 0) / 50000));
    const changeScore = Math.max(0.5, 1 + (token.priceChange24h || 0) / 100);
    const liqScore = Math.max(0.5, Math.min(1.8, 1 + (token.liquidity || 0) / 100000));
    const rawRating = volScore * changeScore * liqScore;
    
    return {
        rating: rawRating.toFixed(1) + 'x',
        rawMultiplier: rawRating
    };
}
