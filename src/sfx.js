// ─────────────────────────────────────────────
// Sound effects using pre-decoded MP3 AudioBuffers
// Each play() creates a lightweight BufferSourceNode
// that overlaps naturally and auto-garbage-collects.
// ─────────────────────────────────────────────

// Sound file manifest — grouped by category
const SOUNDS = {
  // Attack swing whoosh (plays on startup)
  whoosh:     ['/assets/kungfu_effort.wav', '/assets/kungfu_effort.wav', '/assets/dash.mp3', '/assets/dash_2.mp3'],
  // Impact sounds (play on hit only) - highly bias cartoon_punch, karate_hit, kick_hit, slide_hit
  hit:        [
    '/assets/cartoon_punch.wav', '/assets/cartoon_punch.wav', '/assets/cartoon_punch.wav',
    '/assets/karate_hit.wav', '/assets/karate_hit.wav',
    '/assets/kick_hit.wav', '/assets/kick_hit.wav',
    '/assets/slide_hit.wav', '/assets/slide_hit.wav',
    '/assets/slap.mp3', '/assets/punch.mp3'
  ],
  block:      ['/assets/punch_3.mp3', '/assets/punch_4.mp3', '/assets/kick_hit.wav'],
  headshot:   [
    '/assets/whip_impact.wav', '/assets/whip_impact.wav', 
    '/assets/cartoon_punch.wav', 
    '/assets/headshot.mp3', '/assets/headshot_2.mp3'
  ],
  crotchshot: [
    '/assets/pain_female.wav', '/assets/pain_female.wav',
    '/assets/crotchshot.mp3', '/assets/crotchshot_2.mp3'
  ],
  clash:      ['/assets/whip_impact.wav', '/assets/punch_4.mp3', '/assets/punch_3.mp3'],
  somersault: ['/assets/somersault.mp3', '/assets/kungfu_effort.wav'],
  dash:       ['/assets/dash.mp3', '/assets/dash_2.mp3'],
  hadouken_charge: ['/assets/somersault.mp3'],
  hadouken_fire:   ['/assets/whip_explosion.wav', '/assets/whip_explosion.wav', '/assets/dash.mp3'],

  // Custom categories for dedicated programmatic triggers
  male_scream:     ['/assets/male_scream.wav'],
  whip_explosion:  ['/assets/whip_explosion.wav'],
  whip_impact:     ['/assets/whip_impact.wav'],
  pain_female:     ['/assets/pain_female.wav']
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
  hadouken()       { this._play('hadouken_fire', 0.5); }
  playKoScream()   { this._play('male_scream', 0.8); }
  playOverdriveExplosion() { this._play('whip_explosion', 0.7); }
  playHeavyWhipImpact()   { this._play('whip_impact', 0.7); }
  playPainScream()   { this._play('pain_female', 0.7); }


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

  /** Start procedurally synthesized traditional Chinese pentatonic folktale background loop */
  startBGM() {
    if (this._bgmInterval) return;
    this._bgmActive = true;
    
    try {
      const ctx = this._ctx();
      
      const playPluck = (freq, time, volume = 0.03) => {
        const now = time;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        
        // Guzheng plucked characteristic: instant attack, rapid decay, long release
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(volume * 0.3, now + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        
        // Ringing resonance
        const resonance = ctx.createOscillator();
        const resGain = ctx.createGain();
        resonance.type = 'sine';
        resonance.frequency.setValueAtTime(freq * 2, now);
        resGain.gain.setValueAtTime(0, now);
        resGain.gain.linearRampToValueAtTime(volume * 0.1, now + 0.005);
        resGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        resonance.connect(resGain);
        resGain.connect(ctx.destination);
        resonance.start(now);
        resonance.stop(now + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(now);
        osc.stop(now + 1.5);
      };

      const playPad = (freq, time, duration, volume = 0.02) => {
        const now = time;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + duration * 0.3);
        gain.gain.setValueAtTime(volume, now + duration * 0.7);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(now);
        osc.stop(now + duration + 0.1);
      };

      const pentatonicScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
      const padChords = [
        [130.81, 196.00, 261.63], // C major
        [146.83, 220.00, 293.66], // D major
        [164.81, 261.63, 329.63], // E minor
        [196.00, 293.66, 392.00]  // G major
      ];

      let step = 0;
      const tickTime = 0.4; // seconds per tick
      
      const scheduleNextBeats = () => {
        if (!this._bgmActive) return;
        const now = ctx.currentTime;
        
        // Pad every 16 steps (6.4 seconds)
        if (step % 16 === 0) {
          const chord = padChords[Math.floor(Math.random() * padChords.length)];
          chord.forEach(freq => playPad(freq, now, 6.0, 0.015));
        }

        // Procedural Guzheng plucks
        if (step % 2 === 0 && Math.random() < 0.65) {
          const idx = Math.floor(Math.random() * pentatonicScale.length);
          playPluck(pentatonicScale[idx], now, 0.035);
          
          if (Math.random() < 0.25) {
            const orn = pentatonicScale[Math.min(idx + 2, pentatonicScale.length - 1)];
            playPluck(orn, now + 0.15, 0.018);
          }
        }
        
        step++;
      };

      scheduleNextBeats();
      this._bgmInterval = setInterval(scheduleNextBeats, tickTime * 1000);
      console.log("[SFX] Procedural Chinese ambient BGM started successfully.");
    } catch(e) {
      console.warn("[SFX] Failed to initialize BGM synthesizer:", e);
    }
  }

  stopBGM() {
    if (this._bgmInterval) {
      clearInterval(this._bgmInterval);
      this._bgmInterval = null;
    }
    this._bgmActive = false;
    console.log("[SFX] Procedural BGM stopped.");
  }
}
