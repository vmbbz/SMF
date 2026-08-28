import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  GAMEPLAY_PAUSE_EVENT,
  WALLET_ACTION_PAUSE_EVENT,
  dispatchGameplayPause,
  getGameplayPauseCopy,
  isManualPauseOnly,
} from '../src/gameplay-pause.js';
import {
  closeEconomyPage,
  loadEconomyPolicy,
  openEconomyPage,
} from '../src/economy-page.js';
import {
  closeArenaStatusPage,
  loadArenaStatus,
  openArenaStatusPage,
} from '../src/arena-status-page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
const gameSource = readFileSync(resolve(__dirname, '../src/game.js'), 'utf-8');
const walletSource = readFileSync(resolve(__dirname, '../wallet-connect.js'), 'utf-8');

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail || {};
  }
}

class TestClassList {
  constructor(...names) {
    this.names = new Set(names);
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

function createElement(...classNames) {
  return {
    classList: new TestClassList(...classNames),
    textContent: '',
    disabled: false,
    focus() {},
    querySelector() {
      return { scrollTo() {} };
    },
  };
}

function installBrowserHarness(pageId, backButtonId, closeButtonId) {
  const events = [];
  const fetchResponse = {
    ok: true,
    status: 200,
    async json() {
      return {
        runtime: {},
        persistence: { durable: true, retentionScope: 'test' },
        arenaDirector: { recentSelections: [] },
        matches: {},
        engagement: {},
        boundaries: {},
      };
    },
  };
  const fetchStub = async () => fetchResponse;
  const elements = new Map([
    ['game', createElement('active')],
    [pageId, createElement('hidden')],
    [backButtonId, createElement()],
    [closeButtonId, createElement()],
    ['btn-arena-status-refresh', createElement()],
  ]);

  globalThis.window = {
    CustomEvent: TestCustomEvent,
    dispatchEvent(event) {
      events.push({ type: event.type, detail: { ...event.detail } });
      return true;
    },
    fetch: fetchStub,
    location: { pathname: '/' },
    history: { replaceState() {} },
  };
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  globalThis.fetch = fetchStub;
  globalThis.CustomEvent = TestCustomEvent;

  window.openHelpModal = () => dispatchGameplayPause(true, 'help_modal');
  window.closeHelpModal = () => dispatchGameplayPause(false, 'help_modal');

  return { events, elements };
}

function activeReasonSnapshots(events) {
  const reasons = new Set();
  return events.map(({ detail }) => {
    if (detail.paused) reasons.add(detail.reason);
    else reasons.delete(detail.reason);
    return [...reasons];
  });
}

const originalGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  fetch: globalThis.fetch,
  CustomEvent: globalThis.CustomEvent,
};

afterEach(() => {
  globalThis.window = originalGlobals.window;
  globalThis.document = originalGlobals.document;
  globalThis.fetch = originalGlobals.fetch;
  globalThis.CustomEvent = originalGlobals.CustomEvent;
});

describe('Gameplay pause ownership', () => {
  test('keeps Help → Economy → Help paused until Help actually closes', async () => {
    const { events } = installBrowserHarness('economy-page', 'btn-economy-back', 'btn-economy-close');

    window.openHelpModal();
    expect(openEconomyPage({ fromHelp: true })).toBe(true);
    await loadEconomyPolicy();
    expect(closeEconomyPage()).toBe(true);
    window.closeHelpModal();

    expect(events.map(event => [event.type, event.detail.paused, event.detail.reason])).toEqual([
      [GAMEPLAY_PAUSE_EVENT, true, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, true, 'economy_page'],
      [GAMEPLAY_PAUSE_EVENT, false, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, true, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, false, 'economy_page'],
      [GAMEPLAY_PAUSE_EVENT, false, 'help_modal'],
    ]);
    const snapshots = activeReasonSnapshots(events);
    expect(snapshots.slice(0, -1).every(reasons => reasons.length > 0)).toBe(true);
    expect(snapshots.at(-1)).toEqual([]);
  });

  test('keeps Help → Arena Status → Help paused until Help actually closes', async () => {
    const { events } = installBrowserHarness('arena-status-page', 'btn-arena-status-back', 'btn-arena-status-close');

    window.openHelpModal();
    expect(openArenaStatusPage({ fromHelp: true })).toBe(true);
    await loadArenaStatus();
    expect(closeArenaStatusPage()).toBe(true);
    window.closeHelpModal();

    expect(events.map(event => [event.type, event.detail.paused, event.detail.reason])).toEqual([
      [GAMEPLAY_PAUSE_EVENT, true, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, true, 'arena_status_page'],
      [GAMEPLAY_PAUSE_EVENT, false, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, true, 'help_modal'],
      [GAMEPLAY_PAUSE_EVENT, false, 'arena_status_page'],
      [GAMEPLAY_PAUSE_EVENT, false, 'help_modal'],
    ]);
    const snapshots = activeReasonSnapshots(events);
    expect(snapshots.slice(0, -1).every(reasons => reasons.length > 0)).toBe(true);
    expect(snapshots.at(-1)).toEqual([]);
  });

  test('uses truthful copy for informational overlays', () => {
    expect(getGameplayPauseCopy('economy_page').status).toBe('CLOSE REWARDS TO RESUME');
    expect(getGameplayPauseCopy('arena_status_page').detail).toContain('Arena Status');
    expect(getGameplayPauseCopy('economy_page').detail).not.toMatch(/wallet/i);
    expect(getGameplayPauseCopy('arena_status_page').detail).not.toMatch(/wallet/i);
    expect(getGameplayPauseCopy('manual_pause')).toEqual({
      status: 'FIGHT HELD',
      detail: 'Tap RESUME in the live-market bar to continue.',
    });
  });

  test('offers RESUME only when manual pause is the sole owner', () => {
    expect(isManualPauseOnly(new Set(['manual_pause']))).toBe(true);
    expect(isManualPauseOnly(new Set(['manual_pause', 'help_modal']))).toBe(false);
    expect(isManualPauseOnly(new Set(['help_modal']))).toBe(false);
    expect(isManualPauseOnly(undefined)).toBe(false);
  });

  test('keeps wallet pauses on their dedicated compatibility channel', () => {
    expect(GAMEPLAY_PAUSE_EVENT).not.toBe(WALLET_ACTION_PAUSE_EVENT);
    expect(gameSource).toContain('window.addEventListener(GAMEPLAY_PAUSE_EVENT');
    expect(gameSource).toContain('window.addEventListener(WALLET_ACTION_PAUSE_EVENT');
    expect(walletSource).toContain(`new CustomEvent('${WALLET_ACTION_PAUSE_EVENT}'`);
  });

  test('Help always releases the pause reason it owns', () => {
    expect(indexSource).toContain(`new CustomEvent('${GAMEPLAY_PAUSE_EVENT}'`);
    expect(indexSource).not.toContain('options.resumeFight');
    expect(indexSource).not.toContain('closeHelpModal({ resumeFight: false })');
  });

  test('Game destruction unregisters pause/profile listeners and cancels its RAF', () => {
    expect(gameSource).toContain('destroy()');
    expect(gameSource).toContain('cancelAnimationFrame(this._animationFrameId)');
    expect(gameSource).toContain('window.removeEventListener(GAMEPLAY_PAUSE_EVENT, this._applyGameplayPause)');
    expect(gameSource).toContain('window.removeEventListener(WALLET_ACTION_PAUSE_EVENT, this._applyGameplayPause)');
    expect(gameSource).toContain("window.removeEventListener('smf_profile_updated', this._profileUpdateHandler)");
  });
});
