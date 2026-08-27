import { API_ROUTES, fetchApiJson } from './api-endpoints.js';

const REASON_LABELS = Object.freeze({
  graduated_discovery: 'NEW GRAD',
  exceptional_24h_volume: 'HUGE VOLUME',
  active_24h_volume: 'ACTIVE VOLUME',
  strong_upward_momentum: 'PUMPING',
  strong_selling_pressure: 'SELL-OFF',
  high_volatility: 'HIGH VOLATILITY',
  deep_liquidity: 'DEEP LIQUIDITY',
  thin_liquidity_risk: 'THIN LIQUIDITY',
  missing_volume_data: 'LIMITED DATA',
  balanced_market_activity: 'BALANCED MARKET',
});

export async function fetchArenaDirectorDecision(currentMint = '', count = 12) {
  const params = new URLSearchParams();
  const mint = String(currentMint || '').trim();
  if (mint) params.set('current_mint', mint);
  params.set('count', String(Math.max(1, Math.min(Number(count) || 12, 24))));

  const decision = await fetchApiJson(`${API_ROUTES.ARENA_DIRECTOR_NEXT}?${params.toString()}`);
  if (!decision || typeof decision !== 'object') {
    throw new Error('Arena Director returned an invalid response');
  }
  return decision;
}

export function announceArenaDirectorDecision(decision) {
  if (!decision?.opponent || typeof window === 'undefined') return;

  window.latestArenaDirectorDecision = decision;
  const reasons = decision.opponent?.arenaDirector?.reasons || [];
  const reasonLabel = REASON_LABELS[reasons[0]] || 'LIVE MARKET PICK';
  const symbol = String(decision.opponent.symbol || 'MEME').toUpperCase();
  const message = `ARENA DIRECTOR PICK: $${symbol} - ${reasonLabel}`;

  const status = document.getElementById('status');
  if (status) status.textContent = message;

  const activeGame = window.currentGame || window.game || window._game;
  if (activeGame?.showBoostMessage) {
    activeGame.showBoostMessage(message, 'runner');
  }

  window.dispatchEvent(new CustomEvent('smf_arena_director_decision', {
    detail: decision,
  }));
}
