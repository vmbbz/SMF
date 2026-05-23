export class SpotifyWidget {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.player = null;
    this.isConnected = false;
    this.accessToken = null;
  }

  async init() {
    this.render();
    this.syncProfile();
    window.addEventListener('smf_profile_updated', () => {
      this.syncProfile();
    });
    // Check if already connected from previous session
    const savedToken = localStorage.getItem('spotify_access_token');
    if (savedToken) {
      this.accessToken = savedToken;
      this.isConnected = true;
      this.connectPlayer();
    }
  }

  syncProfile() {
    try {
      const profileStr = localStorage.getItem('smf_user_profile');
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        if (profile) {
          const usernameEl = document.getElementById('username');
          if (usernameEl && profile.name) {
            usernameEl.textContent = profile.name;
          }
          const userPicEl = document.getElementById('user-pic');
          if (userPicEl) {
            if (profile.avatar) {
              userPicEl.innerHTML = `<img src="${profile.avatar}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" />`;
            } else {
              userPicEl.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 397 311" style="display:block;">
                  <path d="M64.6 237.9c-2.4-2.4-5.7-3.8-9.2-3.8H3.8c-4.8 0-8 5.3-5.3 9.3l57 85.5c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5z" fill="#9945FF"/>
                  <path d="M337.8 73.1c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5C344.5 1.3 341.2 0 337.7 0H286c-4.8 0-8 5.3-5.3 9.3l57.1 83.8z" fill="#14F195"/>
                  <path d="M201.2 155.5c-2.4-2.4-5.7-3.8-9.2-3.8H140.4c-4.8 0-8 5.3-5.3 9.3l57 85.5c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5z" fill="#00C2FF"/>
                </svg>
              `;
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to sync profile inside Spotify widget:', e);
    }
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="spotify-widget" style="display:flex; align-items:center; gap:10px; padding:6px 12px; background:rgba(0,0,0,0.8); border: 2px solid var(--neon-green); border-radius:30px; color:#fff; backdrop-filter:blur(5px);">
        <div class="user-header" style="display:flex; align-items:center; gap:8px;">
          <div id="user-pic" class="spotify-user-pic" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:rgba(20,241,149,0.15); border:1px solid var(--neon-green); cursor:pointer;" onclick="window.spotifyWidget.toggleUserPanel()">
            <svg width="14" height="14" viewBox="0 0 397 311" style="display:block;">
              <path d="M64.6 237.9c-2.4-2.4-5.7-3.8-9.2-3.8H3.8c-4.8 0-8 5.3-5.3 9.3l57 85.5c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5z" fill="#9945FF"/>
              <path d="M337.8 73.1c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5C344.5 1.3 341.2 0 337.7 0H286c-4.8 0-8 5.3-5.3 9.3l57.1 83.8z" fill="#14F195"/>
              <path d="M201.2 155.5c-2.4-2.4-5.7-3.8-9.2-3.8H140.4c-4.8 0-8 5.3-5.3 9.3l57 85.5c2.4 2.4 5.7 3.8 9.2 3.8h51.6c4.8 0 8-5.3 5.3-9.3l-57-85.5z" fill="#00C2FF"/>
            </svg>
          </div>
          <span id="username" class="desktop-text" style="font-family:monospace; font-size:11px; cursor:pointer;" onclick="window.spotifyWidget.toggleUserPanel()">Guest Fighter</span>
          <button onclick="window.spotifyWidget.connectSpotify()" class="connect-btn" id="connect-btn" style="background:transparent; color:var(--neon-green); border:none; padding:0; font-weight:bold; cursor:pointer; font-family:inherit; font-size:12px;">
            <span class="desktop-text">CONNECT SPOTIFY</span>
            <span class="mobile-text">🎵</span>
          </button>
        </div>
        <div id="player-controls" class="hidden" style="display:none; flex:1; align-items:center; gap:10px;">
          <div class="now-playing" style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width: 150px;">
            <span id="track-name" style="color:var(--neon-blue); font-size:11px; font-weight:bold;">No track playing</span>
          </div>
          <div class="controls" style="display:flex; gap:5px;">
            <button onclick="window.spotifyWidget.togglePlay()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:14px; padding:0;">⏯️</button>
            <button onclick="window.spotifyWidget.nextTrack()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:14px; padding:0;">⏭️</button>
          </div>
        </div>
      </div>
    `;
    
    // Auto-unhide if connected
    const connectBtn = document.getElementById('connect-btn');
    const controls = document.getElementById('player-controls');
    if (this.isConnected) {
      if (connectBtn) { connectBtn.style.display = 'none'; connectBtn.classList.add('hidden'); }
      if (controls) { controls.style.display = 'flex'; controls.classList.remove('hidden'); }
    } else {
      if (connectBtn) { connectBtn.style.display = 'flex'; connectBtn.classList.remove('hidden'); }
      if (controls) { controls.style.display = 'none'; controls.classList.add('hidden'); }
    }
    
    this.syncProfile();
  }

  toggleUserPanel() {
    const modal = document.getElementById('wallet-connect-panel');
    if (modal && !modal.classList.contains('hidden')) {
      if (window.hideWalletConnect) window.hideWalletConnect();
    } else {
      if (window.showWalletConnect) window.showWalletConnect();
    }
  }

  async connectSpotify() {
    const isWebView = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.Capacitor;
    if (isWebView) {
      this.showDevicePairingModal();
    } else {
      window.location.href = '/api/spotify/login';
    }
  }

  showDevicePairingModal() {
    let deviceId = localStorage.getItem('spotify_device_id');
    if (!deviceId) {
      deviceId = 'smf_' + Math.random().toString(36).substring(2, 12);
      localStorage.setItem('spotify_device_id', deviceId);
    }

    const modalId = 'spotify-pairing-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.background = 'rgba(10, 10, 15, 0.95)';
      modal.style.backdropFilter = 'blur(15px)';
      modal.style.zIndex = '3500';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.color = 'white';
      modal.style.fontFamily = 'monospace';
      modal.style.textAlign = 'center';
      modal.style.padding = '20px';
      document.body.appendChild(modal);
    }

    const pairingUrl = `https://sticklash.fun/api/spotify/login?device=${deviceId}`;

    modal.innerHTML = `
      <div style="background: rgba(255,255,255,0.02); border: 2px solid var(--neon-green); box-shadow: 0 0 30px rgba(20,241,149,0.2); border-radius: 24px; padding: 30px; max-width: 420px; width: 90%;">
        <div style="font-size: 40px; margin-bottom: 15px;">🎵</div>
        <h3 style="color: var(--neon-green); font-size: 14px; margin-bottom: 20px; letter-spacing: 2px; text-shadow: 0 0 10px rgba(20,241,149,0.3);">PAIR SPOTIFY MUSIC</h3>
        
        <p style="font-size: 9px; line-height: 1.6; color: #ccc; margin-bottom: 20px; text-align: left; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px;">
          Spotify's secure login cannot run inside the standalone app WebView.<br><br>
          <strong>To connect:</strong><br>
          1. Tap the button below to open Spotify authorization in your mobile browser.<br>
          2. Log in and approve connection.<br>
          3. Return to the game – this app will pair automatically!
        </p>

        <button id="open-pairing-btn" class="premium-btn" style="padding: 10px 16px; font-size: 10px; width: 100%; letter-spacing: 0.5px; margin-bottom: 15px;">
          OPEN AUTHORIZATION PAGE
        </button>

        <div style="font-size: 8px; color: #888; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span style="display:inline-block; width:6px; height:6px; background:#14f195; border-radius:50%; animation: pulse 1s infinite alternate;"></span>
          Awaiting authorization in phone browser...
        </div>

        <style>
          @keyframes pulse {
            0% { transform: scale(1); opacity: 0.5; box-shadow: 0 0 0 0 rgba(20,241,149,0.7); }
            100% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 6px 2px rgba(20,241,149,0.3); }
          }
        </style>

        <button id="close-pairing-btn" style="background:transparent; border:none; color:#888; font-family:inherit; font-size:9px; margin-top:20px; cursor:pointer; text-decoration:underline;">
          CANCEL
        </button>
      </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('open-pairing-btn').onclick = () => {
      window.open(pairingUrl, '_blank');
    };

    document.getElementById('close-pairing-btn').onclick = () => {
      modal.style.display = 'none';
      if (this.pairingInterval) {
        clearInterval(this.pairingInterval);
        this.pairingInterval = null;
      }
    };

    if (this.pairingInterval) clearInterval(this.pairingInterval);
    this.pairingInterval = setInterval(async () => {
      try {
        const resp = await fetch(`https://sticklash.fun/api/spotify/check?device=${deviceId}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.status === 'success' && data.token) {
            console.log('[Spotify] Device paired successfully via token polling!');
            localStorage.setItem('spotify_access_token', data.token);
            this.accessToken = data.token;
            this.isConnected = true;
            
            clearInterval(this.pairingInterval);
            this.pairingInterval = null;
            modal.style.display = 'none';
            
            this.connectPlayer();
            this.render();
          }
        }
      } catch (e) {
        console.warn('[Spotify] Device polling error:', e);
      }
    }, 3000);
  }

  async connectPlayer() {
    const isWebView = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.Capacitor;
    if (isWebView) {
      console.log('[Spotify] WebView detected, falling back to Spotify Web API Remote Control.');
      this.initRemoteControl();
      return;
    }

    if (!window.Spotify) {
      console.warn('Spotify SDK not loaded. Retrying in 1s...');
      setTimeout(() => this.connectPlayer(), 1000);
      return;
    }
    
    this.player = new window.Spotify.Player({
      name: 'SMF Meme Fighter',
      getOAuthToken: cb => cb(this.accessToken),
      volume: 0.5
    });

    this.player.addListener('ready', ({ device_id }) => {
      console.log('Spotify ready — device:', device_id);
      this.isConnected = true;
      const connectBtn = document.getElementById('connect-btn');
      const controls = document.getElementById('player-controls');
      if (connectBtn) {
        connectBtn.style.display = 'none';
        connectBtn.classList.add('hidden');
      }
      if (controls) {
        controls.style.display = 'flex';
        controls.classList.remove('hidden');
      }
    });

    this.player.addListener('not_ready', ({ device_id }) => {
      console.log('Device ID has gone offline', device_id);
    });

    this.player.addListener('initialization_error', ({ message }) => {
      console.warn('Spotify SDK Init Error, falling back to Web API Remote Control:', message);
      this.initRemoteControl();
    });

    this.player.addListener('authentication_error', ({ message }) => {
      console.error('Spotify Auth Error:', message);
      this.disconnect();
    });

    this.player.addListener('account_error', ({ message }) => {
      console.error('Spotify Account Error:', message);
    });

    this.player.addListener('player_state_changed', state => {
      if (!state) return;
      const track = state.track_window.current_track;
      const trackNameEl = document.getElementById('track-name');
      if (trackNameEl && track) {
        trackNameEl.textContent = `${track.name} - ${track.artists[0].name}`;
      }
    });

    await this.player.connect();
  }

  initRemoteControl() {
    this.isRemoteFallback = true;
    this.isConnected = true;
    
    const connectBtn = document.getElementById('connect-btn');
    const controls = document.getElementById('player-controls');
    if (connectBtn) {
      connectBtn.style.display = 'none';
      connectBtn.classList.add('hidden');
    }
    if (controls) {
      controls.style.display = 'flex';
      controls.classList.remove('hidden');
    }
    
    this.pollCurrentlyPlaying();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.pollCurrentlyPlaying(), 4000);
  }

  async pollCurrentlyPlaying() {
    if (!this.accessToken) return;
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        if (data && data.item) {
          const track = data.item;
          const trackNameEl = document.getElementById('track-name');
          if (trackNameEl) {
            trackNameEl.textContent = `${track.name} - ${track.artists[0].name}`;
          }
        }
      } else if (resp.status === 401) {
        console.warn('[Spotify] Token expired or invalid, disconnecting.');
        this.disconnect();
      }
    } catch (e) {
      console.warn('[Spotify] Failed to poll currently playing track:', e);
    }
  }

  async sendRemoteCommand(method, endpoint) {
    if (!this.accessToken) return;
    try {
      const resp = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
        method: method,
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.status === 401) {
        this.disconnect();
      } else {
        setTimeout(() => this.pollCurrentlyPlaying(), 500);
      }
    } catch (e) {
      console.error('[Spotify] Remote command failed:', e);
    }
  }

  togglePlay() {
    if (this.isRemoteFallback) {
      this.toggleRemotePlay();
    } else if (this.player) {
      this.player.togglePlay();
    }
  }

  async toggleRemotePlay() {
    if (!this.accessToken) return;
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        const isPlaying = data.is_playing;
        const endpoint = isPlaying ? 'pause' : 'play';
        await this.sendRemoteCommand('PUT', endpoint);
      } else {
        await this.sendRemoteCommand('PUT', 'play');
      }
    } catch (e) {
      await this.sendRemoteCommand('PUT', 'play');
    }
  }

  nextTrack() {
    if (this.isRemoteFallback) {
      this.sendRemoteCommand('POST', 'next');
    } else if (this.player) {
      this.player.nextTrack();
    }
  }

  disconnect() {
    localStorage.removeItem('spotify_access_token');
    this.isConnected = false;
    this.accessToken = null;
    this.isRemoteFallback = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.pairingInterval) {
      clearInterval(this.pairingInterval);
      this.pairingInterval = null;
    }
    if (this.player) {
      try { this.player.disconnect(); } catch (e) {}
      this.player = null;
    }
    
    this.render();
  }
}

// Global for easy access
window.spotifyWidget = new SpotifyWidget('spotify-widget');
