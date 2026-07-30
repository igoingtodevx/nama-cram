const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cosineSimilarity,
  retrieveRelevant,
  formatSources,
  createQueryEmbedding,
} = require('../api/knowledge.js');

test('retrieves the semantically closest chunks, caps context, and keeps source pages', () => {
  const index = {
    dimensions: 3,
    chunks: [
      { id: 'a', source: 'Klausur SS25', page: 3, content: 'Integrated Value rechnet Financial und Environmental Value.', embedding: [1, 0, 0] },
      { id: 'b', source: 'Skript CSRD', page: 4, content: 'Die doppelte Wesentlichkeit ist zentral für ESRS.', embedding: [0, 1, 0] },
      { id: 'c', source: 'Übung WACC', page: 2, content: 'WACC ist der gewichtete Kapitalkostensatz.', embedding: [0, 0, 1] },
    ],
  };

  const result = retrieveRelevant(index, [0.98, 0.1, 0], { limit: 2, maxContextChars: 300 });

  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].id, 'a');
  assert.match(result.context, /Klausur SS25, S\. 3/);
  assert.match(result.context, /Integrated Value/);
  assert.equal(result.sources[0], 'Klausur SS25, S. 3');
  assert.ok(result.context.length <= 300);
});

test('does not retrieve LkSG-only chunks for the current exam scope', () => {
  const index = {
    chunks: [
      { id: 'lksg', source: 'LkSG-Skript', page: 55, content: 'LkSG: neun Sorgfaltspflichten im Lieferkettengesetz.', embedding: [1, 0] },
      { id: 'omnibus', source: 'Regulatorik', page: 51, content: 'Das Omnibus-Verfahren vereinfacht die CSRD-Berichtspflicht.', embedding: [0.99, 0.01] },
    ],
  };

  const result = retrieveRelevant(index, [1, 0], { limit: 2, maxContextChars: 300 });

  assert.deepEqual(result.matches.map(item => item.id), ['omnibus']);
  assert.doesNotMatch(result.context, /LkSG|Lieferkettengesetz/i);
});

test('creates a 512-dimensional query embedding through the server-side OpenAI endpoint', async () => {
  let request;
  const vector = await createQueryEmbedding('WACC berechnen', 'oa-test', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) };
  });

  assert.deepEqual(vector, [0.1, 0.2, 0.3]);
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings');
  assert.equal(request.options.headers.Authorization, 'Bearer oa-test');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'text-embedding-3-small',
    dimensions: 512,
    input: 'WACC berechnen',
  });
});

test('handles empty indexes and formats de-duplicated source labels', () => {
  const result = retrieveRelevant({ chunks: [] }, [1, 0], { limit: 3, maxContextChars: 300 });
  assert.deepEqual(result, { matches: [], sources: [], context: '' });
  assert.deepEqual(formatSources([
    { source: 'Skript', page: 5 },
    { source: 'Skript', page: 5 },
    { source: 'Übung', page: 2 },
  ]), ['Skript, S. 5', 'Übung, S. 2']);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});
