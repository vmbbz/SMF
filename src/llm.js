// ─────────────────────────────────────────────
// LLMAdapter — AI fighter via Anthropic Claude / OpenAI / Gemini
//              + Intelligent Local Behavior Tree (Option 3)
//
// Sends game state → server → LLM → returns 5-move plan.
// Executes one move per second from the plan.
// When the plan is exhausted, requests a fresh one with current state.
// When LLM is unavailable/rate-limited, switches to the local behavior tree —
// a zero-latency, infinite-scale tactical AI that reads live game state.
// ─────────────────────────────────────────────
import { CommandAdapter } from './input.js';

const MAX_HISTORY = 10;       // max messages in conversation
const MOVE_INTERVAL = 1000;   // ms between executing each move from the plan

// ─────────────────────────────────────────────
// INTELLIGENT LOCAL BEHAVIOR TREE
// Replaces pure-random fallback with situation-aware tactics.
// Zero API calls, infinite scale, <1ms latency.
// ─────────────────────────────────────────────

const BT = {
  // Distance thresholds (px)
  ZONE_CLOSE:  140,  // brawl range — fastest attacks
  ZONE_MID:    300,  // optimal — heavy attacks, combo starters
  ZONE_FAR:    520,  // long range — hadouken pressure, dash
  // HP thresholds
  HP_DANGER:    70,  // play defensively
  HP_CRIT:      35,  // emergency: block/run
  HP_DOMINATE: 140,  // opponent is weak — go aggressive

  // Anti-repeat: store last plan key to avoid identical back-to-back plans
  _lastPlanKey: null,

  /**
   * Main entry point. Reads live fighter objects and returns a 5-move plan.
   */
  plan(me, opp, game, tactics = {}) {
    const dist   = Math.abs(me.x - opp.x);
    const myHp   = me.health;
    const oppHp  = opp.health;
    const timer  = game.roundTimer || 99;
    const stageW = game.stageWidth || 1200;

    // Opponent state flags
    const oppInHitstun   = opp.state === 'hitstun';
    const oppInBlockstun = opp.state === 'blockstun';
    const oppAirborne    = !opp.grounded;
    const oppCrouching   = opp.state === 'crouch';
    const oppAttacking   = opp.state === 'attack';
    const myAirborne     = !me.grounded;

    // Position awareness
    const nearRightWall = me.x > stageW * 0.78;
    const nearLeftWall  = me.x < stageW * 0.22;
    const oppNearEdge   = opp.x > stageW * 0.88 || opp.x < stageW * 0.12;
    const isCornered    = nearRightWall || nearLeftWall;

    // Best learned tactic from history
    const bestTactic = BT._bestTactic(tactics);

    // ── Priority Selector ───────────────────────────────────────────────────

    // 1. CRITICAL DEFENSE — nearly dead, must survive
    if (myHp <= BT.HP_CRIT && oppHp > BT.HP_CRIT) {
      return BT._emit('crit', BT._branchCriticalDefense(dist, isCornered));
    }

    // 2. FINISH HIM — opponent on last legs
    if (oppHp <= BT.HP_CRIT && myHp > BT.HP_CRIT) {
      return BT._emit('finish', BT._branchFinishHim(dist));
    }

    // 3. PUNISH — opponent in hitstun/blockstun — exploit the window
    if ((oppInHitstun || oppInBlockstun) && dist <= BT.ZONE_MID) {
      return BT._emit('punish', BT._branchPunish(dist, oppInHitstun, bestTactic));
    }

    // 4. ANTI-AIR — opponent jumping in on us
    if (oppAirborne && dist <= BT.ZONE_MID && !myAirborne) {
      return BT._emit('antiair', BT._branchAntiAir(dist));
    }

    // 5. DEFENSIVE — low HP, survive and poke
    if (myHp <= BT.HP_DANGER) {
      return BT._emit('defend', BT._branchDefensive(dist, oppHp, timer, isCornered));
    }

    // 6. DOMINANT — big HP lead, go for the kill
    if (oppHp <= BT.HP_DOMINATE && myHp > oppHp + 50) {
      return BT._emit('dominant', BT._branchDominant(dist, bestTactic));
    }

    // 7. EDGE TRAP — opponent cornered, pile on pressure
    if (oppNearEdge && dist <= BT.ZONE_MID) {
      return BT._emit('edge', BT._branchEdgeTrap(dist, bestTactic));
    }

    // 8. NEUTRAL — zone-based gameplan
    if (dist <= BT.ZONE_CLOSE) {
      return BT._emit('close', BT._branchClose(oppAttacking, oppCrouching, bestTactic));
    } else if (dist <= BT.ZONE_MID) {
      return BT._emit('mid', BT._branchMid(oppAttacking, bestTactic));
    } else if (dist <= BT.ZONE_FAR) {
      return BT._emit('far', BT._branchFar(bestTactic));
    } else {
      return BT._emit('fullscreen', BT._branchFullScreen());
    }
  },

  // ── Branch Implementations (v2 — full specials, no-repeat, more variety) ──

  _branchCriticalDefense(dist, cornered) {
    const escape = cornered ? 'jump' : 'dash back';
    return BT._noRepeat('crit', [
      ['back', 'back', 'crouch', escape, 'jump'],
      [escape, 'back', 'back', 'crouch', 'back'],
      ['back', 'crouch', 'back', 'jump', 'back'],
      ['dash back', 'back', 'crouch', 'back', 'jump'],
      ['jump', 'back', 'back', 'crouch', escape],
      ['back', 'jump', 'crouch', 'back', 'dash back'],
    ]);
  },

  _branchFinishHim(dist) {
    if (dist <= BT.ZONE_CLOSE) {
      return BT._noRepeat('finish_close', [
        ['heavy punch', 'heavy kick', 'forward heavy punch', 'forward heavy kick', 'heavy punch'],
        ['forward heavy kick', 'heavy punch', 'jump forward heavy kick', 'heavy punch', 'heavy kick'],
        ['crouch heavy punch', 'heavy kick', 'heavy punch', 'forward heavy punch', 'hadouken'],
        ['heavy kick', 'heavy punch', 'crouch heavy kick', 'forward heavy kick', 'heavy punch'],
        ['jump forward heavy kick', 'heavy punch', 'heavy kick', 'hadouken', 'heavy punch'],
        ['crouch heavy kick', 'heavy punch', 'jump forward heavy kick', 'heavy punch', 'hadouken'],
        ['heavy punch', 'crouch heavy punch', 'heavy kick', 'forward heavy kick', 'hadouken'],
        ['somersault', 'heavy punch', 'heavy kick', 'crouch heavy kick', 'hadouken'],
      ]);
    } else if (dist <= BT.ZONE_MID) {
      return BT._noRepeat('finish_mid', [
        ['dash forward', 'heavy punch', 'heavy kick', 'forward heavy kick', 'heavy punch'],
        ['jump forward heavy kick', 'heavy punch', 'dash forward', 'heavy kick', 'heavy punch'],
        ['hadouken', 'dash forward', 'heavy punch', 'heavy kick', 'forward heavy kick'],
        ['dash forward heavy punch', 'heavy kick', 'heavy punch', 'hadouken', 'heavy kick'],
        ['hadouken', 'dash forward heavy punch', 'heavy kick', 'heavy punch', 'hadouken'],
        ['jump jump forward heavy kick', 'heavy punch', 'dash forward', 'heavy kick', 'hadouken'],
        ['dash forward', 'heavy kick', 'hadouken', 'dash forward', 'heavy punch'],
      ]);
    } else {
      return BT._noRepeat('finish_far', [
        ['hadouken', 'dash forward', 'dash forward', 'heavy punch', 'heavy kick'],
        ['hadouken', 'hadouken', 'dash forward', 'dash forward', 'heavy punch'],
        ['dash forward', 'hadouken', 'dash forward', 'heavy punch', 'heavy kick'],
        ['jump forward heavy kick', 'dash forward', 'heavy punch', 'hadouken', 'heavy kick'],
      ]);
    }
  },

  _branchPunish(dist, isHitstun, bestTactic) {
    if (dist <= BT.ZONE_CLOSE) {
      const pool = isHitstun ? [
        // Hitstun: they can't block — go heavy
        ['heavy punch', 'heavy kick', 'medium punch', 'heavy punch', 'crouch heavy kick'],
        ['heavy kick', 'heavy punch', 'medium kick', 'heavy punch', 'crouch heavy kick'],
        ['crouch heavy punch', 'heavy kick', 'heavy punch', 'medium kick', 'heavy punch'],
        ['heavy punch', 'heavy kick', 'hadouken', 'heavy punch', 'heavy kick'],
        ['heavy kick', 'crouch heavy kick', 'heavy punch', 'medium punch', 'heavy kick'],
        ['heavy punch', 'somersault', 'heavy kick', 'medium punch', 'heavy punch'],
      ] : [
        // Blockstun: they're blocking — throw mix-ups
        ['heavy punch', 'medium kick', 'forward heavy kick', 'heavy punch', 'light punch'],
        ['medium punch', 'heavy kick', 'crouch heavy punch', 'medium kick', 'heavy punch'],
        ['heavy kick', 'forward heavy kick', 'medium punch', 'heavy punch', 'light kick'],
        ['crouch heavy kick', 'medium punch', 'heavy kick', 'light punch', 'heavy punch'],
      ];
      if (bestTactic && Math.random() < 0.35) {
        return [bestTactic, 'heavy punch', 'heavy kick', 'medium punch', bestTactic];
      }
      return BT._noRepeat('punish_close', pool);
    }
    // Mid-range punish — close the gap first
    return BT._noRepeat('punish_mid', [
      ['dash forward', 'heavy punch', 'heavy kick', 'forward heavy punch', 'medium kick'],
      ['dash forward heavy punch', 'heavy kick', 'medium punch', 'forward heavy kick', 'heavy punch'],
      ['dash forward', 'heavy kick', 'heavy punch', 'crouch heavy kick', 'medium punch'],
      ['jump forward heavy kick', 'heavy punch', 'heavy kick', 'medium punch', 'hadouken'],
    ]);
  },

  _branchAntiAir(dist) {
    return BT._noRepeat('antiair', [
      ['crouch heavy punch', 'back', 'light punch', 'medium punch', 'back'],
      ['heavy punch', 'crouch', 'back', 'light punch', 'crouch heavy punch'],
      ['hadouken', 'crouch', 'back', 'medium punch', 'back'],
      ['back', 'heavy punch', 'crouch', 'medium punch', 'back'],
      ['crouch', 'heavy punch', 'medium punch', 'back', 'crouch heavy punch'],
      ['hadouken', 'back', 'heavy punch', 'crouch', 'medium punch'],
      // Jump to meet them
      ['jump heavy kick', 'forward', 'medium punch', 'crouch', 'back'],
      ['jump heavy punch', 'forward', 'heavy kick', 'back', 'crouch'],
    ]);
  },

  _branchDefensive(dist, oppHp, timer, cornered) {
    // Both low HP + timer running out → run the clock
    if (oppHp < 70 && timer < 25) {
      return BT._noRepeat('stall', [
        ['back', 'back', 'back', 'crouch', 'back'],
        ['back', 'crouch', 'back', 'back', 'jump'],
        ['dash back', 'back', 'crouch', 'back', 'back'],
        ['back', 'back', 'jump', 'back', 'crouch'],
      ]);
    }
    if (dist <= BT.ZONE_CLOSE) {
      // Cornered: can't back up, must poke and jump out
      if (cornered) {
        return BT._noRepeat('defend_cornered', [
          ['jump', 'heavy kick', 'back', 'light punch', 'jump'],
          ['jump forward heavy kick', 'back', 'light punch', 'jump', 'back'],
          ['somersault', 'back', 'light punch', 'back', 'jump'],
          ['jump jump forward heavy kick', 'back', 'light punch', 'jump', 'back'],
          ['light punch', 'jump', 'back', 'light kick', 'jump'],
        ]);
      }
      return BT._noRepeat('defend_close', [
        ['back', 'light punch', 'back', 'crouch', 'back'],
        ['back', 'back', 'jump', 'back', 'light kick'],
        ['back', 'crouch', 'light punch', 'back', 'dash back'],
        ['dash back', 'hadouken', 'back', 'crouch', 'back'],
        ['back', 'light kick', 'back', 'crouch', 'dash back'],
        ['back', 'jump', 'back', 'light punch', 'back'],
        ['light punch', 'back', 'crouch', 'back', 'light kick'],
        ['dash back', 'back', 'hadouken', 'crouch', 'back'],
      ]);
    }
    // Mid/far range — hadouken keepaway + retreat
    return BT._noRepeat('defend_far', [
      ['hadouken', 'back', 'crouch', 'back', 'hadouken'],
      ['back', 'hadouken', 'crouch', 'back', 'back'],
      ['back', 'back', 'hadouken', 'crouch', 'back'],
      ['hadouken', 'back', 'back', 'hadouken', 'crouch'],
      ['back', 'hadouken', 'back', 'hadouken', 'crouch'],
      ['dash back', 'hadouken', 'back', 'hadouken', 'crouch'],
    ]);
  },

  _branchDominant(dist, bestTactic) {
    if (dist <= BT.ZONE_CLOSE) {
      const pool = [
        ['heavy punch', 'heavy kick', 'medium punch', 'forward heavy kick', 'heavy punch'],
        ['crouch heavy kick', 'heavy punch', 'heavy kick', 'medium punch', 'heavy kick'],
        ['jump forward heavy kick', 'heavy punch', 'heavy kick', 'forward heavy punch', 'medium kick'],
        ['heavy punch', 'hadouken', 'heavy kick', 'medium punch', 'forward heavy kick'],
        ['crouch heavy punch', 'heavy kick', 'heavy punch', 'hadouken', 'heavy kick'],
        ['jump jump forward heavy kick', 'heavy punch', 'heavy kick', 'medium punch', 'heavy kick'],
        ['somersault', 'heavy punch', 'heavy kick', 'medium punch', 'hadouken'],
        ['heavy kick', 'heavy punch', 'hadouken', 'heavy kick', 'heavy punch'],
        ['forward heavy kick', 'heavy punch', 'crouch heavy kick', 'medium punch', 'heavy kick'],
      ];
      if (bestTactic && Math.random() < 0.4) {
        return [bestTactic, 'heavy punch', 'heavy kick', 'hadouken', 'heavy punch'];
      }
      return BT._noRepeat('dominant_close', pool);
    }
    return BT._noRepeat('dominant_far', [
      ['dash forward', 'heavy punch', 'heavy kick', 'heavy punch', 'forward heavy kick'],
      ['jump forward heavy kick', 'heavy punch', 'dash forward', 'heavy kick', 'heavy punch'],
      ['hadouken', 'dash forward', 'heavy punch', 'heavy kick', 'forward heavy punch'],
      ['dash forward heavy punch', 'heavy kick', 'hadouken', 'dash forward', 'heavy punch'],
      ['hadouken', 'dash forward heavy punch', 'heavy kick', 'heavy punch', 'hadouken'],
      ['jump jump forward heavy kick', 'heavy punch', 'heavy kick', 'hadouken', 'heavy kick'],
      ['dash forward', 'hadouken', 'heavy punch', 'heavy kick', 'forward heavy kick'],
    ]);
  },

  _branchEdgeTrap(dist, bestTactic) {
    if (dist <= BT.ZONE_CLOSE) {
      return BT._noRepeat('edge_close', [
        ['heavy kick', 'heavy punch', 'jump forward heavy kick', 'crouch heavy kick', 'heavy punch'],
        ['crouch heavy kick', 'heavy punch', 'heavy kick', 'hadouken', 'heavy punch'],
        ['jump jump forward heavy kick', 'heavy punch', 'heavy kick', 'crouch heavy punch', 'hadouken'],
        ['heavy punch', 'hadouken', 'heavy kick', 'heavy punch', 'forward heavy kick'],
        ['somersault', 'heavy punch', 'heavy kick', 'hadouken', 'heavy punch'],
        ['heavy kick', 'crouch heavy kick', 'hadouken', 'heavy punch', 'heavy kick'],
        ['jump forward heavy kick', 'hadouken', 'heavy punch', 'heavy kick', 'hadouken'],
        ['forward heavy kick', 'heavy punch', 'hadouken', 'heavy kick', 'heavy punch'],
      ]);
    }
    return BT._noRepeat('edge_mid', [
      ['dash forward', 'heavy kick', 'heavy punch', 'hadouken', 'forward heavy kick'],
      ['hadouken', 'dash forward', 'heavy kick', 'heavy punch', 'hadouken'],
      ['jump forward heavy kick', 'heavy punch', 'hadouken', 'heavy kick', 'heavy punch'],
      ['dash forward heavy punch', 'hadouken', 'heavy kick', 'heavy punch', 'hadouken'],
    ]);
  },

  _branchClose(oppAttacking, oppCrouching, bestTactic) {
    if (oppAttacking) {
      return BT._noRepeat('close_vs_attack', [
        ['back', 'heavy punch', 'heavy kick', 'medium punch', 'back'],
        ['crouch', 'heavy punch', 'medium kick', 'light punch', 'back'],
        ['back', 'back', 'crouch heavy punch', 'medium kick', 'heavy punch'],
        ['back', 'crouch', 'heavy punch', 'heavy kick', 'back'],
        ['crouch', 'back', 'heavy punch', 'medium kick', 'heavy kick'],
        ['back', 'heavy kick', 'heavy punch', 'medium punch', 'back'],
      ]);
    }
    if (oppCrouching) {
      return BT._noRepeat('close_vs_crouch', [
        ['jump forward heavy kick', 'medium punch', 'heavy kick', 'light punch', 'medium punch'],
        ['forward heavy kick', 'medium punch', 'light kick', 'heavy kick', 'medium punch'],
        ['jump heavy punch', 'forward', 'medium punch', 'heavy kick', 'medium punch'],
        ['somersault', 'medium punch', 'heavy kick', 'light punch', 'medium kick'],
        ['jump jump forward heavy kick', 'medium punch', 'heavy kick', 'light kick', 'medium punch'],
        ['jump forward heavy punch', 'heavy kick', 'medium punch', 'light kick', 'heavy punch'],
      ]);
    }
    // Neutral close — mix fast pokes, specials, crouch attacks
    const pool = [
      ['light punch', 'medium punch', 'heavy kick', 'crouch heavy kick', 'light punch'],
      ['medium kick', 'light punch', 'heavy punch', 'forward light kick', 'medium punch'],
      ['crouch heavy punch', 'medium kick', 'light punch', 'heavy kick', 'medium punch'],
      ['forward light punch', 'heavy kick', 'medium punch', 'light kick', 'heavy punch'],
      ['light punch', 'medium punch', 'hadouken', 'light kick', 'medium punch'],
      ['medium kick', 'heavy punch', 'hadouken', 'medium kick', 'light punch'],
      ['crouch heavy kick', 'light punch', 'medium punch', 'heavy kick', 'light punch'],
      ['jump forward heavy kick', 'light punch', 'medium punch', 'heavy kick', 'light kick'],
      ['somersault', 'medium punch', 'light kick', 'heavy punch', 'medium kick'],
      ['crouch', 'heavy punch', 'medium kick', 'light punch', 'heavy kick'],
      ['light kick', 'medium punch', 'heavy kick', 'light punch', 'crouch heavy punch'],
      ['forward light kick', 'medium punch', 'heavy kick', 'light punch', 'heavy punch'],
    ];
    if (bestTactic && Math.random() < 0.3) {
      return BT._mutate([bestTactic, 'light punch', 'medium kick', 'heavy punch', 'light kick']);
    }
    return BT._noRepeat('close_neutral', pool);
  },

  _branchMid(oppAttacking, bestTactic) {
    if (oppAttacking) {
      return BT._noRepeat('mid_vs_attack', [
        ['back', 'crouch', 'dash forward', 'heavy punch', 'heavy kick'],
        ['jump', 'forward heavy kick', 'medium punch', 'back', 'heavy kick'],
        ['crouch', 'back', 'dash forward', 'heavy kick', 'heavy punch'],
        ['back', 'hadouken', 'dash forward', 'heavy punch', 'heavy kick'],
        ['jump forward heavy kick', 'heavy punch', 'medium kick', 'back', 'heavy kick'],
        ['hadouken', 'back', 'dash forward', 'heavy kick', 'heavy punch'],
      ]);
    }
    const pool = [
      ['dash forward', 'heavy punch', 'medium kick', 'forward heavy kick', 'back'],
      ['forward', 'medium punch', 'heavy kick', 'back', 'dash forward'],
      ['jump forward heavy kick', 'medium punch', 'back', 'forward', 'heavy kick'],
      ['hadouken', 'forward', 'dash forward', 'heavy punch', 'heavy kick'],
      ['dash forward heavy punch', 'medium kick', 'back', 'forward', 'heavy punch'],
      ['hadouken', 'dash forward heavy punch', 'medium kick', 'heavy kick', 'back'],
      ['jump jump forward heavy kick', 'heavy punch', 'back', 'forward', 'heavy kick'],
      ['dash forward', 'hadouken', 'dash forward', 'heavy punch', 'heavy kick'],
      ['somersault', 'dash forward', 'heavy punch', 'heavy kick', 'back'],
      ['hadouken', 'jump forward heavy kick', 'heavy punch', 'medium kick', 'back'],
      ['forward', 'heavy punch', 'hadouken', 'dash forward', 'heavy kick'],
      ['dash forward heavy kick', 'medium punch', 'hadouken', 'forward', 'heavy punch'],
    ];
    if (bestTactic && Math.random() < 0.35) {
      return BT._mutate([bestTactic, 'forward', 'heavy punch', 'hadouken', 'heavy kick']);
    }
    return BT._noRepeat('mid_neutral', pool);
  },

  _branchFar(bestTactic) {
    const pool = [
      ['hadouken', 'dash forward', 'forward', 'dash forward', 'heavy punch'],
      ['dash forward', 'dash forward', 'heavy punch', 'heavy kick', 'back'],
      ['hadouken', 'forward', 'dash forward', 'heavy kick', 'medium punch'],
      ['jump forward heavy kick', 'forward', 'dash forward', 'heavy punch', 'medium kick'],
      ['dash forward', 'hadouken', 'dash forward', 'heavy punch', 'heavy kick'],
      ['hadouken', 'hadouken', 'dash forward', 'heavy punch', 'heavy kick'],
      ['jump jump forward heavy kick', 'forward', 'dash forward', 'heavy punch', 'heavy kick'],
      ['hadouken', 'dash forward heavy punch', 'medium kick', 'back', 'heavy kick'],
      ['dash forward', 'dash forward', 'hadouken', 'heavy punch', 'heavy kick'],
      ['somersault', 'dash forward', 'hadouken', 'heavy punch', 'heavy kick'],
    ];
    if (bestTactic && Math.random() < 0.25) {
      return ['dash forward', bestTactic, 'hadouken', 'heavy punch', 'heavy kick'];
    }
    return BT._noRepeat('far', pool);
  },

  _branchFullScreen() {
    return BT._noRepeat('fullscreen', [
      ['hadouken', 'dash forward', 'dash forward', 'dash forward', 'forward'],
      ['dash forward', 'dash forward', 'hadouken', 'dash forward', 'forward'],
      ['jump forward heavy kick', 'dash forward', 'dash forward', 'heavy punch', 'forward'],
      ['hadouken', 'hadouken', 'dash forward', 'dash forward', 'forward'],
      ['hadouken', 'dash forward', 'hadouken', 'dash forward', 'heavy punch'],
      ['jump jump forward heavy kick', 'dash forward', 'dash forward', 'heavy punch', 'forward'],
      ['dash forward', 'hadouken', 'dash forward', 'dash forward', 'heavy punch'],
      ['hadouken', 'dash forward', 'dash forward', 'hadouken', 'heavy punch'],
    ]);
  },

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Emit a plan — applies 15% chance of special injection (hadouken prefix)
   * to any non-defensive/non-critical plan. Prevents predictability.
   */
  _emit(tag, plan) {
    // 15% chance to prepend a hadouken if not already starting with one
    // and we're in an offensive branch
    const offensiveBranches = ['finish', 'punish', 'dominant', 'edge', 'mid', 'far', 'fullscreen'];
    if (offensiveBranches.some(b => tag.startsWith(b)) &&
        plan[0] !== 'hadouken' && Math.random() < 0.15) {
      return ['hadouken', ...plan.slice(0, 4)];
    }
    return plan;
  },

  /**
   * Pick from pool without repeating the last plan (by string key).
   * Falls back to random pick if pool has only 1 item.
   */
  _noRepeat(tag, pool) {
    if (pool.length === 1) return pool[0];

    // Build key for last plan comparison
    const lastKey = BT._lastPlanKey;
    // Filter out plans that match the last one
    const filtered = pool.filter(p => JSON.stringify(p) !== lastKey);
    const chosen = filtered.length > 0
      ? filtered[Math.floor(Math.random() * filtered.length)]
      : pool[Math.floor(Math.random() * pool.length)];

    BT._lastPlanKey = JSON.stringify(chosen);
    return chosen;
  },

  /**
   * Randomly mutate 1-2 moves in a plan for unpredictability.
   * Only swaps from a compatible move pool.
   */
  _mutate(plan) {
    const variants = [
      'light punch', 'medium punch', 'heavy punch',
      'light kick', 'medium kick', 'heavy kick',
      'forward heavy kick', 'forward heavy punch',
      'crouch heavy kick', 'crouch heavy punch',
      'hadouken',
    ];
    const out = [...plan];
    // Mutate 1 random position (not position 0 to keep the opener)
    const idx = 1 + Math.floor(Math.random() * (out.length - 1));
    out[idx] = variants[Math.floor(Math.random() * variants.length)];
    BT._lastPlanKey = JSON.stringify(out);
    return out;
  },

  /** Get best learned tactic (highest net damage/use, >=2 uses, clearly positive) */
  _bestTactic(tactics) {
    let best = null, bestNet = -Infinity;
    for (const [cmd, t] of Object.entries(tactics)) {
      if (t.uses < 2) continue;
      const net = (t.dealt - t.taken) / t.uses;
      if (net > bestNet) { bestNet = net; best = cmd; }
    }
    return bestNet > 1.5 ? best : null;
  },
};

