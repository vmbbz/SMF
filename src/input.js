// ─────────────────────────────────────────────
// Abstract Input System
// ─────────────────────────────────────────────
// Game logic only sees "actions" — never raw keys/buttons.
// Each InputAdapter translates device signals into actions.
// Compound actions (dash, somersault) are emitted by adapters,
// not detected by game logic.

export const Actions = Object.freeze({
  // Directional (held)
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',

  // Attacks (edge-triggered)
  LIGHT_PUNCH: 'lightPunch',
  MEDIUM_PUNCH: 'mediumPunch',
  HEAVY_PUNCH: 'heavyPunch',
  LIGHT_KICK: 'lightKick',
  MEDIUM_KICK: 'mediumKick',
  HEAVY_KICK: 'heavyKick',

  // Compound actions (edge-triggered)
  JUMP: 'jump',
  SOMERSAULT: 'somersault',
  DASH_FORWARD: 'dashForward',   // semantic: toward opponent (voice/LLM)
  DASH_BACK: 'dashBack',         // semantic: away from opponent (voice/LLM)
  DASH_LEFT: 'dashLeft',         // directional: always left (keyboard)
  DASH_RIGHT: 'dashRight',       // directional: always right (keyboard)
  HADOUKEN: 'hadouken',          // special move: energy projectile
});

// ─────────────────────────────────────────────
// InputManager — holds adapters, merges their state
// ─────────────────────────────────────────────
export class InputManager {
  constructor() {
    this.adapters = [];
  }

  addAdapter(adapter) {
    this.adapters.push(adapter);
    if (adapter && typeof adapter.attach === 'function') {
      try {
        const maybePromise = adapter.attach();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(err => {
            const name = adapter?.constructor?.name || 'UnknownAdapter';
            console.warn(`[InputManager] ${name} attach failed:`, err);
          });
        }
      } catch (err) {
        const name = adapter?.constructor?.name || 'UnknownAdapter';
        console.warn(`[InputManager] ${name} attach threw:`, err);
      }
    }
    return this;
  }

  removeAdapter(adapter) {
    if (adapter && typeof adapter.detach === 'function') {
      try {
        const maybePromise = adapter.detach();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(err => {
            const name = adapter?.constructor?.name || 'UnknownAdapter';
            console.warn(`[InputManager] ${name} detach failed:`, err);
          });
        }
      } catch (err) {
        const name = adapter?.constructor?.name || 'UnknownAdapter';
        console.warn(`[InputManager] ${name} detach threw:`, err);
      }
    }
    this.adapters = this.adapters.filter(a => a !== adapter);
    return this;
  }

  /** Returns a Set of currently active actions (held state) */
  getActions() {
    const actions = new Set();
    for (const adapter of this.adapters) {
      for (const action of adapter.getActions()) {
        actions.add(action);
      }
    }
    return actions;
  }

  /** Returns actions that just started this frame (edge-triggered) */
  getJustPressed() {
    const pressed = new Set();
    for (const adapter of this.adapters) {
      if (adapter.getJustPressed) {
        for (const action of adapter.getJustPressed()) {
          pressed.add(action);
        }
      }
    }
    return pressed;
  }

  /** Tick timed adapters (call with dt each frame, before getActions/getJustPressed) */
  update(dt) {
    for (const adapter of this.adapters) {
      if (adapter.update) adapter.update(dt);
    }
  }

  /** Call at end of each frame to reset edge-triggered state */
  endFrame() {
    for (const adapter of this.adapters) {
      if (adapter.endFrame) adapter.endFrame();
    }
  }
}

