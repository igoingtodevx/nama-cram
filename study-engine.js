(function attachStudyEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NamaStudyEngine = api;
}(typeof window !== 'undefined' ? window : globalThis, function createApi() {
  const STORAGE_KEY = 'nama-study-state-v2';
  const RATINGS = new Set(['hard', 'medium', 'easy']);
  const ORDER = { hard: 0, medium: 1, easy: 2 };

  function safeParse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function createStudyEngine(allCards, storage) {
    if (!Array.isArray(allCards) || allCards.some(card => !card || !card.id)) {
      throw new Error('Cards need unique ids');
    }
    if (new Set(allCards.map(card => card.id)).size !== allCards.length) {
      throw new Error('Cards need unique ids');
    }

    const availableIds = new Set(allCards.map(card => card.id));
    const raw = safeParse(storage.getItem(STORAGE_KEY), null);
    const legacyMastered = safeParse(storage.getItem('nama-mastered'), []);
    const legacyFailed = safeParse(storage.getItem('nama-failed'), []);
    let state = normalise(raw, availableIds, legacyMastered, legacyFailed);

    function normalise(candidate, validIds, oldMastered, oldFailed) {
      const ratings = {};
      const source = candidate && typeof candidate.ratings === 'object' ? candidate.ratings : {};
      for (const [id, entry] of Object.entries(source)) {
        if (validIds.has(id) && entry && RATINGS.has(entry.rating)) ratings[id] = entry;
      }
      if (!candidate) {
        for (const id of oldMastered) if (validIds.has(id)) ratings[id] = { rating: 'easy', updatedAt: 0 };
        for (const id of oldFailed) if (validIds.has(id)) ratings[id] = { rating: 'hard', updatedAt: 0 };
      }
      const current = candidate && typeof candidate.current === 'object' ? candidate.current : {};
      return { version: 2, ratings, current };
    }

    function filterKey(category) { return category || 'all'; }
    function deck(category) {
      const matching = category === 'all' ? [...allCards] : allCards.filter(card => card.category === category);
      return matching.sort((left, right) => {
        const leftRating = state.ratings[left.id]?.rating;
        const rightRating = state.ratings[right.id]?.rating;
        const leftOrder = leftRating ? ORDER[leftRating] + 1 : 0;
        const rightOrder = rightRating ? ORDER[rightRating] + 1 : 0;
        return leftOrder - rightOrder || allCards.indexOf(left) - allCards.indexOf(right);
      });
    }
    function persist() { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    function current(category = 'all') {
      const cards = deck(category);
      if (!cards.length) return null;
      const key = filterKey(category);
      const savedId = state.current[key];
      const saved = cards.find(card => card.id === savedId);
      if (saved) return saved;
      state.current[key] = cards[0].id;
      persist();
      return cards[0];
    }
    function rate(cardId, rating, category = 'all') {
      if (!availableIds.has(cardId)) throw new Error(`Unknown card: ${cardId}`);
      if (!RATINGS.has(rating)) throw new Error(`Invalid rating: ${rating}`);
      const before = deck(category);
      const index = before.findIndex(card => card.id === cardId);
      if (index === -1) throw new Error(`Card is outside filter: ${cardId}`);
      const nextBefore = before[(index + 1) % before.length];
      state.ratings[cardId] = { rating, updatedAt: Date.now() };
      state.current[filterKey(category)] = nextBefore.id;
      persist();
      return current(category);
    }
    function progress() {
      const result = { rated: 0, easy: 0, medium: 0, hard: 0, total: allCards.length };
      for (const id of Object.keys(state.ratings)) {
        const rating = state.ratings[id]?.rating;
        if (availableIds.has(id) && RATINGS.has(rating)) {
          result.rated += 1;
          result[rating] += 1;
        }
      }
      return result;
    }
    function replaceProgress(next) {
      state = normalise({ ratings: next?.ratings || {}, current: next?.current || {} }, availableIds, [], []);
      persist();
      return state;
    }
    function reset() {
      state = { version: 2, ratings: {}, current: {} };
      persist();
    }
    function getState() { return JSON.parse(JSON.stringify(state)); }

    persist();
    return { current, rate, progress, getState, replaceProgress, reset };
  }

  return { createStudyEngine, STORAGE_KEY };
}));