export class LLMAdapter {
  constructor(player, provider = 'anthropic', character = null) {
    this.player = player;
    this.provider = provider;
    this.character = character;
    this.command = new CommandAdapter();
    this.game = null;
    this._running = false;
    this._messages = [];
    this._ready = false;
    this._readyResolve = null;

    // Plan state
    this._plan = [];           // current move queue
    this._planIndex = 0;       // next move to execute
    this._moveTimer = 0;       // ms since last move executed
    this._requesting = false;  // true while waiting for LLM response

    // Track health for effectiveness feedback
    this._prevMyHp = 200;
    this._prevOppHp = 200;
    this._lastPlanDealt = 0;
    this._lastPlanTaken = 0;

    // Tactic tracking: command → { dealt, taken, uses }
    this._tactics = {};
    this._lastCommand = null;

    // LLM availability tracking
    this._consecutiveFailures = 0;
  }

  setGameRef(game) {
    this.game = game;
  }

  async attach() {
    this._running = true;
    this._ready = true;
    if (this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
    }
    // Plan request is triggered by update() once game ref is set
  }

  async detach() {
    this._running = false;
    this._ready = false;
    this._messages = [];
    this._plan = [];
    this._planIndex = 0;
    this._requesting = false;
    this.game = null;
  }

  waitUntilReady() {
    if (this._ready) return Promise.resolve();
    return new Promise(resolve => { this._readyResolve = resolve; });
  }

