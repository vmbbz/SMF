// ─────────────────────────────────────────────
// VirtualJoystickAdapter
// Integrates with the InputManager as a proper adapter.
// Exposes getActions() + getJustPressed() + endFrame().
// ─────────────────────────────────────────────
import { Actions } from './input.js';

const ATTACK_CONTROLS = Object.freeze([
  { id: 'btn-light-punch', actions: [Actions.LIGHT_PUNCH], icon: '👊', label: 'LP', tier: 'micro', boostIcon: '🟡', boostLabel: 'MICRO' },
  { id: 'btn-light-kick', actions: [Actions.LIGHT_KICK], icon: '🦵', label: 'LK', tier: 'runner', boostIcon: '🟠', boostLabel: 'RUN' },
  { id: 'btn-heavy-punch', actions: [Actions.HEAVY_PUNCH], icon: '🔥', label: 'HP', tier: 'spike', boostIcon: '🔴', boostLabel: 'SPIKE' },
  { id: 'btn-heavy-kick', actions: [Actions.HEAVY_KICK], icon: '💥', label: 'HK', tier: 'overdrive', boostIcon: '🟣', boostLabel: 'OVER' },
]);

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

    this._listeners = [];
    this._attached = false;
    this.boostLayerAvailable = false;
    this.boostLayerActive = false;
    this._lastTouchPressAt = 0;
  }

  attach() {
    if (this._attached) return;
    this.base = document.getElementById('joystick-base');
    this.knob = document.getElementById('joystick-knob');
    this.container = document.getElementById('joystick-container');
    if (!this.base || !this.knob) return;
    this._attached = true;

    // Touch events on the joystick base
    this._addListener(this.base, 'touchstart', e => this._onTouchStart(e), { passive: false });
    this._addListener(window, 'touchmove', e => this._onTouchMove(e), { passive: false });
    this._addListener(window, 'touchend', e => this._onTouchEnd(e), { passive: false });
    this._addListener(window, 'touchcancel', e => this._onTouchEnd(e), { passive: false });

    // Mouse fallback for desktop testing
    this._addListener(this.base, 'mousedown', e => this._onMouseStart(e));
    this._addListener(window, 'mousemove', e => this._onMouseMove(e));
    this._addListener(window, 'mouseup', () => this._onRelease());

    // Attack buttons
    this._hookAttackButtons();
  }

  detach() {
    for (const { element, type, listener, options } of this._listeners) {
      element.removeEventListener(type, listener, options);
    }
    this._listeners = [];
    this._attached = false;
    this.resetControlLayer();
  }

  _addListener(element, type, listener, options) {
    element.addEventListener(type, listener, options);
    this._listeners.push({ element, type, listener, options });
  }

  _hookAttackButtons() {
    for (const control of ATTACK_CONTROLS) {
      const { id, actions, tier } = control;
      const el = document.getElementById(id);
      if (!el) continue;

      const onDown = (e) => {
        e.preventDefault();
        if (e.type === 'touchstart') this._lastTouchPressAt = Date.now();
        if (e.type === 'mousedown' && Date.now() - this._lastTouchPressAt < 600) return;

        if (this.boostLayerAvailable && this.boostLayerActive) {
          window.triggerControllerBoost?.(tier);
        } else {
          for (const action of actions) this.justPressed.add(action);
          window.haptic?.lightHit?.();
        }
        el.classList.add('active');
      };
      const onUp = (e) => {
        e.preventDefault();
        el.classList.remove('active');
      };

      this._addAttackListener(el, 'touchstart', onDown, { passive: false });
      this._addAttackListener(el, 'touchend', onUp, { passive: false });
      this._addAttackListener(el, 'touchcancel', onUp, { passive: false });
      this._addAttackListener(el, 'mousedown', onDown);
      this._addAttackListener(el, 'mouseup', onUp);
      this._addAttackListener(el, 'mouseleave', onUp);
    }

    const special = document.getElementById('btn-hadouken');
    if (!special) return;

    const onSpecialDown = (e) => {
      e.preventDefault();
      if (e.type === 'touchstart') this._lastTouchPressAt = Date.now();
      if (e.type === 'mousedown' && Date.now() - this._lastTouchPressAt < 600) return;

      if (this.boostLayerAvailable) {
        this.setBoostLayerActive(!this.boostLayerActive);
      } else {
        this.justPressed.add(Actions.HADOUKEN);
      }
      window.haptic?.lightHit?.();
      special.classList.add('active');
    };
    const onSpecialUp = (e) => {
      e.preventDefault();
      special.classList.remove('active');
    };
    this._addAttackListener(special, 'touchstart', onSpecialDown, { passive: false });
    this._addAttackListener(special, 'touchend', onSpecialUp, { passive: false });
    this._addAttackListener(special, 'touchcancel', onSpecialUp, { passive: false });
    this._addAttackListener(special, 'mousedown', onSpecialDown);
    this._addAttackListener(special, 'mouseup', onSpecialUp);
    this._addAttackListener(special, 'mouseleave', onSpecialUp);
    this._syncControlLayerDom();
  }

  _addAttackListener(element, type, listener, options) {
    this._addListener(element, type, listener, options);
  }

  configureForFight({ boostLayerAvailable = false } = {}) {
    this.boostLayerAvailable = Boolean(boostLayerAvailable);
    if (!this.boostLayerAvailable) this.boostLayerActive = false;
    this._syncControlLayerDom();
  }

  setBoostLayerActive(active) {
    this.boostLayerActive = this.boostLayerAvailable && Boolean(active);
    this.justPressed.clear();
    this._syncControlLayerDom();
    return this.boostLayerActive;
  }

  resetControlLayer() {
    this.boostLayerAvailable = false;
    this.boostLayerActive = false;
    this.justPressed.clear();
    this.held.clear();
    this._syncControlLayerDom();
  }

  _syncControlLayerDom() {
    if (typeof document === 'undefined') return;
    const attackZone = document.querySelector('.attack-zone');
    attackZone?.classList.toggle('boost-layer-available', this.boostLayerAvailable);
    attackZone?.classList.toggle('boost-layer-active', this.boostLayerActive);

    const special = document.getElementById('btn-hadouken');
    if (special) {
      const icon = special.querySelector('.icon');
      const label = special.querySelector('.control-label') || special.querySelector('span:last-child');
      if (this.boostLayerAvailable) {
        if (icon) icon.textContent = this.boostLayerActive ? '↩' : '⚡';
        if (label) label.textContent = this.boostLayerActive ? 'ATTACK' : 'BOOST';
        special.title = this.boostLayerActive ? 'Return to attack controls' : 'Open local boost controls';
      } else {
        if (icon) icon.textContent = '⚡';
        if (label) label.textContent = 'SP';
        special.title = 'Hadouken special';
      }
      special.setAttribute('aria-label', special.title);
      special.classList.toggle('boost-layer-toggle', this.boostLayerAvailable);
      special.classList.toggle('boost-layer-return', this.boostLayerActive);
      special.setAttribute('aria-pressed', this.boostLayerActive ? 'true' : 'false');
    }

    for (const control of ATTACK_CONTROLS) {
      const button = document.getElementById(control.id);
      if (!button) continue;
      const icon = button.querySelector('.icon');
      const label = button.querySelector('.control-label') || button.querySelector('span:last-child');
      if (icon) icon.textContent = this.boostLayerActive ? control.boostIcon : control.icon;
      if (label) label.textContent = this.boostLayerActive ? control.boostLabel : control.label;
      button.title = this.boostLayerActive
        ? `Trigger ${control.boostLabel.toLowerCase()} local boost`
        : `${control.label} attack`;
      button.setAttribute('aria-label', button.title);
      button.dataset.boostTier = this.boostLayerActive ? control.tier : '';
      button.classList.toggle('boost-tier-control', this.boostLayerActive);
      for (const tierName of ['micro', 'runner', 'spike', 'overdrive']) {
        button.classList.toggle(`boost-tier-${tierName}`, this.boostLayerActive && tierName === control.tier);
      }
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
// Dynamically bridges native Capacitor & standard Web APIs
// ─────────────────────────────────────────────
export class HapticEngine {
  static async vibrate(pattern) {
    try {
      // 1. Check if running inside Capacitor native app with the Haptics plugin registered
      const Haptics = window.Capacitor?.Plugins?.Haptics;
      if (Haptics) {
        if (Array.isArray(pattern)) {
          // Capacitor vibrate takes a single duration in ms.
          // Sum the pattern for a single consistent native pulse.
          const duration = pattern.reduce((a, b) => a + b, 0);
          await Haptics.vibrate({ duration });
        } else {
          await Haptics.vibrate({ duration: pattern });
        }
        return;
      }
    } catch (e) {
      console.warn('[HapticEngine] Capacitor native haptic failed:', e);
    }

    // 2. Fall back to standard web API (Android Chrome, desktop testing, etc.)
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (e) {
      console.warn('[HapticEngine] Web navigator.vibrate failed:', e);
    }
  }

  static async lightHit() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) {
      Haptics.impact({ style: 'LIGHT' }).catch(() => {});
    } else {
      this.vibrate(30);
    }
  }

  static async heavyHit() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) {
      Haptics.impact({ style: 'HEAVY' }).catch(() => {});
    } else {
      this.vibrate(90);
    }
  }

  static async headshot() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.notification) {
      // Notification type 'WARNING' produces a clean double pulse on native devices
      Haptics.notification({ type: 'WARNING' }).catch(() => {});
    } else {
      this.vibrate([60, 25, 60]);
    }
  }

  static async comboHit() {
    this.vibrate([25, 15, 25, 15, 45]);
  }

  static async boostActivate() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.notification) {
      Haptics.notification({ type: 'SUCCESS' }).catch(() => {});
    } else {
      this.vibrate([50, 30, 100, 30, 150]);
    }
  }

  static async block() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) {
      Haptics.impact({ style: 'LIGHT' }).catch(() => {});
    } else {
      this.vibrate([20, 10, 20]);
    }
  }

  static async clash() {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) {
      Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
    } else {
      this.vibrate([40, 20, 40]);
    }
  }
}

window.haptic = HapticEngine;
