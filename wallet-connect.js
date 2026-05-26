// wallet-connect.js
// Redesigned User Profile, 100% Mock-Free Solana Wallet, & Premium Boost Store Modal
import { tokenDetailsPath } from './src/api-endpoints.js';

// Initialize user profile in localStorage on module load
export function getProfile() {
  let profile = null;
  try {
    const data = localStorage.getItem('smf_user_profile');
    if (data) {
      profile = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to parse user profile', e);
  }

  if (!profile) {
    profile = {
      name: 'Guest Fighter',
      avatar: null,
      boosts: 15, // Free $3 starter boosts initialized automatically
      walletConnected: false,
      walletReadOnly: false,
      walletAuthenticated: false,
      walletAddress: '',
      smfBalance: 0 // Fetch real balance on-chain
    };
    saveProfile(profile);
  } else {
    let changed = false;
    if (typeof profile.walletReadOnly !== 'boolean') {
      profile.walletReadOnly = false;
      changed = true;
    }
    if (typeof profile.walletAuthenticated !== 'boolean') {
      profile.walletAuthenticated = false;
      changed = true;
    }
    if (profile.walletReadOnly || !profile.walletConnected || !profile.walletAddress) {
      if (profile.walletAuthenticated) {
        profile.walletAuthenticated = false;
        changed = true;
      }
    } else {
      const session = getWalletAuthSession();
      const sessionReady = isSessionValidForWallet(session, profile.walletAddress);
      if (profile.walletAuthenticated !== sessionReady) {
        profile.walletAuthenticated = sessionReady;
        changed = true;
      }
    }
    if (changed) saveProfile(profile);
  }
  return profile;
}

export function saveProfile(profile) {
  try {
    localStorage.setItem('smf_user_profile', JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent('smf_profile_updated', { detail: profile }));
  } catch (e) {
    console.error('Failed to save user profile', e);
  }
}

// Function to compress image using Canvas to save localStorage quota
function compressAndSaveAvatar(file, callback) {
  const reader = new FileReader();
  reader.onload = function (event) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 96;
      const MAX_HEIGHT = 96;
      let width = img.width;
      let height = img.height;

      // Crop or resize to square
      if (width > height) {
        width = Math.round(width * (MAX_HEIGHT / height));
        height = MAX_HEIGHT;
      } else {
        height = Math.round(height * (MAX_WIDTH / width));
        width = MAX_WIDTH;
      }

      canvas.width = MAX_WIDTH;
      canvas.height = MAX_HEIGHT;
      const ctx = canvas.getContext('2d');
      
      // Draw centered square
      ctx.drawImage(img, (MAX_WIDTH - width) / 2, (MAX_HEIGHT - height) / 2, width, height);

      // Compress to JPEG with 0.8 quality
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      callback(compressedDataUrl);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// Async balance update function
export async function updateOnChainBalance(profile) {
  if (!profile.walletConnected || !profile.walletAddress) return;
  try {
    const configRes = await fetch('/api/smf-config');
    const config = await configRes.json();
    const { Connection, PublicKey } = window.solanaWeb3;
    const connection = new Connection(config.solanaRpc, 'confirmed');
    const walletPub = new PublicKey(profile.walletAddress);
    const mintPub = new PublicKey(config.smfMint);
    
    // Derive Associated Token Account (ATA)
    const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const associatedTokenProgramId = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    const [associatedTokenAddress] = await PublicKey.findProgramAddress(
      [
        walletPub.toBuffer(),
        tokenProgramId.toBuffer(),
        mintPub.toBuffer()
      ],
      associatedTokenProgramId
    );
    
    try {
      const balRes = await connection.getTokenAccountBalance(associatedTokenAddress);
      profile.smfBalance = balRes.value.uiAmount || 0;
    } catch (e) {
      console.warn('[Wallet] Failed to fetch token balance, account might not exist. Setting balance to 0.', e);
      profile.smfBalance = 0; // Account not created or has 0 tokens
    }
  } catch (err) {
    console.error('[Wallet] Error checking on-chain balance:', err);
  }
}

let isFetchingPrice = false;
let fetchedSMFPrice = null;
let activeMint = null;
let activeRpc = null;

async function syncServerBoostBalance(profile) {
  if (!profile.walletConnected || !profile.walletAddress) return profile.boosts || 0;
  try {
    const resp = await fetch(`/api/boost/balance?wallet=${encodeURIComponent(profile.walletAddress)}`);
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`Boost balance sync failed (${resp.status}): ${detail}`);
    }
    const data = await resp.json();
    if (typeof data.boosts === 'number') {
      profile.boosts = data.boosts;
      saveProfile(profile);
    }
    return profile.boosts || 0;
  } catch (e) {
    console.warn('[Wallet] Failed to sync authoritative boost balance:', e);
    return profile.boosts || 0;
  }
}

function updateBoostIndicators(boosts) {
  const boostBalCountEl = document.getElementById('boost-balance-count');
  if (boostBalCountEl) {
    boostBalCountEl.textContent = boosts;
  }

  const profileBoostsEl = document.getElementById('profile-boosts-count');
  if (profileBoostsEl) {
    profileBoostsEl.textContent = boosts;
  }
}

function isNativeCapacitorPlatform() {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

function getNativeMwaPlugin() {
  return window.Capacitor?.Plugins?.SolanaMwa || null;
}

function hasNativeMwaBridge() {
  return isNativeCapacitorPlatform() && !!getNativeMwaPlugin();
}

const WALLET_FLOW_IDLE = {
  stage: 'idle',
  title: '',
  message: '',
  tone: 'neutral'
};

function getWalletFlow() {
  return window.smfWalletFlow || WALLET_FLOW_IDLE;
}

function setWalletFlow(stage, title, message, tone = 'neutral') {
  window.smfWalletFlow = {
    stage: String(stage || 'idle'),
    title: String(title || ''),
    message: String(message || ''),
    tone: String(tone || 'neutral')
  };
}

function clearWalletFlow() {
  window.smfWalletFlow = { ...WALLET_FLOW_IDLE };
}

function emitWalletGameplayPause(paused, reason = 'wallet_action') {
  window.dispatchEvent(new CustomEvent('smf_wallet_action_pause', {
    detail: { paused: !!paused, reason: String(reason || 'wallet_action') }
  }));
}

function walletFriendlyErrorMessage(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || err || '');
  const lower = message.toLowerCase();
  if (code.includes('MWA_NO_WALLET') || lower.includes('no mwa wallet')) {
    return 'No compatible Solana wallet app was detected. Install Phantom or Solflare, then retry.';
  }
  if (code.includes('MWA_SENDER_UNAVAILABLE') || lower.includes('still initializing')) {
    return 'The Android wallet bridge is still waking up. Close and reopen StickLash, then retry.';
  }
  if (lower.includes('user rejected') || lower.includes('rejected') || lower.includes('declined') || lower.includes('cancel')) {
    return 'Wallet request was cancelled. No tokens were moved.';
  }
  if (lower.includes('lifecycleowner') || lower.includes('register before')) {
    return 'The Android wallet bridge was not ready. Restart StickLash, then retry.';
  }
  if (lower.includes('signature') || lower.includes('sign')) {
    return 'Wallet signing could not be completed. Please retry and approve the wallet prompt.';
  }
  return 'Wallet connection could not be completed. Please retry from your Solana wallet.';
}

