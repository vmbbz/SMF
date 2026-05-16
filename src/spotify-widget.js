export class SpotifyWidget {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.player = null;
    this.isConnected = false;
    this.accessToken = null;
  }

  async init() {
    this.render();
    // Check if already connected from previous session
    const savedToken = localStorage.getItem('spotify_access_token');
    if (savedToken) {
      this.accessToken = savedToken;
      this.isConnected = true;
      this.connectPlayer();
    }
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="spotify-widget neon-border" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.8); border: 2px solid var(--neon-green); border-radius:10px; margin-top:10px; color:#fff;">
        <div class="user-header" style="display:flex; align-items:center; gap:10px;">
          <img id="user-pic" src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" width="28" height="28" style="border-radius:50%;">
          <span id="username" style="font-family:monospace; font-size:14px;">Guest Fighter</span>
          <button onclick="window.spotifyWidget.connectSpotify()" class="connect-btn" id="connect-btn" style="background:var(--neon-green); color:#000; border:none; padding:5px 10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:inherit;">CONNECT SPOTIFY</button>
        </div>
        <div id="player-controls" class="hidden" style="display:none; flex:1; align-items:center; gap:10px;">
          <div class="now-playing" style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
            <span id="track-name" style="color:var(--neon-blue); font-size:12px; font-weight:bold;">No track playing</span>
          </div>
          <div class="controls" style="display:flex; gap:5px;">
            <button onclick="window.spotifyWidget.togglePlay()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:16px;">⏯️</button>
            <button onclick="window.spotifyWidget.nextTrack()" style="background:transparent; border:none; color:#fff; cursor:pointer; font-size:16px;">⏭️</button>
          </div>
        </div>
      </div>
    `;
    
    // Auto-unhide if connected
    if (this.isConnected) {
      document.getElementById('connect-btn').style.display = 'none';
      document.getElementById('player-controls').style.display = 'flex';
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
      if(connectBtn) connectBtn.style.display = 'none';
      if(controls) controls.style.display = 'flex';
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
        trackNameEl.textContent = \`\${track.name} - \${track.artists[0].name}\`;
      }
    });

    await this.player.connect();
  }

  togglePlay() { if (this.player) this.player.togglePlay(); }
  nextTrack() { if (this.player) this.player.nextTrack(); }
}

// Global for easy access
window.spotifyWidget = new SpotifyWidget('spotify-widget');
