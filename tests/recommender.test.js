import { test } from 'node:test';
import assert from 'node:assert/strict';
import { places } from '../src/data/places.js';
import {
  pickInitial,
  pickAlternative,
  suggestNearby,
  suggestReplacements,
  weightedPick,
  explainNext,
} from '../src/services/recommender.js';

/** Small deterministic PRNG so tests are repeatable. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('dataset has unique ids and all required fields', () => {
  const ids = new Set(places.map((p) => p.id));
  assert.equal(ids.size, places.length);
  for (const p of places) {
    for (const field of ['id', 'name', 'category', 'experienceType', 'description', 'whyVisit', 'estimatedStay', 'estimatedCost']) {
      assert.ok(p[field], `${p.id} missing ${field}`);
    }
    assert.ok(Array.isArray(p.suggestedActivities) && p.suggestedActivities.length >= 1);
    assert.ok(p.position.x >= 0 && p.position.x <= 100 && p.position.y >= 0 && p.position.y <= 100);
  }
});

test('weightedPick handles empty and zero-weight lists', () => {
  assert.equal(weightedPick([], () => 1), null);
  assert.ok(['a', 'b'].includes(weightedPick(['a', 'b'], () => 0, seeded())));
});

test('mood biases the initial pick', () => {
  const random = seeded(7);
  const counts = { relaxed: 0, walk: 0 };
  for (let i = 0; i < 400; i += 1) {
    if (['restful', 'scenic'].includes(pickInitial({ places, mood: 'relaxed', random }).experienceType)) counts.relaxed += 1;
    if (['active', 'scenic'].includes(pickInitial({ places, mood: 'walk', random }).experienceType)) counts.walk += 1;
  }
  // with uniform picks these would be ~ 50%; mood weights should push clearly above
  assert.ok(counts.relaxed > 240, `relaxed bias too weak: ${counts.relaxed}`);
  assert.ok(counts.walk > 240, `walk bias too weak: ${counts.walk}`);
});

test('"다른 곳 보기" never repeats current and avoids seen until exhausted', () => {
  const random = seeded(3);
  let current = pickInitial({ places, random });
  const seen = [current.id];
  for (let i = 0; i < places.length - 1; i += 1) {
    const next = pickAlternative({ places, current, seenIds: seen, random });
    assert.notEqual(next.id, current.id);
    assert.ok(!seen.includes(next.id), 'repeated a seen place before exhausting options');
    seen.push(next.id);
    current = next;
  }
  // all seen now — must still return something different from current
  const after = pickAlternative({ places, current, seenIds: seen, random });
  assert.ok(after && after.id !== current.id);
});

test('alternatives usually change experience type', () => {
  const random = seeded(11);
  let different = 0;
  for (let i = 0; i < 200; i += 1) {
    const current = places[i % places.length];
    if (pickAlternative({ places, current, random }).experienceType !== current.experienceType) different += 1;
  }
  assert.ok(different > 170, `only ${different}/200 changed type`);
});

test('nearby suggestions are diverse, exclude route/current, and explain themselves', () => {
  const random = seeded(5);
  const from = places.find((p) => p.category === 'gallery');
  const exclude = ['p01', 'p02'];
  const result = suggestNearby({ places, from, excludeIds: exclude, count: 3, random });
  assert.equal(result.length, 3);
  const ids = result.map((r) => r.place.id);
  assert.ok(!ids.includes(from.id));
  exclude.forEach((id) => assert.ok(!ids.includes(id)));
  assert.equal(new Set(result.map((r) => r.place.experienceType)).size, 3, 'experience types should differ');
  result.forEach((r) => assert.ok(r.reason.length > 0 && r.proximity.length > 0));
});

test('nearby suggestions avoid visited places when alternatives exist', () => {
  const from = places[0];
  const visited = places.slice(1, 20).map((p) => p.id);
  const result = suggestNearby({ places, from, visitedIds: visited, count: 3, random: seeded(9) });
  result.forEach((r) => assert.ok(!visited.includes(r.place.id)));
});

test('after a gallery, transition-friendly categories are explained contextually', () => {
  const gallery = places.find((p) => p.category === 'gallery');
  const park = places.find((p) => p.category === 'park');
  assert.match(explainNext(gallery, park), /다음엔/);
});

test('replacements exclude the target and the route', () => {
  const target = places[0];
  const result = suggestReplacements({ places, target, excludeIds: ['p02', 'p03'], random: seeded(1) });
  assert.equal(result.length, 3);
  result.forEach((p) => assert.ok(![target.id, 'p02', 'p03'].includes(p.id)));
});

test('missing "from" yields no nearby suggestions instead of throwing', () => {
  assert.deepEqual(suggestNearby({ places, from: null }), []);
  assert.deepEqual(suggestReplacements({ places, target: null }), []);
});
