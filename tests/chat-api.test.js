const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/chat.js');
const knowledge = require('../api/knowledge.js');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

const originalFetch = global.fetch;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalNvidiaKey = process.env.NVIDIA_API_KEY;
const originalCreateQueryEmbedding = knowledge.createQueryEmbedding;
const originalRetrieveRelevant = knowledge.retrieveRelevant;

test.beforeEach(() => {
  handler._setKnowledgeIndexForTest({ chunks: [] });
  knowledge.createQueryEmbedding = async () => [1, 0, 0];
  knowledge.retrieveRelevant = () => ({ matches: [], sources: [], context: '' });
});

test.after(() => {
  global.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
  process.env.NVIDIA_API_KEY = originalNvidiaKey;
  knowledge.createQueryEmbedding = originalCreateQueryEmbedding;
  knowledge.retrieveRelevant = originalRetrieveRelevant;
});

test('rejects non-POST requests without calling an upstream provider', async () => {
  const res = responseRecorder();
  global.fetch = async () => { throw new Error('must not be called'); };

  await handler({ method: 'GET', body: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('routes an OpenAI selection to OpenAI without exposing the key', async () => {
  process.env.OPENAI_API_KEY = 'oa-test';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '**DNSH** — kein erheblicher Schaden.' } }] }) };
  };
  const res = responseRecorder();

  await handler({ method: 'POST', body: { provider: 'openai', message: 'Was ist DNSH?' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { reply: '**DNSH** — kein erheblicher Schaden.', provider: 'openai', sources: [] });
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer oa-test');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'gpt-5.4-mini');
  assert.equal(payload.max_completion_tokens, 900);
});

test('answers an explicit LkSG question only with the exam-exclusion emergency sentence', async () => {
  process.env.OPENAI_API_KEY = 'oa-test';
  global.fetch = async () => { throw new Error('LkSG must not trigger an upstream call'); };
  const res = responseRecorder();

  await handler({ method: 'POST', body: { provider: 'openai', message: 'Welche neun Sorgfaltspflichten hat das LkSG?' } }, res);

  assert.deepEqual(res.body, {
    reply: '**LkSG**: Nicht klausurrelevant; nur merken: Lieferkettenrisiken können weiterhin als ESG-Risiken vorkommen.',
    provider: 'notfallhinweis',
    sources: [],
  });
});

test('injects retrieved source excerpts into the tutor prompt and returns source labels', async () => {
  process.env.OPENAI_API_KEY = 'oa-test';
  knowledge.retrieveRelevant = () => ({
    matches: [{ id: 'exam', source: 'Klausuren/SS25_PT1', page: 2 }],
    sources: ['Klausuren/SS25_PT1, S. 2'],
    context: '[Klausuren/SS25_PT1, S. 2]\nErläutern Sie die doppelte Wesentlichkeit.',
  });
  handler._setKnowledgeIndexForTest({ chunks: [{ id: 'exam' }] });
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    if (url.includes('/embeddings')) return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '**Doppelte Wesentlichkeit**: Testantwort.' } }] }) };
  };
  const res = responseRecorder();

  await handler({ method: 'POST', body: { provider: 'openai', message: 'Was fragt die Klausur dazu?' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.sources, ['Klausuren/SS25_PT1, S. 2']);
  const payload = JSON.parse(request.options.body);
  assert.match(payload.messages[0].content, /KLAUSURQUELLEN/);
  assert.match(payload.messages[0].content, /Erläutern Sie die doppelte Wesentlichkeit/);
});

test('routes a NVIDIA selection to NVIDIA NIM with its compatible token parameter', async () => {
  process.env.NVIDIA_API_KEY = 'nv-test';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '**CSRD** — Berichtsrichtlinie.' } }] }) };
  };
  const res = responseRecorder();

  await handler({ method: 'POST', body: { provider: 'nvidia', message: 'Was ist CSRD?' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'nvidia');
  assert.equal(request.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer nv-test');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'meta/llama-3.1-8b-instruct');
  assert.equal(payload.max_tokens, 900);
  assert.equal('max_completion_tokens' in payload, false);
});
