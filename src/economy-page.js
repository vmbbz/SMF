const POLICY_ENDPOINT = '/api/economy/policy';

let openedFromHelp = false;
let policyLoadPromise = null;

function getElement(id) {
  return document.getElementById(id);
}

function fightIsActive() {
  return getElement('game')?.classList.contains('active') === true;
}

function setFightPause(paused, reason) {
  window.dispatchEvent(new CustomEvent('smf_wallet_action_pause', {
    detail: { paused, reason },
  }));
}

function renderRuntimePolicy(policy) {
  const status = getElement('economy-runtime-status');
  const detail = getElement('economy-runtime-detail');
  if (!status || !detail || !policy?.runtime) return;

  const runtime = policy.runtime;
  const anyValuePathLive = runtime.boostPurchasesEnabled
    || runtime.creatorFeeRoutingEnabled
    || runtime.ansemActionsEnabled
    || runtime.rewardEpochsEnabled
    || runtime.rewardClaimsEnabled;

  if (anyValuePathLive) {
    status.textContent = 'PARTIAL ROLLOUT · CHECK LIVE GATES BELOW';
  } else {
    status.textContent = 'DESIGN APPROVED · TOKEN FLOWS NOT LIVE';
  }

  const disabledReason = String(runtime.boostPurchasesDisabledReason || '').trim();
  detail.textContent = disabledReason
    ? `Boost purchases: ${disabledReason} Creator-fee routing, $ANSEM actions, reward epochs, and token claims remain disabled.`
    : 'Runtime policy loaded. Value-moving features remain gated independently.';
}

export async function loadEconomyPolicy(fetchImpl = window.fetch) {
  if (policyLoadPromise) return policyLoadPromise;

  policyLoadPromise = (async () => {
    try {
      const response = await fetchImpl(POLICY_ENDPOINT, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Policy request failed with ${response.status}`);
      const policy = await response.json();
      renderRuntimePolicy(policy);
      return policy;
    } catch (error) {
      console.warn('[economy] Runtime policy unavailable:', error);
      const detail = getElement('economy-runtime-detail');
      if (detail) {
        detail.textContent = 'Live policy status could not be loaded. Token purchases and rewards must be treated as disabled.';
      }
      return null;
    }
  })();

  return policyLoadPromise;
}

export function openEconomyPage({ fromHelp = false } = {}) {
  const page = getElement('economy-page');
  if (!page) return false;

  openedFromHelp = fromHelp;
  const backButton = getElement('btn-economy-back');
  if (backButton) backButton.textContent = fromHelp ? 'BACK TO GUIDE' : 'BACK TO GAME';
  if (fromHelp && typeof window.closeHelpModal === 'function') {
    window.closeHelpModal({ resumeFight: false });
  }

  if (fightIsActive()) setFightPause(true, 'economy_page');
  page.classList.remove('hidden');
  page.querySelector('.economy-page-scroll')?.scrollTo({ top: 0, behavior: 'auto' });
  getElement('btn-economy-close')?.focus();
  loadEconomyPolicy();
  return true;
}

export function closeEconomyPage() {
  const page = getElement('economy-page');
  if (!page || page.classList.contains('hidden')) return false;

  page.classList.add('hidden');

  if (openedFromHelp && typeof window.openHelpModal === 'function') {
    openedFromHelp = false;
    window.openHelpModal();
    return true;
  }

  if (fightIsActive()) setFightPause(false, 'economy_page');
  if (window.location.pathname === '/economy' || window.location.pathname === '/economy/') {
    window.history.replaceState({}, '', '/');
  }
  openedFromHelp = false;
  return true;
}

export function initializeEconomyPage() {
  getElement('btn-help-economy')?.addEventListener('click', () => openEconomyPage({ fromHelp: true }));
  getElement('btn-economy-close')?.addEventListener('click', closeEconomyPage);
  getElement('btn-economy-back')?.addEventListener('click', closeEconomyPage);

  window.openEconomyPage = openEconomyPage;
  window.closeEconomyPage = closeEconomyPage;
}
