import { calculateFighterPower } from './token-power-scaling.js';

export async function getSolscanTrending(count = 12) {
  try {
    console.log(`[SolscanTrending] Fetching ${count} trending tokens...`);
    const res = await fetch(`/api/trending?count=${count}`);
    const tokens = await res.json();
    return tokens.map(t => {
      return { ...t, platform: 'pumpfun', power: calculateFighterPower(t) };
    });
  } catch (e) {
    console.error('[SolscanTrending] Failed:', e);
    return [];
  }
}

export async function getPumpFunGraduates(count = 8) {
  try {
    const res = await fetch(`/api/graduates?count=${count}`);
    const tokens = await res.json();
    return tokens.map(t => {
      return { ...t, platform: 'pumpfun', power: calculateFighterPower(t) };
    });
  } catch (e) {
    console.error('[Graduates] Failed:', e);
    return [];
  }
}

export async function getSolscanDetails(mint) {
  try {
    const res = await fetch(`/api/token/${mint}`);
    return await res.json();
  } catch (e) {
    console.error('[SolscanDetails] Failed:', e);
    return null;
  }
}
