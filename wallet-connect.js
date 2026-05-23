// wallet-connect.js
// Redesigned User Profile, 100% Mock-Free Solana Wallet, & Premium Boost Store Modal

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
      walletAddress: '',
      smfBalance: 0 // Fetch real balance on-chain
    };
    saveProfile(profile);
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

export async function showWalletConnect() {
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
    txOverlay.style.fontFamily = 'monospace';
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
      
      const tokenRes = await fetch(`/api/token/${config.smfMint}`);
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
        saveProfile(profile);
      }
      
      // Trigger modal redraw after async fetch finishes
      showWalletConnect();
    }
  }

  const profile = getProfile();
  
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
        font-family: inherit !important;
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
        font-family: inherit;
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
      @keyframes firePulse {
        0% { text-shadow: 0 0 5px #ff3300, 0 0 10px #ff3300; transform: scale(1); }
        100% { text-shadow: 0 0 15px #ff9900, 0 0 25px #ff5500; transform: scale(1.1); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // Generate profile avatar HTML
  const avatarSrc = profile.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%2314f195" fill-opacity="0.1" stroke="%2314f195" stroke-width="2"/><path d="M50 30a12 12 0 1 0 0 24 12 12 0 1 0 0-24zm0 28c-18 0-30 10-30 20v4h60v-4c0-10-12-20-30-20z" fill="%2314f195"/></svg>';
  const spotifyToken = localStorage.getItem('spotify_access_token');

  modal.innerHTML = `
    <div style="color: white; font-family: inherit; text-align: center; max-height: 80vh; overflow-y: auto; padding-right: 5px;">
      
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
          <span style="font-size: 10px; font-weight: bold; color: var(--neon-blue); letter-spacing: 0.5px;">🔑 WEB3 SOLANA WALLET</span>
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="width: 6px; height: 6px; border-radius:50%; background: ${profile.walletConnected ? 'var(--neon-green)' : '#ff3b30'}; box-shadow: 0 0 6px ${profile.walletConnected ? 'var(--neon-green)' : '#ff3b30'};"></span>
            <span style="font-size: 8px; color: #aaa;">${profile.walletConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          </div>
        </div>
        
        ${profile.walletConnected ? `
          <div style="background: rgba(0,194,255,0.05); border: 1px solid rgba(0,194,255,0.15); padding: 10px; border-radius: 8px; font-size: 9px; font-family: monospace;">
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
              <span style="color:#aaa;">Address:</span>
              <span style="color:#fff;" title="${profile.walletAddress}">${profile.walletAddress.substring(0, 6)}...${profile.walletAddress.substring(profile.walletAddress.length - 4)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
              <span style="color:#aaa;">Token Balance:</span>
              <span style="color:var(--neon-green); font-weight:bold;">${Number(profile.smfBalance).toLocaleString(undefined, {maximumFractionDigits: 4})} $SMF</span>
            </div>
            <button onclick="window.disconnectSolanaWallet()" style="background: rgba(255,59,48,0.1); border: 1px solid #ff3b30; color: #ff3b30; font-family:inherit; font-size:8px; border-radius: 4px; padding: 4px 8px; cursor:pointer; width: 100%; transition: all 0.2s;">
              DISCONNECT WALLET
            </button>
          </div>
        ` : (window.showWalletConnectionOptions ? `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); padding: 10px; border-radius: 8px; font-size: 9px; line-height: 1.4; color: #ccc;">
            <div style="font-weight:bold; color:var(--neon-green); font-size: 9px; margin-bottom: 8px; text-align:center;">🔗 CONNECT SOLANA WALLET</div>
            
            <p style="font-size: 8px; color: #bbb; margin-bottom: 10px; line-height: 1.3;">
              To buy boosts and sign transactions, open this game in your wallet's browser. Or, sync your address manually in Read-Only mode.
            </p>

            <button onclick="window.copyGameUrlToClipboard()" class="premium-btn" style="padding: 6px 10px; font-size: 8px; width: 100%; margin-bottom: 8px; border-color: rgba(20,241,149,0.3);">
              OPTION A: COPY GAME LINK TO WALLET
            </button>

            <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; margin-top: 6px;">
              <div style="font-weight:bold; color:var(--neon-blue); font-size: 8px; margin-bottom: 6px;">OPTION B: SYNC ADDRESS (READ-ONLY)</div>
              <div style="display:flex; gap:6px;">
                <input type="text" id="manual-wallet-input" placeholder="Paste Solana Public Key" style="flex:1; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:4px 8px; color:white; font-family:monospace; font-size:8px;">
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
            CONNECT SOLANA WALLET
          </button>
        `)}
      </div>
      
      <!-- PREMIUM BOOST STORE SECTION -->
      <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 16px; margin-bottom: 12px; text-align: left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
          <span style="font-size: 10px; font-weight: bold; color: var(--neon-pink); letter-spacing: 0.5px;">⚡ PREMIUM BOOST STORE</span>
          <span style="font-size: 9px; background: rgba(255,0,255,0.1); border: 1px solid var(--neon-pink); padding: 2px 8px; border-radius: 10px; color: var(--neon-pink); font-weight:bold;">
            <span id="profile-boosts-count">${profile.boosts}</span> BOOSTS ACTIVE
          </span>
        </div>
        
        <p style="font-size: 8px; color: #888; margin-bottom: 8px; line-height: 1.4;">
          Staking is unsafe. Instead, use connected wallet $SMF tokens to **buy boost packs**! All $SMF spent is **burned forever** 🔥 (Solana Burn Program).
        </p>

        <!-- PACKAGES -->
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom: 8px;">
          <!-- Pack 1 -->
          <div class="store-package-card ${!profile.walletConnected ? 'locked' : ''}">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:#fff;">🔵 Micro Pack (5 Premium Boosts)</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $1.00 <span style="color:#aaa;">(~${pack1SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${!profile.walletConnected ? 'disabled' : ''} onclick="window.purchaseBoostPack('micro', 5, ${pack1SMF})">
              BUY & BURN
            </button>
          </div>
          <!-- Pack 2 -->
          <div class="store-package-card ${!profile.walletConnected ? 'locked' : ''}" style="border-color: rgba(20,241,149,0.3); background: rgba(20,241,149,0.02);">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:var(--neon-green);">🔥 Degen Pack (20 Boosts) - BEST VALUE</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $3.00 <span style="color:#aaa;">(~${pack2SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${!profile.walletConnected ? 'disabled' : ''} style="background: var(--neon-green);" onclick="window.purchaseBoostPack('degen', 20, ${pack2SMF})">
              BUY & BURN
            </button>
          </div>
          <!-- Pack 3 -->
          <div class="store-package-card ${!profile.walletConnected ? 'locked' : ''}">
            <div style="font-size: 9px; line-height:1.3;">
              <div style="font-weight:bold; color:#fff;">⚡ Chaos Pack (45 Premium Boosts)</div>
              <div style="color:var(--neon-green); font-size: 8px;">Only $5.00 <span style="color:#aaa;">(~${pack3SMF} $SMF)</span></div>
            </div>
            <button class="buy-smf-btn" ${!profile.walletConnected ? 'disabled' : ''} onclick="window.purchaseBoostPack('chaos', 45, ${pack3SMF})">
              BUY & BURN
            </button>
          </div>
        </div>
        
        ${!profile.walletConnected ? `
          <div style="font-size: 7px; color:#ff3b30; text-align:center; font-weight:bold; letter-spacing:0.3px;">⚠️ CONNECT SOLANA WALLET TO UNLOCK PURCHASES</div>
        ` : ''}
      </div>

      <!-- SPOTIFY DISCONNECT SECTION -->
      ${spotifyToken ? `
        <button onclick="window.disconnectSpotifyInModal()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #bbb; font-family: inherit; font-size: 9px; padding: 6px 12px; border-radius: 8px; width: 100%; cursor: pointer; margin-bottom: 12px; transition: all 0.2s;">
          🎵 DISCONNECT SPOTIFY MUSIC
        </button>
      ` : ''}
      
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
          
          // Update Spotify widget user pic
          const spotifyPic = document.getElementById('user-pic');
          if (spotifyPic) {
            spotifyPic.innerHTML = `<img src="${compressedBase64}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
          }

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
      
      // Update Spotify Widget name
      const spotifyName = document.getElementById('username');
      if (spotifyName) {
        spotifyName.textContent = newName;
      }

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
}

export function hideWalletConnect() {
  const modal = document.getElementById('wallet-connect-panel');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Global hook: connect wallet (Real & Mock-Free)
window.connectSolanaWallet = async function() {
  if (!window.solana) {
    // If no window.solana is detected, show the beautiful manual sync / deep link copy options panel
    window.showWalletConnectionOptions = true;
    showWalletConnect();
    return;
  }
  try {
    const resp = await window.solana.connect();
    const publicKeyStr = resp.publicKey.toString();
    
    const profile = getProfile();
    profile.walletConnected = true;
    profile.walletAddress = publicKeyStr;
    
    // Fetch live on-chain balance
    await updateOnChainBalance(profile);
    
    saveProfile(profile);
    
    // Redraw modal
    showWalletConnect();
    
    // Show in-game notification if applicable
    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.showBoostMessage) {
      activeGame.showBoostMessage("⚡ SOLANA WALLET CONNECTED!", "runner");
    }
  } catch (err) {
    console.error('Wallet connection rejected/failed:', err);
    alert('⚠️ Wallet connection failed: ' + (err.message || err));
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
    profile.walletAddress = address;
    
    // Clear the options flag
    window.showWalletConnectionOptions = false;
    
    // Fetch live on-chain balance via RPC
    await updateOnChainBalance(profile);
    
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
  showWalletConnect();
};

// Global hook: disconnect wallet
window.disconnectSolanaWallet = function() {
  const profile = getProfile();
  profile.walletConnected = false;
  profile.walletAddress = '';
  profile.smfBalance = 0;
  saveProfile(profile);

  // Redraw modal
  showWalletConnect();
};

// Global hook: purchase boost pack with real SPL token burn
window.purchaseBoostPack = async function(packId, boostsCount, smfCost) {
  const profile = getProfile();
  if (!profile.walletConnected) return alert('⚠️ Wallet is not connected.');

  if (profile.smfBalance < smfCost) {
    return alert(`⚠️ Insufficient $SMF balance! You have ${profile.smfBalance} $SMF but need ${smfCost} $SMF.`);
  }

  if (!window.solana) {
    return alert('⚠️ No Solana wallet adapter detected!');
  }

  const txOverlay = document.getElementById('solana-tx-overlay');
  const txStatusStep = document.getElementById('tx-status-step');
  const txSpinner = document.getElementById('tx-spinner');
  
  if (!txOverlay || !txStatusStep) return;

  // Show fullscreen glowing Solana confirmation transaction loader
  txOverlay.style.display = 'flex';
  txSpinner.className = '';
  txSpinner.innerHTML = '⚙️';
  txSpinner.style.animation = 'spin 1.5s linear infinite';
  txStatusStep.innerHTML = `<span style="color:#00c2ff;">1. Constructing Burn Transaction...</span><br><span style="color:#888;">Preparing to burn ${smfCost} $SMF to dead address</span>`;

  try {
    const { Connection, PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3;
    const connection = new Connection(activeRpc || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const walletPub = new PublicKey(profile.walletAddress);
    const mintPub = new PublicKey(activeMint);
    
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
    
    // Fetch mint decimals dynamically
    txStatusStep.innerHTML = `<span style="color:#00c2ff;">1. Querying Token Metadata...</span><br><span style="color:#888;">Fetching decimals for token mint</span>`;
    const mintInfo = await connection.getParsedAccountInfo(mintPub);
    let decimals = 9; // standard SPL default
    if (mintInfo && mintInfo.value && mintInfo.value.data && mintInfo.value.data.parsed) {
      decimals = mintInfo.value.data.parsed.info.decimals || 9;
    }
    
    const amountToBurn = BigInt(Math.round(smfCost * Math.pow(10, decimals)));
    
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
    let temp = amountToBurn;
    for (let i = 0; i < 8; i++) {
      data[1 + i] = Number(temp & 0xffn);
      temp >>= 8n;
    }
    
    const burnInstruction = new TransactionInstruction({
      keys,
      programId: tokenProgramId,
      data
    });
    
    txStatusStep.innerHTML = `<span style="color:var(--neon-green);">✓ Transaction Compiled</span><br><span style="color:#00c2ff;">2. Awaiting Wallet Approval...</span><br><span style="color:#aaa;">Confirming burn of ${smfCost} $SMF tokens in Phantom...</span>`;
    
    // Fetch recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction();
    transaction.add(burnInstruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletPub;
    
    // Request wallet signature and broadcast
    const { signature } = await window.solana.signAndSendTransaction(transaction);
    
    txSpinner.innerHTML = '🔥';
    txSpinner.className = 'tx-fire-glow';
    txSpinner.style.animation = 'none';
    txStatusStep.innerHTML = `
      <span style="color:var(--neon-green);">✓ Burn Signed!</span><br>
      <span style="color:#ff5500; font-weight:bold;">3. Confirming On Solana Blockchain...</span><br>
      <span style="color:#ff8800; font-size:10px;">Transaction Broadcasted. Signature:<br>
      <span style="font-size:8px; color:#aaa;">${signature}</span></span><br>
      <span style="color:#ff3300; font-size:9px; font-weight:bold;">THEY ARE GONE FOREVER! 🔥☄️</span>
    `;
    
    // Poll for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) {
      throw new Error('Transaction failed on-chain: ' + JSON.stringify(confirmation.value.err));
    }
    
    txSpinner.className = '';
    txSpinner.innerHTML = '🎉';
    txStatusStep.innerHTML = `
      <span style="color:var(--neon-green); font-weight:bold; font-size:14px; text-shadow:0 0 10px var(--neon-green);">✓ TRANSACTION CONFIRMED!</span><br>
      <span style="color:#ccc; font-size:11px; margin-top:10px; display:inline-block;">Successfully Credited <span style="color:var(--neon-pink); font-weight:bold;">${boostsCount} Premium Boosts</span>!</span><br>
      <span style="color:#888; font-size:8px;">Signature: ${signature.substring(0, 10)}... (Confirmed on Solana Mainnet)</span>
    `;
    
    // Update local storage
    profile.smfBalance = Math.max(0, profile.smfBalance - smfCost);
    profile.boosts += boostsCount;
    saveProfile(profile);

    // Update UI elements
    const boostBalCountEl = document.getElementById('boost-balance-count');
    if (boostBalCountEl) {
      boostBalCountEl.textContent = profile.boosts;
    }
    
    const profileBoostsEl = document.getElementById('profile-boosts-count');
    if (profileBoostsEl) {
      profileBoostsEl.textContent = profile.boosts;
    }
    
    // Play SFX
    const activeGame = window.currentGame || window.game || window._game;
    if (activeGame && activeGame.sfx && activeGame.sfx.hadouken) {
      try { activeGame.sfx.hadouken(); } catch(e){}
    }
    
    setTimeout(() => {
      txOverlay.style.display = 'none';
      showWalletConnect();
    }, 4000);
    
  } catch (err) {
    console.error('Solana Transaction failed:', err);
    txSpinner.innerHTML = '❌';
    txSpinner.style.animation = 'none';
    txStatusStep.innerHTML = `<span style="color:#ff3b30; font-weight:bold; font-size:14px;">✓ TRANSACTION FAILED</span><br><span style="color:#ccc; font-size:10px; margin-top:10px; display:inline-block;">${err.message || err}</span>`;
    
    setTimeout(() => {
      txOverlay.style.display = 'none';
    }, 5000);
  }
};

// Global hook: disconnect Spotify directly from modal
window.disconnectSpotifyInModal = function() {
  if (window.spotifyWidget) {
    window.spotifyWidget.disconnect();
  } else {
    localStorage.removeItem('spotify_access_token');
  }
  
  // Redraw modal
  showWalletConnect();
  console.log('[Spotify] Logged out successfully from profile panel.');
};

// Automatically bind to window on import
window.showWalletConnect = showWalletConnect;
window.hideWalletConnect = hideWalletConnect;
