const test = require('node:test');
const assert = require('node:assert/strict');
const { createStudyEngine } = require('../study-engine.js');

const cards = [
  { id: 'one', category: 'A' },
  { id: 'two', category: 'A' },
  { id: 'three', category: 'B' },
];

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('rating a card immediately advances to another card and records the rating', () => {
  const engine = createStudyEngine(cards, memoryStorage());
  const first = engine.current('all');

  const next = engine.rate(first.id, 'easy', 'all');

  assert.notEqual(next.id, first.id);
  assert.equal(engine.getState().ratings[first.id].rating, 'easy');
});

test('progress and the current card survive a reload', () => {
  const storage = memoryStorage();
  const firstSession = createStudyEngine(cards, storage);
  const first = firstSession.current('all');
  const expectedNext = firstSession.rate(first.id, 'medium', 'all');

  const reloaded = createStudyEngine(cards, storage);

  assert.equal(reloaded.current('all').id, expectedNext.id);
  assert.deepEqual(reloaded.progress(), { rated: 1, easy: 0, medium: 1, hard: 0, total: 3 });
});

test('a category filter never restores a current card from another category', () => {
  const engine = createStudyEngine(cards, memoryStorage());
  const first = engine.current('all');
  engine.rate(first.id, 'hard', 'all');

  assert.equal(engine.current('B').category, 'B');
  assert.equal(engine.current('B').id, 'three');
});

test('invalid rating or unknown card is rejected without corrupting saved state', () => {
  const engine = createStudyEngine(cards, memoryStorage());

  assert.throws(() => engine.rate('missing', 'easy', 'all'), /Unknown card/);
  assert.throws(() => engine.rate('one', 'skip', 'all'), /Invalid rating/);
  assert.deepEqual(engine.progress(), { rated: 0, easy: 0, medium: 0, hard: 0, total: 3 });
});
