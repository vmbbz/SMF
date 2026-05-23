import { InputManager, KeyboardAdapter, P1_KEYBOARD_MAP, P2_KEYBOARD_MAP } from './input.js';
import { Game } from './game.js';
import { Fighter } from './fighter.js';
import { SFX } from './sfx.js';
import { DG, INPUT_MODES, LLM_PROVIDERS, updateModeSelection, updateControlsInfo, getPlayerLabel } from './ui.js';
import { VoiceAdapter } from './voice.js';
import { PhoneAdapter } from './phone.js';
import { SimulatedAdapter } from './simulated.js';
import { LLMAdapter } from './llm.js';
import { parseRoute } from './router.js';
import { isAuthConfigured, login, logout, handleCallback, checkAuth, isLoggedIn, getUser, updateUsername } from './auth.js';
import { PeerConnection, RemoteInputAdapter } from './webrtc.js';
import { PredictionManager } from './prediction.js';
import { generatePersonality } from './token-utils.js';

window.generatePersonality = generatePersonality;

// Native Capacitor Initialization (Locked Landscape & Full-screen Status Bar)
if (window.Capacitor) {
  try {
    const plugins = window.Capacitor.Plugins;
    if (plugins) {
      // Hide status bar programmatically for full-screen immersive play
      if (plugins.StatusBar && typeof plugins.StatusBar.hide === 'function') {
        plugins.StatusBar.hide().catch(err => console.warn('[Native] StatusBar hide failed:', err));
      }
      // Lock orientation to landscape-primary programmatically
      if (plugins.ScreenOrientation && typeof plugins.ScreenOrientation.lock === 'function') {
        plugins.ScreenOrientation.lock({ orientation: 'landscape' }).catch(err => console.warn('[Native] ScreenOrientation lock failed:', err));
      }
    }
  } catch (e) {
    console.warn('[Native] Failed to initialize mobile premium views:', e);
  }
}


const canvas = document.getElementById('game');
const screens = {
  landing: document.getElementById('landing'),
  multiplayer: document.getElementById('multiplayer-menu'),
  joinRoom: document.getElementById('join-room'),
  roomLobby: document.getElementById('room-lobby'),
  roomController: document.getElementById('room-controller'),
  matchmaking: document.getElementById('matchmaking'),
  leaderboard: document.getElementById('leaderboard'),
  matchResults: document.getElementById('match-results'),
  characterSelect: document.getElementById('character-select'),
  onboarding: document.getElementById('onboarding'),
};

// Restored Name Extraction Engine (Commit 90323e43b1)
function extractNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    const pathname = new URL(url).pathname;
    const domain = hostname.replace('www.', '').replace('.com', '').replace('.io', '').replace('.xyz', '').replace('.fun', '').replace('.app', '').replace('.net', '').replace('.org', '');
    const pathParts = pathname.split('/').filter(part => part.length > 0);
    const pathName = pathParts[pathParts.length - 1];
    const bestName = domain.length > 2 ? domain : pathName;
    return bestName.charAt(0).toUpperCase() + bestName.slice(1);
  } catch { return null; }
}
function extractNameFromTwitter(url) {
  try {
    const match = url.match(/x\.com\/([^\/\?]+)/);
    if (match) {
      const handle = match[1];
      if (!/^\d+$/.test(handle)) return handle;
    }
    return null;
  } catch { return null; }
}
function extractNameFromTelegram(url) {
  try {
    const match = url.match(/t\.me\/([^\/\?]+)/);
    if (match) return match[1];
    return null;
  } catch { return null; }
}

async function enrichTokenData(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      const info = pair.info || {};
      
      let name = pair.baseToken.name;
      let symbol = pair.baseToken.symbol;
      
      // RESTORED: website -> twitter -> telegram priority
      if (info.links && info.links.length > 0) {
        const website = info.links.find(link => !link.type);
        if (website && website.url) {
          const websiteName = extractNameFromUrl(website.url);
          if (websiteName && websiteName.length > 2) name = websiteName;
        }
        
        if (name === symbol || !name) {
          const twitter = info.links.find(link => link.type === 'twitter');
          if (twitter && twitter.url) {
            const twitterName = extractNameFromTwitter(twitter.url);
            if (twitterName && twitterName.length > 2) name = twitterName;
          }
        }
        
        if (name === symbol || !name) {
          const telegram = info.links.find(link => link.type === 'telegram');
          if (telegram && telegram.url) {
            const telegramName = extractNameFromTelegram(telegram.url);
            if (telegramName && telegramName.length > 2) name = telegramName;
          }
        }
      }
      
      return {
        ...pair,
        extractedName: name,
        extractedSymbol: symbol
      };
    }
  } catch (e) { console.error('Enrichment engine error:', e); }
  return null;
}
window.enrichTokenData = enrichTokenData;

// Global null-safe helpers for meme-first UI
const safeAddEventListener = (id, event, handler) => {
  const el = typeof id === 'string' ? (document.getElementById(id) || (screens && screens[id])) : id;
  if (el && el.addEventListener) el.addEventListener(event, handler);
};
const safeListener = safeAddEventListener; // alias for compatibility

const safeClass = (id, action, className) => {
  const el = typeof id === 'string' ? (document.getElementById(id) || (screens && screens[id])) : id;
  if (el && el.classList) el.classList[action](className);
};

const safeAction = (id, fn) => {
  const el = typeof id === 'string' ? (document.getElementById(id) || (screens && screens[id])) : id;
  if (el) fn(el);
};

const hideAllScreens = () => {
  for (const el of Object.values(screens)) {
    if (el && el.classList) el.classList.add('hidden');
  }
};

// Hi-DPI setup
const dpr = window.devicePixelRatio || 1;
function resize() {
  if (canvas.classList.contains('active')) {
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
  }
}
window.addEventListener('resize', resize);

// ─────────────────────────────────────────────
// Mode selection — persisted in localStorage
// ─────────────────────────────────────────────
let p1ModeIdx = parseInt(localStorage.getItem('sf_p1Mode') || '0', 10);
let p2ModeIdx = parseInt(localStorage.getItem('sf_p2Mode') || '0', 10);
let p1ProviderIdx = parseInt(localStorage.getItem('sf_p1Provider') || '0', 10);
let p2ProviderIdx = parseInt(localStorage.getItem('sf_p2Provider') || '0', 10);

// Expose globally for index.html access
window.setGameMode = (p1, p2) => {
  if (p1 !== undefined) p1ModeIdx = p1;
  if (p2 !== undefined) p2ModeIdx = p2;
  saveModes();
  updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
  updateModeSelection(2, p2ModeIdx, p2ProviderIdx);
};
window.setProviders = (p1, p2) => {
  if (p1 !== undefined) p1ProviderIdx = p1;
  if (p2 !== undefined) p2ProviderIdx = p2;
  saveModes();
};
p1ModeIdx = Math.max(0, Math.min(p1ModeIdx, INPUT_MODES.length - 1));
p2ModeIdx = Math.max(0, Math.min(p2ModeIdx, INPUT_MODES.length - 1));
p1ProviderIdx = Math.max(0, Math.min(p1ProviderIdx, LLM_PROVIDERS.length - 1));
p2ProviderIdx = Math.max(0, Math.min(p2ProviderIdx, LLM_PROVIDERS.length - 1));
// Ensure P2 doesn't land on a P1-only or P2-disabled mode
if (INPUT_MODES[p2ModeIdx].p1Only || INPUT_MODES[p2ModeIdx].p2Disabled) p2ModeIdx = 3;

function saveModes() {
  localStorage.setItem('sf_p1Mode', p1ModeIdx.toString());
  localStorage.setItem('sf_p2Mode', p2ModeIdx.toString());
  localStorage.setItem('sf_p1Provider', p1ProviderIdx.toString());
  localStorage.setItem('sf_p2Provider', p2ProviderIdx.toString());
}

updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
updateModeSelection(2, p2ModeIdx, p2ProviderIdx);

// ─────────────────────────────────────────────
// App state & screen navigation
// ─────────────────────────────────────────────
let state = 'landing';
let game = null;
let p1Input = null;
let p2Input = null;
const sfx = new SFX();
// Track active adapters for cleanup
let activeAdapters = [];
// Track active peer connection for multiplayer cleanup
let peerConnection = null;

/** Show a screen by name, hiding all others */
function showScreen(name) {
  hideAllScreens();
  if (canvas && canvas.classList) canvas.classList.remove('active');
  
  const targetScreen = screens[name];
  if (targetScreen && targetScreen.classList) {
    targetScreen.classList.remove('hidden');
  }
  state = name;

  // Clear keyboard focus indicators from previous screen
  document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));

  // Reset focus indices for the new screen
  if (name === 'landing') landingFocusIdx = 0;
  if (name === 'multiplayer') mpFocusIdx = 0;
  if (name === 'matchResults') resultsFocusIdx = 0;

  // Auto-focus room code input when entering join screen
  if (name === 'joinRoom') {
    safeAction('room-code-input', el => el.focus());
  }
}

/** Create an InputManager with the right adapter for a mode */
function createInput(playerNum, modeIdx, providerIdx, character = null) {
  const manager = new InputManager();
  const mode = INPUT_MODES[modeIdx].id;

  if (mode === 'controller') {
    const keyMap = playerNum === 1 ? P1_KEYBOARD_MAP : P2_KEYBOARD_MAP;
    const adapter = new KeyboardAdapter(keyMap);
    manager.addAdapter(adapter);
    activeAdapters.push(adapter);
  } else if (mode === 'voice') {
    const adapter = new VoiceAdapter(playerNum);
    manager.addAdapter(adapter);
    activeAdapters.push(adapter);
  } else if (mode === 'phone') {
    const adapter = new PhoneAdapter(playerNum);
    manager.addAdapter(adapter);
    activeAdapters.push(adapter);
  } else if (mode === 'simulated') {
    const adapter = new SimulatedAdapter(playerNum);
    manager.addAdapter(adapter);
    activeAdapters.push(adapter);
  } else if (mode === 'llm') {
    const provider = LLM_PROVIDERS[providerIdx]?.id || 'anthropic';
    const adapter = new LLMAdapter(playerNum, provider, character);
    manager.addAdapter(adapter);
    activeAdapters.push(adapter);
  }

  return manager;
}

/** Clean up all active adapters */
async function cleanupAdapters() {
  for (const adapter of activeAdapters) {
    if (adapter.detach) await adapter.detach();
  }
  activeAdapters = [];

  // Reset dynamic Voice Control toggling state
  if (window.activeVoiceAdapter) {
    try {
      await window.activeVoiceAdapter.detach();
    } catch (e) {
      console.warn('[Cleanup] Voice adapter detach failed:', e);
    }
    window.activeVoiceAdapter = null;
  }
  window.isVoiceControlActive = false;
  const micBtn = document.getElementById('mic-toggle-btn');
  if (micBtn) {
    micBtn.classList.remove('loading', 'active');
    const tooltip = micBtn.querySelector('.mic-tooltip');
    if (tooltip) tooltip.innerText = 'TOGGLE VOICE CONTROL [V]';
  }
}

function showOnboarding() {
  if (game) { game.running = false; game = null; }
  cleanupAdapters();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  p1Input = null;
  p2Input = null;
  showScreen('onboarding');
}

function showLanding() {
  if (game) { game.running = false; game = null; }
  cleanupAdapters();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  p1Input = null;
  p2Input = null;
  showScreen('landing');
}

async function startFight() {
  await cleanupAdapters(); // Ensure fresh start
  state = 'fighting';
  if (screens.onboarding && screens.onboarding.classList) {
    screens.onboarding.classList.add('hidden');
  }
  if (canvas && canvas.classList) canvas.classList.add('active');
  resize();

  // Show Fight Trending Strip
  const fightStripEl = document.getElementById('fight-trending-strip');
  if (fightStripEl) {
    fightStripEl.style.display = 'block';
    if (!window.fightTrendingStrip) {
      window.fightTrendingStrip = new window.TrendingStrip('fight-trending-strip');
      window.fightTrendingStrip.init();
    }
  }

  // Create inputs based on mode selection
  p1Input = createInput(1, p1ModeIdx, p1ProviderIdx);
  p2Input = createInput(2, p2ModeIdx, p2ProviderIdx);

  // Preload SFX + wait for all adapters to be ready (mic, WS, etc.)
  const readyPromises = [sfx.preload()];
  for (const adapter of activeAdapters) {
    if (adapter.waitUntilReady) readyPromises.push(adapter.waitUntilReady());
  }

  // Start the game loop (renders stage + fighters while waiting)
  const p1Label = getPlayerLabel(p1ModeIdx, p1ProviderIdx);
  const p2Label = getPlayerLabel(p2ModeIdx, p2ProviderIdx);
  game = new Game(canvas, p1Input, p2Input, sfx, { p1Label, p2Label });
  game.start();

  // Expose game globally immediately (fixes race condition)
  window.game = game;
  window._game = game;
  window.currentGame = game;  // alias used by joystick + nextFight

  // Re-register virtual joystick with the fresh p1Input on every game start
  // (The _registered guard is intentionally removed so it works after resetAndFight)
  if (window.virtualJoystick) {
    // Check adapters list to avoid double-add
    const alreadyAdded = p1Input.adapters && p1Input.adapters.includes(window.virtualJoystick);
    if (!alreadyAdded) {
      p1Input.addAdapter(window.virtualJoystick);
      console.log('[Joystick] Virtual joystick registered with new p1Input');
    }
    window.virtualJoystick._registered = true;
  }

  // Wire up adapters with game reference
  for (const adapter of activeAdapters) {
    if (adapter.setGameRef) adapter.setGameRef(game);
  }

  // Wait for all providers, then show "FIGHT!"
  await Promise.all(readyPromises);
  game.showFightAlert();
}

