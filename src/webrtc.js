// ─────────────────────────────────────────────
// WebRTC Data Channel — peer input exchange
// ─────────────────────────────────────────────
// Each client establishes a WebRTC data channel with the other peer
// for low-latency input exchange. Both clients also send inputs to
// the server via WebSocket for authoritative validation.
//
// If WebRTC fails, the system falls back to server-only relay via
// the existing /ws/game/{code} WebSocket.

const RECONNECT_DELAY = 2000; // ms
const MAX_RECONNECT_ATTEMPTS = 3;
const WS_RECONNECT_BASE_DELAY = 1000; // ms
const WS_RECONNECT_MAX_DELAY = 15000; // ms
const WS_RECONNECT_JITTER = 350; // ms
const WS_RECONNECT_CAP_ATTEMPTS = 8;

/**
 * Manages a WebRTC peer connection + data channel for one multiplayer room,
 * along with the fallback WebSocket to the game server.
 */
export class PeerConnection {
  constructor(roomCode, playerId, playerNum) {
    this.roomCode = roomCode;
    this.playerId = playerId;
    this.playerNum = playerNum;

    // WebRTC
    this.pc = null;
    this.dataChannel = null;
    this.iceServers = [];
    this.iceQueue = [];

    // WebSocket (server relay / authoritative state)
    this.ws = null;

    // SSE (signaling)
    this.signalSource = null;

    // Callbacks
    this._onRemoteInput = null;
    this._onServerState = null;
    this._onConnectionChange = null;
    this._onRemoteProfile = null;

    // State
    this.connected = false;     // data channel is open
    this.wsConnected = false;   // game WebSocket is open
    this.fallbackMode = false;  // true = WebRTC failed, WS-only mode
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._wsReconnectAttempts = 0;
    this._wsReconnectDelay = WS_RECONNECT_BASE_DELAY;
    this._wsReconnectTimer = null;
    this._wsGeneration = 0;
    this._closed = false;
    this.opponentProfile = null;
  }

  /** Register callback for remote peer inputs (via data channel) */
  onRemoteInput(cb) { this._onRemoteInput = cb; }

  /** Register callback for authoritative server state (via WebSocket) */
  onServerState(cb) { this._onServerState = cb; }

  /** Register callback for connection state changes */
  onConnectionChange(cb) { this._onConnectionChange = cb; }

  /** Register callback for remote peer profile sync details */
  onRemoteProfile(cb) {
    this._onRemoteProfile = cb;
    if (this.opponentProfile) cb(this.opponentProfile);
  }

  /**
   * Establish WebSocket + WebRTC connections.
   * WebSocket connects first (always needed). Then signaling starts
   * and WebRTC is attempted. If WebRTC fails, falls back to WS-only.
   */
  async connect() {
    this._connectWebSocket();

    try {
      await this._startSignaling();
    } catch (err) {
      console.warn('[webrtc] Signaling failed, falling back to server relay:', err);
      this._enterFallback();
    }
  }

