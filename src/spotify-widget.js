export class SpotifyWidget {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.player = null;
    this.isConnected = false;
    this.accessToken = null;
    
    // Track State
    this.currentTrackName = 'No track playing';
    this.currentTrackArtist = 'Spotify Connected';
    this.currentTrackArt = null;
    this.isPlaying = false;
    this.isShuffle = false;
    this.isRepeat = 'off'; // off, context, track
    this.currentVolume = 50; // 0-100
    
    // Search Results
    this.searchResults = [];
    this.userPlaylists = [];
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
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to sync profile inside Spotify widget:', e);
    }
  }

  openMusicCenter() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.pollCurrentlyPlaying();
      this.fetchUserPlaylists();
    }
  }

  closeMusicCenter() {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
  }

  render() {
    if (!this.container) return;
    
    // Create or find modal element
    let modal = document.getElementById('spotify-music-center-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'spotify-music-center-modal';
      modal.className = 'screen hidden';
      modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2200;
        background: rgba(10, 10, 15, 0.95);
        backdrop-filter: blur(25px);
        border: 2px solid var(--neon-green);
        box-shadow: 0 0 35px rgba(20,241,149,0.25);
        border-radius: 28px;
        padding: 30px;
        max-width: 440px;
        width: 90%;
        color: white;
        font-family: monospace;
        max-height: 85vh;
        overflow-y: auto;
      `;
      document.body.appendChild(modal);
    }
    this.modal = modal;

    const albumArt = this.currentTrackArt || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%231db954" fill-opacity="0.1" stroke="%231db954" stroke-width="2"/><path d="M50 20a30 30 0 0 0-30 30 30 30 0 0 0 30 30 30 30 0 0 0 30-30A30 30 0 0 0 50 20zm-5 13h10v10H45V33zm0 18h10v16H45V51z" fill="%231db954"/></svg>';

    // HUD Layout: User Profile Button + Spotify Vinyl Pill
    const profileStr = localStorage.getItem('smf_user_profile');
    let avatarSrc = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%2314f195" fill-opacity="0.1" stroke="%2314f195" stroke-width="2"/><path d="M50 30a12 12 0 1 0 0 24 12 12 0 1 0 0-24zm0 28c-18 0-30 10-30 20v4h60v-4c0-10-12-20-30-20z" fill="%2314f195"/></svg>';
    try {
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        if (profile && profile.avatar) avatarSrc = profile.avatar;
      }
    } catch(e){}

    this.container.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: center;">
        <!-- User Profile Menu Button -->
        <div id="user-pic" class="hud-btn" onclick="if(window.showWalletConnect) window.showWalletConnect()" style="width: 44px; height: 44px; padding: 0; border-radius: 50%; overflow: hidden; border: 2px solid var(--neon-blue); box-shadow: 0 0 15px rgba(0, 194, 255, 0.4); cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(10,10,15,0.85);">
          <img src="${avatarSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
        </div>

        <!-- Spotify Pill -->
        <div class="spotify-vinyl-pill" onclick="window.spotifyWidget.openMusicCenter()" style="display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; background: rgba(10, 10, 15, 0.85); border: 2px solid ${this.isConnected ? 'var(--neon-green)' : 'rgba(255,255,255,0.2)'}; box-shadow: 0 0 15px rgba(0,0,0,0.5); cursor:pointer; overflow:hidden; position:relative; transition: all 0.3s ease; flex-shrink: 0;">
          <img id="hud-vinyl-img" src="${albumArt}" class="${this.isPlaying ? 'spinning-vinyl' : ''}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block; transition: transform 0.3s ease;" />
          ${!this.isConnected ? `
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); backdrop-filter: blur(2px);">
              <span style="font-size:18px; filter: drop-shadow(0 0 5px var(--neon-green));">🎵</span>
            </div>
          ` : ''}
        </div>
      </div>
      <style>
        .spinning-vinyl {
          animation: spinVinyl 6s linear infinite;
        }
        @keyframes spinVinyl {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spotify-vinyl-pill:hover {
          transform: scale(1.08) rotate(15deg);
          border-color: var(--neon-blue);
          box-shadow: 0 0 15px var(--neon-blue);
        }
      </style>
    `;

    // Render Music Center modal content
    this.renderMusicCenterContent();
  }

  renderMusicCenterContent() {
    if (!this.modal) return;

    if (!this.isConnected) {
      this.modal.innerHTML = `
        <div style="text-align: center; color: white;">
          <h3 style="color: var(--neon-green); margin-bottom: 20px; font-size: 14px; letter-spacing: 2px;">🎵 CONNECT SPOTIFY MUSIC</h3>
          <p style="font-size: 9px; line-height: 1.6; color: #aaa; margin-bottom: 20px;">
            Pair your Spotify account to listen to high-action fighting soundtracks during gameplay and control playback on any device!
          </p>
          <button onclick="window.spotifyWidget.connectSpotify()" class="premium-btn" style="padding: 10px 20px; font-size: 10px; width: 100%; margin-bottom: 15px;">
            CONNECT SPOTIFY
          </button>
          <button onclick="window.spotifyWidget.closeMusicCenter()" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:9px; text-decoration:underline;">
            CLOSE
          </button>
        </div>
      `;
      return;
    }

    const albumArt = this.currentTrackArt || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%231db954" fill-opacity="0.1" stroke="%231db954" stroke-width="2"/><path d="M50 20a30 30 0 0 0-30 30 30 30 0 0 0 30 30 30 30 0 0 0 30-30A30 30 0 0 0 50 20zm-5 13h10v10H45V33zm0 18h10v16H45V51z" fill="%231db954"/></svg>';

    // Beautiful Music Center with active Visualizer controls
    this.modal.innerHTML = `
      <div style="color: white; text-align: center; padding-right: 5px;">
        <!-- HEADER -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
          <span style="font-size: 10px; font-weight: bold; color: var(--neon-green); letter-spacing: 1px;">🟢 SPOTIFY MUSIC CENTER</span>
          <button onclick="window.spotifyWidget.closeMusicCenter()" style="background:transparent; border:none; color:#ff007f; font-weight:bold; cursor:pointer; font-size:12px;">✕</button>
        </div>

        <!-- PLAYER VISUALIZER -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 20px; margin-bottom: 15px; display:flex; flex-direction:column; align-items:center; gap:12px;">
          <div style="width: 140px; height: 140px; border-radius: 50%; overflow:hidden; border: 3px solid var(--neon-green); box-shadow: 0 0 20px rgba(20,241,149,0.3); position:relative;">
            <img src="${albumArt}" class="${this.isPlaying ? 'spinning-vinyl' : ''}" style="width:100%; height:100%; object-fit:cover;" />
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:30px; height:30px; background:#000; border-radius:50%; border:2px solid var(--neon-green);"></div>
          </div>

          <div style="text-align: center; width: 100%; overflow:hidden;">
            <div id="modal-track-name" style="color: var(--neon-blue); font-size: 12px; font-weight: bold; white-space: nowrap; animation: marquee 10s linear infinite;">
              ${this.currentTrackName}
            </div>
            <div id="modal-artist-name" style="color: #aaa; font-size: 9px; margin-top: 4px;">
              ${this.currentTrackArtist}
            </div>
          </div>
        </div>

        <!-- PLAYBACK CONTROLS -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 12px; margin-bottom: 15px;">
          <div style="display:flex; justify-content:center; align-items:center; gap:20px; font-size:18px; margin-bottom: 10px;">
            <button onclick="window.spotifyWidget.toggleShuffle()" style="background:transparent; border:none; color:${this.isShuffle ? 'var(--neon-green)' : '#666'}; cursor:pointer; font-size:14px;">🔀</button>
            <button onclick="window.spotifyWidget.prevTrack()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:16px;">⏮️</button>
            <button onclick="window.spotifyWidget.togglePlay()" style="background:var(--neon-green); border:none; color:#000; cursor:pointer; font-size:18px; width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 10px rgba(20,241,149,0.3); transition:all 0.2s;">
              ${this.isPlaying ? '⏸️' : '▶️'}
            </button>
            <button onclick="window.spotifyWidget.nextTrack()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:16px;">⏭️</button>
            <button onclick="window.spotifyWidget.toggleRepeat()" style="background:transparent; border:none; color:${this.isRepeat !== 'off' ? 'var(--neon-green)' : '#666'}; cursor:pointer; font-size:14px;">🔁</button>
          </div>

          <!-- Volume Slider -->
          <div style="display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box;">
            <span style="font-size:9px; color:#aaa;">🔈</span>
            <input type="range" min="0" max="100" value="${this.currentVolume}" onchange="window.spotifyWidget.setVolume(this.value)" style="flex:1; accent-color:var(--neon-green); height:4px; background:#444; border-radius:2px; outline:none; cursor:pointer;" />
            <span style="font-size:9px; color:#aaa;">🔊</span>
          </div>
        </div>

        <!-- SEARCH AND MEME RADIO PANELS -->
        <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
          <!-- Active Search -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 12px;">
            <span style="font-size: 8px; font-weight:bold; color:var(--neon-blue); letter-spacing:0.5px; display:block; margin-bottom:6px;">🔎 SEARCH TRACKS ON SPOTIFY</span>
            <div style="display:flex; gap:6px;">
              <input type="text" id="spotify-search-query" placeholder="Type Song or Artist..." style="flex:1; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:6px 12px; color:white; font-family:monospace; font-size:9px;" onkeydown="if(event.key === 'Enter') window.spotifyWidget.searchTracks(this.value)" />
              <button onclick="window.spotifyWidget.searchTracks(document.getElementById('spotify-search-query').value)" style="background:var(--neon-blue); border:none; color:black; font-family:inherit; font-size:9px; font-weight:bold; border-radius:8px; padding:6px 12px; cursor:pointer;">SEARCH</button>
            </div>
            
            <!-- Search Results -->
            <div id="spotify-search-results" style="margin-top:8px; display:flex; flex-direction:column; gap:4px; max-height: 100px; overflow-y:auto;">
              ${this.searchResults.map(t => `
                <div onclick="window.spotifyWidget.playTrack('${t.uri}')" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:6px; border-radius:6px; font-size:8px; cursor:pointer; transition:all 0.2s;">
                  <span style="font-weight:bold; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">${t.name} - ${t.artist}</span>
                  <span style="color:var(--neon-green)">▶️</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Curated Meme Radio Playlists -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 12px;">
            <span style="font-size: 8px; font-weight:bold; color:var(--neon-pink); letter-spacing:0.5px; display:block; margin-bottom:8px;">⛩️ CURATED MEME BATTLE RADIO</span>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <div onclick="window.spotifyWidget.playPlaylist('spotify:playlist:37i9dQZF1DXdLTE751Kydt')" class="radio-card" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:10px; font-size:9px; cursor:pointer;">
                <div>
                  <div style="font-weight:bold; color:#fff;">🔵 Cyberpunk Combat Beats</div>
                  <div style="color:#888; font-size:7px; margin-top:2px;">High-tempo industrial synth battle tracks</div>
                </div>
                <span style="color:var(--neon-pink)">▶️</span>
              </div>
              <div onclick="window.spotifyWidget.playPlaylist('spotify:playlist:37i9dQZF1DX8XZmiw614GA')" class="radio-card" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:10px; font-size:9px; cursor:pointer;">
                <div>
                  <div style="font-weight:bold; color:#fff;">🔥 Synthwave Pump & Degen Anthem</div>
                  <div style="color:#888; font-size:7px; margin-top:2px;">Retro gaming beats for charting vertical pumps</div>
                </div>
                <span style="color:var(--neon-pink)">▶️</span>
              </div>
            </div>
          </div>
        </div>

        <button onclick="window.spotifyWidget.disconnect()" style="background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); color:#ff3b30; font-family:inherit; font-size:9px; padding:8px; border-radius:8px; width:100%; cursor:pointer; margin-top:15px;">
          DISCONNECT SPOTIFY
        </button>
      </div>
      
      <style>
        @keyframes marquee {
          0% { transform: translateX(0); }
          50% { transform: translateX(-35%); }
          100% { transform: translateX(0); }
        }
        .radio-card:hover {
          background: rgba(255,255,255,0.06) !important;
          border-color: var(--neon-pink) !important;
        }
      </style>
    `;
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
      this.render();
    });

    this.player.addListener('initialization_error', ({ message }) => {
      console.warn('Spotify SDK Init Error, falling back to Web API Remote Control:', message);
      this.initRemoteControl();
    });

    this.player.addListener('authentication_error', ({ message }) => {
      console.error('Spotify Auth Error:', message);
      this.disconnect();
    });

    this.player.addListener('player_state_changed', state => {
      if (!state) return;
      const track = state.track_window.current_track;
      this.isPlaying = !state.paused;
      this.isShuffle = state.shuffle;
      this.isRepeat = state.repeat_mode === 1 ? 'context' : state.repeat_mode === 2 ? 'track' : 'off';
      
      if (track) {
        this.currentTrackName = track.name;
        this.currentTrackArtist = track.artists[0].name;
        this.currentTrackArt = track.album.images[0]?.url;
        
        // Suppress BGM if Spotify plays
        if (this.isPlaying && window.bgmVolumeNode) {
          try { window.bgmVolumeNode.gain.value = 0; } catch(e){}
        }
      }
      this.render();
    });

    await this.player.connect();
  }

  initRemoteControl() {
    this.isRemoteFallback = true;
    this.isConnected = true;
    this.render();
    
    this.pollCurrentlyPlaying();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.pollCurrentlyPlaying(), 4000);
  }

  async pollCurrentlyPlaying() {
    if (!this.accessToken) return;
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        if (data && data.item) {
          const track = data.item;
          this.currentTrackName = track.name;
          this.currentTrackArtist = track.artists[0].name;
          this.currentTrackArt = track.album.images[0]?.url;
          this.isPlaying = data.is_playing;
          this.isShuffle = data.shuffle_state;
          this.isRepeat = data.repeat_state; // off, context, track
          this.currentVolume = data.device?.volume_percent || this.currentVolume;
          
          // Suppress Ambient BGM if active playing
          if (this.isPlaying) {
            const ambientBtn = document.getElementById('btn-bgm');
            if (ambientBtn && ambientBtn.textContent.includes('ON')) {
              if (window.toggleBGM) window.toggleBGM();
            }
          }
          this.render();
        }
      } else if (resp.status === 401) {
        console.warn('[Spotify] Token expired or invalid, disconnecting.');
        this.disconnect();
      }
    } catch (e) {
      console.warn('[Spotify] Failed to poll currently playing track:', e);
    }
  }

  async sendRemoteCommand(method, endpoint, body = null) {
    if (!this.accessToken) return;
    try {
      const resp = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
        method: method,
        headers: { 
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : null
      });
      if (resp.status === 401) {
        this.disconnect();
      } else {
        setTimeout(() => this.pollCurrentlyPlaying(), 600);
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

  prevTrack() {
    if (this.isRemoteFallback) {
      this.sendRemoteCommand('POST', 'previous');
    } else if (this.player) {
      this.player.previousTrack();
    }
  }

  nextTrack() {
    if (this.isRemoteFallback) {
      this.sendRemoteCommand('POST', 'next');
    } else if (this.player) {
      this.player.nextTrack();
    }
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    this.sendRemoteCommand('PUT', `shuffle?state=${this.isShuffle}`);
  }

  toggleRepeat() {
    const modes = ['off', 'context', 'track'];
    const currentIdx = modes.indexOf(this.isRepeat);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    this.isRepeat = nextMode;
    this.sendRemoteCommand('PUT', `repeat?state=${nextMode}`);
  }

  setVolume(value) {
    this.currentVolume = value;
    this.sendRemoteCommand('PUT', `volume?volume_percent=${value}`);
  }

  async searchTracks(query) {
    if (!query || !query.trim() || !this.accessToken) return;
    try {
      const resp = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        this.searchResults = data.tracks.items.map(t => ({
          name: t.name,
          artist: t.artists[0].name,
          uri: t.uri
        }));
        this.renderMusicCenterContent();
      }
    } catch(e) {
      console.warn('Spotify search failed:', e);
    }
  }

  async fetchUserPlaylists() {
    if (!this.accessToken) return;
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/playlists?limit=5', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        this.userPlaylists = data.items.map(p => ({
          name: p.name,
          uri: p.uri
        }));
      }
    } catch(e) {
      console.warn('Spotify playlists fetch failed:', e);
    }
  }

  playTrack(uri) {
    this.sendRemoteCommand('PUT', 'play', { uris: [uri] });
  }

  playPlaylist(uri) {
    this.sendRemoteCommand('PUT', 'play', { context_uri: uri });
  }

  disconnect() {
    localStorage.removeItem('spotify_access_token');
    this.isConnected = false;
    this.accessToken = null;
    this.isRemoteFallback = false;
    this.currentTrackName = 'No track playing';
    this.currentTrackArtist = 'Spotify Connected';
    this.currentTrackArt = null;
    this.isPlaying = false;
    
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
    
    this.closeMusicCenter();
    this.render();
  }
}

// Global instance
window.spotifyWidget = new SpotifyWidget('spotify-widget');