// ─────────────────────────────────────────────
// Command vocabulary — maps words to action(s) + timing
// ─────────────────────────────────────────────
// 'hold' actions are sustained for `duration` seconds
// 'press' actions fire once (edge-triggered)
const COMMAND_VOCAB = {
  // Movement (held for duration)
  'forward':    { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'forwards':   { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'for ward':   { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'for wards':  { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'foreward':   { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'forewards':  { hold: [Actions.RIGHT],  duration: 1.0, semantic: true },
  'back':       { hold: [Actions.LEFT],   duration: 1.0, semantic: true },
  'backward':   { hold: [Actions.LEFT],   duration: 1.0, semantic: true },
  'backwards':  { hold: [Actions.LEFT],   duration: 1.0, semantic: true },
  'back ward':  { hold: [Actions.LEFT],   duration: 1.0, semantic: true },
  'back wards': { hold: [Actions.LEFT],   duration: 1.0, semantic: true },
  'crouch':     { hold: [Actions.DOWN],   duration: 1.0 },
  'crouched':   { hold: [Actions.DOWN],   duration: 1.0 },
  'couch':      { hold: [Actions.DOWN],   duration: 1.0 },
  'coach':      { hold: [Actions.DOWN],   duration: 1.0 },
  'crunch':     { hold: [Actions.DOWN],   duration: 1.0 },
  'duck':       { hold: [Actions.DOWN],   duration: 1.0 },
  'ducks':      { hold: [Actions.DOWN],   duration: 1.0 },
  'ducked':     { hold: [Actions.DOWN],   duration: 1.0 },

  // Jumps (edge-triggered)
  'jump':       { press: [Actions.JUMP] },
  'jumps':      { press: [Actions.JUMP] },
  'jumped':     { press: [Actions.JUMP] },
  'dump':       { press: [Actions.JUMP] },
  'gump':       { press: [Actions.JUMP] },
  'somersault': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'summersault': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'somersaults': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'summersaults': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'summer salt': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'summer assault': { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'flip':       { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'flips':      { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'backflip':   { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'back flip':  { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'frontflip':  { press: [Actions.SOMERSAULT, Actions.JUMP] },
  'front flip': { press: [Actions.SOMERSAULT, Actions.JUMP] },

  // Dashes (edge-triggered, semantic)
  'dash':           { press: [Actions.DASH_FORWARD] },
  'dashes':         { press: [Actions.DASH_FORWARD] },
  'dashed':         { press: [Actions.DASH_FORWARD] },
  'dash forward':   { press: [Actions.DASH_FORWARD] },
  'dash forwards':  { press: [Actions.DASH_FORWARD] },
  'dash for ward':  { press: [Actions.DASH_FORWARD] },
  'dash back':      { press: [Actions.DASH_BACK] },
  'dash backward':  { press: [Actions.DASH_BACK] },
  'dash backwards': { press: [Actions.DASH_BACK] },
  'dash back ward': { press: [Actions.DASH_BACK] },

  // Attacks (edge-triggered)
  'punch':        { press: [Actions.LIGHT_PUNCH] },
  'punches':      { press: [Actions.LIGHT_PUNCH] },
  'punched':      { press: [Actions.LIGHT_PUNCH] },
  'pinch':        { press: [Actions.LIGHT_PUNCH] },
  'lunch':        { press: [Actions.LIGHT_PUNCH] },
  'ponch':        { press: [Actions.LIGHT_PUNCH] },
  'light punch':  { press: [Actions.LIGHT_PUNCH] },
  'lite punch':   { press: [Actions.LIGHT_PUNCH] },
  'light pinch':  { press: [Actions.LIGHT_PUNCH] },
  'lite pinch':   { press: [Actions.LIGHT_PUNCH] },
  'jab':          { press: [Actions.LIGHT_PUNCH] },
  'medium punch': { press: [Actions.MEDIUM_PUNCH] },
  'medium pinch': { press: [Actions.MEDIUM_PUNCH] },
  'mid punch':    { press: [Actions.MEDIUM_PUNCH] },
  'mid pinch':    { press: [Actions.MEDIUM_PUNCH] },
  'strong':       { press: [Actions.MEDIUM_PUNCH] },
  'hard punch':   { press: [Actions.HEAVY_PUNCH] },
  'heavy punch':  { press: [Actions.HEAVY_PUNCH] },
  'hard pinch':   { press: [Actions.HEAVY_PUNCH] },
  'heavy pinch':  { press: [Actions.HEAVY_PUNCH] },
  'fierce':       { press: [Actions.HEAVY_PUNCH] },
  
  'kick':         { press: [Actions.LIGHT_KICK] },
  'kicks':        { press: [Actions.LIGHT_KICK] },
  'kicked':       { press: [Actions.LIGHT_KICK] },
  'quick':        { press: [Actions.LIGHT_KICK] },
  'cake':         { press: [Actions.LIGHT_KICK] },
  'keck':         { press: [Actions.LIGHT_KICK] },
  'light kick':   { press: [Actions.LIGHT_KICK] },
  'lite kick':    { press: [Actions.LIGHT_KICK] },
  'light cake':   { press: [Actions.LIGHT_KICK] },
  'lite cake':    { press: [Actions.LIGHT_KICK] },
  'short':        { press: [Actions.LIGHT_KICK] },
  'medium kick':  { press: [Actions.MEDIUM_KICK] },
  'medium cake':  { press: [Actions.MEDIUM_KICK] },
  'mid kick':     { press: [Actions.MEDIUM_KICK] },
  'mid cake':     { press: [Actions.MEDIUM_KICK] },
  'heavy kick':   { press: [Actions.HEAVY_KICK] },
  'heavy cake':   { press: [Actions.HEAVY_KICK] },
  'hard kick':    { press: [Actions.HEAVY_KICK] },
  'hard cake':    { press: [Actions.HEAVY_KICK] },
  'roundhouse':   { press: [Actions.HEAVY_KICK] },

  // Special moves (edge-triggered)
  'hadouken':     { press: [Actions.HADOUKEN] },
  'hadoken':      { press: [Actions.HADOUKEN] },
  'hadou':        { press: [Actions.HADOUKEN] },
  'hadu':         { press: [Actions.HADOUKEN] },
  'hado':         { press: [Actions.HADOUKEN] },
  'hadoukan':     { press: [Actions.HADOUKEN] },
  'hadukan':      { press: [Actions.HADOUKEN] },
  'haducon':      { press: [Actions.HADOUKEN] },
  'hadokun':      { press: [Actions.HADOUKEN] },
  'how do you can': { press: [Actions.HADOUKEN] },
  'how do can':   { press: [Actions.HADOUKEN] },
  'how do you get': { press: [Actions.HADOUKEN] },
  'how do you':   { press: [Actions.HADOUKEN] },
  'how to can':   { press: [Actions.HADOUKEN] },
  'how to get':   { press: [Actions.HADOUKEN] },
  'how to':       { press: [Actions.HADOUKEN] },
  'hurricane':    { press: [Actions.HADOUKEN] },
  'herricane':    { press: [Actions.HADOUKEN] },
  'ha do ken':    { press: [Actions.HADOUKEN] },
  'fireball':     { press: [Actions.HADOUKEN] },
  'fire ball':    { press: [Actions.HADOUKEN] },
  'energy blast': { press: [Actions.HADOUKEN] },
  'energyball':   { press: [Actions.HADOUKEN] },
  'energy ball':  { press: [Actions.HADOUKEN] },
};

export { COMMAND_VOCAB };

/**
 * Clean text, strip punctuation, collapse whitespace, and correct phonetic homophones
 * to guarantee robust vocabulary matching for game actions.
 */
function _cleanAndCorrectText(text) {
  if (!text) return "";
  
  // 1. Strip punctuation & convert to lowercase
  let clean = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "") // strip punctuation
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();

  // 2. Phrase-level corrections (longest phrases first)
  const phraseMappings = {
    "how do you can": "hadouken",
    "how do you get": "hadouken",
    "how do you": "hadouken",
    "how do can": "hadouken",
    "how to can": "hadouken",
    "how to get": "hadouken",
    "how to": "hadouken",
    "hadu kan": "hadouken",
    "hadou kan": "hadouken",
    "outer scan": "hadouken",
    "outer can": "hadouken",
    "fire ball": "hadouken",
    "fireball": "hadouken",
    "energy blast": "hadouken",
    "energyball": "hadouken",
    "energy ball": "hadouken",
    "summer salt": "somersault",
    "summer assault": "somersault",
    "summersault": "somersault",
    "back flip": "backflip",
    "front flip": "frontflip",
  };

  for (const [phrase, replacement] of Object.entries(phraseMappings)) {
    if (clean.includes(phrase)) {
      clean = clean.replace(new RegExp(phrase, 'g'), replacement);
    }
  }

  // 3. Word-level homophone replacements (common mis-transcriptions)
  const wordMappings = {
    "hadou": "hadouken",
    "hado": "hadouken",
    "hadu": "hadouken",
    "hadoken": "hadouken",
    "haducon": "hadouken",
    "hadokun": "hadouken",
    "hurricane": "hadouken",
    "herricane": "hadouken",
    "harricane": "hadouken",
  };

  const words = clean.split(" ");
  const correctedWords = words.map(w => wordMappings[w] || w);
  clean = correctedWords.join(" ");

  return clean;
}

// ─────────────────────────────────────────────
// CommandAdapter — converts text commands into
// timed actions. Used by voice and LLM adapters.
// ─────────────────────────────────────────────
export class CommandAdapter {
  constructor(facing = 1) {
    this.facing = facing; // 1 = right, -1 = left. Updated by game each frame.
    this.held = new Set();
    this.justPressed = new Set();
    // Active timed holds: [{ actions: [...], remaining: seconds }]
    this._timedHolds = [];
  }

  attach() {}
  detach() {}

  /** Update facing direction (call from game loop) */
  setFacing(facing) {
    this.facing = facing;
  }

  /**
   * Execute a text command string, e.g. "forward somersault" or "hard punch"
   * Parses into individual tokens, matches against COMMAND_VOCAB,
   * and queues the resulting actions.
   */
  execute(text) {
    const cleaned = _cleanAndCorrectText(text);
    console.log(`[CommandAdapter] Raw: "${text}" -> Cleaned: "${cleaned}"`);

    // Try matching multi-word commands first (longest match wins)
    const matched = new Set();
    let remaining = cleaned;

    // Sort vocab keys by length descending for greedy matching
    const sortedKeys = Object.keys(COMMAND_VOCAB).sort((a, b) => b.length - a.length);

    while (remaining.length > 0) {
      let found = false;
      for (const key of sortedKeys) {
        if (remaining.startsWith(key)) {
          const cmd = COMMAND_VOCAB[key];
          this._applyCommand(cmd);
          remaining = remaining.slice(key.length).trim();
          found = true;
          break;
        }
      }
      if (!found) {
        // Skip unrecognized word
        const spaceIdx = remaining.indexOf(' ');
        if (spaceIdx === -1) break;
        remaining = remaining.slice(spaceIdx + 1).trim();
      }
    }
  }

  _applyCommand(cmd) {
    // Edge-triggered actions
    if (cmd.press) {
      for (const action of cmd.press) {
        this.justPressed.add(action);
      }
    }

    // Timed hold actions
    if (cmd.hold && cmd.duration) {
      let actions = [...cmd.hold];

      // Semantic direction: flip LEFT/RIGHT based on facing
      if (cmd.semantic) {
        actions = actions.map(a => {
          if (a === Actions.RIGHT) return this.facing === 1 ? Actions.RIGHT : Actions.LEFT;
          if (a === Actions.LEFT) return this.facing === 1 ? Actions.LEFT : Actions.RIGHT;
          return a;
        });
      }

      this._timedHolds.push({ actions, remaining: cmd.duration });
      // Also add to held immediately
      for (const action of actions) {
        this.held.add(action);
      }
    }
  }

  /** Call each frame with dt to tick down timed holds */
  update(dt) {
    // Rebuild held set from active timed holds
    this.held.clear();
    this._timedHolds = this._timedHolds.filter(hold => {
      hold.remaining -= dt;
      if (hold.remaining > 0) {
        for (const action of hold.actions) {
          this.held.add(action);
        }
        return true;
      }
      return false;
    });
  }

  getActions() {
    return this.held;
  }

  getJustPressed() {
    return this.justPressed;
  }

  endFrame() {
    this.justPressed.clear();
  }
}

// ─────────────────────────────────────────────
// Double-tap detection window (seconds)
// ─────────────────────────────────────────────
const DOUBLE_TAP_WINDOW = 0.25;

// ─────────────────────────────────────────────
// KeyboardAdapter — maps keys → actions,
// detects double-taps → compound actions
// ─────────────────────────────────────────────
export class KeyboardAdapter {
  constructor(keyMap) {
    this.keyMap = keyMap; // { 'KeyW': Actions.UP, ... }
    this.held = new Set();
    this.justPressed = new Set();

    // Double-tap tracking: action → last press timestamp
    this._lastTap = {};

    // Combo buffer for hadouken: forward-forward-heavyPunch within 500ms
    this._comboBuffer = []; // [{action, time}]

    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  detach() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }

  _onDown(e) {
    const action = this.keyMap[e.code];
    if (!action) return;
    e.preventDefault();

    if (!this.held.has(action)) {
      const now = performance.now() / 1000;

      // Track direction presses for hadouken combo detection
      if (action === Actions.LEFT || action === Actions.RIGHT) {
        this._comboBuffer.push({ action, time: now });
        if (this._comboBuffer.length > 10) this._comboBuffer.shift();
      }

      // Hadouken combo: 2x same direction + heavy punch within 500ms
      if (action === Actions.HEAVY_PUNCH) {
        const COMBO_WINDOW = 0.5;
        const recent = this._comboBuffer.filter(e => now - e.time < COMBO_WINDOW);
        const rights = recent.filter(e => e.action === Actions.RIGHT).length;
        const lefts = recent.filter(e => e.action === Actions.LEFT).length;
        if (rights >= 2 || lefts >= 2) {
          this.justPressed.add(Actions.HADOUKEN);
          this._comboBuffer = [];
        }
      }

      const lastTap = this._lastTap[action] || 0;

      // Detect double-taps and emit compound actions
      if (now - lastTap < DOUBLE_TAP_WINDOW) {
        if (action === Actions.UP) {
          this.justPressed.add(Actions.SOMERSAULT);
        } else if (action === Actions.LEFT) {
          this.justPressed.add(Actions.DASH_LEFT);
        } else if (action === Actions.RIGHT) {
          this.justPressed.add(Actions.DASH_RIGHT);
        }
        this._lastTap[action] = 0; // reset so triple-tap doesn't re-trigger
      } else {
        // First tap — emit the base action + JUMP for UP
        if (action === Actions.UP) {
          this.justPressed.add(Actions.JUMP);
        }
        this._lastTap[action] = now;
      }

      this.justPressed.add(action);
    }
    this.held.add(action);
  }

  _onUp(e) {
    const action = this.keyMap[e.code];
    if (action) {
      this.held.delete(action);
      e.preventDefault();
    }
  }

  getActions() {
    return this.held;
  }

  getJustPressed() {
    return this.justPressed;
  }

  endFrame() {
    this.justPressed.clear();
  }
}

// ─────────────────────────────────────────────
// Default P1 keyboard layout
// ─────────────────────────────────────────────
export const P1_KEYBOARD_MAP = {
  'KeyW': Actions.UP,
  'KeyS': Actions.DOWN,
  'KeyA': Actions.LEFT,
  'KeyD': Actions.RIGHT,
  'KeyU': Actions.LIGHT_PUNCH,
  'KeyI': Actions.MEDIUM_PUNCH,
  'KeyO': Actions.HEAVY_PUNCH,
  'KeyJ': Actions.LIGHT_KICK,
  'KeyK': Actions.MEDIUM_KICK,
  'KeyL': Actions.HEAVY_KICK,
};

export const P2_KEYBOARD_MAP = {
  'ArrowUp': Actions.UP,
  'ArrowDown': Actions.DOWN,
  'ArrowLeft': Actions.LEFT,
  'ArrowRight': Actions.RIGHT,
  'Numpad4': Actions.LIGHT_PUNCH,
  'Numpad5': Actions.MEDIUM_PUNCH,
  'Numpad6': Actions.HEAVY_PUNCH,
  'Numpad1': Actions.LIGHT_KICK,
  'Numpad2': Actions.MEDIUM_KICK,
  'Numpad3': Actions.HEAVY_KICK,
};