  /**
   * Send local player inputs to both the peer (data channel) and the
   * server (WebSocket). The peer gets them for local prediction, the
   * server uses them for authoritative validation.
   */
  sendInput(actions, justPressed, seq = 0) {
    const msg = JSON.stringify({
      type: 'input',
      actions: Array.from(actions),
      just_pressed: Array.from(justPressed),
      seq,
    });

    // Send to peer via data channel (if connected)
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(msg);
      } catch (err) {
        console.warn('[webrtc] Data channel send error:', err);
      }
    }

    // Always send to server via WebSocket for authoritative validation
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(msg);
      } catch (err) {
        console.warn('[webrtc] WS send error:', err);
      }
    }
  }

  /** Tear down all connections and clean up. */
  close() {
    this._closed = true;
    this._clearReconnectTimer();
    this._clearWsReconnectTimer();
    this._disposeSignalSource();
    this._disposeDataChannel();
    this._disposePeerConnection();
    this._disposeWebSocket();

    this.connected = false;
    this.wsConnected = false;
  }

  // ── WebSocket (server relay) ──────────────────

  _clearReconnectTimer() {
    if (!this._reconnectTimer) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _clearWsReconnectTimer() {
    if (!this._wsReconnectTimer) return;
    clearTimeout(this._wsReconnectTimer);
    this._wsReconnectTimer = null;
  }

  _disposeSignalSource() {
    if (!this.signalSource) return;
    try {
      this.signalSource.onmessage = null;
      this.signalSource.onerror = null;
      this.signalSource.close();
    } catch (_) {}
    this.signalSource = null;
  }

  _disposeDataChannel() {
    if (!this.dataChannel) return;
    try {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
    } catch (_) {}
    this.dataChannel = null;
  }

  _disposePeerConnection() {
    if (!this.pc) return;
    try {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
    } catch (_) {}
    this.pc = null;
  }

  _disposeWebSocket() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    this.wsConnected = false;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'normal closure');
      }
    } catch (_) {}
  }

  _connectWebSocket() {
    if (this._closed) return;
    const currentState = this.ws?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
      return;
    }

    this._clearWsReconnectTimer();
    this._disposeWebSocket();

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/game/${this.roomCode}?player=${this.playerNum}`;
    const ws = new WebSocket(url);
    const generation = ++this._wsGeneration;
    this.ws = ws;

    ws.onopen = () => {
      if (generation !== this._wsGeneration || this.ws !== ws) return;
      console.log('[webrtc] Game WebSocket connected');
      this.wsConnected = true;
      this._wsReconnectAttempts = 0;
      this._wsReconnectDelay = WS_RECONNECT_BASE_DELAY;
      this._clearWsReconnectTimer();
      if (this._onConnectionChange) {
        this._onConnectionChange({ connected: this.connected, fallback: this.fallbackMode, wsConnected: true });
      }
    };

    ws.onmessage = (event) => {
      if (generation !== this._wsGeneration || this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (this._onServerState) this._onServerState(msg);
      } catch (err) {
        console.warn('[webrtc] WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      if (generation !== this._wsGeneration || this.ws !== ws) return;
      console.log('[webrtc] Game WebSocket disconnected');
      this.wsConnected = false;
      this.ws = null;
      if (this._closed) return;
      this._scheduleWsReconnect();
      if (this._onConnectionChange) {
        this._onConnectionChange({ connected: this.connected, fallback: this.fallbackMode, wsConnected: false });
      }
    };

    ws.onerror = (err) => {
      if (generation !== this._wsGeneration || this.ws !== ws) return;
      console.warn('[webrtc] Game WebSocket error:', err);
    };
  }

  _scheduleWsReconnect() {
    if (this._closed || this._wsReconnectTimer || this.wsConnected) return;

    const nextAttempt = this._wsReconnectAttempts + 1;
    this._wsReconnectAttempts = nextAttempt;
    const baseDelay = this._wsReconnectDelay;
    const jitter = Math.floor(Math.random() * WS_RECONNECT_JITTER);
    const delay = baseDelay + jitter;

    if (nextAttempt <= WS_RECONNECT_CAP_ATTEMPTS) {
      console.log(`[webrtc] WS reconnect attempt ${nextAttempt}/${WS_RECONNECT_CAP_ATTEMPTS} in ${delay}ms`);
    } else {
      console.log(`[webrtc] WS reconnect attempt ${nextAttempt} (capped backoff) in ${delay}ms`);
    }

    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      if (this._closed || this.wsConnected) return;
      this._connectWebSocket();
    }, delay);

    this._wsReconnectDelay = Math.min(baseDelay * 2, WS_RECONNECT_MAX_DELAY);
  }

  // ── WebRTC Signaling ──────────────────────────

  async _startSignaling() {
    return new Promise((resolve, reject) => {
      const url = `/api/room/signal/listen?room=${encodeURIComponent(this.roomCode)}&player_id=${encodeURIComponent(this.playerId)}`;

      this.signalSource = new EventSource(url);
      let resolved = false;

      this.signalSource.onmessage = async (event) => {
        try {
          if (!event.data || event.data.trim() === '' || event.data === 'undefined') return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch (e) {
            return; // Ignore malformed or keep-alive frames silently
          }

          if (data.type === 'connected') {
            this.iceServers = data.iceServers || [];
            this._createPeerConnection();

            // P1 creates the offer; P2 waits for it
            if (this.playerNum === 1) {
              await this._createOffer();
            }
            resolved = true;
            resolve();

            // Sync local profile details with peer over signaling
            try {
              const profileStr = localStorage.getItem('smf_user_profile');
              if (profileStr) {
                const profile = JSON.parse(profileStr);
                this._sendSignal({
                  type: 'profile_sync',
                  name: profile.name,
                  avatar: profile.avatar
                });
              }
            } catch (e) {
              console.warn('[webrtc] Failed to send profile sync signal:', e);
            }
          } else if (data.type === 'profile_sync') {
            console.log('[webrtc] Received remote profile via signaling:', data);
            this.opponentProfile = { name: data.name, avatar: data.avatar };
            if (this._onRemoteProfile) {
              this._onRemoteProfile(this.opponentProfile);
            }
          } else if (data.type === 'offer') {
            await this._handleOffer(data);
          } else if (data.type === 'answer') {
            await this._handleAnswer(data);
          } else if (data.candidate !== undefined) {
            await this._handleIceCandidate(data);
          }
        } catch (err) {
          console.warn('[webrtc] Signal processing error:', err);
        }
      };

      this.signalSource.onerror = () => {
        console.warn('[webrtc] Signal SSE error');
        if (!resolved) {
          this._disposeSignalSource();
          reject(new Error('Signaling SSE failed'));
        }
      };
    });
  }

  // ── RTCPeerConnection ─────────────────────────

  _createPeerConnection() {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    // Send ICE candidates to peer via signaling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log('[webrtc] Connection state:', state);
      if (state === 'failed' || state === 'disconnected') {
        this._handleDisconnect();
      }
    };

    // P1 creates the data channel; P2 receives it via ondatachannel
    if (this.playerNum === 1) {
      this.dataChannel = this.pc.createDataChannel('game-inputs', {
        ordered: false,       // low latency over ordering
        maxRetransmits: 0,    // unreliable = faster for real-time inputs
      });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }

  _setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('[webrtc] Data channel open');
      this.connected = true;
      this._reconnectAttempts = 0;
      if (this._onConnectionChange) {
        this._onConnectionChange({ connected: true, fallback: false });
      }

      // REDUNDANT BACKUP: Send local profile over data channel on open
      try {
        const profileStr = localStorage.getItem('smf_user_profile');
        if (profileStr) {
          const profile = JSON.parse(profileStr);
          channel.send(JSON.stringify({
            type: 'profile_sync',
            name: profile.name,
            avatar: profile.avatar
          }));
        }
      } catch (e) {
        console.warn('[webrtc] Failed to send backup profile sync:', e);
      }
    };

    channel.onclose = () => {
      console.log('[webrtc] Data channel closed');
      this.connected = false;
      if (!this._closed) {
        this._handleDisconnect();
      }
    };

    channel.onerror = (err) => {
      console.warn('[webrtc] Data channel error:', err);
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'input' && this._onRemoteInput) {
          this._onRemoteInput(msg);
        } else if (msg.type === 'profile_sync') {
          console.log('[webrtc] Received remote profile via WebRTC data channel:', msg);
          this.opponentProfile = { name: msg.name, avatar: msg.avatar };
          if (this._onRemoteProfile) {
            this._onRemoteProfile(this.opponentProfile);
          }
        }
      } catch (err) {
        console.warn('[webrtc] Data channel message parse error:', err);
      }
    };
  }

  async _createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._sendSignal({
      type: 'offer',
      sdp: offer.sdp,
    });
  }

  async _handleOffer(data) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: data.sdp,
    }));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._sendSignal({
      type: 'answer',
      sdp: answer.sdp,
    });
    await this._processIceQueue();
  }

  async _handleAnswer(data) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: data.sdp,
    }));
    await this._processIceQueue();
  }

  async _handleIceCandidate(data) {
    if (!this.pc) return;
    if (!this.pc.remoteDescription) {
      this.iceQueue.push(data.candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn('[webrtc] Failed to add ICE candidate:', err);
    }
  }

  async _processIceQueue() {
    if (!this.pc) return;
    while (this.iceQueue.length > 0) {
      const candidate = this.iceQueue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[webrtc] Failed to add queued ICE candidate:', err);
      }
    }
  }

  async _sendSignal(signal) {
    try {
      await fetch('/api/room/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: this.roomCode,
          playerId: this.playerId,
          signal,
        }),
      });
    } catch (err) {
      console.warn('[webrtc] Failed to send signal:', err);
    }
  }

  // ── Reconnection & Fallback ───────────────────

  _handleDisconnect() {
    if (this._closed || this.fallbackMode || this._reconnectTimer) return;

    this.connected = false;
    this._reconnectAttempts++;

    if (this._reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[webrtc] Reconnect attempt ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._attemptReconnect();
      }, RECONNECT_DELAY);
    } else {
      console.log('[webrtc] Max reconnect attempts reached, entering fallback mode');
      this._enterFallback();
    }
  }

  async _attemptReconnect() {
    if (this._closed || this.connected) return;

    // Clean up old peer connection
    this._disposeDataChannel();
    this._disposePeerConnection();

    try {
      this._createPeerConnection();
      if (this.playerNum === 1) {
        await this._createOffer();
      }
    } catch (err) {
      console.warn('[webrtc] Reconnect failed:', err);
      this._handleDisconnect();
    }
  }

  _enterFallback() {
    this.fallbackMode = true;
    this.connected = false;
    this._clearReconnectTimer();

    // Clean up WebRTC resources
    this._disposeSignalSource();
    this._disposeDataChannel();
    this._disposePeerConnection();

    console.log('[webrtc] Fallback mode: using server relay only');
    if (this._onConnectionChange) {
      this._onConnectionChange({ connected: false, fallback: true });
    }
  }
}


// ─────────────────────────────────────────────
// RemoteInputAdapter — standard InputAdapter that
// receives inputs from a remote peer via data channel
// ─────────────────────────────────────────────

export class RemoteInputAdapter {
  constructor() {
    this.held = new Set();
    this.justPressed = new Set();
  }

  attach() {}
  detach() {}

  /** Called when a remote input message arrives from the peer. */
  receiveInput(msg) {
    this.held = new Set(msg.actions || []);
    for (const action of (msg.just_pressed || [])) {
      this.justPressed.add(action);
    }
  }

  getActions() { return this.held; }
  getJustPressed() { return this.justPressed; }
  endFrame() { this.justPressed.clear(); }
}
