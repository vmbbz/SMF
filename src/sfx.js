// ─────────────────────────────────────────────
// Sound effects using pre-decoded MP3 AudioBuffers
// Each play() creates a lightweight BufferSourceNode
// that overlaps naturally and auto-garbage-collects.
// ─────────────────────────────────────────────

// Sound file manifest — grouped by category
const SOUNDS = {
  // Attack swing whoosh (plays on startup)
  whoosh:     ['/assets/dash.mp3', '/assets/dash_2.mp3'],
  // Impact sounds (play on hit only)
  hit:        ['/assets/slap.mp3', '/assets/slap_2.mp3', '/assets/punch.mp3', '/assets/punch_2.mp3', '/assets/punch_3.mp3', '/assets/punch_4.mp3'],
  block:      ['/assets/punch_3.mp3', '/assets/punch_4.mp3'],
  headshot:   ['/assets/headshot.mp3', '/assets/headshot_2.mp3'],
  crotchshot: ['/assets/crotchshot.mp3', '/assets/crotchshot_2.mp3'],
  clash:      ['/assets/punch_4.mp3', '/assets/punch_3.mp3'],
  somersault: ['/assets/somersault.mp3'],
  dash:       ['/assets/dash.mp3', '/assets/dash_2.mp3'],
  hadouken_charge: ['/assets/somersault.mp3'],
  hadouken_fire:   ['/assets/dash.mp3', '/assets/dash_2.mp3'],
};

export class SFX {
  constructor() {
    this._audioCtx = null;
    this._buffers = {};  // path → AudioBuffer
    this._loaded = false;
  }

  /** Lazy-init AudioContext (must happen after user gesture) */
  _ctx() {
    if (!this._audioCtx) {
      this._audioCtx = new AudioContext();
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    return this._audioCtx;
  }

  /** Preload all MP3s into decoded AudioBuffers */
  async preload() {
    if (this._loaded) return;
    const ctx = this._ctx();

    // Collect unique paths
    const paths = new Set();
    for (const files of Object.values(SOUNDS)) {
      for (const path of files) paths.add(path);
    }

    // Fetch + decode in parallel
    const entries = await Promise.all(
      [...paths].map(async (path) => {
        try {
          const resp = await fetch(path);
          const arrayBuf = await resp.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          return [path, audioBuf];
        } catch (e) {
          console.warn(`SFX: failed to load ${path}`, e);
          return [path, null];
        }
      })
    );

    for (const [path, buf] of entries) {
      if (buf) this._buffers[path] = buf;
    }

    this._loaded = true;
  }

  /** Play a random variant from a category at given volume */
  _play(category, volume = 0.5) {
    const files = SOUNDS[category];
    if (!files || files.length === 0) return;

    const ctx = this._ctx();
    const path = files[Math.floor(Math.random() * files.length)];
    const buffer = this._buffers[path];
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.connect(ctx.destination);

    source.connect(gain);
    source.start(0);
  }

  // ── Public sound methods ─────────────────────

  whoosh()     { this._play('whoosh', 0.3); }
  hit()        { this._play('hit', 0.5); }
  block()      { this._play('block', 0.3); }
  headshot()   { this._play('headshot', 0.7); }
  crotchshot() { this._play('crotchshot', 0.7); }
  clash()      { this._play('clash', 0.6); }
  somersault()     { this._play('somersault', 0.5); }
  dash()           { this._play('dash', 0.4); }
  hadoukenCharge() { this._play('hadouken_charge', 0.4); }
  hadoukenFire()   { this._play('hadouken_fire', 0.5); }

  /** Play a custom high-fidelity retro synth chime on mic toggles */
  playMicChime(active = true) {
    try {
      const ctx = this._ctx();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (active) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.15); // A5

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now); // E5
        osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15); // C6

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);

        osc1.start(now);
        osc1.stop(now + 0.35);
        osc2.start(now);
        osc2.stop(now + 0.35);
      } else {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440.00, now); // A4
        osc.frequency.exponentialRampToValueAtTime(220.00, now + 0.2); // A3

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch (e) {
      console.warn('[SFX] Synth chime failed:', e);
    }
  }

  /** Boom a boxing ring bell and deep gong at fight start */
  playFightStartSound() {
    try {
      const ctx = this._ctx();
      const now = ctx.currentTime;
      
      // 1. Boxing Bell (high metallic ping)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(100, now + 0.5);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.2, now + 0.01);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // 2. Booming Gong (deep low metallic sweep)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(110, now); // A2
      osc2.frequency.linearRampToValueAtTime(55, now + 1.2);
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 1.5);
      
      console.log("[SFX] Fight Start gong synthesized.");
    } catch (e) {
      console.warn('[SFX] Fight Start sound failed:', e);
    }
  }

  /** Play a triumphant major-chord retro arpeggio on victory */
  playVictorySound() {
    try {
      const ctx = this._ctx();
      const now = ctx.currentTime;
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C4, E4, G4, C5, E5, G5, C6 (C Major Arpeggio)
      
      notes.forEach((freq, idx) => {
        const time = now + idx * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.15, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(time);
        osc.stop(time + 0.35);
      });
      console.log("[SFX] Victory Fanfare synthesized.");
    } catch (e) {
      console.warn('[SFX] Victory Fanfare failed:', e);
    }
  }

  /** Play a sad descending minor-chord chime on defeat */
  playDefeatSound() {
    try {
      const ctx = this._ctx();
      const now = ctx.currentTime;
      const notes = [392.00, 349.23, 311.13, 261.63, 196.00]; // G4, F4, Eb4, C4, G3 (Sad minor chord)
      
      notes.forEach((freq, idx) => {
        const time = now + idx * 0.15;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.frequency.linearRampToValueAtTime(freq - 15, time + 0.45);
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.12, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(time);
        osc.stop(time + 0.55);
      });
      console.log("[SFX] Defeat Chime synthesized.");
    } catch (e) {
      console.warn('[SFX] Defeat Chime failed:', e);
    }
  }

  /** Play a rising high-energy laser pitch sweep on boosts */
  playBoostSound() {
    try {
      const ctx = this._ctx();
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(1800, now + 0.6); // Sci-fi pitch sweep!
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.6);
      console.log("[SFX] Boost sound synthesized.");
    } catch (e) {
      console.warn('[SFX] Boost sound failed:', e);
    }
  }
}
