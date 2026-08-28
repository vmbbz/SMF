/**
 * Tests for US-005: Step indicators and instructions on all screens.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Minimal DOM stub for ui.js import
globalThis.document = {
  documentElement: {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => {
    const el = { tagName: tag, textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {} };
    return el;
  },
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const { INPUT_MODES } = await import('../src/ui.js');

// Load index.html for static content assertions
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
const mainJs = readFileSync(resolve(__dirname, '../src/main.js'), 'utf-8');
const gameJs = readFileSync(resolve(__dirname, '../src/game.js'), 'utf-8');
const trendingStripJs = readFileSync(resolve(__dirname, '../src/trending-strip.js'), 'utf-8');

describe('Landing page', () => {
  test('has tagline explaining game modes', () => {
    expect(html).toContain('Watch live Solana tokens fight autonomously, or enter wallet-verified human competition.');
  });

  test('tagline has proper CSS class', () => {
    expect(html).toContain('landing-tagline');
  });
});

describe('Mobile readability and practice contract', () => {
  test('obsolete launch timeline is removed from Help', () => {
    expect(html).not.toContain('Timeline: Past 7 Days To Launch');
  });

  test('primary token modes use compact labels in one layout group', () => {
    expect(html).toContain('class="landing-primary-modes"');
    expect(html).toContain('>TRENDING <span');
    expect(html).toContain('>ENDLESS <span');
  });

  test('Token Exhibition is explicitly spectator-only and symmetric', () => {
    expect(html).not.toContain('id="btn-char-fight"');
    expect(html).toContain('id="btn-char-watch" disabled>WATCH TOKEN FIGHT');
    expect(html).toContain('id="btn-exhibition-reroll" disabled>RANDOMIZE MATCHUP');
    expect(html).toContain('id="token-exhibition-p1"');
    expect(html).toContain('id="token-exhibition-p2"');
    expect(html).toContain('no player controls, paid boosts, ELO, leaderboard credit, or token rewards');
    expect(mainJs).toContain('localOnly: true');
    expect(mainJs).toContain('game.p1.applyMarketStats(p1Token, p1Power)');
    expect(mainJs).toContain('game.p2.applyMarketStats(p2Token, p2Power)');
    expect(mainJs).toContain("mobileControls.style.display = 'none'");
    expect(html).toMatch(/window\._showMobileControls\s*=\s*\(\)\s*=>\s*\{\s*if \(window\.isTokenExhibition\)/);
    expect(mainJs).toContain("for (const id of ['mic-toggle-btn'])");
    expect(mainJs).toContain("control.classList.toggle('token-exhibition-control-hidden', exhibitionActive)");
    expect(html).toContain('#hud-widgets button.token-exhibition-control-hidden');
    expect(mainJs).toContain("control.style.setProperty('display', 'none', 'important')");
    expect(mainJs).toContain("[VoiceToggle] Token Exhibition is spectator-only");
    expect(mainJs).toContain("window.isTokenExhibition === true");
    expect(mainJs).toContain("activeGame?.authoritativeMultiplayer === true");
    expect(gameJs).toContain('this.p2.tokenData && !this.tokenExhibition');
    expect(gameJs).toMatch(/!this\.tokenExhibition\s*&&\s*p1Pressed\.has\(Actions\.HADOUKEN\)/);
  });

  test('uses a non-blocking local boost layer instead of the developer modal', () => {
    expect(html).not.toContain('id="btn-boost-hack"');
    expect(html).not.toContain('id="boost-menu"');
    expect(mainJs).not.toContain('triggerSimulatedBoost');
    expect(mainJs).toContain('window.triggerControllerBoost = function(tierId)');
    expect(mainJs).toContain("window.liveBoostSystem.triggerTier(tierId, tokenData, 'p1')");
    expect(html).toContain('class="control-label">SP</span>');
    expect(html).toContain('.attack-zone.boost-layer-active');
  });

  test('documents Help, Pause, Resume, and destructive Home semantics', () => {
    expect(html).toContain('Before a fight, the live-market center button opens HELP.');
    expect(html).toContain('During a live round it becomes PAUSE; while manually paused it becomes RESUME.');
    expect(html).toContain('HOME ends and destroys the current fight');
    expect(mainJs).toContain('function disposeCurrentGame({ clearCanvas = true } = {})');
    expect(mainJs).toContain("setMarketStripSurface('fight')");
    expect(mainJs).toContain("setMarketStripSurface('landing')");
    expect(mainJs).toContain('const voiceAdapterToCleanup = window.activeVoiceAdapter || null');
    expect(mainJs).toContain('await voiceAdapterToCleanup.detach()');
    expect(mainJs).toContain('window._cancelEndlessCountdown?.()');
    expect(mainJs).toContain('Object.assign(window.endlessSession, { active: false, round: 0, wins: 0, losses: 0, streak: 0 })');
    expect(trendingStripJs).toContain('data-game-context-action');
    expect(trendingStripJs).toContain('class="strip-context-label">HELP</span>');
  });

  test('lowers the compact mobile landing panel by 50 pixels', () => {
    expect(html).toContain('top: calc(48% + 50px) !important;');
  });
});

describe('Multiplayer screen', () => {
  test('explains the casual-versus-ranked boundary', () => {
    expect(html).toContain('Private rooms are casual. Public matchmaking is the only ranked path.');
    expect(html).toContain('Fight a randomly matched online human.');
    expect(html).toContain('AI PRACTICE WHILE WAITING (DOES NOT COUNT)');
  });

  test('step indicator has proper CSS class', () => {
    expect(html).toContain('mp-steps');
  });
});

describe('Room creation screen', () => {
  test('has instruction text about sharing code', () => {
    expect(html).toContain('Share this code with your opponent');
  });

  test('has copy button', () => {
    expect(html).toContain('btn-copy-url');
    expect(html).toContain('COPY');
  });
});

describe('Room join screen', () => {
  test('has placeholder with example format', () => {
    expect(html).toContain('placeholder="e.g. red-tiger-paw"');
  });
});

describe('Controller selection descriptions', () => {
  test('keyboard mode has descriptive label', () => {
    const kbd = INPUT_MODES.find(m => m.id === 'controller');
    expect(kbd.desc).toMatch(/keyboard/i);
    expect(kbd.desc).toMatch(/arrow keys|Z\/X/i);
  });

  test('voice mode has descriptive label', () => {
    const voice = INPUT_MODES.find(m => m.id === 'voice');
    expect(voice.desc).toMatch(/voice/i);
    expect(voice.desc).toMatch(/mic/i);
  });

  test('phone mode has descriptive label', () => {
    const phone = INPUT_MODES.find(m => m.id === 'phone');
    expect(phone.desc).toMatch(/phone/i);
    expect(phone.desc).toMatch(/call in/i);
  });

  test('all modes have a desc field', () => {
    for (const mode of INPUT_MODES) {
      expect(mode.desc).toBeDefined();
      expect(typeof mode.desc).toBe('string');
      expect(mode.desc.length).toBeGreaterThan(0);
    }
  });
});

describe('Matchmaking queue text', () => {
  test('matchmaking searching element exists in HTML', () => {
    expect(html).toContain('id="mm-searching-text"');
    expect(html).toContain('Searching for opponent...');
  });
});

describe('Waiting for opponent text', () => {
  test('room controller screen has status element', () => {
    expect(html).toContain('id="room-ctrl-status"');
  });
});