// ─────────────────────────────────────────────
// Global opponent loader
// Loads a token into P2 of the current or freshly-started fight.
// ─────────────────────────────────────────────
window.loadOpponent = async function(token, forceRestart = false) {
  // 1. Ensure P2 is in Simulated mode (not Keyboard) so AI works
  if (p2ModeIdx === 0) {
    window.setGameMode(undefined, 3); // 3 = Simulated
  }

  // 2. Start fight — always start fresh if forceRestart or game isn't running
  if (forceRestart || state !== 'fighting' || !game || game.roundOver) {
    await startFight();
  }

  // 3. Wait for game and p2 to be fully initialized (up to 2.5s)
  let attempts = 0;
  while ((!game || !game.p2) && attempts < 50) {
    await new Promise(r => setTimeout(r, 50));
    attempts++;
  }

  if (!game || !game.p2) {
    console.error('[loadOpponent] Game initialization timed out');
    return;
  }

  const opponent = game.p2;

  // 4. Apply token market stats
  try {
    opponent.applyMarketStats(token);
    token.name   = token.name   || 'Unknown Meme';
    token.symbol = token.symbol || 'MEME';
    console.log(`[Game] Loaded opponent: ${token.name} (${token.symbol})`);
  } catch (e) {
    console.error('[loadOpponent] Market stats enrichment failed', e);
  }

  await opponent.loadTokenHead(token);

  // 5. Announce opponent taunt via TTS
  if (opponent.personality?.taunts?.length > 0) {
    const taunts = opponent.personality.taunts;
    const randomTaunt = taunts[Math.floor(Math.random() * taunts.length)];
    console.log(`[Intro Taunt] Speaking: "${randomTaunt}"`);

    const lbs = window.liveBoostSystem;
    if (lbs && lbs._announce) {
      lbs._announce(randomTaunt);
    } else if (window.speechSynthesis) {
      // Local browser fallback
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(randomTaunt);
        utterance.pitch  = opponent.personality.pitch || 1.0;
        utterance.rate   = opponent.personality.rate  || 1.0;
        utterance.volume = 1.0;
        
        const voices = speechSynthesis.getVoices();
        const best = voices.find(v => v.name === 'Google US English')
                  || voices.find(v => v.name.startsWith('Microsoft') && v.lang.startsWith('en') && v.name.includes('Neural'))
                  || voices.find(v => v.lang === 'en-US')
                  || voices.find(v => v.lang.startsWith('en'));
        if (best) utterance.voice = best;
        
        window.speechSynthesis.speak(utterance);
      } catch(err) {
        console.warn('[TTS] Speech synthesis autoplay blocked:', err);
      }
    }
  }

  safeClass('landing', 'add', 'hidden');
  console.log('✅ Opponent loaded:', token.symbol);
};

// ─────────────────────────────────────────────
// resetAndFight — authoritative teardown + fresh game start
//
// This is the single source of truth for "start the next fight".
// It:
//  1. Stops the RAF loop and live boost
//  2. Nulls the module-scoped `game` variable (not just window.currentGame)
//  3. Resets state to 'landing' so startFight() in loadOpponent creates a
//     brand-new Game instance with clean roundOver / victoryOverlayTriggered
//  4. Clears the canvas of any stale frame
//  5. Calls loadOpponent with forceRestart=true
// ─────────────────────────────────────────────
window.resetAndFight = async function(token) {
  if (!token) {
    console.warn('[resetAndFight] No token provided');
    return;
  }

  console.log('[resetAndFight] Tearing down current game for:', token.symbol);

  // Reset joystick registration so the new game's p1Input gets it
  if (window.virtualJoystick) window.virtualJoystick._registered = false;

  // Stop RAF loop + live boost
  if (game) {
    game.running = false;
    game.roundOver = true;
  }
  if (window.liveBoostSystem) {
    try { window.liveBoostSystem.stop(); } catch (e) { /* ignore */ }
    window.liveBoostSystem = null;
  }

  // Null both references so loadOpponent triggers startFight()
  game = null;
  window.currentGame = null;
  window.game = null;
  window.isMultiplayerMatch = false;

  // Step back state so startFight() runs unconditionally
  state = 'landing';

  // Clear canvas of stale frame
  const canvas = document.getElementById('game');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Small yield to let the RAF loop notice running=false before we restart
  await new Promise(r => setTimeout(r, 32));

  if (window._showMobileControls) window._showMobileControls();
  await window.loadOpponent(token, true);
};


// ─────────────────────────────────────────────
// Landing page click handlers
// ─────────────────────────────────────────────
safeListener('btn-multiplayer', 'click', async () => {
  // Multiplayer requires authentication
  if (!isLoggedIn()) {
    const configured = await isAuthConfigured();
    if (configured) {
      // Store intent to return to multiplayer after login
      login('/multiplayer');
      return;
    }
    // If OIDC is not configured, allow through (dev mode)
  }
  showScreen('multiplayer');
});
safeListener('btn-singleplayer', 'click', () => showCharacterSelect());

// Multiplayer menu
safeListener('btn-create-room', 'click', async () => {
  const createBtn = document.getElementById('btn-create-room');
  createBtn.classList.add('loading');
  const origLabel = createBtn.querySelector('.mp-label');
  const savedText = origLabel ? origLabel.textContent : '';
  if (origLabel) origLabel.textContent = 'Creating...';
  try {
    const resp = await fetch('/api/room/create', { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Store room info for later use
    localStorage.setItem('sf_roomCode', data.code);
    localStorage.setItem('sf_playerId', data.playerId);
    localStorage.setItem('sf_playerNum', '1');
    // Show lobby in "created" mode (P1 perspective)
    document.getElementById('room-lobby-title').textContent = 'ROOM CREATED';
    document.getElementById('room-lobby-hint').textContent = 'Share this code with your opponent';
    document.getElementById('room-code-display').textContent = data.code;
    document.getElementById('room-url-display').value = data.url;
    const roomUrlRow = document.getElementById('room-url-row');
    if (roomUrlRow) roomUrlRow.classList.remove('hidden');
    document.getElementById('room-waiting-text').textContent = 'Waiting for opponent...';
    showScreen('roomLobby');
    startRoomPolling(); // Poll until P2 joins → status becomes "selecting"
  } catch (err) {
    console.error('[multiplayer] Failed to create room:', err);
  } finally {
    createBtn.classList.remove('loading');
    if (origLabel) origLabel.textContent = savedText;
  }
});
safeListener('btn-join-room', 'click', () => showScreen('joinRoom'));
safeListener('btn-matchmaking', 'click', () => showMatchmakingScreen());
safeListener('btn-mp-back', 'click', () => showScreen('landing'));

// Join room
const roomCodeInput = document.getElementById('room-code-input');
const joinGoBtn = document.getElementById('btn-join-go');

if (roomCodeInput && joinGoBtn) {
  roomCodeInput.addEventListener('input', () => {
    // Enable join button when input has a plausible room code
    joinGoBtn.disabled = roomCodeInput.value.trim().length < 3;
  });

  joinGoBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toLowerCase();
    if (code) joinRoom(code);
  });

  roomCodeInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !joinGoBtn.disabled) {
      const code = roomCodeInput.value.trim().toLowerCase();
      if (code) joinRoom(code);
    }
  });
}

/** Join a room by code — calls the API, navigates to lobby on success */
async function joinRoom(code) {
  const joinError = document.getElementById('join-error');
  if (joinError) {
    joinError.classList.add('hidden');
    joinError.textContent = '';
  }

  if (joinGoBtn) {
    joinGoBtn.disabled = true;
    joinGoBtn.classList.add('loading');
    joinGoBtn.textContent = 'JOINING...';
  }

  try {
    const resp = await fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const detail = err.detail || `Failed to join (HTTP ${resp.status})`;
      if (joinError) {
        joinError.textContent = detail;
        joinError.classList.remove('hidden');
      }
      return;
    }

    const data = await resp.json();
    // Store room info for later WebSocket/WebRTC use
    localStorage.setItem('sf_roomCode', data.code);
    localStorage.setItem('sf_playerId', data.playerId);
    localStorage.setItem('sf_playerNum', data.playerNum);

    // P2 joins → room is now "selecting" → go straight to controller selection
    showRoomControllerScreen();
    startRoomPolling();
  } catch (err) {
    console.error('[multiplayer] Failed to join room:', err);
    if (joinError) {
      joinError.textContent = 'Network error — could not reach server';
      joinError.classList.remove('hidden');
    }
  } finally {
    if (joinGoBtn) {
      joinGoBtn.classList.remove('loading');
      joinGoBtn.textContent = 'JOIN';
      joinGoBtn.disabled = roomCodeInput ? roomCodeInput.value.trim().length < 3 : true;
    }
  }
}

safeListener('btn-join-back', 'click', () => {
  if (roomCodeInput) roomCodeInput.value = '';
  if (joinGoBtn) joinGoBtn.disabled = true;
  const joinError = document.getElementById('join-error');
  if (joinError) joinError.classList.add('hidden');
  showScreen('multiplayer');
});

// Room lobby
safeListener('btn-lobby-back', 'click', () => {
  stopRoomPolling();
  showScreen('multiplayer');
});
safeListener('btn-copy-url', 'click', () => {
  const url = document.getElementById('room-url-display').value;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-copy-url');
    btn.textContent = 'COPIED';
    setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
  });
});

// ─────────────────────────────────────────────
// Room status polling
// ─────────────────────────────────────────────
let roomPollTimer = null;

