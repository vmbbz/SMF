import { calculateFighterPower } from './token-power-scaling.js';

const clamp = (min, value, max) => Math.max(min, Math.min(max, value));

export function tokenIdentityKey(token) {
  // Solana public keys are base58 and case-sensitive. Never lowercase a mint:
  // two strings that differ only by letter case are not interchangeable keys.
  return String(token?.mint || '').trim();
}

export function uniqueExhibitionTokens(sources) {
  const sourceList = Array.isArray(sources) ? sources : [];
  const candidates = sourceList.some(Array.isArray) ? sourceList.flat() : sourceList;
  const seen = new Set();
  const unique = [];

  for (const token of candidates) {
    const key = tokenIdentityKey(token);
    const hasLabel = Boolean(String(token?.symbol || token?.name || '').trim());
    if (!key || !hasLabel || seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }

  return unique;
}

export function tokenPairKey(pair) {
  if (!Array.isArray(pair) || pair.length !== 2) return '';
  const keys = pair.map(tokenIdentityKey).filter(Boolean).sort();
  return keys.length === 2 ? keys.join(':') : '';
}

export function selectDistinctTokenPair(tokens, { random = Math.random, excludePair = null } = {}) {
  const unique = uniqueExhibitionTokens(tokens);
  if (unique.length < 2) return null;

  const pairs = [];
  for (let left = 0; left < unique.length - 1; left++) {
    for (let right = left + 1; right < unique.length; right++) {
      pairs.push([unique[left], unique[right]]);
    }
  }

  const excludedKey = tokenPairKey(excludePair);
  const eligiblePairs = excludedKey && pairs.length > 1
    ? pairs.filter(pair => tokenPairKey(pair) !== excludedKey)
    : pairs;
  const roll = clamp(0, Number(random()) || 0, 0.999999999);
  return eligiblePairs[Math.floor(roll * eligiblePairs.length)] || eligiblePairs[0] || null;
}

export function deriveTokenCombatProfile(token) {
  const change = Number(token?.priceChange24h) || 0;
  const volume = Math.max(0, Number(token?.volume24h) || 0);
  const liquidity = Math.max(0, Number(token?.liquidity) || 0);

  if (change >= 15) {
    return {
      id: 'momentum_rush',
      label: 'MOMENTUM RUSH',
      detail: 'Positive 24h momentum drives fast approaches and heavy finishers.',
      cadenceMs: 520,
    };
  }
  if (change <= -10) {
    return {
      id: 'reversal_hunter',
      label: 'REVERSAL HUNTER',
      detail: 'Negative momentum favors retreats, counters, and comeback attacks.',
      cadenceMs: 620,
    };
  }
  if (liquidity >= 150000 || (liquidity >= 50000 && liquidity > volume * 1.4)) {
    return {
      id: 'liquidity_tank',
      label: 'LIQUIDITY TANK',
      detail: 'Deep liquidity favors measured defense and ranged control.',
      cadenceMs: 660,
    };
  }
  if (volume >= 75000) {
    return {
      id: 'volume_pressure',
      label: 'VOLUME PRESSURE',
      detail: 'High turnover creates relentless projectile and combo pressure.',
      cadenceMs: 560,
    };
  }
  return {
    id: 'degen_wildcard',
    label: 'DEGEN WILDCARD',
    detail: 'An unproven market profile produces acrobatics and unpredictable mixups.',
    cadenceMs: 600,
  };
}

export function calculateTokenExhibitionPower(token) {
  const marketPower = calculateFighterPower(token);
  const marketHealthRatio = Math.max(0.5, Number(marketPower.health || 100) / 100);
  const compressedHealth = 100 + Math.log2(marketHealthRatio) * 40;

  return {
    ...marketPower,
    health: Math.round(clamp(80, compressedHealth, 240)),
    damageMult: clamp(0.8, Number(marketPower.damageMult) || 1, 1.5),
    speedMult: clamp(1, (Number(marketPower.speedMult) || 1) * 1.06, 1.25),
    marketHealth: marketPower.health,
  };
}

export function tuneTokenCombatPlan(plan, profile) {
  const tuned = Array.isArray(plan) && plan.length > 0
    ? [...plan]
    : ['forward', 'dash forward', 'medium punch', 'heavy kick', 'hadouken'];
  const last = tuned.length - 1;

  if (profile?.id === 'momentum_rush') {
    const defensiveIndex = tuned.findIndex(move => ['back', 'dash back', 'crouch'].includes(move));
    tuned[defensiveIndex >= 0 ? defensiveIndex : 0] = 'dash forward';
    tuned[last] = 'forward heavy kick';
  } else if (profile?.id === 'reversal_hunter') {
    tuned[0] = 'dash back';
    if (tuned.length > 1) tuned[1] = 'heavy punch';
    tuned[last] = 'hadouken';
  } else if (profile?.id === 'liquidity_tank') {
    tuned[0] = 'back';
    if (tuned.length > 2) tuned[2] = 'crouch heavy punch';
    tuned[last] = 'hadouken';
  } else if (profile?.id === 'volume_pressure') {
    tuned[0] = 'hadouken';
    if (tuned.length > 2) tuned[2] = 'dash forward heavy punch';
    tuned[last] = 'heavy kick';
  } else {
    if (tuned.length > 1) tuned[1] = 'somersault';
    tuned[last] = 'jump forward heavy kick';
  }

  return tuned;
}
