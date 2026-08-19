import { calculateFighterPower } from './token-power-scaling.js';
import { API_ROUTES, fetchApiJson } from './api-endpoints.js';

// Fetch Base chain trending tokens from backend (backed by DexScreener Base pairs)
export async function getBaseTrending(count = 12) {
  try {
    console.log(`[BaseTrending] Fetching ${count} trending Base tokens...`);
    const tokens = await fetchApiJson([
      `${API_ROUTES.TRENDING}?count=${count}`,
      `${API_ROUTES.LEGACY_TRENDING}?count=${count}`,
    ]);
    if (!Array.isArray(tokens)) return [];
    return tokens.map(t => {
      return { ...t, platform: 'base', power: calculateFighterPower(t) };
    });
  } catch (e) {
    console.error('[BaseTrending] Failed:', e);
    return [];
  }
}

// Backward-compat alias
export const getSolscanTrending = getBaseTrending;

// Fetch Base 'graduated' tokens — Base pairs that crossed the $10k liquidity threshold
export async function getBaseGraduates(count = 8) {
  try {
    const tokens = await fetchApiJson([
      `${API_ROUTES.GRADUATES}?count=${count}`,
      `${API_ROUTES.LEGACY_GRADUATES}?count=${count}`,
    ]);
    if (!Array.isArray(tokens)) return [];
    return tokens.map(t => {
      return { ...t, platform: 'base', power: calculateFighterPower(t) };
    });
  } catch (e) {
    console.error('[BaseGraduates] Failed:', e);
    return [];
  }
}

// Backward-compat alias
export const getPumpFunGraduates = getBaseGraduates;

// Fetch token detail from backend (backed by DexScreener, chain-agnostic)
export async function getTokenDetails(mint) {
  try {
    return await fetchApiJson(`${API_ROUTES.TOKEN_DETAILS}/${encodeURIComponent(mint)}`);
  } catch (e) {
    console.error('[TokenDetails] Failed:', e);
    return null;
  }
}

// Backward-compat alias
export const getSolscanDetails = getTokenDetails;