function stopRoomPolling() {
  if (roomPollTimer) {
    clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
}

function startRoomPolling() {
  stopRoomPolling();
  const code = localStorage.getItem('sf_roomCode');
  if (!code) return;

  roomPollTimer = setInterval(async () => {
    try {
      const resp = await fetch(`/api/room/status?code=${encodeURIComponent(code)}`);
      if (!resp.ok) {
        console.warn('[room-poll] Status check failed:', resp.status);
        return;
      }
      const data = await resp.json();
      handleRoomStatusUpdate(data);
    } catch (err) {
      console.warn('[room-poll] Error:', err);
    }
  }, 2000);
}

function handleRoomStatusUpdate(data) {
  const myNum = localStorage.getItem('sf_playerNum');

  if (data.status === 'selecting' && (state === 'roomLobby' || state === 'victoryOverlay' || state === 'matchResults')) {
    // Both players in room — go to controller selection (e.g. after a rematch reset)
    const overlay = document.getElementById('victory-overlay');
    if (overlay) overlay.classList.add('hidden');
    showRoomControllerScreen();
  } else if (data.status === 'fighting' && state === 'waitingInArena') {
    // Opponent confirmed — transition from waiting arena to real fight
    stopRoomPolling();
    stopWaitingInArena();
    startMultiplayerFight(data);
  } else if (data.status === 'fighting' && state !== 'fighting') {
    // Both controllers confirmed — start the fight (normal path)
    stopRoomPolling();
    startMultiplayerFight(data);
  } else if (data.status === 'finished' && state === 'waitingInArena') {
    // Forfeit — opponent didn't pick a controller in time
    stopRoomPolling();
    stopWaitingInArena();
    handleControllerForfeit(data);
  }

  // Update controller status text on room-controller screen
  if (state === 'roomController') {
    const statusEl = document.getElementById('room-ctrl-status');
    const opponentNum = myNum === '1' ? '2' : '1';
    const opponentReady = data[`p${opponentNum}Ready`];
    const myReady = data[`p${myNum}Ready`];

    if (myReady && opponentReady) {
      statusEl.textContent = 'Both ready — starting match!';
      statusEl.classList.add('ready');
    } else if (myReady && !opponentReady) {
      statusEl.textContent = 'Waiting for opponent to select controller...';
      statusEl.classList.remove('ready');
    } else if (!myReady && opponentReady) {
      statusEl.textContent = 'Opponent is ready — pick your controller!';
      statusEl.classList.remove('ready');
    } else {
      statusEl.textContent = 'Both players selecting controllers...';
      statusEl.classList.remove('ready');
    }
  }
}

// ─────────────────────────────────────────────
// Room controller selection screen
// ─────────────────────────────────────────────
let roomModeIdx = 0;
let roomProviderIdx = 0;

function showRoomControllerScreen() {
  const myNum = localStorage.getItem('sf_playerNum') || '1';
  const card = document.getElementById('room-ctrl-card');
  const playerLabel = document.getElementById('room-ctrl-player');
  const confirmBtn = document.getElementById('btn-ctrl-confirm');

  // Style card based on player number
  card.classList.remove('p1', 'p2');
  card.classList.add(myNum === '1' ? 'p1' : 'p2');
  playerLabel.textContent = `PLAYER ${myNum}`;

  // Reset selection
  roomModeIdx = 0;
  roomProviderIdx = 0;
  if (confirmBtn) confirmBtn.disabled = false;
  if (confirmBtn) confirmBtn.textContent = 'CONFIRM';
  const roomCtrlStatus = document.getElementById('room-ctrl-status');
  if (roomCtrlStatus) roomCtrlStatus.textContent = 'Both players selecting controllers...';
  if (roomCtrlStatus) roomCtrlStatus.classList.remove('ready');

  updateRoomControllerUI();
  showScreen('roomController');
}

function updateRoomControllerUI() {
  // Update pill selection — hide mpDisabled modes
  const pills = document.querySelectorAll('#room-ctrl-pills .mode-pill');
  pills.forEach((pill, i) => {
    const mode = INPUT_MODES[i];
    if (mode.mpDisabled) {
      pill.style.display = 'none';
    }
    pill.classList.toggle('selected', i === roomModeIdx);
  });

  // Update controls info using the existing ui.js function
  // We render into the room-ctrl-info element directly
  const infoEl = document.getElementById('room-ctrl-info');
  const mode = INPUT_MODES[roomModeIdx];

  if (mode.id === 'controller') {
    const myNum = localStorage.getItem('sf_playerNum') || '1';
    const controls = myNum === '1'
      ? [{ keys: ['W', 'A', 'S', 'D'], label: 'move' }, { keys: ['U', 'I', 'O'], label: 'punch' }, { keys: ['J', 'K', 'L'], label: 'kick' }]
      : [{ keys: ['↑', '←', '↓', '→'], label: 'move' }, { keys: ['4', '5', '6'], label: 'punch' }, { keys: ['1', '2', '3'], label: 'kick' }];
    infoEl.innerHTML = controls.map(row =>
      `<div class="control-row">${row.keys.map(k => `<kbd>${k}</kbd>`).join(' ')} ${row.label}</div>`
    ).join('') + `<div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'voice') {
    infoEl.innerHTML = `<div class="voice-info">"punch" "kick" "jump"<br><span>"hard punch" "forward" "back"</span></div><div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'phone') {
    infoEl.innerHTML = `<div class="voice-info">Call a phone number<br><span>Shout commands into the phone</span></div><div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'simulated') {
    infoEl.innerHTML = `<div class="llm-info">Random command bot<br><span>Lightweight, no API key needed</span></div><div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'llm') {
    const provider = LLM_PROVIDERS[roomProviderIdx] || LLM_PROVIDERS[0];
    const providerPills = LLM_PROVIDERS.map((p, i) =>
      `<button class="provider-pill${i === roomProviderIdx ? ' selected' : ''}" data-provider="${i}">${p.label}</button>`
    ).join('');
    infoEl.innerHTML = `<div class="provider-pills" data-player="room">${providerPills}</div><div class="llm-info">${provider.label} ${provider.model}<br><span>Tactical AI with game awareness</span></div><div class="mode-desc">${mode.desc}</div>`;
  }
}

// Mode pill clicks on room controller screen
safeListener('room-ctrl-pills', 'click', e => {
  const pill = e.target.closest('.mode-pill');
  if (!pill) return;
  const idx = parseInt(pill.dataset.mode, 10);
  if (INPUT_MODES[idx].mpDisabled) return;
  roomModeIdx = idx;
  updateRoomControllerUI();
});

// LLM provider pill clicks (delegated from room-ctrl-info)
safeListener('room-ctrl-info', 'click', e => {
  const pill = e.target.closest('.provider-pill');
  if (!pill) return;
  roomProviderIdx = parseInt(pill.dataset.provider, 10);
  updateRoomControllerUI();
});

// Confirm controller choice
safeListener('btn-ctrl-confirm', 'click', async () => {
  const code = localStorage.getItem('sf_roomCode');
  const playerId = localStorage.getItem('sf_playerId');
  const controller = INPUT_MODES[roomModeIdx].id;
  const confirmBtn = document.getElementById('btn-ctrl-confirm');

  confirmBtn.disabled = true;
  confirmBtn.classList.add('loading');
  confirmBtn.textContent = 'Confirming...';

  try {
    const resp = await fetch('/api/room/controller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, playerId, controller }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[room-ctrl] Failed:', err.detail || resp.status);
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('loading');
      confirmBtn.textContent = 'CONFIRM';
      return;
    }

    confirmBtn.textContent = 'CONFIRMED';
    confirmBtn.classList.remove('loading');

    const data = await resp.json();
    if (data.bothReady) {
      stopRoomPolling();
      startMultiplayerFight(data);
    } else {
      // First controller confirmed — enter the arena and wait for opponent
      startWaitingInArena(data.controllerWaitDeadline);
    }
  } catch (err) {
    console.error('[room-ctrl] Error:', err);
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('loading');
    confirmBtn.textContent = 'CONFIRM';
  }
});

// Back button on controller screen
safeListener('btn-ctrl-back', 'click', () => {
  stopRoomPolling();
  stopWaitingInArena();
  showScreen('multiplayer');
});

// ─────────────────────────────────────────────
// Waiting in arena — shown after controller confirm, before opponent confirms
// ─────────────────────────────────────────────
let waitingArenaRAF = null;
let waitingArenaDeadline = 0;

function startWaitingInArena(deadline) {
  const myNum = parseInt(localStorage.getItem('sf_playerNum') || '1', 10);
  state = 'waitingInArena';

  hideAllScreens();
  if (canvas && canvas.classList) canvas.classList.add('active');
  resize();

  waitingArenaDeadline = deadline;

  // Create a static fighter for the local player
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;
  const floorY = logicalH - 160;
  const stageMargin = 0.05;
  const stageLeft = logicalW * stageMargin;
  const stageRight = logicalW * (1 - stageMargin);
  const startOffset = (stageRight - stageLeft) * 0.25;

  const myX = myNum === 1 ? stageLeft + startOffset : stageRight - startOffset;
  const myFacing = myNum === 1 ? 1 : -1;
  const myColor = myNum === 1 ? DG.primary : DG.secondary;
  const waitingFighter = new Fighter(myX, floorY, myFacing, myColor, myNum);

  function drawFrame() {
    if (state !== 'waitingInArena') return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const fy = h - 160;
    const sl = w * stageMargin;
    const sr = w * (1 - stageMargin);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = DG.bg || '#0b0b0c';
    ctx.fillRect(0, 0, w, h);

    // Floor line
    const floorGrad = ctx.createLinearGradient(sl, 0, sr, 0);
    floorGrad.addColorStop(0, DG.gradStart || '#008fc1');
    floorGrad.addColorStop(1, DG.gradEnd || '#00f099');
    ctx.strokeStyle = floorGrad;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(sl, fy);
    ctx.lineTo(sr, fy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Stage bounds
    ctx.strokeStyle = DG.border || '#2c2c33';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sl, fy - 200);
    ctx.lineTo(sl, fy);
    ctx.moveTo(sr, fy - 200);
    ctx.lineTo(sr, fy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the local fighter (idle)
    waitingFighter.floorY = fy;
    waitingFighter.draw(ctx);

    // "Waiting for opponent..." placeholder on the opponent's side
    const opX = myNum === 1 ? sr - startOffset : sl + startOffset;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DG.slate || '#949498';
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(Date.now() / 500);
    ctx.fillText('Waiting for opponent...', opX, fy - 60);
    ctx.globalAlpha = 1;

    // Draw ghost silhouette for opponent
    ctx.strokeStyle = DG.pebble || '#4e4e52';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    // Head
    ctx.arc(opX, fy - 105, 10, 0, Math.PI * 2);
    ctx.stroke();
    // Body
    ctx.beginPath();
    ctx.moveTo(opX, fy - 95);
    ctx.lineTo(opX, fy - 55);
    ctx.stroke();
    // Arms
    ctx.beginPath();
    ctx.moveTo(opX - 20, fy - 80);
    ctx.lineTo(opX + 20, fy - 80);
    ctx.stroke();
    // Legs
    ctx.beginPath();
    ctx.moveTo(opX, fy - 55);
    ctx.lineTo(opX - 15, fy);
    ctx.moveTo(opX, fy - 55);
    ctx.lineTo(opX + 15, fy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Countdown timer
    const remaining = Math.max(0, Math.ceil((waitingArenaDeadline * 1000 - Date.now()) / 1000));
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = remaining <= 10 ? (DG.danger || '#f04438') : (DG.text || '#fbfbff');
    ctx.fillText(`${remaining}s`, w / 2, 40);

    ctx.font = '12px monospace';
    ctx.fillStyle = DG.slate || '#949498';
    ctx.fillText(`Waiting for opponent to pick a controller... (${remaining}s remaining)`, w / 2, 62);

    ctx.restore();

    waitingArenaRAF = requestAnimationFrame(drawFrame);
  }

  waitingArenaRAF = requestAnimationFrame(drawFrame);

  // Ensure room polling is active to detect opponent readiness
  startRoomPolling();
}

function stopWaitingInArena() {
  if (waitingArenaRAF !== null) {
    cancelAnimationFrame(waitingArenaRAF);
    waitingArenaRAF = null;
  }
  waitingArenaDeadline = 0;
}

/** Start a multiplayer fight using the locally selected controller */
function startMultiplayerFight(_roomData) {
  const myNum = parseInt(localStorage.getItem('sf_playerNum') || '1', 10);
  const roomCode = localStorage.getItem('sf_roomCode');
  const playerId = localStorage.getItem('sf_playerId');

  state = 'fighting';
  hideAllScreens();
  if (canvas && canvas.classList) canvas.classList.add('active');
  resize();

  // Create input for local player based on room controller selection
  const localInput = createInput(myNum, roomModeIdx, roomProviderIdx);

  // Remote player gets an InputManager with a RemoteInputAdapter
  // that receives inputs from the peer via WebRTC data channel
  const remoteInput = new InputManager();
  const remoteAdapter = new RemoteInputAdapter();
  remoteInput.addAdapter(remoteAdapter);

  const myInput = myNum === 1 ? localInput : remoteInput;
  const opInput = myNum === 1 ? remoteInput : localInput;

  const myLabel = getPlayerLabel(roomModeIdx, roomProviderIdx);
  const opLabel = 'Remote';

  const p1Label = myNum === 1 ? myLabel : opLabel;
  const p2Label = myNum === 1 ? opLabel : myLabel;

  // Preload SFX + adapters
  const readyPromises = [sfx.preload()];
  for (const adapter of activeAdapters) {
    if (adapter.waitUntilReady) readyPromises.push(adapter.waitUntilReady());
  }

  game = new Game(canvas, myInput, opInput, sfx, { p1Label, p2Label });
  game.start();

  for (const adapter of activeAdapters) {
    if (adapter.setGameRef) adapter.setGameRef(game);
  }

  window._game = game;

  // Establish WebRTC peer connection + game WebSocket
  if (roomCode && playerId) {
    peerConnection = new PeerConnection(roomCode, playerId, myNum);

    // Client-side prediction with rollback reconciliation
    const predictionManager = new PredictionManager(game, myNum);
    game.predictionManager = predictionManager;

    // Feed remote peer inputs into the RemoteInputAdapter
    peerConnection.onRemoteInput((msg) => {
      remoteAdapter.receiveInput(msg);
    });

    // Handle authoritative server state — prediction manager reconciles
    peerConnection.onServerState((msg) => {
      if (msg.type === 'state' && predictionManager) {
        predictionManager.applyServerState(msg);
      }
      if (msg.type === 'round_over' && game) {
        game.roundOver = true;
        handleMultiplayerRoundOver(msg);
      }
      if (msg.type === 'room_expired') {
        handleRoomExpired();
      }
    });

    peerConnection.connect();

    // 1. Mark this as a multiplayer match
    window.isMultiplayerMatch = true;

    // 2. Fetch and apply local player avatar from OIDC claims
    try {
      const profileStr = localStorage.getItem('smf_user_profile');
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        if (profile) {
          const localFighter = myNum === 1 ? game.p1 : game.p2;
          if (localFighter) {
            if (profile.avatar) {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => { localFighter.headImage = img; };
              img.src = profile.avatar;
            }
            if (profile.name) {
              if (myNum === 1) game.p1Label = profile.name;
              else game.p2Label = profile.name;
            }
          }
        }
      }
    } catch (e) {
      console.error('[Multiplayer] Failed to load local profile avatar:', e);
    }

    // 3. Listen to remote profile metadata exchange to apply remote head and label
    peerConnection.onRemoteProfile((profile) => {
      console.log('[Multiplayer] Remote profile received:', profile);
      window.opponentProfile = profile;
      const remoteFighter = myNum === 1 ? game.p2 : game.p1;
      if (remoteFighter) {
        if (profile.avatar) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { remoteFighter.headImage = img; };
          img.src = profile.avatar;
        }
        if (profile.name) {
          if (myNum === 1) game.p2Label = profile.name;
          else game.p1Label = profile.name;
        }
      }
    });

    // Tap into localInput.endFrame to buffer inputs for replay and send
    // to peer + server. Captures the exact actions the game loop just consumed.
    const origEndFrame = localInput.endFrame.bind(localInput);
    localInput.endFrame = () => {
      if (peerConnection) {
        const actions = localInput.getActions();
        const pressed = localInput.getJustPressed();
        const seq = predictionManager.nextSeq();
        predictionManager.bufferInput(seq, actions, pressed, game._dt);
        peerConnection.sendInput(actions, pressed, seq);
      }
      origEndFrame();
    };
  }

  Promise.all(readyPromises).then(() => game.showFightAlert());
}