if (hasNativeMwaBridge()) {
  try {
    getNativeMwaPlugin().addListener('walletCallback', (event) => {
      console.log('[Wallet][MWA] callback intent received:', event?.uri || event);
    });
  } catch (e) {
    console.warn('[Wallet][MWA] failed to attach callback listener:', e);
  }
}

const WALLET_AUTH_STORAGE_KEY = 'smf_wallet_auth_session';

function getWalletAuthSession() {
  try {
    const raw = localStorage.getItem(WALLET_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[WalletAuth] Failed to parse stored session:', e);
    return null;
  }
}

function setWalletAuthSession(session) {
  localStorage.setItem(WALLET_AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearWalletAuthSession() {
  localStorage.removeItem(WALLET_AUTH_STORAGE_KEY);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function signWalletAuthMessage(message) {
  const nativeMwa = getNativeMwaPlugin();
  if (nativeMwa) {
    const signed = await nativeMwa.signMessage({ message });
    const signatureBase64 = String(signed?.signatureBase64 || '').trim();
    if (!signatureBase64) {
      throw new Error('Native wallet bridge returned an empty signature.');
    }
    return signatureBase64;
  }

  if (!window.solana || typeof window.solana.signMessage !== 'function') {
    throw new Error('Wallet does not support message signing.');
  }
  const encoded = new TextEncoder().encode(message);
  const signed = await window.solana.signMessage(encoded, 'utf8');
  const signatureBytes = signed?.signature || signed;
  if (!signatureBytes) {
    throw new Error('Wallet did not return a signature.');
  }
  return bytesToBase64(signatureBytes);
}

async function nativeMwaSignAndSendSerializedTx(transaction) {
  const nativeMwa = getNativeMwaPlugin();
  if (!nativeMwa) {
    throw new Error('Native Solana bridge unavailable.');
  }
  const serialized = transaction.serialize({
    verifySignatures: false,
    requireAllSignatures: false
  });
  const signed = await nativeMwa.signAndSendTransaction({
    transactionBase64: bytesToBase64(serialized)
  });
  const signatureBase58 = String(signed?.signatureBase58 || '').trim();
  if (!signatureBase58) {
    throw new Error('Native wallet bridge returned an empty transaction signature.');
  }
  return { signature: signatureBase58 };
}

function isSessionValidForWallet(session, walletAddress) {
  if (!session) return false;
  if (session.wallet !== walletAddress) return false;
  if (!session.token) return false;
  if (!session.expiresAtUnix) return false;
  const now = Math.floor(Date.now() / 1000);
  return now < Number(session.expiresAtUnix);
}

function isWalletAuthenticated(profile) {
  if (!profile || !profile.walletConnected || profile.walletReadOnly || !profile.walletAddress) {
    return false;
  }
  return isSessionValidForWallet(getWalletAuthSession(), profile.walletAddress);
}

function buildStoredWalletAuthHeaders(walletAddress) {
  const session = getWalletAuthSession();
  if (!isSessionValidForWallet(session, walletAddress)) {
    return null;
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.token}`
  };
}

async function ensureWalletAuthSession(walletAddress, { forceRefresh = false } = {}) {
  if (!walletAddress) throw new Error('Wallet address missing.');
  if (!window.solana && !hasNativeMwaBridge()) {
    throw new Error('Wallet provider unavailable.');
  }

  const existing = getWalletAuthSession();
  if (!forceRefresh && isSessionValidForWallet(existing, walletAddress)) {
    return existing.token;
  }

  const challengeResp = await fetch('/api/wallet-auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: walletAddress })
  });
  if (!challengeResp.ok) {
    const err = await challengeResp.text();
    throw new Error(`Wallet auth challenge failed (${challengeResp.status}): ${err}`);
  }
  const challenge = await challengeResp.json();
  const signature = await signWalletAuthMessage(String(challenge.message || ''));

  const verifyResp = await fetch('/api/wallet-auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: walletAddress,
      challengeId: challenge.challengeId,
      signature
    })
  });
  if (!verifyResp.ok) {
    const err = await verifyResp.text();
    throw new Error(`Wallet auth verify failed (${verifyResp.status}): ${err}`);
  }
  const verified = await verifyResp.json();
  const session = {
    wallet: walletAddress,
    token: verified.token,
    expiresAtUnix: verified.expiresAtUnix
  };
  setWalletAuthSession(session);
  return session.token;
}

async function buildWalletAuthHeaders(walletAddress, { forceRefresh = false } = {}) {
  const token = await ensureWalletAuthSession(walletAddress, { forceRefresh });
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

async function fetchWithWalletAuth(walletAddress, url, options = {}) {
  const {
    allowInteractiveReauth = true,
    ...fetchOptions
  } = options;
  const method = fetchOptions.method || 'GET';
  const body = fetchOptions.body;
  let headers = {
    ...(fetchOptions.headers || {}),
    ...(await buildWalletAuthHeaders(walletAddress))
  };
  let resp = await fetch(url, {
    ...fetchOptions,
    method,
    headers,
    body
  });
  if (resp.status === 401 && allowInteractiveReauth) {
    headers = {
      ...(fetchOptions.headers || {}),
      ...(await buildWalletAuthHeaders(walletAddress, { forceRefresh: true }))
    };
    resp = await fetch(url, {
      ...fetchOptions,
      method,
      headers,
      body
    });
  }
  return resp;
}

async function logoutWalletAuthSession(walletAddress) {
  const session = getWalletAuthSession();
  if (!isSessionValidForWallet(session, walletAddress)) {
    clearWalletAuthSession();
    return;
  }
  try {
    await fetch('/api/wallet-auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`
      },
      body: JSON.stringify({ wallet: walletAddress })
    });
  } catch (e) {
    console.warn('[WalletAuth] logout call failed:', e);
  } finally {
    clearWalletAuthSession();
  }
}

async function consumeServerBoost(walletAddress, units = 1, reason = 'hadouken') {
  const consumeId = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = buildStoredWalletAuthHeaders(walletAddress);
  if (!headers) {
    return {
      ok: false,
      status: 401,
      error: 'Wallet security sign-in required before boosts can be spent.'
    };
  }
  let resp = null;
  try {
    resp = await fetch('/api/boost/consume', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wallet: walletAddress,
        units,
        reason,
        consumeId
      })
    });
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: e.message || 'Wallet session required'
    };
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const body = await resp.json();
      detail = body?.detail || '';
    } catch {
      try {
        detail = await resp.text();
      } catch {
        detail = '';
      }
    }
    return {
      ok: false,
      status: resp.status,
      error: detail || `Boost consume failed (${resp.status})`
    };
  }
  const data = await resp.json();
  return {
    ok: true,
    boosts: typeof data.boosts === 'number' ? data.boosts : null,
    idempotent: !!data.idempotent
  };
}

