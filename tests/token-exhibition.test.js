import {
  calculateTokenExhibitionPower,
  deriveTokenCombatProfile,
  selectDistinctTokenPair,
  tokenIdentityKey,
  tokenPairKey,
  tuneTokenCombatPlan,
  uniqueExhibitionTokens,
} from '../src/token-exhibition.js';

const TOKENS = [
  {
    mint: 'MintAlpha111',
    symbol: 'ALPHA',
    name: 'Alpha Token',
    volume24h: 125000,
    liquidity: 90000,
    priceChange24h: 22,
  },
  {
    mint: 'MintBeta222',
    symbol: 'BETA',
    name: 'Beta Token',
    volume24h: 16000,
    liquidity: 220000,
    priceChange24h: 2,
  },
  {
    mint: 'MintGamma333',
    symbol: 'GAMMA',
    name: 'Gamma Token',
    volume24h: 18000,
    liquidity: 12000,
    priceChange24h: -18,
  },
];

describe('Token Exhibition market pool', () => {
  test('requires real mints and de-duplicates the same token across feeds', () => {
    const duplicate = { ...TOKENS[0], symbol: 'ALPHA-NEW' };
    const unique = uniqueExhibitionTokens([
      TOKENS.slice(0, 2),
      [duplicate, TOKENS[2], { symbol: 'NO_MINT' }, { mint: 'NoLabel444' }],
    ]);

    expect(unique).toHaveLength(3);
    expect(unique.map(tokenIdentityKey)).toEqual([
      'MintAlpha111',
      'MintBeta222',
      'MintGamma333',
    ]);
    expect(unique[0].symbol).toBe('ALPHA');
  });

  test('never selects the same mint for both corners', () => {
    const pair = selectDistinctTokenPair(TOKENS, { random: () => 0.999 });

    expect(pair).toHaveLength(2);
    expect(tokenIdentityKey(pair[0])).not.toBe(tokenIdentityKey(pair[1]));
  });

  test('preserves Solana mint case when identifying candidates', () => {
    const unique = uniqueExhibitionTokens([
      { mint: 'CaseSensitiveMint', symbol: 'UPPER' },
      { mint: 'casesensitivemint', symbol: 'LOWER' },
    ]);

    expect(unique).toHaveLength(2);
  });

  test('fails transparently when fewer than two distinct real tokens exist', () => {
    expect(selectDistinctTokenPair([TOKENS[0], { ...TOKENS[0] }])).toBeNull();
    expect(selectDistinctTokenPair([])).toBeNull();
  });

  test('reroll avoids the current unordered pair when another matchup exists', () => {
    const current = [TOKENS[0], TOKENS[1]];
    const next = selectDistinctTokenPair(TOKENS, {
      random: () => 0,
      excludePair: current,
    });

    expect(tokenPairKey(next)).not.toBe(tokenPairKey(current));
  });
});

describe('Token Exhibition combat translation', () => {
  test.each([
    [{ priceChange24h: 20 }, 'momentum_rush'],
    [{ priceChange24h: -12 }, 'reversal_hunter'],
    [{ liquidity: 180000, volume24h: 10000 }, 'liquidity_tank'],
    [{ liquidity: 10000, volume24h: 90000 }, 'volume_pressure'],
    [{ liquidity: 10000, volume24h: 10000 }, 'degen_wildcard'],
  ])('derives a visible tactical style from market conditions', (token, expected) => {
    const profile = deriveTokenCombatProfile(token);

    expect(profile.id).toBe(expected);
    expect(profile.label).toBeTruthy();
    expect(profile.detail).toBeTruthy();
    expect(profile.cadenceMs).toBeGreaterThanOrEqual(450);
  });

  test('retains true market rating while bounding match duration and lethality', () => {
    const power = calculateTokenExhibitionPower({
      volume24h: 5000000,
      liquidity: 5000000,
      priceChange24h: 900,
    });

    expect(power.rating).toBe('36.0x');
    expect(power.marketHealth).toBe(1000);
    expect(power.health).toBeGreaterThanOrEqual(80);
    expect(power.health).toBeLessThanOrEqual(240);
    expect(power.damageMult).toBeGreaterThanOrEqual(0.8);
    expect(power.damageMult).toBeLessThanOrEqual(1.5);
    expect(power.speedMult).toBeGreaterThanOrEqual(1);
    expect(power.speedMult).toBeLessThanOrEqual(1.25);
  });

  test('styles alter tactics without mutating the behavior-tree plan', () => {
    const base = ['back', 'light punch', 'crouch', 'medium kick', 'heavy punch'];
    const tuned = tuneTokenCombatPlan(base, { id: 'momentum_rush' });

    expect(tuned).not.toBe(base);
    expect(base).toEqual(['back', 'light punch', 'crouch', 'medium kick', 'heavy punch']);
    expect(tuned[0]).toBe('dash forward');
    expect(tuned.at(-1)).toBe('forward heavy kick');
  });
});