// ─────────────────────────────────────────────
// Multiplayer match results
// ─────────────────────────────────────────────

/** Handle forfeit when opponent didn't pick a controller within the deadline */
function handleControllerForfeit(data) {
  const myNum = parseInt(localStorage.getItem('sf_playerNum') || '1', 10);
  const forfeitWinner = data.forfeitWinner;

  canvas.classList.remove('active');

  // Show results screen with forfeit info
  const winnerEl = document.getElementById('results-winner');
  winnerEl.classList.remove('p1-wins', 'p2-wins', 'draw');

  if (forfeitWinner === myNum) {
    winnerEl.textContent = 'YOU WIN!';
    winnerEl.classList.add(myNum === 1 ? 'p1-wins' : 'p2-wins');
  } else {
    winnerEl.textContent = 'YOU LOSE';
    winnerEl.classList.add(forfeitWinner === 1 ? 'p1-wins' : 'p2-wins');
  }

  document.getElementById('results-title').textContent = 'OPPONENT FORFEITED';
  document.getElementById('results-p1-hp').textContent = '';
  document.getElementById('results-p2-hp').textContent = 'Opponent did not select a controller in time';

  const eloEl = document.getElementById('results-elo');
  eloEl.classList.add('hidden');
  eloEl.innerHTML = '';

  state = 'matchResults';
  showScreen('matchResults');
  game = null;
}

/** Handle the round_over message from the server */
async function handleMultiplayerRoundOver(msg) {
  // Brief delay so players see the KO on canvas before switching screens
  await new Promise(r => setTimeout(r, 2000));

  // Stop the game and clean up peer connection
  if (game) { game.running = false; }
  cleanupAdapters();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }

  // Start polling room status so we know when a rematch starts
  startRoomPolling();

  const myNum = parseInt(localStorage.getItem('sf_playerNum') || '1', 10);
  const roomCode = localStorage.getItem('sf_roomCode');
  const playerId = localStorage.getItem('sf_playerId');

  // Determine result text
  safeClass('results-winner', 'remove', 'p1-wins');
  safeClass('results-winner', 'remove', 'p2-wins');
  safeClass('results-winner', 'remove', 'draw');

  const winnerEl = document.getElementById('results-winner');
  if (winnerEl) {
    if (msg.winner === null || msg.winner === undefined) {
      winnerEl.textContent = 'DRAW!';
      winnerEl.classList.add('draw');
    } else if (msg.winner === myNum) {
      winnerEl.textContent = 'YOU WIN!';
      winnerEl.classList.add(myNum === 1 ? 'p1-wins' : 'p2-wins');
      // Track opponent symbol for victory capture
      window.lastOpponentSymbol = game && game.p2 && game.p2.tokenData ? game.p2.tokenData.symbol : 'MEME';
      // Call our new victory function
      if (window.captureVictory) {
        await window.captureVictory('player');
      }
    } else {
      winnerEl.textContent = 'YOU LOSE';
      winnerEl.classList.add(msg.winner === 1 ? 'p1-wins' : 'p2-wins');
    }
  }

  // Show reason for forfeit
  if (msg.reason === 'forfeit') {
    document.getElementById('results-title').textContent = 'OPPONENT DISCONNECTED';
  } else {
    document.getElementById('results-title').textContent = 'MATCH OVER';
  }

  // Health display
  document.getElementById('results-p1-hp').textContent =
    `P1: ${Math.max(0, Math.round(msg.p1_health))} HP`;
  document.getElementById('results-p2-hp').textContent =
    `P2: ${Math.max(0, Math.round(msg.p2_health))} HP`;

  // Call match complete endpoint with ELO data
  const user = isLoggedIn() ? getUser() : null;
  const body = {
    code: roomCode,
    playerId,
    winner: msg.winner,
    p1Health: msg.p1_health,
    p2Health: msg.p2_health,
  };

  // Add user info for ELO if logged in
  if (user) {
    if (myNum === 1) {
      body.p1UserId = user.sub || user.id;
      body.p1Name = user.name || 'Player';
    } else {
      body.p2UserId = user.sub || user.id;
      body.p2Name = user.name || 'Player';
    }
  }

  try {
    const resp = await fetch('/api/match/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const result = await resp.json();
      window.multiplayerEloData = result.elo; // Store rating changes globally
    }
  } catch (err) {
    console.warn('[match] Failed to report match result:', err);
  }

  // Show premium victory overlay instead of results screen!
  if (window.showVictoryOverlay) {
    window.showVictoryOverlay(msg.winner, null, null);
  }

  game = null;
  state = 'victoryOverlay';
}

/** Display ELO rating changes on the results screen */
function showEloChanges(elo, myNum) {
  const eloEl = document.getElementById('results-elo');
  const myElo = myNum === 1 ? elo.p1 : elo.p2;
  const opElo = myNum === 1 ? elo.p2 : elo.p1;

  if (!myElo) return;

  const ratingChange = myElo.rating - 1000; // Approximate — rating was updated
  const changeClass = ratingChange > 0 ? 'elo-positive' : ratingChange < 0 ? 'elo-negative' : 'elo-neutral';

  eloEl.innerHTML = `
    <div class="elo-change">
      <span class="${changeClass}">Your ELO: ${Math.round(myElo.rating)}</span>
      <br><small>${elo.category} | W:${myElo.wins} L:${myElo.losses}</small>
    </div>
  `;
  if (opElo) {
    eloEl.innerHTML += `
      <div class="elo-change">
        <span class="elo-neutral">Opponent: ${Math.round(opElo.rating)}</span>
      </div>
    `;
  }
  const resultsElo = document.getElementById('results-elo');
  if (resultsElo) resultsElo.classList.remove('hidden');
}

/** Handle room expiry — server cleaned up the room due to inactivity TTL */
function handleRoomExpired() {
  console.log('[room] Room expired due to inactivity');
  // Stop game and clean up all connections gracefully
  if (game) { game.running = false; game = null; }
  cleanupAdapters();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  stopRoomPolling();
  // Clear room data from localStorage
  localStorage.removeItem('sf_roomCode');
  localStorage.removeItem('sf_playerId');
  localStorage.removeItem('sf_playerNum');
  // Show landing with a brief alert
  showLanding();
  alert('Room expired due to inactivity.');
}

// Results screen: Rematch button
safeListener('btn-rematch', 'click', async () => {
  const roomCode = localStorage.getItem('sf_roomCode');
  const playerId = localStorage.getItem('sf_playerId');
  if (!roomCode || !playerId) { showLanding(); return; }

  try {
    const resp = await fetch('/api/room/rematch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, playerId }),
    });

    if (!resp.ok) {
      console.warn('[rematch] Failed:', resp.status);
      showLanding();
      return;
    }

    // Back to controller selection
    showRoomControllerScreen();
    startRoomPolling();
  } catch (err) {
    console.warn('[rematch] Error:', err);
    showLanding();
  }
});

// Results screen: Leave button
safeListener('btn-leave', 'click', () => {
  localStorage.removeItem('sf_roomCode');
  localStorage.removeItem('sf_playerId');
  localStorage.removeItem('sf_playerNum');
  showLanding();
});

// ─────────────────────────────────────────────
// Matchmaking
// ─────────────────────────────────────────────
let mmModeIdx = 0;
let mmProviderIdx = 0;
let mmPlayerId = null;
let mmPollTimer = null;
let mmWaitingGame = false;
let mmSearchStart = 0;
let mmSearchTimer = null;

/** Map controller id to ELO category (mirrors elo.py) */
function controllerToCategory(controller) {
  if (controller === 'controller' || controller === 'keyboard') return 'keyboard';
  if (controller === 'voice' || controller === 'phone') return 'voice';
  return null;
}

function showMatchmakingScreen() {
  mmModeIdx = 0;
  mmProviderIdx = 0;
  mmPlayerId = null;
  const mmSelect = document.getElementById('mm-select');
  if (mmSelect) mmSelect.classList.remove('hidden');
  const mmSearching = document.getElementById('mm-searching');
  if (mmSearching) mmSearching.classList.add('hidden');
  updateMatchmakingControllerUI();
  showScreen('matchmaking');
}

function updateMatchmakingControllerUI() {
  const pills = document.querySelectorAll('#mm-ctrl-pills .mode-pill');
  pills.forEach((pill, i) => {
    const mode = INPUT_MODES[i];
    if (mode.mpDisabled) {
      pill.style.display = 'none';
    }
    pill.classList.toggle('selected', i === mmModeIdx);
  });

  const mode = INPUT_MODES[mmModeIdx];
  const category = controllerToCategory(mode.id);
  const searchBtn = document.getElementById('btn-mm-search');
  const infoEl = document.getElementById('mm-ctrl-info');

  if (category === null) {
    searchBtn.disabled = true;
    infoEl.innerHTML = '<div class="mm-warn">Bot controllers are not eligible for ranked matchmaking</div>';
    return;
  }

  searchBtn.disabled = false;

  if (mode.id === 'controller') {
    const controls = [
      { keys: ['W', 'A', 'S', 'D'], label: 'move' },
      { keys: ['U', 'I', 'O'], label: 'punch' },
      { keys: ['J', 'K', 'L'], label: 'kick' },
    ];
    infoEl.innerHTML = controls.map(row =>
      `<div class="control-row">${row.keys.map(k => `<kbd>${k}</kbd>`).join(' ')} ${row.label}</div>`
    ).join('') + `<div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'voice') {
    infoEl.innerHTML = `<div class="voice-info">"punch" "kick" "jump"<br><span>"hard punch" "forward" "back"</span></div><div class="mode-desc">${mode.desc}</div>`;
  } else if (mode.id === 'phone') {
    infoEl.innerHTML = `<div class="voice-info">Call a phone number<br><span>Shout commands into the phone</span></div><div class="mode-desc">${mode.desc}</div>`;
  }
}

// Mode pill clicks
safeListener('mm-ctrl-pills', 'click', e => {
  const pill = e.target.closest('.mode-pill');
  if (!pill) return;
  const idx = parseInt(pill.dataset.mode, 10);
  if (INPUT_MODES[idx].mpDisabled) return;
  mmModeIdx = idx;
  updateMatchmakingControllerUI();
});

// LLM provider pill clicks (delegated from mm-ctrl-info)
safeListener('mm-ctrl-info', 'click', e => {
  const pill = e.target.closest('.provider-pill');
  if (!pill) return;
  mmProviderIdx = parseInt(pill.dataset.provider, 10);
  updateMatchmakingControllerUI();
});

// Search button
safeListener('btn-mm-search', 'click', startMatchmakingSearch);

async function startMatchmakingSearch() {
  const controller = INPUT_MODES[mmModeIdx].id;
  const user = isLoggedIn() ? getUser() : null;
  const searchBtn = document.getElementById('btn-mm-search');
  searchBtn.disabled = true;
  searchBtn.classList.add('loading');
  searchBtn.textContent = 'SEARCHING...';

  try {
    const resp = await fetch('/api/matchmaking/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controller,
        userId: user ? (user.sub || user.id || '') : '',
        name: user ? (user.name || '') : '',
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[matchmaking] Join failed:', err.detail || resp.status);
      searchBtn.disabled = false;
      searchBtn.classList.remove('loading');
      searchBtn.textContent = 'SEARCH FOR OPPONENT';
      return;
    }

    const data = await resp.json();
    mmPlayerId = data.playerId;

    // Toggle to searching state
    const mmSelect = document.getElementById('mm-select');
    if (mmSelect) mmSelect.classList.add('hidden');
    const mmSearching = document.getElementById('mm-searching');
    if (mmSearching) mmSearching.classList.remove('hidden');
    mmSearchStart = Date.now();
    document.getElementById('mm-searching-text').textContent = 'Searching for opponent... (0s)';
    document.getElementById('mm-wait-info').textContent =
      `Category: ${data.category} | ELO: ${Math.round(data.elo)} | Queue: ${data.queueSize}`;

    startMmSearchTimer();
    startMatchmakingPoll();
  } catch (err) {
    console.error('[matchmaking] Error:', err);
    searchBtn.disabled = false;
    searchBtn.classList.remove('loading');
    searchBtn.textContent = 'SEARCH FOR OPPONENT';
  }
}

function startMatchmakingPoll() {
  stopMatchmakingPoll();
  if (!mmPlayerId) return;

  mmPollTimer = setInterval(async () => {
    if (!mmPlayerId) return;
    try {
      const resp = await fetch(`/api/matchmaking/status?player_id=${encodeURIComponent(mmPlayerId)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      handleMatchmakingStatus(data);
    } catch (err) {
      console.warn('[matchmaking] Poll error:', err);
    }
  }, 2000);
}

