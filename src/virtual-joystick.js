// ─────────────────────────────────────────────
// VirtualJoystickAdapter
// Integrates with the InputManager as a proper adapter.
// Exposes getActions() + getJustPressed() + endFrame().
// ─────────────────────────────────────────────
import { Actions } from './input.js';

export class VirtualJoystickAdapter {
  constructor() {
    this.held = new Set();
    this.justPressed = new Set();

    // Deadzone as a fraction of maxRadius
    this.DEADZONE = 0.18;
    this.maxRadius = 52;

    // Internal state
    this._activeTouchId = null;
    this._baseCenter = { x: 0, y: 0 };
    this._knobOffset = { x: 0, y: 0 };

    // DOM refs — will be assigned on attach()
    this.base = null;
    this.knob = null;
    this.container = null;

    // Attack buttons
    this._attackListeners = [];
  }

  attach() {
    this.base = document.getElementById('joystick-base');
    this.knob = document.getElementById('joystick-knob');
    this.container = document.getElementById('joystick-container');
    if (!this.base || !this.knob) return;

    // Touch events on the joystick base
    this.base.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    window.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
    window.addEventListener('touchend', e => this._onTouchEnd(e), { passive: false });
    window.addEventListener('touchcancel', e => this._onTouchEnd(e), { passive: false });

    // Mouse fallback for desktop testing
    this.base.addEventListener('mousedown', e => this._onMouseStart(e));
    window.addEventListener('mousemove', e => this._onMouseMove(e));
    window.addEventListener('mouseup', () => this._onRelease());

    // Attack buttons
    this._hookAttackButtons();
  }

  detach() {
    // Clean up listeners if needed
  }

  _hookAttackButtons() {
    const map = [
      { id: 'btn-light-punch', actions: [Actions.LIGHT_PUNCH] },
      { id: 'btn-heavy-punch', actions: [Actions.HEAVY_PUNCH] },
      { id: 'btn-light-kick',  actions: [Actions.LIGHT_KICK] },
      { id: 'btn-heavy-kick',  actions: [Actions.HEAVY_KICK] },
      { id: 'btn-jump',        actions: [Actions.JUMP, Actions.UP] },
      { id: 'btn-hadouken',    actions: [Actions.HADOUKEN] },
    ];

    for (const { id, actions } of map) {
      const el = document.getElementById(id);
      if (!el) continue;

      const onDown = (e) => {
        e.preventDefault();
        for (const a of actions) this.justPressed.add(a);
        if (window.haptic) window.haptic.lightHit();
        el.classList.add('active');
      };
      const onUp = (e) => {
        e.preventDefault();
        el.classList.remove('active');
      };

      el.addEventListener('touchstart', onDown, { passive: false });
      el.addEventListener('touchend', onUp, { passive: false });
      el.addEventListener('mousedown', onDown);
      el.addEventListener('mouseup', onUp);
    }
  }

  _recalcCenter() {
    const rect = this.base.getBoundingClientRect();
    this._baseCenter.x = rect.left + rect.width / 2;
    this._baseCenter.y = rect.top + rect.height / 2;
  }

  _onTouchStart(e) {
    e.preventDefault();
    if (this._activeTouchId !== null) return;
    const touch = e.changedTouches[0];
    this._activeTouchId = touch.identifier;
    this._recalcCenter();
    this._updateFromPoint(touch.clientX, touch.clientY);
  }

  _onTouchMove(e) {
    if (this._activeTouchId === null) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._activeTouchId) {
        e.preventDefault();
        this._updateFromPoint(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  _onTouchEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._activeTouchId) {
        this._activeTouchId = null;
        this._onRelease();
        break;
      }
    }
  }

  _onMouseStart(e) {
    this._mouseDown = true;
    this._recalcCenter();
    this._updateFromPoint(e.clientX, e.clientY);
  }

  _onMouseMove(e) {
    if (!this._mouseDown) return;
    this._updateFromPoint(e.clientX, e.clientY);
  }

  _onRelease() {
    this._mouseDown = false;
    this.held.clear();
    this._knobOffset = { x: 0, y: 0 };
    this._updateKnobVisual(0, 0);
  }

  _updateFromPoint(clientX, clientY) {
    const dx = clientX - this._baseCenter.x;
    const dy = clientY - this._baseCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const norm = dist / this.maxRadius;

    if (norm < this.DEADZONE) {
      this.held.clear();
      this._updateKnobVisual(0, 0);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedNorm = Math.min(1, norm);

    const knobX = Math.cos(angle) * clampedNorm * this.maxRadius;
    const knobY = Math.sin(angle) * clampedNorm * this.maxRadius;
    this._updateKnobVisual(knobX, knobY);

    // Compute actions from direction
    this.held.clear();

    // 8-direction with 30° dead arcs around pure diagonals
    const deg = (angle * 180 / Math.PI + 360) % 360;

    // Left / Right
    if (deg < 67.5 || deg >= 292.5) this.held.add(Actions.RIGHT);
    if (deg >= 112.5 && deg < 247.5) this.held.add(Actions.LEFT);

    // Up / Down
    if (deg >= 22.5 && deg < 157.5) this.held.add(Actions.DOWN);
    if (deg >= 202.5 && deg < 337.5) this.held.add(Actions.UP);

    // Jump when strongly pointing up (override DOWN)
    if (deg >= 247.5 && deg < 292.5) {
      this.held.add(Actions.UP);
      this.justPressed.add(Actions.JUMP);
    }
  }

  _updateKnobVisual(x, y) {
    if (!this.knob) return;
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  getActions() { return this.held; }
  getJustPressed() { return this.justPressed; }
  endFrame() { this.justPressed.clear(); }
  update(_dt) {}
}

// ─────────────────────────────────────────────
// HapticEngine — lightweight haptic feedback
// ─────────────────────────────────────────────
export class HapticEngine {
  static vibrate(pattern) {
    if (!navigator.vibrate) return;
    navigator.vibrate(pattern);
  }
  static lightHit()      { this.vibrate(30); }
  static heavyHit()      { this.vibrate(90); }
  static headshot()      { this.vibrate([60, 25, 60]); }
  static comboHit()      { this.vibrate([25, 15, 25, 15, 45]); }
  static boostActivate() { this.vibrate([70, 30, 120]); }
  static block()         { this.vibrate([20, 10, 20]); }
  static clash()         { this.vibrate([40, 20, 40]); }
}

window.haptic = HapticEngine;
