/**
 * Local recommendation engine.
 *
 * Pure functions only: no DOM, no storage. Every function receives the
 * place list and an optional `random` source so it can be tested
 * deterministically and later replaced by a remote/AI service with the
 * same signatures.
 */
import { MOOD_WEIGHTS, CATEGORY_TRANSITIONS, CATEGORY_LABELS } from '../data/places.js';

const DEFAULT_MOOD = 'anything';

/** Weighted random pick. Falls back to a uniform pick when all weights are 0. */
export function weightedPick(items, weightOf, random = Math.random) {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(random() * items.length)];
  let roll = random() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

function moodWeight(mood, place) {
  const table = MOOD_WEIGHTS[mood] || MOOD_WEIGHTS[DEFAULT_MOOD];
  return table[place.experienceType] ?? 1;
}

/**
 * Returns candidates excluding `excludeIds`. If that leaves nothing,
 * relaxes the exclusion step by step so the user is never stuck.
 */
function candidatePool(places, { hardExclude = [], softExclude = [] }) {
  const hard = new Set(hardExclude);
  const soft = new Set(softExclude);
  const preferred = places.filter((p) => !hard.has(p.id) && !soft.has(p.id));
  if (preferred.length) return preferred;
  return places.filter((p) => !hard.has(p.id));
}

/** First destination of the day, shaped by mood. */
export function pickInitial({ places, mood = DEFAULT_MOOD, excludeIds = [], visitedIds = [], random = Math.random }) {
  const pool = candidatePool(places, { softExclude: [...excludeIds, ...visitedIds] });
  return weightedPick(pool, (p) => moodWeight(mood, p), random);
}

/**
 * "다른 곳 보기": a genuinely different suggestion.
 * - never the current one
 * - avoids already-seen suggestions until they run out
 * - prefers a different experience type than the current one
 */
export function pickAlternative({
  places,
  mood = DEFAULT_MOOD,
  current = null,
  seenIds = [],
  visitedIds = [],
  random = Math.random,
}) {
  const hardExclude = current ? [current.id] : [];
  const pool = candidatePool(places, { hardExclude, softExclude: [...seenIds, ...visitedIds] });
  return weightedPick(
    pool,
    (p) => {
      let w = moodWeight(mood, p);
      if (current && p.experienceType === current.experienceType) w *= 0.25;
      if (current && p.category === current.category) w *= 0.5;
      return w;
    },
    random,
  );
}

/** Distance on the schematic canvas (0–100). Not a geographic distance. */
export function schematicDistance(a, b) {
  if (!a?.position || !b?.position) return 50;
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

/** A soft, explicitly approximate description of how far something is on the diagram. */
export function describeProximity(distance) {
  if (distance < 20) return '바로 근처';
  if (distance < 45) return '조금 걸어서';
  return '천천히 걸어서';
}

const NEXT_PHRASES = {
  park: '바깥 공기를 마시며 잠깐 쉬어가기 좋아요',
  cafe: '앉아서 방금 본 것들을 천천히 정리해보기 좋아요',
  bookstore: '걸음을 멈추고 조용히 책장 사이를 거닐어보기 좋아요',
  street: '발길 닿는 대로 조금 걸어보기 좋아요',
  gallery: '한 사람의 시선을 따라가 보기 좋아요',
  architecture: '고개를 들어 건물의 디테일을 구경하기 좋아요',
  market: '소리와 냄새로 감각을 깨워보기 좋아요',
  riverside: '물소리를 따라 머리를 비워보기 좋아요',
  library: '조용히 생각을 정리하기 좋아요',
  workshop: '손을 움직이며 다른 리듬을 느껴보기 좋아요',
  viewpoint: '지나온 길을 위에서 내려다보기 좋아요',
  garden: '초록 속에서 숨을 고르기 좋아요',
  recordshop: '귀로 하는 산책을 해보기 좋아요',
  museum: '이 동네의 다른 시간을 엿보기 좋아요',
  trail: '발길 닿는 대로 조금 더 걸어보기 좋아요',
};

/** Why `to` is worth considering after `from`. */
export function explainNext(from, to) {
  const likes = CATEGORY_TRANSITIONS[from?.category] || [];
  if (from && likes.includes(to.category) && NEXT_PHRASES[to.category]) {
    const fromLabel = CATEGORY_LABELS[from.category] || '이곳';
    return `${fromLabel} 다음엔 ${NEXT_PHRASES[to.category]}.`;
  }
  return to.whyVisit;
}

/**
 * Discoveries after arriving somewhere.
 * Scores variety first (transition fit + different experience type),
 * proximity only a little, plus randomness, then greedily diversifies.
 */
export function suggestNearby({ places, from, excludeIds = [], visitedIds = [], count = 3, random = Math.random }) {
  if (!from) return [];
  const pool = candidatePool(places, {
    hardExclude: [from.id, ...excludeIds],
    softExclude: visitedIds,
  });
  const likes = CATEGORY_TRANSITIONS[from.category] || [];

  const scored = pool.map((place) => {
    const distance = schematicDistance(from, place);
    let score = 0;
    if (likes.includes(place.category)) score += 3;
    if (place.experienceType !== from.experienceType) score += 2;
    else score -= 1.5;
    if (place.category === from.category) score -= 1;
    score += Math.max(0, 1 - distance / 100); // proximity matters, but only a little
    score += random() * 2.2; // keep serendipity
    return { place, distance, score };
  });

  const chosen = [];
  const usedTypes = new Map();
  const remaining = [...scored];
  while (chosen.length < count && remaining.length) {
    remaining.forEach((entry) => {
      entry.adjusted = entry.score - (usedTypes.get(entry.place.experienceType) || 0) * 2.5;
    });
    remaining.sort((a, b) => b.adjusted - a.adjusted);
    const next = remaining.shift();
    chosen.push(next);
    usedTypes.set(next.place.experienceType, (usedTypes.get(next.place.experienceType) || 0) + 1);
  }

  return chosen.map(({ place, distance }) => ({
    place,
    reason: explainNext(from, place),
    proximity: describeProximity(distance),
  }));
}

/** Options to swap a route stop for something of a similar spirit. */
export function suggestReplacements({ places, target, excludeIds = [], count = 3, random = Math.random }) {
  if (!target) return [];
  const pool = candidatePool(places, { hardExclude: [target.id, ...excludeIds] });
  return pool
    .map((place) => {
      let score = random() * 1.5;
      if (place.experienceType === target.experienceType) score += 2;
      if (place.category === target.category) score += 0.5;
      score += Math.max(0, 1 - schematicDistance(target, place) / 100);
      return { place, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ place }) => place);
}