function stopMatchmakingPoll() {
  if (mmPollTimer) {
    clearInterval(mmPollTimer);
    mmPollTimer = null;
  }
}

function startMmSearchTimer() {
  stopMmSearchTimer();
  mmSearchTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - mmSearchStart) / 1000);
    const textEl = document.getElementById('mm-searching-text');
    if (textEl) textEl.textContent = `Searching for opponent... (${elapsed}s)`;
  }, 1000);
}

function stopMmSearchTimer() {
  if (mmSearchTimer) {
    clearInterval(mmSearchTimer);
    mmSearchTimer = null;
  }
}

function handleMatchmakingStatus(data) {
  if (data.status === 'matched') {
    stopMatchmakingPoll();
    handleMatchFound(data);
  } else if (data.status === 'searching') {
    document.getElementById('mm-wait-info').textContent =
      `Wait: ${data.waitTime}s | Queue: ${data.queueSize} | Threshold: \u00b1${data.threshold}`;
  } else if (data.status === 'not_queued') {
    // Player was removed (expired / pruned)
    stopMatchmakingPoll();
    stopMmSearchTimer();
    mmPlayerId = null;
    if (mmWaitingGame) {
      if (game) { game.running = false; game = null; }
      cleanupAdapters();
      mmWaitingGame = false;
    }
    showMatchmakingScreen();
  }
}

async function handleMatchFound(data) {
  stopMmSearchTimer();
  // If playing a waiting game, stop it first
  if (mmWaitingGame) {
    if (game) { game.running = false; game = null; }
    cleanupAdapters();
    mmWaitingGame = false;
  }

  // Show "Match Found!" flash before transitioning
  const searchingText = document.getElementById('mm-searching-text');
  if (searchingText) {
    searchingText.textContent = 'MATCH FOUND!';
    searchingText.classList.remove('mm-searching-text');
    searchingText.classList.add('mm-match-found');
  }
  await new Promise(r => setTimeout(r, 1200));

  // Store room data (same pattern as room join)
  localStorage.setItem('sf_roomCode', data.roomCode);
  localStorage.setItem('sf_playerId', data.playerId);
  localStorage.setItem('sf_playerNum', String(data.playerNum));

  // Set controller indices for startMultiplayerFight
  roomModeIdx = mmModeIdx;
  roomProviderIdx = mmProviderIdx;

  mmPlayerId = null;
  startMultiplayerFight(data);
}

// Cancel button
safeListener('btn-mm-cancel', 'click', async () => {
  if (mmPlayerId) {
    await fetch('/api/matchmaking/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: mmPlayerId }),
    }).catch(() => {});
  }
  stopMatchmakingPoll();
  stopMmSearchTimer();
  mmPlayerId = null;
  showMatchmakingScreen();
});

// Play while you wait
safeListener('btn-mm-play-wait', 'click', () => {
  mmWaitingGame = true;
  // Start a SIM fight — keys for P1, simulated for P2
  state = 'fighting';
  hideAllScreens();
  if (canvas && canvas.classList) canvas.classList.add('active');
  resize();

  const simInput1 = createInput(1, 0, 0); // Keys
  const simInput2 = createInput(2, 3, 0); // SIM

  game = new Game(canvas, simInput1, simInput2, sfx, { p1Label: 'You', p2Label: 'SIM Bot' });
  game.start();

  for (const adapter of activeAdapters) {
    if (adapter.setGameRef) adapter.setGameRef(game);
  }

  sfx.preload().then(() => game.showFightAlert());
  // Matchmaking poll continues in the background
});

// Back button
safeListener('btn-mm-back', 'click', () => {
  if (mmPlayerId) {
    fetch('/api/matchmaking/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: mmPlayerId }),
    }).catch(() => {});
    stopMatchmakingPoll();
    stopMmSearchTimer();
    mmPlayerId = null;
  }
  showScreen('multiplayer');
});

// ─────────────────────────────────────────────
// Character select (single-player AI opponent)
// ─────────────────────────────────────────────
let selectedCharacter = null;
let characterList = [];

/** Fetch characters from server and show the character select screen */
async function showCharacterSelect() {
  showScreen('characterSelect');
  const fightBtn = document.getElementById('btn-char-fight');
  fightBtn.disabled = true;
  selectedCharacter = null;

  try {
    if (characterList.length === 0) {
      const resp = await fetch('/api/characters');
      if (resp.ok) characterList = await resp.json();
    }
    renderCharacterCards();
  } catch (err) {
    console.error('[character-select] Failed to load characters:', err);
  }
}

/** Render character cards into the grid */
function renderCharacterCards() {
  const container = document.getElementById('char-cards');
  container.innerHTML = characterList.map(c => `
    <button class="char-card${selectedCharacter === c.id ? ' selected' : ''}" data-char="${c.id}">
      <div class="char-icon">${c.icon}</div>
      <div class="char-name">${escapeHtml(c.name)}</div>
      <div class="char-provider">Powered by ${escapeHtml(c.provider)}</div>
      <div class="char-desc">${escapeHtml(c.description)}</div>
    </button>
  `).join('');

  // Attach click listeners
  container.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedCharacter = card.dataset.char;
      container.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.getElementById('btn-char-fight').disabled = false;
    });
  });
}

/** Start a fight against the selected character */
async function startCharacterFight() {
  if (!selectedCharacter) return;

  const char = characterList.find(c => c.id === selectedCharacter);
  if (!char) return;

  state = 'fighting';
  if (screens.characterSelect && screens.characterSelect.classList) {
    screens.characterSelect.classList.add('hidden');
  }
  if (canvas && canvas.classList) canvas.classList.add('active');
  resize();

  // P1 uses keyboard, P2 is the selected LLM character
  p1Input = createInput(1, 0, 0); // keyboard
  const p2Manager = new InputManager();
  const adapter = new LLMAdapter(2, char.provider, char.id);
  p2Manager.addAdapter(adapter);
  activeAdapters.push(adapter);
  p2Input = p2Manager;

  // Preload SFX + wait for adapters
  const readyPromises = [sfx.preload()];
  for (const a of activeAdapters) {
    if (a.waitUntilReady) readyPromises.push(a.waitUntilReady());
  }

  // Start game loop
  const p1Label = 'Keyboard';
  const p2Label = char.name;
  game = new Game(canvas, p1Input, p2Input, sfx, { p1Label, p2Label });
  game.start();

  // Wire adapter game ref
  for (const a of activeAdapters) {
    if (a.setGameRef) a.setGameRef(game);
  }

  window._game = game;

  await Promise.all(readyPromises);
  game.showFightAlert();
}

safeListener('btn-char-fight', 'click', () => startCharacterFight());
safeListener('btn-char-classic', 'click', () => {
  selectedCharacter = null;
  showScreen('onboarding');
});
safeListener('btn-char-back', 'click', () => showScreen('landing'));

// ─────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────
/** Determine the default leaderboard league from the player's most recent controller. */
function defaultLeaderboardCategory() {
  const modeIdx = parseInt(localStorage.getItem('sf_p1Mode') || '0', 10);
  // INPUT_MODES: 0=controller(keyboard), 1=voice, 2=phone, 3=simulated, 4=llm
  if (modeIdx === 1 || modeIdx === 2) return 'voice';
  if (modeIdx === 0) return 'keyboard';
  return 'voice'; // default for non-ranked modes
}
let lbCategory = defaultLeaderboardCategory();