  /** Called every frame by the game loop */
  update(dt) {
    this.command.update(dt);

    if (!this._running || !this.game) return;
    if (this.game.roundOver || this.game.waitingForProviders || this.game.fightAlert > 0) return;

    // Tick move timer (dt is in seconds, _moveTimer is in ms)
    this._moveTimer += dt * 1000;

    // Execute next move from plan if interval has elapsed
    if (this._plan.length > 0 && this._planIndex < this._plan.length) {
      if (this._moveTimer >= MOVE_INTERVAL) {
        const move = this._plan[this._planIndex];
        console.log(`[LLM P${this.player}] execute [${this._planIndex + 1}/${this._plan.length}]: "${move}"  (timer=${Math.round(this._moveTimer)}ms)`);

        // Track tactic for the previous move's outcome
        this._trackTactic();

        this._lastCommand = move;
        this.command.execute(move);
        this._planIndex++;
        this._moveTimer = 0;

        // Snapshot health after executing (for next move's delta)
        this._snapshotHealth();
      }
    } else if (!this._requesting) {
      // Plan exhausted or empty — request a new one
      this._trackTactic();
      this._requestPlan();
    }
  }

  /** Snapshot current health for delta tracking */
  _snapshotHealth() {
    if (!this.game) return;
    const me = this.player === 1 ? this.game.p1 : this.game.p2;
    const opp = this.player === 1 ? this.game.p2 : this.game.p1;
    this._prevMyHp = me.health;
    this._prevOppHp = opp.health;
  }

