import { calculateFighterPower } from './token-power-scaling.js';
import { API_ROUTES, apiUrl, tokenDetailsPath } from './api-endpoints.js';

async function fetchJsonWithFallback(primaryPath, fallbackPath) {
  const primaryUrl = apiUrl(primaryPath);
  const primaryRes = await fetch(primaryUrl);
  if (primaryRes.ok) {
    return await primaryRes.json();
  }

  if (!fallbackPath) {
    throw new Error(`HTTP ${primaryRes.status} for ${primaryUrl}`);
  }

  const fallbackUrl = apiUrl(fallbackPath);
  const fallbackRes = await fetch(fallbackUrl);
  if (!fallbackRes.ok) {
    throw new Error(`HTTP ${primaryRes.status}/${fallbackRes.status} for ${primaryUrl} -> ${fallbackUrl}`);
  }
  return await fallbackRes.json();
}

export async function getSolscanTrending(count = 12) {
  try {
    console.log(`[SolscanTrending] Fetching ${count} trending tokens...`);
    const tokens = await fetchJsonWithFallback(
      `${API_ROUTES.TRENDING}?count=${count}`,
      `${API_ROUTES.LEGACY_TRENDING}?count=${count}`
    );
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
    const tokens = await fetchJsonWithFallback(
      `${API_ROUTES.GRADUATES}?count=${count}`,
      `${API_ROUTES.LEGACY_GRADUATES}?count=${count}`
    );
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
    const res = await fetch(tokenDetailsPath(mint));
    return await res.json();
  } catch (e) {
    console.error('[SolscanDetails] Failed:', e);
    return null;
  }
}