/** Fetch and render the leaderboard */
async function loadLeaderboard(category = lbCategory) {
  lbCategory = category;

  // Update filter button states
  document.querySelectorAll('#lb-filters .lb-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const body = document.getElementById('lb-body');
  const emptyEl = document.getElementById('lb-empty');
  const viewerRow = document.getElementById('lb-viewer-row');
  body.innerHTML = '';
  emptyEl.classList.add('hidden');
  viewerRow.classList.add('hidden');

  // Build URL with viewer's user ID if logged in
  let url = `/api/leaderboard?category=${encodeURIComponent(category)}`;
  const user = isLoggedIn() ? getUser() : null;
  const viewerId = user ? (user.sub || user.id || '') : '';
  if (viewerId) {
    url += `&user_id=${encodeURIComponent(viewerId)}`;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();

    if (!data.entries || data.entries.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    // Render entries
    for (const entry of data.entries) {
      const isViewer = viewerId && String(entry.user_id) === viewerId;
      const tr = document.createElement('tr');
      if (isViewer) tr.classList.add('lb-viewer');
      const wl = `${entry.wins}W-${entry.losses}L` + (entry.draws ? `-${entry.draws}D` : '');
      const modeBadge = entry.input_mode || '';
      const badgeClass = modeBadge === 'voice' ? 'voice' : modeBadge === 'keyboard' ? 'keyboard' : '';
      tr.innerHTML = `
        <td class="lb-rank">${entry.rank}</td>
        <td class="lb-name">${escapeHtml(entry.name || 'Anonymous')}</td>
        <td class="lb-rating">${Math.round(entry.rating)}</td>
        <td class="lb-record">${wl}</td>
        <td><span class="lb-badge ${badgeClass}">${modeBadge || '—'}</span></td>
      `;
      body.appendChild(tr);
    }

    // Show viewer's own row if they're ranked but not in the top entries
    if (data.viewer && !data.viewer_in_entries) {
      const v = data.viewer;
      const vwl = `${v.wins}W-${v.losses}L` + (v.draws ? `-${v.draws}D` : '');
      const vBadge = v.input_mode || '';
      const vBadgeClass = vBadge === 'voice' ? 'voice' : vBadge === 'keyboard' ? 'keyboard' : '';
      viewerRow.innerHTML = `
        <span class="lb-rank">#${v.rank}</span>
        <span class="lb-name">${escapeHtml(v.name || 'You')}</span>
        <span class="lb-rating">${Math.round(v.rating)}</span>
        <span class="lb-record">${vwl}</span>
        <span class="lb-badge ${vBadgeClass}">${vBadge || '—'}</span>
      `;
      viewerRow.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('[leaderboard] Failed to load:', err);
    emptyEl.textContent = 'Failed to load leaderboard.';
    emptyEl.classList.remove('hidden');
  }
}

/** Escape HTML to prevent XSS in player names */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Leaderboard button on landing page
safeListener('btn-leaderboard', 'click', () => {
  showScreen('leaderboard');
  loadLeaderboard(lbCategory);
});

// Filter buttons
safeListener('lb-filters', 'click', e => {
  const btn = e.target.closest('.lb-filter');
  if (!btn) return;
  loadLeaderboard(btn.dataset.category);
});

// Back button
safeListener('btn-lb-back', 'click', () => showScreen('landing'));

// ─────────────────────────────────────────────
// Click handlers for mode pills (onboarding)
// ─────────────────────────────────────────────
document.querySelectorAll('.mode-pills').forEach(container => {
  const player = parseInt(container.dataset.player, 10);
  container.addEventListener('click', e => {
    const pill = e.target.closest('.mode-pill');
    if (!pill) return;
    const idx = parseInt(pill.dataset.mode, 10);
    // Skip restricted modes
    if (INPUT_MODES[idx].p1Only && player !== 1) return;
    if (INPUT_MODES[idx].p2Disabled && player === 2) return;
    if (player === 1) {
      p1ModeIdx = idx;
      updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
    } else {
      p2ModeIdx = idx;
      updateModeSelection(2, p2ModeIdx, p2ProviderIdx);
    }
    saveModes();
  });
});

// ─────────────────────────────────────────────
// Click handlers for LLM provider pills (delegated)
// ─────────────────────────────────────────────
safeAddEventListener('onboarding', 'click', e => {
  const pill = e.target.closest('.provider-pill');
  if (!pill) return;
  const container = pill.closest('.provider-pills');
  if (!container) return;
  const player = parseInt(container.dataset.player, 10);
  const idx = parseInt(pill.dataset.provider, 10);
  if (player === 1) {
    p1ProviderIdx = idx;
    updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
  } else {
    p2ProviderIdx = idx;
    updateModeSelection(2, p2ModeIdx, p2ProviderIdx);
  }
  saveModes();
});

// ─────────────────────────────────────────────
// Keyboard navigation — per-screen focus tracking
// ─────────────────────────────────────────────
let landingFocusIdx = 0;
let mpFocusIdx = 0;
let resultsFocusIdx = 0;

function getLandingItems() {
  return [
    document.getElementById('btn-multiplayer'),
    document.getElementById('btn-singleplayer'),
    document.getElementById('btn-leaderboard'),
  ];
}

function getMpItems() {
  return [
    document.getElementById('btn-create-room'),
    document.getElementById('btn-join-room'),
    document.getElementById('btn-matchmaking'),
  ];
}

function getResultsItems() {
  return [
    document.getElementById('btn-rematch'),
    document.getElementById('btn-leave'),
  ];
}

/** Apply .kb-focus to exactly one element in a list, removing from siblings */
function updateFocus(items, idx) {
  items.forEach((el, i) => {
    if (el) el.classList.toggle('kb-focus', i === idx);
  });
}

/** Clear all keyboard focus indicators on the page */
function clearKbFocus() {
  document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));
}

// Clear keyboard focus indicators on mouse interaction
document.addEventListener('mousedown', clearKbFocus);

// ─────────────────────────────────────────────
// Keyboard handlers
// ─────────────────────────────────────────────
window.addEventListener('keydown', e => {
  // Toggle developer boost menu hotkey [B]
  if (e.code === 'KeyB') {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }
    if (typeof window.toggleBoostMenu === 'function') {
      window.toggleBoostMenu();
      e.preventDefault();
      return;
    }
  }

  // Toggle voice control hotkey [V]
  if (e.code === 'KeyV') {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }
    if (typeof window.toggleVoiceControl === 'function') {
      window.toggleVoiceControl();
      e.preventDefault();
      return;
    }
  }

  const modeCount = INPUT_MODES.length;

  if (state === 'onboarding') {
    if (e.code === 'KeyA') {
      p1ModeIdx = (p1ModeIdx - 1 + modeCount) % modeCount;
      updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
      saveModes();
    } else if (e.code === 'KeyD') {
      p1ModeIdx = (p1ModeIdx + 1) % modeCount;
      updateModeSelection(1, p1ModeIdx, p1ProviderIdx);
      saveModes();
    } else if (e.code === 'ArrowLeft') {
      do { p2ModeIdx = (p2ModeIdx - 1 + modeCount) % modeCount; } while (INPUT_MODES[p2ModeIdx].p1Only || INPUT_MODES[p2ModeIdx].p2Disabled);
      updateModeSelection(2, p2ModeIdx, p2ProviderIdx);
      saveModes();
      e.preventDefault();
    } else if (e.code === 'ArrowRight') {
      do { p2ModeIdx = (p2ModeIdx + 1) % modeCount; } while (INPUT_MODES[p2ModeIdx].p1Only || INPUT_MODES[p2ModeIdx].p2Disabled);
      updateModeSelection(2, p2ModeIdx, p2ProviderIdx);
      saveModes();
      e.preventDefault();
    } else if (e.code === 'Enter') {
      startFight();
    }
  } else if (state === 'fighting') {
    if (e.code === 'Enter' && game && game.roundOver && !peerConnection) {
      if (mmWaitingGame) {
        // Return to matchmaking searching screen
        if (game) { game.running = false; game = null; }
        cleanupAdapters();
        mmWaitingGame = false;
        showScreen('matchmaking');
      } else if (selectedCharacter) {
        // Character fight: Enter goes back to character select
        if (game) { game.running = false; game = null; }
        cleanupAdapters();
        p1Input = null; p2Input = null;
        showCharacterSelect();
      } else {
        // Classic single-player: Enter restarts
        showOnboarding();
      }
    }
  } else if (state === 'landing') {
    // Landing: Up/Down between MP / SP / Leaderboard; Enter selects
    const items = getLandingItems();
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      landingFocusIdx = e.code === 'ArrowDown'
        ? (landingFocusIdx + 1) % items.length
        : (landingFocusIdx - 1 + items.length) % items.length;
      updateFocus(items, landingFocusIdx);
    } else if (e.code === 'Enter') {
      const focused = items[landingFocusIdx];
      if (focused) focused.click();
    }
  } else if (state === 'multiplayer') {
    // Multiplayer menu: Up/Down between Create/Join/Matchmaking; Enter selects
    const items = getMpItems();
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      mpFocusIdx = e.code === 'ArrowDown'
        ? (mpFocusIdx + 1) % items.length
        : (mpFocusIdx - 1 + items.length) % items.length;
      updateFocus(items, mpFocusIdx);
    } else if (e.code === 'Enter') {
      items[mpFocusIdx]?.click();
    }
  } else if (state === 'roomController') {
    // Room controller: Up/Down cycles mode pills (skip mpDisabled); Enter confirms
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const dir = e.code === 'ArrowDown' ? 1 : -1;
      let next = roomModeIdx;
      do { next = (next + dir + modeCount) % modeCount; } while (INPUT_MODES[next].mpDisabled);
      roomModeIdx = next;
      updateRoomControllerUI();
    } else if (e.code === 'Enter') {
      const confirmBtn = document.getElementById('btn-ctrl-confirm');
      if (confirmBtn && !confirmBtn.disabled) confirmBtn.click();
    }
  } else if (state === 'matchmaking') {
    // Matchmaking controller select: Up/Down cycles pills; Enter searches
    const mmSelect = document.getElementById('mm-select');
    if (mmSelect && !mmSelect.classList.contains('hidden')) {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const dir = e.code === 'ArrowDown' ? 1 : -1;
        let next = mmModeIdx;
        do { next = (next + dir + modeCount) % modeCount; } while (INPUT_MODES[next].mpDisabled);
        mmModeIdx = next;
        updateMatchmakingControllerUI();
      } else if (e.code === 'Enter') {
        const searchBtn = document.getElementById('btn-mm-search');
        if (searchBtn && !searchBtn.disabled) searchBtn.click();
      }
    }
  } else if (state === 'leaderboard') {
    // Leaderboard: Left/Right switches league tabs
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const tabs = ['voice', 'keyboard'];
      const currentIdx = tabs.indexOf(lbCategory);
      const newIdx = e.code === 'ArrowRight'
        ? (currentIdx + 1) % tabs.length
        : (currentIdx - 1 + tabs.length) % tabs.length;
      loadLeaderboard(tabs[newIdx]);
    }
  } else if (state === 'characterSelect') {
    // Character select: Up/Down (or Left/Right) between characters; Enter fights
    const cards = Array.from(document.querySelectorAll('#char-cards .char-card'));
    if (cards.length > 0) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const dir = (e.code === 'ArrowRight' || e.code === 'ArrowDown') ? 1 : -1;
        const currentIdx = cards.findIndex(c => c.classList.contains('selected'));
        const nextIdx = currentIdx < 0 ? 0 : (currentIdx + dir + cards.length) % cards.length;
        cards[nextIdx]?.click();
      } else if (e.code === 'Enter') {
        if (selectedCharacter) {
          document.getElementById('btn-char-fight')?.click();
        }
      }
    }
  } else if (state === 'matchResults') {
    // Match results: Left/Right between Rematch/Leave; Enter selects
    const items = getResultsItems();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      resultsFocusIdx = e.code === 'ArrowRight' ? 1 : 0;
      updateFocus(items, resultsFocusIdx);
    } else if (e.code === 'Enter') {
      items[resultsFocusIdx]?.click();
    }
  }

  // Escape goes back from any sub-screen
  if (e.code === 'Escape') {
    if (state === 'multiplayer') showScreen('landing');
    else if (state === 'joinRoom') showScreen('multiplayer');
    else if (state === 'roomLobby') { stopRoomPolling(); showScreen('multiplayer'); }
    else if (state === 'roomController') { stopRoomPolling(); showScreen('multiplayer'); }
    else if (state === 'matchmaking') {
      if (mmPlayerId) {
        fetch('/api/matchmaking/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: mmPlayerId }),
        }).catch(() => {});
        stopMatchmakingPoll();
        mmPlayerId = null;
      }
      showScreen('multiplayer');
    }
    else if (state === 'leaderboard') showScreen('landing');
    else if (state === 'matchResults') showLanding();
    else if (state === 'characterSelect') showScreen('landing');
    else if (state === 'onboarding') showScreen('landing');
  }
});

// ─────────────────────────────────────────────
// Auth UI — header login/user section
// ─────────────────────────────────────────────
const headerAuth = document.getElementById('header-auth');

/** Update the header auth section based on login state */
function updateAuthUI() {
  if (!headerAuth) return;

  if (isLoggedIn()) {
    const user = getUser();
    const name = user?.name || 'User';

    // Sync to smf_user_profile
    try {
      const profileStr = localStorage.getItem('smf_user_profile');
      let profile = { name: "Guest Fighter", avatar: "", boosts: 15, walletConnected: false, walletAddress: "", smfBalance: 0 };
      if (profileStr) {
        profile = JSON.parse(profileStr);
      }
      profile.name = name;
      if (user?.avatar) {
        profile.avatar = user.avatar;
      }
      localStorage.setItem('smf_user_profile', JSON.stringify(profile));
    } catch (e) {
      console.warn('[auth] Failed to sync session user to smf_user_profile:', e);
    }

    headerAuth.innerHTML = `
      <span class="auth-user-name" id="auth-display-name">${name}</span>
      <button class="auth-edit-btn" id="btn-auth-edit" title="Edit username">✎</button>
      <input class="auth-name-input hidden" id="auth-name-input" type="text"
        maxlength="30" placeholder="2-30 chars, a-z 0-9 -" spellcheck="false" autocomplete="off">
      <span class="auth-name-error hidden" id="auth-name-error"></span>
      <button class="auth-logout-btn" id="btn-auth-logout">LOG OUT</button>
    `;
    headerAuth.classList.remove('hidden');
    document.getElementById('btn-auth-logout')?.addEventListener('click', () => {
      logout();
      updateAuthUI();
    });
    _setupUsernameEdit();
  } else {
    // Show login button only if OIDC is configured (check cached config)
    headerAuth.innerHTML = `
      <button class="auth-login-btn" id="btn-auth-login">LOG IN</button>
    `;
    // Will be shown/hidden after config check
    headerAuth.classList.add('hidden');
  }
}

