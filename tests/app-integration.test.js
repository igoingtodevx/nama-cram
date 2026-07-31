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

function readCards() {
  const html = fs.readFileSync('index.html', 'utf8');
  const match = html.match(/const ALL_CARDS = (\[.*?\]);\n\nconst CRASH_COURSE_STEPS/s);
  assert.ok(match, 'ALL_CARDS must be serialised in index.html before crash-course data');
  return JSON.parse(match[1]);
}

function bootApp(initialStorage = {}) {
  const values = new Map(Object.entries(initialStorage));
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

test('ships an eight-step crash course with original task and solution evidence', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const match = html.match(/const CRASH_COURSE_STEPS = (\[.*?\]);\n\nconst ESSAY_EXAMS/s);
  assert.ok(match, 'CRASH_COURSE_STEPS must be serialised in index.html');
  const steps = JSON.parse(match[1]);

  assert.match(html, /id="studyTab"/);
  assert.match(html, /id="crashTab"/);
  assert.match(html, /id="crashCourse"/);
  assert.equal(steps.length, 8);
  assert.deepEqual(steps.map(step => step.title), [
    'Integrated Value', 'Taxonomie-KPIs', 'ISSB vs. ESRS', 'Essay-Maschine',
    'WACC/CAPM + kleine SuSFi-Bausteine', 'Produktrechnung', 'Kapitel 4 & Theorie', 'Reserve-Rechnen',
  ]);
  for (const step of steps) {
    assert.match(step.originalTask, /^\/crash-assets\/.+\.webp$/);
    assert.match(step.officialSolution, /^\/crash-assets\/.+\.webp$/);
    assert.equal(fs.existsSync(`.${step.originalTask}`), true, `${step.title} needs its original task image`);
    assert.equal(fs.existsSync(`.${step.officialSolution}`), true, `${step.title} needs its official solution image`);
    assert.ok(step.shortAnswer.length >= 45, `${step.title} needs a real maximal-kurz answer`);
    assert.ok(step.sourceNote.length >= 20, `${step.title} needs source transparency`);
  }
  assert.doesNotMatch(JSON.stringify(steps), /LkSG|Lieferkettengesetz/i);
});

test('ships a separate ROADS essay tab with every genuine 25-point past-paper essay', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const match = html.match(/const ESSAY_EXAMS = (\[[\s\S]*?\]);\n\nconst NOTE_CARDS_STORAGE_KEY/);
  assert.ok(match, 'ESSAY_EXAMS must be serialised before note-card state');
  const exams = vm.runInNewContext(`(${match[1]})`);

  assert.match(html, /id="essayTab"/);
  assert.match(html, /id="essayCourse"/);
  assert.equal(exams.length, 2);
  assert.deepEqual(Array.from(exams, exam => exam.title), [
    'Omnibus & Deregulierung',
    'Doppelte Wesentlichkeit & CSRD',
  ]);
  for (const exam of exams) {
    assert.equal(exam.blocks.length, 3, `${exam.title} needs the three requested task blocks`);
    assert.deepEqual(Array.from(exam.blocks, block => block.sentences.length), [8, 8, 8]);
    assert.equal(exam.verdict.length, 2);
    assert.match(exam.source, /kein offizieller Erwartungshorizont/i);
    assert.ok(Array.isArray(exam.originalTasks) && exam.originalTasks.length >= 1);
    for (const task of exam.originalTasks) {
      assert.match(task, /^\/crash-assets\/roads-.+\.webp$/);
      assert.equal(fs.existsSync(`.${task}`), true, `${exam.title} needs its original exam page`);
    }
    const allSentences = exam.blocks.flatMap(block => block.sentences.map(item => item[1])).concat(exam.verdict[1]);
    assert.equal(allSentences.length, 25);
    assert.equal(new Set(allSentences).size, 25, `${exam.title} must not repeat point sentences`);
  }
  assert.match(html, /3 × 8 \+ 1/);
  assert.match(html, /ROADS = Munition/);
  assert.match(html, /BASIK nur bei Blackout/);
});

test('opening the larger tutor hides floating controls and exposes an in-panel close action', () => {
  const { context, getElementById } = bootApp();

  context.toggleChat();
  assert.equal(getElementById('chatPanel').classList.contains('open'), true);
  assert.equal(getElementById('chatToggle').hidden, true);
  assert.equal(getElementById('statsToggle').hidden, true);

  context.closeChat();
  assert.equal(getElementById('chatPanel').classList.contains('open'), false);
  assert.equal(getElementById('chatToggle').hidden, false);
  assert.equal(getElementById('statsToggle').hidden, false);
});

test('saves a pinned tutor note as a separate persistent custom flashcard', () => {
  const originalNote = 'DNSH: Kein erheblicher Schaden. Taxonomiekonform nur mit wesentlichem Beitrag, DNSH und Minimum Safeguards.';
  const { context, getElementById, values } = bootApp({
    'nama-pinned': JSON.stringify([originalNote]),
  });
  context.prompt = () => 'Wann ist eine Aktivität taxonomiekonform?';

  context.saveNoteAsCard(0);

  const noteCards = JSON.parse(values.get('nama-note-cards-v1'));
  assert.equal(noteCards.length, 1);
  assert.equal(noteCards[0].category, '📌 Eigene Notizen');
  assert.equal(noteCards[0].front, 'Wann ist eine Aktivität taxonomiekonform?');
  assert.equal(noteCards[0].back, originalNote);
  assert.equal(values.get('nama-pinned'), JSON.stringify([originalNote]), 'saving must never delete the original pin');
  assert.match(getElementById('pinnedList').innerHTML, /Als Karte gespeichert/);

  context.showOwnNotesDeck();
  assert.equal(getElementById('cardQuestion').textContent, 'Wann ist eine Aktivität taxonomiekonform?');
});

