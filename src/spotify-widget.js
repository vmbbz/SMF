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
    // Simple OAuth flow — redirect to your backend /api/spotify/login
    window.location.href = '/api/spotify/login';
  }

  async connectPlayer() {
    // Web Playback SDK initialization (Spotify script must be loaded in index.html)
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
      console.error('Spotify Init Error:', message);
    });

    this.player.addListener('authentication_error', ({ message }) => {
      console.error('Spotify Auth Error:', message);
      localStorage.removeItem('spotify_access_token'); // clear invalid token
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

  togglePlay() { if (this.player) this.player.togglePlay(); }
  nextTrack() { if (this.player) this.player.nextTrack(); }
}

// Global for easy access
window.spotifyWidget = new SpotifyWidget('spotify-widget');