  /** Track effectiveness of the last executed command */
  _trackTactic() {
    if (!this._lastCommand || !this.game) return;

    const me = this.player === 1 ? this.game.p1 : this.game.p2;
    const opp = this.player === 1 ? this.game.p2 : this.game.p1;
    const dealt = -(opp.health - this._prevOppHp);
    const taken = -(me.health - this._prevMyHp);

    if (!this._tactics[this._lastCommand]) {
      this._tactics[this._lastCommand] = { dealt: 0, taken: 0, uses: 0 };
    }
    const t = this._tactics[this._lastCommand];
    t.dealt += dealt;
    t.taken += taken;
    t.uses++;

    // Accumulate plan totals for feedback
    this._lastPlanDealt += dealt;
    this._lastPlanTaken += taken;
  }

  /**
   * Generate an intelligent 5-move plan using the local Behavior Tree.
   * Uses live game state if available; otherwise returns a basic approach plan.
   * Zero API calls — infinite scale, <1ms latency.
   */
  _behaviorTreePlan() {
    if (this.game) {
      const me  = this.player === 1 ? this.game.p1 : this.game.p2;
      const opp = this.player === 1 ? this.game.p2 : this.game.p1;
      if (me && opp) {
        const plan = BT.plan(me, opp, this.game, this._tactics);
        console.log(`[BT P${this.player}] plan: ${JSON.stringify(plan)}`);
        return plan;
      }
    }
    // Game ref not available yet — return a generic approach sequence
    return ['forward', 'dash forward', 'forward', 'heavy punch', 'heavy kick'];
  }

