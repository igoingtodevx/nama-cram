function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function sourceLabel(item) {
  return `${item.source}, S. ${item.page}`;
}

function formatSources(items) {
  return [...new Set(items.map(sourceLabel))];
}

function isExcludedExamContent(chunk) {
  return /\bLkSG\b|Lieferkettensorgfaltspflichtengesetz|Lieferkettengesetz/i.test(`${chunk?.source || ''}\n${chunk?.content || ''}`);
}

function retrieveRelevant(index, queryEmbedding, { limit = 4, maxContextChars = 5_500 } = {}) {
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  if (!chunks.length) return { matches: [], sources: [], context: '' };

  const matches = chunks
    .filter(chunk => !isExcludedExamContent(chunk))
    .map(chunk => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .filter(chunk => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  let context = '';
  const included = [];
  for (const chunk of matches) {
    const excerpt = `[Quelle: ${sourceLabel(chunk)}]\n${chunk.content.trim()}`;
    const separator = context ? '\n\n---\n\n' : '';
    if (context.length + separator.length + excerpt.length > maxContextChars) break;
    context += separator + excerpt;
    included.push(chunk);
  }
  return { matches: included, sources: formatSources(included), context };
}

async function createQueryEmbedding(query, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      dimensions: 512,
      input: query,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const embedding = payload.data?.[0]?.embedding;
  if (!response.ok || !Array.isArray(embedding)) {
    throw new Error(`Embedding request failed (${response.status})`);
  }
  return embedding;
}

module.exports = { cosineSimilarity, formatSources, retrieveRelevant, createQueryEmbedding };