test('does not create a duplicate custom card for the same pinned note', () => {
  const note = 'Eine wiederholte Notiz';
  const { context, values } = bootApp({ 'nama-pinned': JSON.stringify([note]) });
  context.prompt = () => 'Eine Frage';

  context.saveNoteAsCard(0);
  context.saveNoteAsCard(0);

  assert.equal(JSON.parse(values.get('nama-note-cards-v1')).length, 1);
});

test('crash course mode switches away from flashcards without changing flashcard progress', () => {
  const { context, getElementById } = bootApp();
  context.showMode('crash');

  assert.equal(getElementById('studyView').hidden, true);
  assert.equal(getElementById('crashCourse').hidden, false);
  assert.equal(getElementById('crashTab').classList.contains('active'), true);
  assert.equal(getElementById('studyTab').classList.contains('active'), false);

  context.showMode('study');
  assert.equal(getElementById('studyView').hidden, false);
  assert.equal(getElementById('crashCourse').hidden, true);
});

test('essay mode is an independent third tab and leaves the study views hidden', () => {
  const { context, getElementById } = bootApp();
  context.showMode('essay');

  assert.equal(getElementById('studyView').hidden, true);
  assert.equal(getElementById('crashCourse').hidden, true);
  assert.equal(getElementById('essayCourse').hidden, false);
  assert.equal(getElementById('essayTab').classList.contains('active'), true);
  assert.equal(getElementById('studyTab').classList.contains('active'), false);
  assert.equal(getElementById('crashTab').classList.contains('active'), false);
  assert.match(getElementById('essayCourse').innerHTML, /20 Minuten/);
  assert.match(getElementById('essayCourse').innerHTML, /Omnibus &amp; Deregulierung/);
  assert.match(getElementById('essayCourse').innerHTML, /Doppelte Wesentlichkeit &amp; CSRD/);
  assert.match(getElementById('essayCourse').innerHTML, /ROADS = Munition/);
  assert.match(getElementById('essayCourse').innerHTML, /roads-omnibus-original-task\.webp/);
  assert.match(getElementById('essayCourse').innerHTML, /roads-wesentlichkeit-original-task\.webp/);
});

test('prioritises the announced lecture blocks without active LkSG learning', () => {
  const cards = readCards();
  const priorityCards = cards.filter(card => card.category === '🔥 High Priority');
  const corpus = priorityCards.map(card => `${card.front}\n${card.back}`).join('\n');

  assert.equal(priorityCards.length, 5);
  for (const phrase of ['ESG', 'SDGs', 'Paris', 'Taxonomie-KPIs', 'DB Transition Plan', 'ICMA', 'Sustainability-Linked Loan', 'Risikotragfähigkeit']) {
    assert.match(corpus, new RegExp(phrase, 'i'));
  }
  assert.doesNotMatch(cards.map(card => `${card.front}\n${card.back}`).join('\n'), /LkSG|Lieferkettengesetz|neun Sorgfaltspflichten|Grundaufbau.*LkSG/i);
});

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

test('flashcards render markdown emphasis, lists, and comparison tables without allowing HTML', () => {
  const { context } = bootApp();
  const markdown = `| Kriterium | ESRS/CSRD | IFRS S1&S2/ISSB |
|---|---|---|
| **Wesentlichkeit** | Doppelt | Single Financial Materiality |
| Blickrichtung | Inside-Out + Outside-In | Nur Outside-In |

⚡ **Merksatz:** **ESRS** fragt zusätzlich nach Umweltwirkung.`;
  const html = context.formatCardMarkdown(markdown);

  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<th>Kriterium<\/th>/);
  assert.match(html, /<strong>Wesentlichkeit<\/strong>/);
  assert.match(html, /<strong>Merksatz:<\/strong>/);
  assert.match(html, /<p>⚡ <strong>Merksatz:<\/strong>/);
  assert.doesNotMatch(context.formatCardMarkdown('<script>alert(1)<\/script>'), /<script/);
});

test('chat formats pasted one-line bullet answers into a readable safe list', () => {
  const { context } = bootApp();
  const html = context.formatTutorReply('- **IV**: Gesamtwert. - **IFRS S1**: Allgemeine Offenlegung.');

  assert.match(html, /^<ul>/);
  assert.match(html, /<li><strong>IV<\/strong>: Gesamtwert\.<\/li>/);
  assert.match(html, /<li><strong>IFRS S1<\/strong>: Allgemeine Offenlegung\.<\/li>/);
  assert.doesNotMatch(context.formatTutorReply('<img src=x onerror=alert(1)>'), /<img/);
});

test('chat gives every dynamic assistant reply a pin button and sends the selected provider', async () => {
  const { context, getElementById, values } = bootApp();
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ reply: '- **DNSH**: Kein erheblicher Schaden.', sources: ['Klausuren/SS25_PT1, S. 2'] }) };
  };
  getElementById('chatProvider').value = 'nvidia';
  context.saveChatProvider();
  getElementById('chatInput').value = 'Was ist DNSH?';

  await context.sendChat();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/chat');
  assert.deepEqual(JSON.parse(calls[0].options.body), { provider: 'nvidia', message: 'Was ist DNSH?' });
  assert.equal(values.get('nama-chat-provider'), 'nvidia');
  const assistantReply = getElementById('chatMessages').children.at(-1);
  assert.match(assistantReply.innerHTML, /class="pin-btn"/);
  assert.match(assistantReply.innerHTML, /<ul>/);
  assert.match(assistantReply.innerHTML, /chat-sources/);
  assert.match(assistantReply.innerHTML, /Klausuren\/SS25_PT1, S\. 2/);
});
