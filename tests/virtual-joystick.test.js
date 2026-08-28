class TestClassList {
  constructor() {
    this.names = new Set();
  }

  add(...names) {
    names.forEach(name => this.names.add(name));
  }

  remove(...names) {
    names.forEach(name => this.names.delete(name));
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.names.has(name) : Boolean(force);
    if (shouldAdd) this.names.add(name);
    else this.names.delete(name);
    return shouldAdd;
  }

  contains(name) {
    return this.names.has(name);
  }
}

class TestEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail = {}) {
    const event = {
      type,
      preventDefault() {},
      ...detail,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class TestElement extends TestEventTarget {
  constructor(id, { button = false } = {}) {
    super();
    this.id = id;
    this.classList = new TestClassList();
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.title = '';
    this.icon = button ? { textContent: '' } : null;
    this.label = button ? { textContent: '' } : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  querySelector(selector) {
    if (selector === '.icon') return this.icon;
    if (selector === '.control-label' || selector === 'span:last-child') return this.label;
    return null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 130, height: 130 };
  }
}

const ids = [
  'joystick-base',
  'joystick-knob',
  'btn-hadouken',
  'btn-light-punch',
  'btn-light-kick',
  'btn-heavy-punch',
  'btn-heavy-kick',
];
const elements = new Map(ids.map(id => [id, new TestElement(id, { button: id.startsWith('btn-') })]));
const attackZone = new TestElement('attack-zone');
const testWindow = new TestEventTarget();
testWindow.haptic = { lightHit() {} };

globalThis.window = testWindow;
globalThis.document = {
  getElementById(id) {
    return elements.get(id) || null;
  },
  querySelector(selector) {
    return selector === '.attack-zone' ? attackZone : null;
  },
};
globalThis.navigator = { maxTouchPoints: 0, vibrate() {} };

const { Actions } = await import('../src/input.js');
const { VirtualJoystickAdapter } = await import('../src/virtual-joystick.js');

function resetButtonState() {
  for (const element of [...elements.values(), attackZone]) {
    element.classList = new TestClassList();
    element.dataset = {};
    element.attributes = new Map();
  }
}

describe('VirtualJoystickAdapter control layers', () => {
  let adapter;
  let triggered;

  beforeEach(() => {
    resetButtonState();
    triggered = [];
    window.triggerControllerBoost = tier => triggered.push(tier);
    adapter = new VirtualJoystickAdapter();
    adapter.attach();
  });

  afterEach(() => {
    adapter.detach();
  });

  test('toggles four local boost tiers without emitting attack actions', () => {
    adapter.configureForFight({ boostLayerAvailable: true });
    expect(elements.get('btn-hadouken').label.textContent).toBe('BOOST');

    elements.get('btn-hadouken').emit('mousedown');
    expect(adapter.boostLayerActive).toBe(true);
    expect(elements.get('btn-hadouken').label.textContent).toBe('ATTACK');
    expect(elements.get('btn-light-punch').label.textContent).toBe('MICRO');
    expect(elements.get('btn-light-kick').label.textContent).toBe('RUN');
    expect(elements.get('btn-heavy-punch').label.textContent).toBe('SPIKE');
    expect(elements.get('btn-heavy-kick').label.textContent).toBe('OVER');

    elements.get('btn-light-punch').emit('mousedown');
    expect(triggered).toEqual(['micro']);
    expect(adapter.getJustPressed().has(Actions.LIGHT_PUNCH)).toBe(false);

    elements.get('btn-hadouken').emit('mousedown');
    expect(adapter.boostLayerActive).toBe(false);
    expect(elements.get('btn-light-punch').label.textContent).toBe('LP');

    elements.get('btn-light-punch').emit('mousedown');
    expect(adapter.getJustPressed().has(Actions.LIGHT_PUNCH)).toBe(true);
  });

  test('retains the server-authorized SP action when the local layer is unavailable', () => {
    adapter.configureForFight({ boostLayerAvailable: false });
    expect(elements.get('btn-hadouken').label.textContent).toBe('SP');

    elements.get('btn-hadouken').emit('mousedown');
    expect(adapter.getJustPressed().has(Actions.HADOUKEN)).toBe(true);
    expect(adapter.boostLayerActive).toBe(false);
  });

  test('reset restores normal labels and clears queued actions', () => {
    adapter.configureForFight({ boostLayerAvailable: true });
    elements.get('btn-hadouken').emit('mousedown');
    adapter.justPressed.add(Actions.HEAVY_KICK);

    adapter.resetControlLayer();

    expect(adapter.boostLayerAvailable).toBe(false);
    expect(adapter.boostLayerActive).toBe(false);
    expect(adapter.getJustPressed().size).toBe(0);
    expect(elements.get('btn-hadouken').label.textContent).toBe('SP');
    expect(elements.get('btn-heavy-kick').label.textContent).toBe('HK');
  });
});