/** Wire up inline username editing in the header */
function _setupUsernameEdit() {
  const editBtn = document.getElementById('btn-auth-edit');
  const nameSpan = document.getElementById('auth-display-name');
  const nameInput = document.getElementById('auth-name-input');
  const nameError = document.getElementById('auth-name-error');
  if (!editBtn || !nameSpan || !nameInput || !nameError) return;

  function startEdit() {
    nameInput.value = nameSpan.textContent;
    nameSpan.classList.add('hidden');
    editBtn.classList.add('hidden');
    nameError.classList.add('hidden');
    nameInput.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();
  }

  async function confirmEdit() {
    const newName = nameInput.value.trim();
    const currentName = getUser()?.name || '';
    if (!newName || newName === currentName) {
      cancelEdit();
      return;
    }
    nameInput.disabled = true;
    nameError.classList.add('hidden');
    const result = await updateUsername(newName);
    nameInput.disabled = false;
    if (result.error) {
      nameError.textContent = result.error;
      nameError.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    // Success — update display
    nameSpan.textContent = result.name;
    cancelEdit();
  }

  function cancelEdit() {
    nameInput.classList.add('hidden');
    nameError.classList.add('hidden');
    nameSpan.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  }

  editBtn.addEventListener('click', startEdit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
  nameInput.addEventListener('blur', () => {
    // Small delay so click on error doesn't immediately cancel
    setTimeout(() => {
      if (document.activeElement !== nameInput) cancelEdit();
    }, 150);
  });
}

/** Initialize auth — check session from server cookie */
async function initAuth() {
  const configured = await isAuthConfigured();

  if (!configured) {
    // OIDC not configured — hide auth UI entirely
    headerAuth?.classList.add('hidden');
    return false;
  }

  // Check session from server cookie
  await checkAuth();
  updateAuthUI();

  // Show login button for anonymous users
  if (!isLoggedIn()) {
    headerAuth?.classList.remove('hidden');
    document.getElementById('btn-auth-login')?.addEventListener('click', () => login());
  }

  return false;
}

// ─────────────────────────────────────────────
// URL routing — detect /room/:code or /auth/callback on load
// ─────────────────────────────────────────────
const route = parseRoute();

// Initialize auth (may handle callback route)
initAuth().then(handledRoute => {
  if (handledRoute) return; // Auth callback was handled

  if (route.type === 'room') {
    // Auto-join room from URL — show join screen with code pre-filled, then attempt join
    showScreen('joinRoom');
    roomCodeInput.value = route.code;
    joinGoBtn.disabled = false;
    joinRoom(route.code);
  } else if (route.type === 'leaderboard') {
    showScreen('leaderboard');
    loadLeaderboard(lbCategory);
  } else if (route.type === 'multiplayer') {
    // Direct navigation to /multiplayer (e.g. after auth redirect)
    showScreen('multiplayer');
    window.history.replaceState({}, '', '/');
  } else if (route.type !== 'auth-callback') {
    showScreen('landing');
  }
});

// Expose startFight globally for meme mode
window.startFight = startFight;

window.toggleWeather = function() {
  if (window.effects) window.effects.toggleWeather();
  const btn = document.getElementById('btn-weather');
  if (btn) {
    const modes = { 'rain': '🌧️ RAIN', 'wind': '💨 WIND', 'snow': '❄️ SNOW', 'clear': '☀️ CLEAR' };
    const mobileIcons = { 'rain': '🌧️', 'wind': '💨', 'snow': '❄️', 'clear': '☀️' };
    const curr = window.effects.weatherModes[window.effects.currentWeather];
    const text = modes[curr] || 'WEATHER';
    const icon = mobileIcons[curr] || '🌧️';
    btn.innerHTML = `
      <span class="desktop-text">${text}</span>
      <span class="mobile-text">${icon}</span>
    `;
  }
};

// ─────────────────────────────────────────────
// Premium Victory & Social (Phase 3)
// ─────────────────────────────────────────────

window.showVictoryOverlay = function(winnerNum, token, loserToken) {
  const overlay = document.getElementById('victory-overlay');
  const winText = document.getElementById('victory-text');
  
  const winContainer = document.getElementById('front-card-content');
  const loseContainer = document.getElementById('back-card-content');
  const buyBtn = document.getElementById('btn-buy-token');

  if (!overlay || !winContainer || !loseContainer) return;

  const isPlayer = winnerNum === 1;
  winText.textContent = isPlayer ? 'YOU WIN!' : 'K.O.';
  winText.style.color = isPlayer ? 'var(--neon-blue)' : 'var(--neon-pink)';
  
  winText.style.transform = 'scale(1)';
  winText.style.fontSize = ''; 
  
  if (window.winnerFront === false && window.toggleCards) {
    window.toggleCards();
  }
  
  const lc = document.getElementById('loser-card');
  if (lc) lc.style.opacity = '0'; // Hide loser card initially

  // Helper to render Simple or Rich Card
  const renderCard = (container, tokenData, isWinner) => {
    if (tokenData && (tokenData.marketCap !== undefined || tokenData.liquidity !== undefined)) {
      // RICH CARD
      container.innerHTML = `
        <div class="rich-tabs">
          <button onclick="switchRichTab(0)" class="active">ABOUT</button>
          <button onclick="switchRichTab(1)">SOCIAL</button>
          <button onclick="switchRichTab(2)">SAFETY</button>
        </div>
        <div id="rich-tab-content"></div>
      `;
      if (window.renderRichCard) window.renderRichCard(tokenData, isWinner);
    } else {
      // SIMPLE HUMAN CARD
      const name = isPlayer === isWinner ? 'CHAD' : 'MEME';
      const color = isWinner ? 'var(--neon-green)' : 'var(--neon-pink)';
      container.innerHTML = `
        <div class="card-header" style="color:${color};font-size:14px;font-weight:bold;margin-bottom:15px;letter-spacing:3px;">${isWinner ? 'WINNER' : 'LOSER'}</div>
        <img src="assets/smf-logo.png" style="width:100px;height:100px;border-radius:50%;border:4px solid ${color};">
        <div style="font-size:32px;font-weight:900;color:#fff;margin-top:15px;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">${name}</div>
        <div style="font-style:italic;color:var(--neon-blue);font-size:16px;line-height:1.2;text-shadow:0 0 10px var(--neon-blue);">"I'll be back!"</div>
      `;
    }
  };

  renderCard(winContainer, isPlayer ? null : token, true);
  renderCard(loseContainer, isPlayer ? loserToken : null, false);

  const memeToken = isPlayer ? loserToken : token;
  if (buyBtn && memeToken) {
    buyBtn.style.display = 'block';
    buyBtn.textContent = `BUY $${memeToken.symbol} 🛒`;
    buyBtn.onclick = () => window.open(memeToken.url || `https://dexscreener.com/solana/${memeToken.mint}`, '_blank');
    window.lastOpponentSymbol = memeToken.symbol;
  } else {
    if (buyBtn) buyBtn.style.display = 'none';
    window.lastOpponentSymbol = 'MEME';
  }

  // Capture the canvas screenshot NOW — before the overlay covers it
  window._lastVictoryScreenshot = null;
  const gameCanvas = document.getElementById('game');
  if (gameCanvas) {
    // Try native capture first (fast, but fails if canvas is tainted by cross-origin images)
    let nativeCaptured = false;
    try {
      window._lastVictoryScreenshot = gameCanvas.toDataURL('image/png');
      nativeCaptured = true;
    } catch(_) {
      // Canvas tainted by cross-origin token images — fall through to html2canvas
    }
    // If native failed, use html2canvas (works despite tainted canvas)
    if (!nativeCaptured && typeof html2canvas !== 'undefined') {
      html2canvas(gameCanvas, { useCORS: true, allowTaint: false, scale: 1 })
        .then(c => {
          window._lastVictoryScreenshot = c.toDataURL('image/png');
          console.log('[Victory] Screenshot captured via html2canvas');
        })
        .catch(err => console.warn('[Victory] Screenshot failed:', err.message));
    }
  }

  // Store win/loss state for shareVictory
  window._lastVictoryIsWin = isPlayer;

  // ── 3-second delay before overlay appears ───────────────────────────
  // This lets the player see the final KO frame on the stage
  if (window.effects) window.effects.addCoinRain();

  setTimeout(() => {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    // Animate card reveal after overlay appears
    setTimeout(() => {
      winText.style.transform = 'scale(0.8)';
      winText.style.fontSize = '40px';
      if (lc) lc.style.opacity = '1';
    }, 600);
  }, 3000);

  // Update session stats and start 8s endless-mode countdown
  const sess = window.endlessSession;
  if (sess && sess.active) {
    sess.round++;
    if (winnerNum === 1) { sess.wins++;   sess.streak = Math.max(0, sess.streak) + 1; }
    else                 { sess.losses++; sess.streak = Math.min(0, sess.streak) - 1; }

    // Show session header
    const hdr = document.getElementById('endless-session-header');
    if (hdr) {
      hdr.style.display = 'flex';
      const roundEl  = document.getElementById('endless-round-label');
      const recordEl = document.getElementById('endless-record-label');
      const streakEl = document.getElementById('endless-streak-label');
      if (roundEl)  roundEl.textContent  = 'ROUND ' + sess.round;
      if (recordEl) recordEl.textContent = sess.wins + 'W · ' + sess.losses + 'L';
      if (streakEl) {
        if (sess.streak >= 3)       streakEl.textContent = sess.streak + 'ð¥ STREAK';
        else if (sess.streak <= -3) streakEl.textContent = Math.abs(sess.streak) + 'ð ON TILT';
        else                        streakEl.textContent = '';
      }
    }

    // Start 8-second auto-advance countdown
    const cdEl   = document.getElementById('endless-countdown');
    const cdBar  = document.getElementById('endless-countdown-bar');
    const cdSecs = document.getElementById('endless-countdown-secs');
    if (cdEl && cdBar && cdSecs) {
      cdEl.style.display = 'flex';
      cdBar.style.transition = 'none';
      cdBar.style.width = '100%';

      let remaining = 8;
      cdSecs.textContent = remaining;

      // Force a reflow so the transition reset takes effect
      void cdBar.offsetWidth;
      cdBar.style.transition = 'width 1s linear';
      cdBar.style.width = ((remaining - 1) / 8 * 100) + '%';

      sess._countdownTimer = setInterval(() => {
        remaining--;
        if (cdSecs) cdSecs.textContent = remaining;
        if (cdBar)  cdBar.style.width  = (remaining / 8 * 100) + '%';
        if (remaining <= 0) {
          clearInterval(sess._countdownTimer);
          sess._countdownTimer = null;
          window.nextFight();
        }
      }, 1000);
    }
  }
};

window.shareVictory = async function() {
  const symbol   = window.lastOpponentSymbol || 'MEME';
  const isWin    = window._lastVictoryIsWin !== false; // default true for safety
  const origin   = window.location.origin;

  // Adaptive randomized copy keeping original format/CTA/tags
  const winVariations = [
    `I just SMASHED $${symbol} in the $SMF Stick Fight Arena! 🥊🔥\n\nWho's next? Play at ${origin}\n\n#Solana #MemeFighter #SMF`,
    `Just sent $${symbol} to the absolute shadow realm in $SMF! 💀🥊\n\nBring on the next challenger! Play at ${origin}\n\n#Solana #MemeFighter #SMF`,
    `My stickman just completely BODIED $${symbol} live in the arena! 👊⚡\n\nWho wants some? Play at ${origin}\n\n#Solana #MemeFighter #SMF`
  ];

  const loseVariations = [
    `$${symbol} just SMASHED me in the $SMF Stick Fight Arena! 🥊💀\n\nCan anyone stop them? Play at ${origin}\n\n#Solana #MemeFighter #SMF`,
    `Got absolutely bodied by $${symbol} in the $SMF arena! 💸🪦\n\nI need a rematch! Play at ${origin}\n\n#Solana #MemeFighter #SMF`,
    `$${symbol}'s chart was pumping too hard, they knocked me OUT! 🥊📈\n\nWho can take them down? Play at ${origin}\n\n#Solana #MemeFighter #SMF`
  ];

  let text = '';
  if (window.isMultiplayerMatch) {
    const oppName = window.opponentProfile?.name || 'an opponent';
    const oppText = oppName.toUpperCase();
    const winPvPVariations = [
      `I just SMASHED ${oppText} in real-time PvP inside the $SMF Stick Fight Arena! 🥊🔥\n\nWho wants the smoke next? Challenge me at ${origin}\n\n#Solana #MemeFighter #PvP`,
      `Just sent ${oppText} to the absolute shadow realm in $SMF PvP! 💀🥊\n\nWho's next to get bodied? Play at ${origin}\n\n#Solana #MemeFighter #PvP`,
      `My custom stickman just completely BODIED ${oppText} live in the $SMF PvP arena! 👊⚡\n\nCome and get some: ${origin}\n\n#Solana #MemeFighter #PvP`
    ];

    const losePvPVariations = [
      `${oppText} just SMASHED me in the $SMF PvP Stick Fight Arena! 🥊💀\n\nI need a rematch right now! Play at ${origin}\n\n#Solana #MemeFighter #PvP`,
      `Got absolutely bodied by ${oppText} in the $SMF PvP arena! 💸🪦\n\nGoing back in for revenge! Play at ${origin}\n\n#Solana #MemeFighter #PvP`,
      `${oppText} caught me with a clean combo in $SMF PvP! 🥊📈\n\nWho can take them down? Play at ${origin}\n\n#Solana #MemeFighter #PvP`
    ];
    
    text = isWin
      ? winPvPVariations[Math.floor(Math.random() * winPvPVariations.length)]
      : losePvPVariations[Math.floor(Math.random() * losePvPVariations.length)];
  } else {
    text = isWin 
      ? winVariations[Math.floor(Math.random() * winVariations.length)]
      : loseVariations[Math.floor(Math.random() * loseVariations.length)];
  }

  // Try Web Share API with image (works on mobile Chrome/Safari)
  const screenshot = window._lastVictoryScreenshot;
  if (navigator.share && screenshot) {
    try {
      // Convert dataURL to File blob
      const res  = await fetch(screenshot);
      const blob = await res.blob();
      const file = new File([blob], 'sticklash-battle.png', { type: 'image/png' });
      
      const oppName = window.opponentProfile?.name || 'opponent';
      const shareTitle = window.isMultiplayerMatch 
        ? (isWin ? `I beat ${oppName} in PvP!` : `${oppName} beat me in PvP!`)
        : (isWin ? `I beat $${symbol}!` : `$${symbol} wrecked me!`);

      await navigator.share({
        title: shareTitle,
        text,
        files: [file],
      });
      return;
    } catch (e) {
      console.warn('[Share] Web Share with image failed, falling back:', e);
    }
  }

  // Fallback: Twitter intent (desktop) — image can't be attached via web intent
  // but tweet copy is adaptive and link drives traffic
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
};

window.showMultiplayer = function() {
  const overlay = document.getElementById('victory-overlay');
  if (overlay) overlay.classList.add('hidden');
  showScreen('multiplayer');
};

// Endless Session State
window.endlessSession = {
  active: false,
  round:  0,
  wins:   0,
  losses: 0,
  streak: 0,
  _countdownTimer: null,
};

window._cancelEndlessCountdown = function() {
  if (window.endlessSession._countdownTimer) {
    clearInterval(window.endlessSession._countdownTimer);
    window.endlessSession._countdownTimer = null;
  }
  const cd = document.getElementById('endless-countdown');
  if (cd) cd.style.display = 'none';
};

window.nextFight = async function() {
  window._cancelEndlessCountdown();

  const overlay = document.getElementById('victory-overlay');
  if (overlay) overlay.classList.add('hidden');

  let nextToken = null;

  // Priority 1: pumpQueue from endless-mode launcher
  if (window.pumpQueue && window.pumpQueue.length > 0) {
    nextToken = window.pumpQueue.shift();
  }

  // Priority 2: rotate through trending strip list
  if (!nextToken) {
    let tokens = [];
    if (window.fightTrendingStrip?.tokens?.length > 0) {
      tokens = window.fightTrendingStrip.tokens;
    } else if (window.trendingStrip?.tokens?.length > 0) {
      tokens = window.trendingStrip.tokens;
    }
    if (tokens.length > 0) {
      let nextIndex = 0;
      const curMint = game?.p2?.tokenData?.mint || window.currentGame?.p2?.tokenData?.mint;
      if (curMint) {
        const idx = tokens.findIndex(t => t.mint === curMint);
        if (idx !== -1) nextIndex = (idx + 1) % tokens.length;
      }
      nextToken = tokens[nextIndex];
    }
  }

  // Priority 3: fetch fresh trending as last resort
  if (!nextToken) {
    try {
      const res = await fetch('/api/trending?count=12');
      const fresh = await res.json();
      if (Array.isArray(fresh) && fresh.length > 0) {
        window.pumpQueue = fresh.slice(1);
        nextToken = fresh[0];
      }
    } catch (e) {
      console.error('[nextFight] Trending fetch failed:', e);
    }
  }

  if (!nextToken) {
    console.warn('[nextFight] No next token — reloading');
    location.reload();
    return;
  }

  await window.resetAndFight(nextToken);
};

// ─────────────────────────────────────────────
// Dynamic Voice Control Toggling API
// ─────────────────────────────────────────────
window.activeVoiceAdapter = null;
window.isVoiceControlActive = false;

window.toggleVoiceControl = async function(forceState) {
  const g = window.currentGame;
  if (!g || !g.p1Input) {
    console.warn('[VoiceToggle] No active game or P1 input found.');
    return;
  }

  const micBtn = document.getElementById('mic-toggle-btn');
  const nextState = forceState !== undefined ? forceState : !window.isVoiceControlActive;

  if (nextState) {
    if (window.isVoiceControlActive) return; // already active

    console.log('[VoiceToggle] Activating Voice Control adapter...');
    if (micBtn) {
      micBtn.classList.add('loading');
      const tooltip = micBtn.querySelector('.mic-tooltip');
      if (tooltip) tooltip.innerText = 'REQUESTING MIC...';
    }

    try {
      if (!window.activeVoiceAdapter) {
        window.activeVoiceAdapter = new VoiceAdapter(1);
      }

      if (window.activeVoiceAdapter.setGameRef) {
        window.activeVoiceAdapter.setGameRef(g);
      }

      // Initialize the audio stream & connect WebSocket
      await window.activeVoiceAdapter.attach();
      await window.activeVoiceAdapter.waitUntilReady();

      // Register the adapter dynamically alongside manual keyboard/joystick
      const adapters = g.p1Input.adapters || [];
      if (!adapters.includes(window.activeVoiceAdapter)) {
        g.p1Input.addAdapter(window.activeVoiceAdapter);
      }

      window.isVoiceControlActive = true;

      if (micBtn) {
        micBtn.classList.remove('loading');
        micBtn.classList.add('active');
        const tooltip = micBtn.querySelector('.mic-tooltip');
        if (tooltip) tooltip.innerText = 'VOICE ACTIVE [V]';
      }

      // Play synthetically synthesized up-chime
      if (g.sfx) {
        g.sfx.playMicChime(true);
      }

      console.log('[VoiceToggle] Voice Control is now ACTIVE.');
    } catch (err) {
      console.error('[VoiceToggle] Failed to initialize mic / WS stream:', err);
      window.isVoiceControlActive = false;
      if (window.activeVoiceAdapter) {
        try { await window.activeVoiceAdapter.detach(); } catch (e) {}
        window.activeVoiceAdapter = null;
      }
      if (micBtn) {
        micBtn.classList.remove('loading', 'active');
        const tooltip = micBtn.querySelector('.mic-tooltip');
        if (tooltip) tooltip.innerText = 'MIC DENIED / ERROR';
        
        // Shake / red flash error warning
        micBtn.style.borderColor = 'rgba(255, 0, 80, 0.9)';
        setTimeout(() => { micBtn.style.borderColor = ''; }, 1500);
      }
    }
  } else {
    if (!window.isVoiceControlActive) return; // already inactive

    console.log('[VoiceToggle] Deactivating Voice Control...');

    if (g.p1Input && window.activeVoiceAdapter) {
      g.p1Input.removeAdapter(window.activeVoiceAdapter);
    }

    if (window.activeVoiceAdapter) {
      try { await window.activeVoiceAdapter.detach(); } catch (e) {}
      window.activeVoiceAdapter = null;
    }

    window.isVoiceControlActive = false;

    if (micBtn) {
      micBtn.classList.remove('loading', 'active');
      const tooltip = micBtn.querySelector('.mic-tooltip');
      if (tooltip) tooltip.innerText = 'TOGGLE VOICE CONTROL [V]';
    }

    // Play synthetically synthesized down-chime
    if (g.sfx) {
      g.sfx.playMicChime(false);
    }

    console.log('[VoiceToggle] Voice Control is now INACTIVE.');
  }
};

// ─────────────────────────────────────────────
// Rematch flow — teardown + fresh game start without reloading page
// ─────────────────────────────────────────────
window.rematchFight = async function() {
  console.log('[Rematch] Initiating seamless rematch...');
  
  if (window._cancelEndlessCountdown) {
    window._cancelEndlessCountdown();
  }

  const overlay = document.getElementById('victory-overlay');
  if (overlay) overlay.classList.add('hidden');

  // Check if we are in a multiplayer match
  if (window.isMultiplayerMatch) {
    const roomCode = localStorage.getItem('sf_roomCode');
    const playerId = localStorage.getItem('sf_playerId');
    if (!roomCode || !playerId) { showLanding(); return; }

    try {
      const resp = await fetch('/api/room/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, playerId }),
      });

      if (!resp.ok) {
        console.warn('[rematch] Failed:', resp.status);
        showLanding();
        return;
      }

      // Cleanup existing game objects before going to controller selection
      if (game) {
        game.running = false;
        game.roundOver = true;
      }
      await cleanupAdapters();
      game = null;
      window.currentGame = null;
      window.game = null;
      
      const canvas = document.getElementById('game');
      if (canvas) {
        canvas.classList.remove('active');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // Back to controller selection
      showRoomControllerScreen();
      startRoomPolling();
    } catch (err) {
      console.warn('[rematch] Error:', err);
      showLanding();
    }
    return;
  }

  // 1. Check if we fought an enriched token (Trending Arena / Meme fighter)
  const token = game?.p2?.tokenData || window.currentGame?.p2?.tokenData || window.game?.p2?.tokenData;
  if (token) {
    console.log('[Rematch] Restarting token fight against:', token.symbol);
    await window.resetAndFight(token);
    return;
  }

  // 2. Check if we fought a standard select character
  if (selectedCharacter) {
    console.log('[Rematch] Restarting character fight against:', selectedCharacter);
    if (game) {
      game.running = false;
      game.roundOver = true;
    }
    if (window.liveBoostSystem) {
      try { window.liveBoostSystem.stop(); } catch (e) {}
      window.liveBoostSystem = null;
    }
    await cleanupAdapters();
    game = null;
    window.currentGame = null;
    window.game = null;
    state = 'landing';
    
    const canvas = document.getElementById('game');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    await new Promise(r => setTimeout(r, 32));
    if (window._showMobileControls) window._showMobileControls();
    await startCharacterFight();
    return;
  }

  // 3. Classic / other custom single player match
  console.log('[Rematch] Restarting classic single-player match');
  if (game) {
    game.running = false;
    game.roundOver = true;
  }
  if (window.liveBoostSystem) {
    try { window.liveBoostSystem.stop(); } catch (e) {}
    window.liveBoostSystem = null;
  }
  await cleanupAdapters();
  game = null;
  window.currentGame = null;
  window.game = null;
  state = 'landing';
  
  const canvas = document.getElementById('game');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  
  await new Promise(r => setTimeout(r, 32));
  if (window._showMobileControls) window._showMobileControls();
  await startFight();
};

// ─────────────────────────────────────────────
// Developer Live Boost Simulator Helper API
// ─────────────────────────────────────────────
window.boostTarget = 'p2';
window.setBoostTarget = function(target) {
  window.boostTarget = target;
  const btnP1 = document.getElementById('btn-target-p1');
  const btnP2 = document.getElementById('btn-target-p2');
  if (target === 'p1') {
    if (btnP1) {
      btnP1.style.background = 'var(--neon-green)';
      btnP1.style.color = '#000';
      btnP1.style.borderColor = 'transparent';
    }
    if (btnP2) {
      btnP2.style.background = 'rgba(255,255,255,0.1)';
      btnP2.style.color = '#fff';
      btnP2.style.borderColor = 'rgba(255,255,255,0.2)';
    }
  } else {
    if (btnP2) {
      btnP2.style.background = 'var(--neon-green)';
      btnP2.style.color = '#000';
      btnP2.style.borderColor = 'transparent';
    }
    if (btnP1) {
      btnP1.style.background = 'rgba(255,255,255,0.1)';
      btnP1.style.color = '#fff';
      btnP1.style.borderColor = 'rgba(255,255,255,0.2)';
    }
  }
};

window.triggerSimulatedBoost = function(tierId) {
  const g = window.currentGame || window.game || window._game;
  if (!g) {
    console.warn("No active game to boost");
    return;
  }
  if (!window.liveBoostSystem) {
    const LiveBoostSystem = window.liveBoostSystemClass;
    if (LiveBoostSystem) {
      window.liveBoostSystem = new LiveBoostSystem(g);
      window.liveBoostSystem.start(g.p2, g.p2.tokenData || { symbol: 'TEST', mint: 'testmint', price: 1, volume24h: 1 });
    } else {
      console.error("LiveBoostSystem class not found");
      return;
    }
  }
  
  const tokenData = (g.p2 && g.p2.tokenData) || { symbol: 'TEST', mint: 'testmint', price: 1, volume24h: 1 };
  window.liveBoostSystem.triggerTier(tierId, tokenData, window.boostTarget);
};

window.toggleBoostMenu = function() {
  const menu = document.getElementById('boost-menu');
  if (menu) {
    const isHidden = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = isHidden ? 'block' : 'none';
  }
};