  /** Set the LLM toast message on the game object */
  _setToast(text) {
    if (!this.game) return;
    const key = this.player === 1 ? 'p1LlmToast' : 'p2LlmToast';
    this.game[key] = text ? { text, time: 2.0 } : null;
  }

  /** Set the LLM thinking state on the game object */
  _setThinking(active) {
    if (!this.game) return;
    const key = this.player === 1 ? 'p1LlmThinking' : 'p2LlmThinking';
    this.game[key] = active;
  }

  /** Apply a plan (from LLM or fallback) */
  _applyPlan(plan, elapsed = 0, isFallback = false) {
    if (plan && plan.length > 0) {
      const src = isFallback ? 'fallback' : 'LLM';
      console.log(`[LLM P${this.player}] new ${src} plan (${Math.round(elapsed)}ms): ${JSON.stringify(plan)}`);
      if (!isFallback) {
        this._messages.push({ role: 'assistant', content: JSON.stringify(plan) });
      }
      this._plan = plan;
      this._planIndex = 0;
      this._moveTimer = MOVE_INTERVAL; // execute first move immediately
      this._lastPlanDealt = 0;
      this._lastPlanTaken = 0;
    }
  }

  /** Request a fresh 5-move plan from the LLM (retry once, then fallback) */
  async _requestPlan() {
    if (this._requesting || !this._running) return;
    this._requesting = true;

    // Show subtle thinking indicator while LLM processes
    this._setThinking(true);

    try {
      const state = this._buildState();
      if (!state) {
        this._requesting = false;
        this._setThinking(false);
        return;
      }

      // Add game state as user message
      this._messages.push({ role: 'user', content: state });
      if (this._messages.length > MAX_HISTORY) {
        this._messages = this._messages.slice(-MAX_HISTORY);
      }

      const t0 = performance.now();
      const body = { provider: this.provider, messages: this._messages };
      if (this.character) body.character = this.character;

      const resp = await fetch('/api/llm/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const elapsed = performance.now() - t0;

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      console.log(`[LLM P${this.player}] response:`, JSON.stringify(data));

      this._setThinking(false);

      // Server may have fallen back to random commands — use local behavior tree instead
      if (data.fallback) {
        this._consecutiveFailures++;
        this._setToast('⚡ AI: Local Mode');
        console.warn(`[LLM P${this.player}] server returned fallback — switching to behavior tree`);
        const btPlan = this._behaviorTreePlan();
        this._applyPlan(btPlan, elapsed, true);
      } else {
        this._consecutiveFailures = 0;
        this._setToast(null);
        this._applyPlan(data.plan, elapsed, false);
      }

      if (!data.plan && !data.fallback) {
        console.warn(`[LLM P${this.player}] empty/missing plan in response:`, data);
      }
    } catch (e) {
      // Network error, rate-limit, or no API key — use local behavior tree
      this._setThinking(false);
      this._consecutiveFailures++;
      console.warn(`[LLM P${this.player}] Error (failures: ${this._consecutiveFailures}), using behavior tree:`, e.message);
      this._setToast('⚡ AI: Local Mode');
      const plan = this._behaviorTreePlan();
      this._applyPlan(plan, 0, true);
    } finally {
      this._requesting = false;
    }
  }

  /** Build compact game state string with plan outcome feedback */
  _buildState() {
    if (!this.game) return null;

    const me = this.player === 1 ? this.game.p1 : this.game.p2;
    const opp = this.player === 1 ? this.game.p2 : this.game.p1;
    const dist = Math.round(Math.abs(me.x - opp.x));

    const parts = [
      `T${Math.ceil(this.game.roundTimer)}`,
      `ME:${Math.round(me.x)},${Math.round(me.y)} hp${me.health} ${me.state}${me.grounded ? '' : ' air'}`,
      `OPP:${Math.round(opp.x)},${Math.round(opp.y)} hp${opp.health} ${opp.state}${opp.grounded ? '' : ' air'}`,
      `D${dist}`,
    ];

    // Add outcome of previous plan
    if (this._plan.length > 0) {
      const dealt = this._lastPlanDealt;
      const taken = this._lastPlanTaken;
      if (dealt > 0 && taken > 0) parts.push(`PLAN_RESULT:traded dealt=${dealt} took=${taken}`);
      else if (dealt > 0) parts.push(`PLAN_RESULT:hit! dealt=${dealt}`);
      else if (taken > 0) parts.push(`PLAN_RESULT:got hit, took=${taken}`);
      else parts.push(`PLAN_RESULT:no damage`);
    }

    // Add best tactics summary (top 3 by net damage)
    const tacticEntries = Object.entries(this._tactics)
      .filter(([, t]) => t.uses >= 2)
      .map(([cmd, t]) => ({ cmd, net: t.dealt - t.taken, avg: ((t.dealt - t.taken) / t.uses).toFixed(1), uses: t.uses }))
      .sort((a, b) => b.net - a.net);

    if (tacticEntries.length > 0) {
      const best = tacticEntries.slice(0, 3)
        .map(t => `${t.cmd}(net=${t.avg}/use x${t.uses})`)
        .join(', ');
      parts.push(`BEST:${best}`);
    }

    // Snapshot for deltas
    this._snapshotHealth();

    return parts.join(' | ');
  }

  setFacing(facing) {
    this.command.setFacing(facing);
  }

  getActions() {
    return this.command.getActions();
  }

  getJustPressed() {
    return this.command.getJustPressed();
  }

  endFrame() {
    this.command.endFrame();
  }
}
