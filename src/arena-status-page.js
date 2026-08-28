import { API_ROUTES, fetchApiJson } from './api-endpoints.js';

let openedFromHelp = false;
let statusLoadPromise = null;

function getElement(id) {
  return document.getElementById(id);
}

function fightIsActive() {
  return getElement('game')?.classList.contains('active') === true;
}

function setFightPause(paused) {
  window.dispatchEvent(new CustomEvent('smf_wallet_action_pause', {
    detail: { paused, reason: 'arena_status_page' },
  }));
}

function setText(id, value) {
  const element = getElement(id);
  if (element) element.textContent = value;
}

export function formatArenaCount(value) {
  if (value === null || value === undefined || value === '') return 'NOT AVAILABLE';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 'NOT AVAILABLE';
  return Math.trunc(parsed).toLocaleString('en-US');
}

export function formatArenaTime(value) {
  if (!value) return 'NOT RECORDED';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'NOT RECORDED';
  return parsed.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function shortIdentifier(value, edge = 5) {
  const text = String(value || '');
  if (text.length <= edge * 2 + 3) return text;
  return `${text.slice(0, edge)}…${text.slice(-edge)}`;
}

function setPersistenceStatus(text, state = 'loading') {
  const badge = getElement('arena-status-persistence');
  if (!badge) return;
  badge.textContent = text;
  badge.classList.remove('is-durable', 'is-unavailable');
  if (state === 'durable') badge.classList.add('is-durable');
  if (state === 'unavailable') badge.classList.add('is-unavailable');
}

function renderRecentSelections(selections) {
  const container = getElement('arena-recent-selections');
  if (!container) return;
  container.replaceChildren();

  if (!Array.isArray(selections) || selections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'arena-status-empty';
    empty.textContent = 'No recorded Director selections are available in this evidence window.';
    container.append(empty);
    return;
  }

  for (const selection of selections) {
    const row = document.createElement('article');
    row.className = 'arena-selection';

    const symbol = document.createElement('div');
    symbol.className = 'arena-selection-symbol';
    symbol.textContent = `$${String(selection?.symbol || 'MEME').toUpperCase()}`;

    const detail = document.createElement('div');
    detail.className = 'arena-selection-detail';
    const score = Number(selection?.score);
    const scoreText = Number.isFinite(score) ? score.toFixed(2) : 'N/A';
    detail.append(document.createTextNode(`Director score ${scoreText} · ${formatArenaTime(selection?.generatedAt)} · `));
    if (selection?.mint) {
      const mintLink = document.createElement('a');
      mintLink.href = `https://solscan.io/token/${encodeURIComponent(selection.mint)}`;
      mintLink.target = '_blank';
      mintLink.rel = 'noopener noreferrer';
      mintLink.textContent = shortIdentifier(selection.mint);
      mintLink.setAttribute('aria-label', `Open ${selection.symbol || 'token'} mint on Solscan`);
      detail.append(mintLink);
    } else {
      detail.append(document.createTextNode('mint unavailable'));
    }

    const state = String(selection?.marketDataState || 'unverified').toLowerCase();
    const tag = document.createElement('span');
    tag.className = `arena-evidence-tag${state === 'fresh' ? ' fresh' : ''}`;
    tag.textContent = state.replaceAll('_', ' ').toUpperCase();

    row.append(symbol, detail, tag);
    container.append(row);
  }
}

function renderTransactions(onchain) {
  const container = getElement('arena-recent-transactions');
  if (!container) return;
  container.replaceChildren();

  const count = onchain?.verifiedTransactions;
  if (count === null || count === undefined) {
    setText('arena-onchain-count', 'NOT AVAILABLE');
    setText('arena-onchain-status', 'The durable verification ledger is unavailable. No zero-volume claim is inferred.');
    const empty = document.createElement('div');
    empty.className = 'arena-status-empty';
    empty.textContent = 'Transaction evidence cannot be shown without the durable PostgreSQL ledger.';
    container.append(empty);
    return;
  }

  setText('arena-onchain-count', `${formatArenaCount(count)} VERIFIED`);
  setText(
    'arena-onchain-status',
    count > 0
      ? 'Each listed signature passed the backend Solana boost-burn verification path.'
      : 'The durable verification ledger is connected and currently contains zero verified transactions.'
  );

  const transactions = Array.isArray(onchain?.recentTransactions) ? onchain.recentTransactions : [];
  if (transactions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'arena-status-empty';
    empty.textContent = 'No verified Solana transaction has been recorded.';
    container.append(empty);
    return;
  }

  for (const transaction of transactions) {
    const item = document.createElement('div');
    item.className = 'arena-transaction';
    const link = document.createElement('a');
    link.href = `https://solscan.io/tx/${encodeURIComponent(String(transaction?.signature || ''))}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = shortIdentifier(transaction?.signature, 7) || 'Open transaction';
    item.append(link);
    item.append(document.createTextNode(` · slot ${transaction?.slot ?? 'N/A'} · ${formatArenaTime(transaction?.verifiedAt)}`));
    container.append(item);
  }
}

function renderBoundaries(boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) return;
  const list = getElement('arena-status-boundaries');
  if (!list) return;
  list.replaceChildren();
  for (const boundary of boundaries) {
    const item = document.createElement('li');
    item.textContent = String(boundary);
    list.append(item);
  }
}

function setStreamStatus(text, fresh = false) {
  const badge = getElement('arena-stream-status');
  if (!badge) return;
  badge.textContent = text;
  badge.classList.toggle('fresh', fresh);
}

function renderMarketStream(stream) {
  if (!stream) {
    setStreamStatus('STREAM EVIDENCE UNAVAILABLE');
    setText('arena-stream-last-update', 'The backend did not return a stream-health record.');
    for (const id of [
      'arena-stream-freshness',
      'arena-stream-slot',
      'arena-stream-candidates',
      'arena-stream-observations',
    ]) setText(id, 'NOT AVAILABLE');
    setText('arena-stream-cursor', 'Replay cursor evidence is not available.');
    setText('arena-stream-reliability', 'Reconnect and queue evidence is not available.');
    return;
  }

  const status = String(stream.status || 'unavailable').replaceAll('_', ' ').toUpperCase();
  const isFresh = stream.freshness === 'fresh' && ['live', 'degraded'].includes(stream.status);
  setStreamStatus(status, isFresh);
  setText('arena-stream-freshness', String(stream.freshness || 'unavailable').toUpperCase());
  setText('arena-stream-slot', formatArenaCount(stream.lastSlot));
  setText('arena-stream-candidates', formatArenaCount(stream.subscription?.candidateCount));
  setText('arena-stream-observations', formatArenaCount(stream.activity?.observedConfirmedTransactions));
  setText(
    'arena-stream-last-update',
    stream.lastUpdateAt
      ? `Latest transport update: ${formatArenaTime(stream.lastUpdateAt)} · ${stream.ageSeconds ?? 'N/A'}s old.`
      : 'No Alchemy transport update has been recorded.'
  );

  const replay = stream.replay || {};
  const cursorLabel = replay.cursorDurable === true ? 'durable PostgreSQL cursor' : 'process-memory cursor';
  setText(
    'arena-stream-cursor',
    `${cursorLabel} · saved slot ${formatArenaCount(replay.cursorSlot)} · requested replay slot ${formatArenaCount(replay.requestedFromSlot)} · ${String(replay.reason || 'not available').replaceAll('_', ' ')}.`
  );

  const reliability = stream.reliability || {};
  setText(
    'arena-stream-reliability',
    `Reconnects ${formatArenaCount(reliability.reconnects)} · dropped updates ${formatArenaCount(reliability.droppedUpdates)} · last sanitized error ${reliability.lastErrorCode || 'NONE'}.`
  );
}

export function renderArenaStatus(status) {
  const persistence = status?.persistence || {};
  const director = status?.arenaDirector || {};
  const matches = status?.matches || {};
  const engagement = status?.engagement || {};

  if (persistence.durable === true) {
    setPersistenceStatus('DURABLE POSTGRES EVIDENCE', 'durable');
  } else {
    setPersistenceStatus('PROCESS MEMORY · RESETS ON RESTART');
  }
  setText(
    'arena-status-scope',
    `${String(persistence.retentionScope || 'Evidence retention scope unavailable')}. `
      + 'Counts describe backend records only; they are not revenue, reward, or user claims.'
  );

  setText('arena-count-director', formatArenaCount(director.decisionsReturned));
  setText('arena-count-matches', formatArenaCount(matches.authoritativeMultiplayerRounds));
  setText('arena-count-tokens', formatArenaCount(director.uniqueTokensFeatured));
  setText('arena-count-shares', formatArenaCount(engagement.shareCardsGenerated));
  setText('arena-market-fresh', formatArenaCount(director.freshMarketSelections));

  setText('arena-match-ranked', formatArenaCount(matches.rankedRounds));
  setText('arena-match-skill', formatArenaCount(matches.skillRankedRounds));
  setText('arena-match-boosted', formatArenaCount(matches.boostedRankedRounds));
  setText('arena-match-casual', formatArenaCount(matches.privateCasualRounds));
  setText('arena-match-boost-charges', formatArenaCount(matches.paidBoostChargesInRecordedRounds));

  setText('arena-wallet-sessions', formatArenaCount(engagement.walletSessionsCreated));
  setText('arena-wallet-active', formatArenaCount(engagement.activeWalletSessions));
  setText('arena-wallet-unique', formatArenaCount(engagement.uniqueAuthenticatedWallets));

  renderRecentSelections(director.recentSelections);
  renderMarketStream(status?.marketStream);
  renderTransactions(status?.onchain);
  renderBoundaries(status?.boundaries);
  setText('arena-status-generated-at', formatArenaTime(status?.generatedAt));
}

function renderUnavailable(error) {
  console.warn('[arena-status] Evidence endpoint unavailable:', error);
  setPersistenceStatus('EVIDENCE ENDPOINT UNAVAILABLE', 'unavailable');
  setText('arena-status-scope', 'The evidence endpoint could not be loaded. No activity count, wallet count, or onchain zero is inferred.');
  for (const id of [
    'arena-count-director',
    'arena-count-matches',
    'arena-count-tokens',
    'arena-count-shares',
    'arena-market-fresh',
    'arena-match-ranked',
    'arena-match-skill',
    'arena-match-boosted',
    'arena-match-casual',
    'arena-match-boost-charges',
    'arena-wallet-sessions',
    'arena-wallet-active',
    'arena-wallet-unique',
  ]) setText(id, 'NOT AVAILABLE');
  renderRecentSelections([]);
  renderMarketStream(null);
  renderTransactions(null);
  setText('arena-status-generated-at', 'LOAD FAILED');
}

async function defaultStatusLoader() {
  return fetchApiJson(API_ROUTES.ARENA_STATUS);
}

export async function loadArenaStatus(loader = defaultStatusLoader, { force = false } = {}) {
  if (statusLoadPromise && !force) return statusLoadPromise;

  setPersistenceStatus('LOADING EVIDENCE');
  const refreshButton = getElement('btn-arena-status-refresh');
  if (refreshButton) refreshButton.disabled = true;

  statusLoadPromise = (async () => {
    try {
      const status = await loader();
      renderArenaStatus(status);
      return status;
    } catch (error) {
      renderUnavailable(error);
      return null;
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  })();

  return statusLoadPromise;
}

export function openArenaStatusPage({ fromHelp = false } = {}) {
  const page = getElement('arena-status-page');
  if (!page) return false;

  openedFromHelp = fromHelp;
  const backButton = getElement('btn-arena-status-back');
  if (backButton) backButton.textContent = fromHelp ? 'BACK TO GUIDE' : 'BACK TO GAME';
  if (fromHelp && typeof window.closeHelpModal === 'function') {
    window.closeHelpModal({ resumeFight: false });
  }

  if (fightIsActive()) setFightPause(true);
  page.classList.remove('hidden');
  page.querySelector('.economy-page-scroll')?.scrollTo({ top: 0, behavior: 'auto' });
  getElement('btn-arena-status-close')?.focus();
  void loadArenaStatus(defaultStatusLoader, { force: true });
  return true;
}

export function closeArenaStatusPage() {
  const page = getElement('arena-status-page');
  if (!page || page.classList.contains('hidden')) return false;

  page.classList.add('hidden');
  if (openedFromHelp && typeof window.openHelpModal === 'function') {
    openedFromHelp = false;
    window.openHelpModal();
    return true;
  }

  if (fightIsActive()) setFightPause(false);
  if (window.location.pathname === '/arena' || window.location.pathname === '/arena/') {
    window.history.replaceState({}, '', '/');
  }
  openedFromHelp = false;
  return true;
}

export function initializeArenaStatusPage() {
  getElement('btn-help-arena-status')?.addEventListener('click', () => openArenaStatusPage({ fromHelp: true }));
  getElement('btn-arena-status-close')?.addEventListener('click', closeArenaStatusPage);
  getElement('btn-arena-status-back')?.addEventListener('click', closeArenaStatusPage);
  getElement('btn-arena-status-refresh')?.addEventListener('click', () => {
    void loadArenaStatus(defaultStatusLoader, { force: true });
  });

  window.openArenaStatusPage = openArenaStatusPage;
  window.closeArenaStatusPage = closeArenaStatusPage;
}
