const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createStudyEngine } = require('../study-engine.js');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : force;
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class Element {
  constructor() {
    this.classList = new ClassList();
    this.events = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this._lastChild = { textContent: '', classList: new ClassList() };
  }
  get lastChild() { return this.children.at(-1) || this._lastChild; }
  addEventListener(name, handler) { this.events[name] = handler; }
  appendChild(child) { this.children.push(child); return child; }
  click() {}
}

function bootApp() {
  const values = new Map();
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = {
    getElementById,
    createElement: () => new Element(),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const html = fs.readFileSync('index.html', 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'the page must have exactly one inline app script');
  const context = {
    console,
    document,
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
    NamaStudyEngine: { createStudyEngine },
    Date,
    JSON,
    Math,
    Blob: class {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    alert() {},
    confirm: () => true,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ reply: 'Testantwort' }) }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(scripts[0][1], context, { filename: 'index-inline.js' });
  return { context, getElementById, values };
}

test('page reveals rating buttons, rates a card, advances, and persists state', () => {
  const { context, getElementById, values } = bootApp();
  const before = getElementById('cardQuestion').textContent;

  context.flipCard();
  assert.equal(getElementById('actions').classList.contains('visible'), true);

  context.rateCard('medium');
  assert.equal(getElementById('actions').classList.contains('visible'), false);
  assert.notEqual(getElementById('cardQuestion').textContent, before);
  assert.match(values.get('nama-study-state-v2'), /"medium"/);
});

test('horizontal swipe flips the card first and rates it on the next swipe', () => {
  const { getElementById, values } = bootApp();
  const card = getElementById('card');
  const touch = (x, y) => ({ changedTouches: [{ clientX: x, clientY: y }], preventDefault() {} });

  card.events.touchstart(touch(10, 10));
  card.events.touchend(touch(90, 10));
  assert.equal(card.classList.contains('flipped'), true);

  card.events.touchstart(touch(10, 10));
  card.events.touchend(touch(90, 10));
  assert.match(values.get('nama-study-state-v2'), /"easy"/);
});

test('chat sends the selected provider to the same-origin server proxy', async () => {
  const { context, getElementById, values } = bootApp();
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ reply: 'DNSH-Testantwort' }) };
  };
  getElementById('chatProvider').value = 'nvidia';
  context.saveChatProvider();
  getElementById('chatInput').value = 'Was ist DNSH?';

  await context.sendChat();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/chat');
  assert.deepEqual(JSON.parse(calls[0].options.body), { provider: 'nvidia', message: 'Was ist DNSH?' });
  assert.equal(values.get('nama-chat-provider'), 'nvidia');
});