window.consumeBoostForHadouken = async function(walletAddress) {
  const profile = getProfile();
  if (!walletAddress) {
    return { ok: false, error: 'Wallet address missing for boost consume.' };
  }
  const consume = await consumeServerBoost(walletAddress, 1, 'hadouken');
  if (consume.ok && typeof consume.boosts === 'number') {
    profile.boosts = consume.boosts;
    saveProfile(profile);
    updateBoostIndicators(profile.boosts);
  }
  return consume;
};

export async function showWalletConnect(options = {}) {
  if (options && typeof options === 'object') {
    const previousContext = window.walletModalContext || {};
    const nextContext = {
      ...previousContext,
      ...options
    };
    if (nextContext.pauseGameplay) {
      nextContext.pauseReason = String(
        nextContext.pauseReason ||
        options.pauseReason ||
        previousContext.pauseReason ||
        'wallet_modal'
      );
    }
    window.walletModalContext = {
      ...nextContext
    };
  }
  const modalContext = window.walletModalContext || {};
  const focusStore = !!modalContext.focusStore;
  const nativeMwaBridge = hasNativeMwaBridge();
  if (modalContext.pauseGameplay) {
    emitWalletGameplayPause(true, modalContext.pauseReason || 'wallet_modal');
  }

  let modal = document.getElementById('wallet-connect-panel');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'wallet-connect-panel';
    modal.className = 'screen hidden';
    modal.style.zIndex = '2100'; // Make sure it floats on top of everything
    document.body.appendChild(modal);
  }

  // Create full transaction overlay if missing
  let txOverlay = document.getElementById('solana-tx-overlay');
  if (!txOverlay) {
    txOverlay = document.createElement('div');
    txOverlay.id = 'solana-tx-overlay';
    txOverlay.style.position = 'fixed';
    txOverlay.style.top = '0';
    txOverlay.style.left = '0';
    txOverlay.style.width = '100vw';
    txOverlay.style.height = '100vh';
    txOverlay.style.background = 'rgba(10, 10, 15, 0.9)';
    txOverlay.style.backdropFilter = 'blur(15px)';
    txOverlay.style.zIndex = '3000';
    txOverlay.style.display = 'none';
    txOverlay.style.alignItems = 'center';
    txOverlay.style.justifyContent = 'center';
    txOverlay.style.color = 'white';
    txOverlay.style.fontFamily = "var(--font-print, 'Press Start 2P', system-ui, sans-serif)";
    txOverlay.style.textAlign = 'center';
    txOverlay.style.padding = '20px';
    txOverlay.innerHTML = `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px; max-width: 400px; width: 90%; box-shadow: 0 0 30px rgba(0,255,157,0.15);">
        <div id="tx-spinner" class="tx-fire-glow" style="font-size: 40px; margin-bottom: 20px;">⚡</div>
        <h4 id="tx-title" style="color: var(--neon-green); font-size: 14px; margin-bottom: 15px; letter-spacing: 1px;">SOLANA TRANSACTION</h4>
        <div id="tx-status-step" style="font-size: 11px; line-height: 1.8; color: #ccc;">Initialising secure link...</div>
      </div>
    `;
    document.body.appendChild(txOverlay);
  }

  // Fetch config and token price asynchronously once
  if (!fetchedSMFPrice && !isFetchingPrice) {
    isFetchingPrice = true;
    try {
      const configRes = await fetch('/api/smf-config');
      const config = await configRes.json();
      activeMint = config.smfMint;
      activeRpc = config.solanaRpc;
      
      const tokenRes = await fetch(tokenDetailsPath(config.smfMint));
      if (tokenRes.ok) {
        const tokenInfo = await tokenRes.json();
        if (tokenInfo && tokenInfo.price) {
          fetchedSMFPrice = tokenInfo.price;
        }
      }
    } catch (e) {
      console.warn('[Wallet] Config/price fetch failed:', e);
    } finally {
      isFetchingPrice = false;
      fetchedSMFPrice = fetchedSMFPrice || 0.00762; // fallback
      
      const profile = getProfile();
      if (profile.walletConnected && profile.walletAddress) {
        await updateOnChainBalance(profile);
        await syncServerBoostBalance(profile);
        saveProfile(profile);
      }
      
      // Trigger modal redraw after async fetch finishes
      showWalletConnect();
    }
  }

  const profile = getProfile();
  const walletAuthReady = isWalletAuthenticated(profile);
  const walletFlow = getWalletFlow();
  const walletStatusLabel = profile.walletConnected
    ? (profile.walletReadOnly ? 'READ-ONLY' : (walletAuthReady ? 'SECURE' : 'CONNECTED'))
    : 'DISCONNECTED';
  const walletStatusColor = profile.walletConnected
    ? (profile.walletReadOnly ? '#ffcc00' : (walletAuthReady ? 'var(--neon-green)' : 'var(--neon-blue)'))
    : '#ff3b30';
  
  // Custom HSL/fluctuating price for SMF
  const smfPrice = fetchedSMFPrice || 0.00762; 
  const pack1SMF = Math.round(1.00 / smfPrice);
  const pack2SMF = Math.round(3.00 / smfPrice);
  const pack3SMF = Math.round(5.00 / smfPrice);

  // Set up local style injection
  if (!document.getElementById('profile-widget-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'profile-widget-styles';
    styleEl.innerHTML = `
      .profile-avatar-upload {
        position: relative;
        width: 70px;
        height: 70px;
        margin: 0 auto 10px auto;
        border-radius: 50%;
        border: 2px solid var(--neon-green);
        box-shadow: 0 0 10px rgba(20,241,149,0.3);
        cursor: pointer;
        overflow: hidden;
      }
      .profile-avatar-upload img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .profile-avatar-upload .overlay-text {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        background: rgba(0,0,0,0.6);
        color: #fff;
        font-size: 7px;
        padding: 2px 0;
        text-align: center;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .profile-avatar-upload:hover .overlay-text {
        opacity: 1;
      }
      .profile-field-input {
        background: rgba(255,255,255,0.05) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        border-radius: 8px !important;
        color: #fff !important;
        padding: 6px 12px !important;
        font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif) !important;
        font-size: 11px !important;
        text-align: center !important;
        width: 160px !important;
        transition: all 0.3s ease !important;
      }
      .profile-field-input:focus {
        border-color: var(--neon-green) !important;
        box-shadow: 0 0 8px rgba(20,241,149,0.2) !important;
        outline: none !important;
      }
      .store-package-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: all 0.2s ease;
      }
      .store-package-card:hover {
        background: rgba(255,255,255,0.06);
        border-color: rgba(255,255,255,0.2);
        transform: translateY(-1px);
      }
      .store-package-card.locked {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .buy-smf-btn {
        background: var(--neon-pink);
        border: none;
        border-radius: 8px;
        color: #000;
        cursor: pointer;
        font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
        font-size: 9px;
        font-weight: bold;
        padding: 6px 10px;
        transition: all 0.2s ease;
      }
      .buy-smf-btn:hover:not(:disabled) {
        box-shadow: 0 0 10px var(--neon-pink);
        transform: scale(1.03);
      }
      .buy-smf-btn:disabled {
        background: #555;
        color: #888;
        cursor: not-allowed;
      }
      .tx-fire-glow {
        animation: firePulse 1.5s infinite alternate;
      }
      .wallet-store-focus {
        border-color: rgba(255, 170, 0, 0.5) !important;
        box-shadow: 0 0 24px rgba(255, 170, 0, 0.25);
      }
      @keyframes storePulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.01); }
        100% { transform: scale(1); }
      }
      .wallet-store-focus-animate {
        animation: storePulse 1.8s ease-in-out infinite;
      }
      .wallet-flow-banner {
        background: linear-gradient(135deg, rgba(20,241,149,0.10), rgba(0,194,255,0.08));
        border: 1px solid rgba(20,241,149,0.22);
        border-radius: 12px;
        padding: 10px;
        margin-bottom: 10px;
        box-shadow: 0 0 18px rgba(20,241,149,0.08);
      }
      .wallet-flow-banner.warn {
        background: linear-gradient(135deg, rgba(255,204,0,0.12), rgba(255,0,255,0.06));
        border-color: rgba(255,204,0,0.28);
      }
      .wallet-flow-banner.error {
        background: linear-gradient(135deg, rgba(255,59,48,0.12), rgba(255,0,255,0.05));
        border-color: rgba(255,59,48,0.35);
      }
      .wallet-flow-title {
        color: var(--neon-green);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 0.6px;
        margin-bottom: 5px;
      }
      .wallet-flow-copy {
        color: #d8f8ff;
        font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
        font-size: 7px;
        line-height: 1.55;
      }
      .wallet-step-row {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 8px;
        align-items: start;
        color: #cbd7df;
        font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);
        font-size: 7px;
        line-height: 1.45;
        margin-top: 7px;
      }
      .wallet-step-dot {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.18);
        color: #888;
        font-size: 8px;
      }
      .wallet-step-dot.done {
        background: rgba(20,241,149,0.16);
        border-color: rgba(20,241,149,0.55);
        color: var(--neon-green);
        box-shadow: 0 0 10px rgba(20,241,149,0.25);
      }
      .wallet-step-dot.active {
        background: rgba(0,194,255,0.16);
        border-color: rgba(0,194,255,0.55);
        color: var(--neon-blue);
        box-shadow: 0 0 10px rgba(0,194,255,0.25);
      }
      @keyframes firePulse {
        0% { text-shadow: 0 0 5px #ff3300, 0 0 10px #ff3300; transform: scale(1); }
        100% { text-shadow: 0 0 15px #ff9900, 0 0 25px #ff5500; transform: scale(1.1); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // Generate profile avatar HTML
  const avatarSrc = profile.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%2314f195" fill-opacity="0.1" stroke="%2314f195" stroke-width="2"/><path d="M50 30a12 12 0 1 0 0 24 12 12 0 1 0 0-24zm0 28c-18 0-30 10-30 20v4h60v-4c0-10-12-20-30-20z" fill="%2314f195"/></svg>';
  modal.innerHTML = `
    <div style="color: white; font-family: var(--font-display, 'Shojumaru', 'Press Start 2P', sans-serif); text-align: center; max-height: 80vh; overflow-y: auto; padding-right: 5px;">
      
      <!-- HEADER -->
      <h3 style="color: var(--neon-green); margin-bottom: 15px; font-size: 14px; letter-spacing: 2px; text-shadow: 0 0 8px rgba(20,241,149,0.3);">👤 USER FIGHTER PROFILE</h3>
      
      <!-- PROFILE SECTION -->
      <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 16px; margin-bottom: 12px;">
        <div class="profile-avatar-upload" onclick="document.getElementById('avatar-file-input').click()">
          <img id="profile-modal-pic" src="${avatarSrc}" alt="Avatar">
          <div class="overlay-text">CHANGE</div>
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" style="display: none;">
        
        <div style="margin-top: 5px;">
          <input type="text" id="username-input" class="profile-field-input" value="${profile.name}" maxLength="15" placeholder="Enter Nickname">
          <div style="font-size: 7px; color: #888; margin-top: 4px;">Click to edit name. Auto-appears in fight HUD</div>
        </div>
      </div>
      
      <!-- WALLET CENTER SECTION (Optional, Mock-Free) -->
      <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 16px; margin-bottom: 12px; text-align: left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <span style="font-size: 10px; font-weight: bold; color: var(--neon-blue); letter-spacing: 0.5px;">🔑 SOLANA WALLET ${nativeMwaBridge ? '(ANDROID MWA)' : ''}</span>
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="width: 6px; height: 6px; border-radius:50%; background: ${walletStatusColor}; box-shadow: 0 0 6px ${walletStatusColor};"></span>
            <span style="font-size: 8px; color: #aaa;">${walletStatusLabel}</span>
          </div>
        </div>

        ${walletFlow.stage !== 'idle' && walletFlow.title ? `
          <div class="wallet-flow-banner ${walletFlow.tone === 'error' ? 'error' : (walletFlow.tone === 'warn' ? 'warn' : '')}">
            <div class="wallet-flow-title">${walletFlow.title}</div>
            <div class="wallet-flow-copy">${walletFlow.message}</div>
          </div>
        ` : ''}
        
        ${profile.walletConnected ? `
          <div style="background: rgba(0,194,255,0.05); border: 1px solid rgba(0,194,255,0.15); padding: 10px; border-radius: 8px; font-size: 9px; font-family: var(--font-print, 'Press Start 2P', system-ui, sans-serif);">
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
              <span style="color:#aaa;">Address:</span>
              <span style="color:#fff;" title="${profile.walletAddress}">${profile.walletAddress.substring(0, 6)}...${profile.walletAddress.substring(profile.walletAddress.length - 4)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
              <span style="color:#aaa;">Token Balance:</span>
              <span style="color:var(--neon-green); font-weight:bold;">${Number(profile.smfBalance).toLocaleString(undefined, {maximumFractionDigits: 4})} $SMF</span>
            </div>
            ${!profile.walletReadOnly ? `
              <div style="background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px; margin:8px 0;">
                <div class="wallet-step-row">
                  <span class="wallet-step-dot done">1</span>
                  <span>Wallet connected. Phantom returned your public address to StickLash.</span>
                </div>
                <div class="wallet-step-row">
                  <span class="wallet-step-dot ${walletAuthReady ? 'done' : 'active'}">2</span>
                  <span>${walletAuthReady ? 'Security sign-in complete. Boost buys and spends are unlocked.' : 'Sign one free message so our server can protect your boost balance. No tokens move.'}</span>
                </div>
              </div>
              ${walletAuthReady ? `
                <div style="font-size: 8px; color: var(--neon-green); margin-bottom: 8px; line-height: 1.35;">
                  SECURE SESSION ACTIVE: wallet actions can use server-authoritative boosts without interrupting gameplay.
                </div>
              ` : `
                <button onclick="window.secureWalletSignIn()" class="premium-btn" style="padding: 7px 10px; font-size: 8px; width: 100%; margin-bottom: 8px; border-color: rgba(20,241,149,0.45);">
                  SIGN FREE SECURITY MESSAGE
                </button>
              `}
            ` : ''}
            ${profile.walletReadOnly ? `
              <div style="font-size: 8px; color: #ffcc00; margin-bottom: 8px; line-height: 1.35;">
                READ-ONLY MODE: Open StickLash inside Phantom/Backpack browser to sign secure actions.
              </div>
            ` : ''}
            <button onclick="window.disconnectSolanaWallet()" style="background: rgba(255,59,48,0.1); border: 1px solid #ff3b30; color: #ff3b30; font-family:inherit; font-size:8px; border-radius: 4px; padding: 4px 8px; cursor:pointer; width: 100%; transition: all 0.2s;">
              DISCONNECT WALLET
            </button>
          </div>
        ` : (window.showWalletConnectionOptions ? `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); padding: 10px; border-radius: 8px; font-size: 9px; line-height: 1.4; color: #ccc;">
            <div style="font-weight:bold; color:var(--neon-green); font-size: 9px; margin-bottom: 8px; text-align:center;">🔗 CONNECT SOLANA WALLET</div>

            ${nativeMwaBridge ? `
              <p style="font-size: 8px; color: #bbb; margin-bottom: 10px; line-height: 1.3;">
                No compatible wallet app was detected for native Android signing. Install Phantom or Solflare, then retry.
              </p>
              <button onclick="window.connectSolanaWallet()" class="premium-btn" style="padding: 6px 10px; font-size: 8px; width: 100%; margin-bottom: 8px; border-color: rgba(20,241,149,0.3);">
                RETRY WALLET DETECTION
              </button>
            ` : `
              <p style="font-size: 8px; color: #bbb; margin-bottom: 10px; line-height: 1.3;">
                To buy boosts and sign transactions, open this game in your wallet's browser. Or, sync your address manually in Read-Only mode.
              </p>
              <button onclick="window.copyGameUrlToClipboard()" class="premium-btn" style="padding: 6px 10px; font-size: 8px; width: 100%; margin-bottom: 8px; border-color: rgba(20,241,149,0.3);">
                OPTION A: COPY GAME LINK TO WALLET
              </button>
            `}

            <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; margin-top: 6px;">
              <div style="font-weight:bold; color:var(--neon-blue); font-size: 8px; margin-bottom: 6px;">SYNC ADDRESS (READ-ONLY)</div>
              <div style="display:flex; gap:6px;">
                <input type="text" id="manual-wallet-input" placeholder="Paste Solana Public Key" style="flex:1; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:4px 8px; color:white; font-family:var(--font-print, 'Press Start 2P', system-ui, sans-serif); font-size:8px;">
                <button onclick="window.syncManualSolanaAddress()" style="background:var(--neon-blue); border:none; color:black; font-family:inherit; font-size:8px; font-weight:bold; border-radius:4px; padding:4px 10px; cursor:pointer;">
                  SYNC
                </button>
              </div>
              <span id="manual-wallet-error" style="color:#ff3b30; font-size:7px; display:block; margin-top:3px;"></span>
            </div>

            <button onclick="window.cancelWalletOptions()" style="background:transparent; border:none; color:#888; font-family:inherit; font-size:8px; display:block; margin:8px auto 0 auto; cursor:pointer; text-decoration:underline;">
              Cancel
            </button>
          </div>
        ` : `
          <p style="font-size: 8px; color: #bbb; margin-bottom: 8px; line-height: 1.4;">Connecting your wallet is optional. Holds your $SMF tokens to buy premium boost packs.</p>
          <button onclick="window.connectSolanaWallet()" class="premium-btn" style="padding: 8px 12px; font-size: 9px; width: 100%; letter-spacing: 0.5px;">
            ${nativeMwaBridge ? 'CONNECT VIA ANDROID WALLET (MWA)' : 'CONNECT SOLANA WALLET'}
          </button>
        `)}
      </div>
      
      <!-- PREMIUM BOOST STORE SECTION -->
      <div id="boost-store-section" class="${focusStore ? 'wallet-store-focus wallet-store-focus-animate' : ''}" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 16px; margin-bottom: 12px; text-align: left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
          <span style="font-size: 10px; font-weight: bold; color: var(--neon-pink); letter-spacing: 0.5px;">⚡ PREMIUM BOOST STORE</span>
          <span style="font-size: 9px; background: rgba(255,0,255,0.1); border: 1px solid var(--neon-pink); padding: 2px 8px; border-radius: 10px; color: var(--neon-pink); font-weight:bold;">
            <span id="profile-boosts-count">${profile.boosts}</span> BOOSTS ACTIVE
          </span>
        </div>
        ${focusStore ? `
          <div style="font-size: 8px; color: #ffcc00; margin-bottom: 8px; font-weight: bold; letter-spacing: 0.4px;">
            ⚠️ OUT OF BOOSTS: BUY A PACK TO RESUME THE FIGHT.
          </div>
        ` : ''}
        
        <p style="font-size: 8px; color: #888; margin-bottom: 8px; line-height: 1.4;">
          Staking is unsafe. Instead, use connected wallet $SMF tokens to **buy boost packs**! All $SMF spent is **burned forever** 🔥 (Solana Burn Program).
        </p>

        <!-- PACKAGES -->
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom: 8px;">
          <!-- Pack 1 -->
          <div class="store-package-card ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'locked' : ''}">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:#fff;">🔵 Micro Pack (5 Premium Boosts)</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $1.00 <span style="color:#aaa;">(~${pack1SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'disabled' : ''} onclick="window.purchaseBoostPack('micro')">
              BUY & BURN
            </button>
          </div>
          <!-- Pack 2 -->
          <div class="store-package-card ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'locked' : ''}" style="border-color: rgba(20,241,149,0.3); background: rgba(20,241,149,0.02);">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:var(--neon-green);">🔥 Degen Pack (20 Boosts) - BEST VALUE</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $3.00 <span style="color:#aaa;">(~${pack2SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'disabled' : ''} style="background: var(--neon-green);" onclick="window.purchaseBoostPack('degen')">
              BUY & BURN
            </button>
          </div>
          <!-- Pack 3 -->
          <div class="store-package-card ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'locked' : ''}">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:#fff;">⚡ Chaos Pack (45 Premium Boosts)</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $5.00 <span style="color:#aaa;">(~${pack3SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? 'disabled' : ''} onclick="window.purchaseBoostPack('chaos')">
              BUY & BURN
            </button>
          </div>
        </div>
        
        ${(!profile.walletConnected || profile.walletReadOnly || !walletAuthReady) ? `
          <div style="font-size: 7px; color:${profile.walletReadOnly ? '#ffcc00' : (!walletAuthReady && profile.walletConnected ? 'var(--neon-blue)' : '#ff3b30')}; text-align:center; font-weight:bold; letter-spacing:0.3px;">${profile.walletReadOnly ? '⚠️ READ-ONLY MODE CANNOT PURCHASE. OPEN IN WALLET BROWSER.' : (!walletAuthReady && profile.walletConnected ? '⚠️ SIGN FREE SECURITY MESSAGE TO UNLOCK PURCHASES' : '⚠️ CONNECT SOLANA WALLET TO UNLOCK PURCHASES')}</div>
        ` : ''}
      </div>

      <!-- ACTION BUTTONS -->
      <button class="premium-btn" onclick="window.hideWalletConnect()" style="font-size: 10px; padding: 12px 20px; width: 100%; border-color: rgba(255,255,255,0.2);">
        CLOSE WIDGET
      </button>
    </div>
  `;

  // Attach event handlers
  const fileInput = document.getElementById('avatar-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) {
        compressAndSaveAvatar(e.target.files[0], function (compressedBase64) {
          const prof = getProfile();
          prof.avatar = compressedBase64;
          saveProfile(prof);
          
          // Update local elements
          const modalPic = document.getElementById('profile-modal-pic');
          if (modalPic) modalPic.src = compressedBase64;
          
          // Notify active game P1
          const activeGame = window.currentGame || window.game || window._game;
          if (activeGame && activeGame.p1) {
            activeGame.p1.headImage = new Image();
            activeGame.p1.headImage.src = compressedBase64;
          }

          console.log('[Profile] Compressed Base64 profile photo updated successfully.');
        });
      }
    });
  }

  const usernameInput = document.getElementById('username-input');
  if (usernameInput) {
    usernameInput.addEventListener('change', function () {
      const newName = usernameInput.value.trim() || 'Guest Fighter';
      const prof = getProfile();
      prof.name = newName;
      saveProfile(prof);
      
      // Update active game P1 label
      const activeGame = window.currentGame || window.game || window._game;
      if (activeGame) {
        activeGame.p1Label = newName;
      }
      console.log('[Profile] Saved new name:', newName);
    });
  }

  // Unhide modal
  modal.classList.remove('hidden');

  if (focusStore) {
    const storeSection = document.getElementById('boost-store-section');
    if (storeSection && typeof storeSection.scrollIntoView === 'function') {
      setTimeout(() => {
        storeSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 20);
    }
  }
}

export function hideWalletConnect() {
  const modal = document.getElementById('wallet-connect-panel');
  const modalContext = window.walletModalContext || {};
  if (modal) {
    modal.classList.add('hidden');
  }
  if (modalContext.pauseGameplay) {
    emitWalletGameplayPause(false, modalContext.pauseReason || 'wallet_modal');
  }
  window.walletModalContext = null;
}

async function refreshConnectedWalletProfile(publicKeyStr, { authenticated = false } = {}) {
  const profile = getProfile();
  profile.walletConnected = true;
  profile.walletReadOnly = false;
  profile.walletAuthenticated = !!authenticated && isWalletAuthenticated({ ...profile, walletAddress: publicKeyStr });
  profile.walletAddress = publicKeyStr;

  await updateOnChainBalance(profile);
  await syncServerBoostBalance(profile);

  profile.walletAuthenticated = isWalletAuthenticated(profile);
  saveProfile(profile);
  updateBoostIndicators(profile.boosts);
  return profile;
}

window.secureWalletSignIn = async function(options = {}) {
  const { silent = false } = options || {};
  const profile = getProfile();
  if (!profile.walletConnected || profile.walletReadOnly || !profile.walletAddress) {
    if (!silent) alert('⚠️ Connect a signing wallet first.');
    return false;
  }

  if (isWalletAuthenticated(profile)) {
    profile.walletAuthenticated = true;
    saveProfile(profile);
    return true;
  }

  try {
    setWalletFlow(
      'awaiting_signature',
      'SECURE SIGN-IN',
      'Opening Phantom for a free message signature. This proves wallet ownership and does not move tokens.',
      'warn'
    );
    emitWalletGameplayPause(true, 'wallet_security_signin');
    showWalletConnect();

    await ensureWalletAuthSession(profile.walletAddress, { forceRefresh: true });

    profile.walletAuthenticated = true;
    await syncServerBoostBalance(profile);
    saveProfile(profile);
    updateBoostIndicators(profile.boosts);

    setWalletFlow(
      'ready',
      'WALLET READY',
      'Secure session active. Boost buys and boost spends are now unlocked without surprise signing during gameplay.',
      'success'
    );
    showWalletConnect();

    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.showBoostMessage) {
      activeGame.showBoostMessage('⚡ WALLET SECURITY READY!', 'runner');
    }
    return true;
  } catch (err) {
    console.error('Wallet security sign-in failed:', err);
    const profileAfterError = getProfile();
    profileAfterError.walletAuthenticated = false;
    saveProfile(profileAfterError);
    setWalletFlow(
      'signature_failed',
      'SIGN-IN NOT FINISHED',
      walletFriendlyErrorMessage(err),
      'error'
    );
    showWalletConnect();
    if (!silent) alert('⚠️ ' + walletFriendlyErrorMessage(err));
    return false;
  } finally {
    emitWalletGameplayPause(false, 'wallet_security_signin');
  }
};

// Global hook: connect wallet (Real & Mock-Free)
window.connectSolanaWallet = async function() {
  try {
    const nativeMwa = getNativeMwaPlugin();
    let publicKeyStr = '';

    setWalletFlow(
      'opening_wallet',
      nativeMwa ? 'OPENING PHANTOM' : 'OPENING WALLET',
      nativeMwa
        ? 'Approve the StickLash connection in your Android wallet. You should return here after account selection.'
        : 'Approve the wallet connection prompt, then finish the free security sign-in.',
      'warn'
    );
    emitWalletGameplayPause(true, 'wallet_connect');
    showWalletConnect();

    if (nativeMwa) {
      const result = await nativeMwa.connect();
      publicKeyStr = String(result?.walletAddress || '').trim();
      if (!publicKeyStr) {
        throw new Error('Native wallet bridge did not return a wallet address.');
      }
      window.showWalletConnectionOptions = false;
    } else if (window.solana) {
      const resp = await window.solana.connect();
      publicKeyStr = resp.publicKey.toString();
      window.showWalletConnectionOptions = false;
    } else {
      // No native bridge and no browser wallet.
      window.showWalletConnectionOptions = true;
      showWalletConnect();
      return;
    }

    await refreshConnectedWalletProfile(publicKeyStr, { authenticated: false });
    setWalletFlow(
      'connected_needs_signature',
      'WALLET CONNECTED',
      'One more free signature unlocks protected boosts. This is not a transaction and no tokens move.',
      'warn'
    );
    
    // Redraw modal
    showWalletConnect();
    
    // Show in-game notification if applicable
    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.showBoostMessage) {
      activeGame.showBoostMessage("⚡ WALLET CONNECTED. SIGN TO UNLOCK BOOSTS.", "runner");
    }
  } catch (err) {
    console.error('Wallet connection rejected/failed:', err);
    setWalletFlow('connect_failed', 'WALLET CONNECTION FAILED', walletFriendlyErrorMessage(err), 'error');
    if (String(err?.code || '').includes('MWA_NO_WALLET')) {
      window.showWalletConnectionOptions = true;
      showWalletConnect();
    }
    alert('⚠️ ' + walletFriendlyErrorMessage(err));
  } finally {
    emitWalletGameplayPause(false, 'wallet_connect');
  }
};

window.copyGameUrlToClipboard = function() {
  const gameUrl = 'https://sticklash.fun';
  navigator.clipboard.writeText(gameUrl).then(() => {
    alert('📋 Game URL copied to clipboard! Paste it in the Browser tab of Phantom or Backpack.');
  }).catch(() => {
    alert('📋 Game URL is: https://sticklash.fun (Copy and open in Phantom browser)');
  });
};

window.syncManualSolanaAddress = async function() {
  const inputEl = document.getElementById('manual-wallet-input');
  const errorEl = document.getElementById('manual-wallet-error');
  if (!inputEl) return;
  const address = inputEl.value.trim();
  
  if (!address) {
    if (errorEl) errorEl.textContent = 'Please enter an address.';
    return;
  }
  
  // Basic validation (Solana public key base58, 32-44 chars)
  const isBase58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (!isBase58) {
    if (errorEl) errorEl.textContent = 'Invalid Solana address format.';
    return;
  }
  
  try {
    const profile = getProfile();
    profile.walletConnected = true;
    profile.walletReadOnly = true;
    profile.walletAuthenticated = false;
    profile.walletAddress = address;
    clearWalletAuthSession();
    
    // Clear the options flag
    window.showWalletConnectionOptions = false;
    
    // Fetch live on-chain balance via RPC
    await updateOnChainBalance(profile);
    await syncServerBoostBalance(profile);
    
    saveProfile(profile);
    showWalletConnect();
    
    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.showBoostMessage) {
      activeGame.showBoostMessage("⚡ SOLANA ADDRESS SYNCED!", "runner");
    }
  } catch (e) {
    if (errorEl) errorEl.textContent = 'Failed to sync: ' + e.message;
  }
};

window.cancelWalletOptions = function() {
  window.showWalletConnectionOptions = false;
  clearWalletFlow();
  showWalletConnect();
};

window.requestBoostRefillFlow = function({ autoPause = true } = {}) {
  const shouldPause = !!autoPause && !window.isMultiplayerMatch;
  if (shouldPause) {
    emitWalletGameplayPause(true, 'boost_refill_required');
  }
  showWalletConnect({
    focusStore: true,
    pauseGameplay: shouldPause,
    pauseReason: 'boost_refill_required'
  });
};

window.requestWalletSecurityFlow = function({ autoPause = true } = {}) {
  const shouldPause = !!autoPause && !window.isMultiplayerMatch;
  if (shouldPause) {
    emitWalletGameplayPause(true, 'wallet_security_required');
  }
  setWalletFlow(
    'security_required',
    'SECURE WALLET SIGN-IN REQUIRED',
    'Your wallet is connected, but boosts need one free message signature before gameplay can spend them.',
    'warn'
  );
  showWalletConnect({
    focusStore: true,
    pauseGameplay: shouldPause,
    pauseReason: 'wallet_security_required'
  });
};

// Global hook: disconnect wallet
window.disconnectSolanaWallet = function() {
  const profile = getProfile();
  const nativeMwa = getNativeMwaPlugin();
  if (nativeMwa) {
    nativeMwa.disconnect().catch(() => {});
  }
  if (profile.walletAddress) {
    logoutWalletAuthSession(profile.walletAddress).catch(() => {});
  } else {
    clearWalletAuthSession();
  }
  profile.walletConnected = false;
  profile.walletReadOnly = false;
  profile.walletAuthenticated = false;
  profile.walletAddress = '';
  profile.smfBalance = 0;
  clearWalletFlow();
  saveProfile(profile);

  // Redraw modal
  showWalletConnect();
};

// Global hook: purchase boost pack with server-authoritative crediting
window.purchaseBoostPack = async function(packId) {
  let profile = getProfile();
  if (!profile.walletConnected) return alert('⚠️ Wallet is not connected.');
  if (profile.walletReadOnly) return alert('⚠️ Read-only wallet mode cannot purchase. Open game in your wallet browser.');
  const nativeMwa = getNativeMwaPlugin();
  if (!window.solana && !nativeMwa) {
    return alert('⚠️ No Solana wallet adapter detected.');
  }
  if (!isWalletAuthenticated(profile)) {
    setWalletFlow(
      'purchase_needs_signature',
      'SECURITY SIGN-IN REQUIRED',
      'Sign one free message first, then StickLash can safely create your boost purchase intent.',
      'warn'
    );
    showWalletConnect({ focusStore: true });
    const signedIn = await window.secureWalletSignIn({ silent: true });
    if (!signedIn) {
      alert('⚠️ Finish the free wallet sign-in before buying boosts.');
      return;
    }
    profile = getProfile();
  }

  const txOverlay = document.getElementById('solana-tx-overlay');
  const txStatusStep = document.getElementById('tx-status-step');
  const txSpinner = document.getElementById('tx-spinner');
  
  if (!txOverlay || !txStatusStep) return;

  // Show fullscreen glowing Solana confirmation transaction loader
  txOverlay.style.display = 'flex';
  emitWalletGameplayPause(true, 'purchase_boost_pack');
  txSpinner.className = '';
  txSpinner.innerHTML = '⚙️';
  txSpinner.style.animation = 'spin 1.5s linear infinite';
  txStatusStep.innerHTML = `<span style="color:#00c2ff;">1. Creating Secure Purchase Intent...</span><br><span style="color:#888;">Locking canonical pack quote on backend</span>`;

  try {
    const { Connection, PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3;

    const intentResp = await fetchWithWalletAuth(profile.walletAddress, '/api/boost/create-intent', {
      method: 'POST',
      body: JSON.stringify({
        wallet: profile.walletAddress,
        packId
      })
    });
    if (!intentResp.ok) {
      const err = await intentResp.text();
      throw new Error(`Intent creation failed (${intentResp.status}): ${err}`);
    }
    const intent = await intentResp.json();
    const requiredSmfUi = Number(intent.requiredSmfUiAmount || 0);
    const requiredSmfRaw = BigInt(String(intent.requiredSmfRawAmount || '0'));
    const boostsToCredit = Number(intent.boostsToCredit || 0);
    const mintAddress = String(intent.mint || activeMint || '');
    const rpcUrl = String(intent.solanaRpc || activeRpc || 'https://api.mainnet-beta.solana.com');

    if (!mintAddress) {
      throw new Error('Backend did not return token mint address.');
    }
    if (requiredSmfRaw <= 0n || requiredSmfUi <= 0 || boostsToCredit <= 0) {
      throw new Error('Backend returned invalid quote values.');
    }
    if (profile.smfBalance < requiredSmfUi) {
      throw new Error(`Insufficient $SMF balance. Need ${requiredSmfUi}, have ${profile.smfBalance}.`);
    }

    const connection = new Connection(rpcUrl, 'confirmed');
    const walletPub = new PublicKey(profile.walletAddress);
    const mintPub = new PublicKey(mintAddress);

    // Derive ATA
    const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const associatedTokenProgramId = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    const [associatedTokenAddress] = await PublicKey.findProgramAddress(
      [
        walletPub.toBuffer(),
        tokenProgramId.toBuffer(),
        mintPub.toBuffer()
      ],
      associatedTokenProgramId
    );
    
    txStatusStep.innerHTML = `<span style="color:#00c2ff;">1. Constructing Burn Transaction...</span><br><span style="color:#888;">Preparing to burn ${requiredSmfUi} $SMF</span>`;
    
    // Compile SPL Token Burn Instruction
    // Keys needed:
    // 1. Source (writable) -> associatedTokenAddress
    // 2. Mint (writable) -> mintPub
    // 3. Authority (signer) -> walletPub
    const keys = [
      { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
      { pubkey: mintPub, isSigner: false, isWritable: true },
      { pubkey: walletPub, isSigner: true, isWritable: false }
    ];
    
    // Compile instruction data
    // Index 8 is Burn. Data structure: u8 index (8), u64 amount
    const data = new Uint8Array(9);
    data[0] = 8; // Burn index
    let temp = requiredSmfRaw;
    for (let i = 0; i < 8; i++) {
      data[1 + i] = Number(temp & 0xffn);
      temp >>= 8n;
    }
    
    const burnInstruction = new TransactionInstruction({
      keys,
      programId: tokenProgramId,
      data
    });
    
    txStatusStep.innerHTML = `<span style="color:var(--neon-green);">✓ Transaction Compiled</span><br><span style="color:#00c2ff;">2. Awaiting Wallet Approval...</span><br><span style="color:#aaa;">Confirming burn of ${requiredSmfUi} $SMF tokens in wallet...</span>`;
    
    // Fetch recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction();
    transaction.add(burnInstruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletPub;
    
    // Request wallet signature and broadcast
    const { signature } = nativeMwa
      ? await nativeMwaSignAndSendSerializedTx(transaction)
      : await window.solana.signAndSendTransaction(transaction);
    
    txSpinner.innerHTML = '🔥';
    txSpinner.className = 'tx-fire-glow';
    txSpinner.style.animation = 'none';
    txStatusStep.innerHTML = `
      <span style="color:var(--neon-green);">✓ Burn Signed!</span><br>
      <span style="color:#ff5500; font-weight:bold;">3. Verifying With Backend Ledger...</span><br>
      <span style="color:#ff8800; font-size:10px;">Transaction Broadcasted. Signature:<br>
      <span style="font-size:8px; color:#aaa;">${signature}</span></span><br>
      <span style="color:#ff3300; font-size:9px; font-weight:bold;">Awaiting server-side burn verification... 🔥</span>
    `;
    
    // Poll for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) {
      throw new Error('Transaction failed on-chain: ' + JSON.stringify(confirmation.value.err));
    }

    const confirmResp = await fetchWithWalletAuth(profile.walletAddress, '/api/boost/confirm', {
      method: 'POST',
      body: JSON.stringify({
        wallet: profile.walletAddress,
        intentId: intent.intentId,
        signature
      })
    });
    if (!confirmResp.ok) {
      const err = await confirmResp.text();
      throw new Error(`Backend confirmation failed (${confirmResp.status}): ${err}`);
    }
    const confirmationData = await confirmResp.json();
    
    txSpinner.className = '';
    txSpinner.innerHTML = '🎉';
    txStatusStep.innerHTML = `
      <span style="color:var(--neon-green); font-weight:bold; font-size:14px; text-shadow:0 0 10px var(--neon-green);">✓ TRANSACTION CONFIRMED!</span><br>
      <span style="color:#ccc; font-size:11px; margin-top:10px; display:inline-block;">Successfully Credited <span style="color:var(--neon-pink); font-weight:bold;">${boostsToCredit} Premium Boosts</span>!</span><br>
      <span style="color:#888; font-size:8px;">Signature: ${signature.substring(0, 10)}... (Confirmed on Solana Mainnet)</span>
    `;
    
    // Update local cache from authoritative backend response
    profile.smfBalance = Math.max(0, profile.smfBalance - requiredSmfUi);
    profile.boosts = typeof confirmationData.boosts === 'number'
      ? confirmationData.boosts
      : profile.boosts;
    saveProfile(profile);

    // Update UI elements
    updateBoostIndicators(profile.boosts);
    
    // Play SFX
    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.sfx && activeGame.sfx.hadouken) {
      try { activeGame.sfx.hadouken(); } catch(e){}
    }
    
    setTimeout(() => {
      txOverlay.style.display = 'none';
      emitWalletGameplayPause(false, 'purchase_boost_pack');
      showWalletConnect();
    }, 4000);
    
  } catch (err) {
    console.error('Solana Transaction failed:', err);
    txSpinner.innerHTML = '❌';
    txSpinner.style.animation = 'none';
    txStatusStep.innerHTML = `<span style="color:#ff3b30; font-weight:bold; font-size:14px;">✓ TRANSACTION FAILED</span><br><span style="color:#ccc; font-size:10px; margin-top:10px; display:inline-block;">${err.message || err}</span>`;
    
    setTimeout(() => {
      txOverlay.style.display = 'none';
      emitWalletGameplayPause(false, 'purchase_boost_pack');
    }, 5000);
  }
};

// Automatically bind to window on import
window.showWalletConnect = showWalletConnect;
window.hideWalletConnect = hideWalletConnect;
