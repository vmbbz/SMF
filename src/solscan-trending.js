import { calculateFighterPower } from './token-power-scaling.js';
import { API_ROUTES, fetchApiJson } from './api-endpoints.js';

export async function getSolscanTrending(count = 12) {
  try {
    console.log(`[SolscanTrending] Fetching ${count} trending tokens...`);
    const tokens = await fetchApiJson([
      `${API_ROUTES.TRENDING}?count=${count}`,
      `${API_ROUTES.LEGACY_TRENDING}?count=${count}`,
    ]);
    if (!Array.isArray(tokens)) return [];
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
    const tokens = await fetchApiJson([
      `${API_ROUTES.GRADUATES}?count=${count}`,
      `${API_ROUTES.LEGACY_GRADUATES}?count=${count}`,
    ]);
    if (!Array.isArray(tokens)) return [];
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
    return await fetchApiJson(`${API_ROUTES.TOKEN_DETAILS}/${encodeURIComponent(mint)}`);
  } catch (e) {
    console.error('[SolscanDetails] Failed:', e);
    return null;
  }
}
