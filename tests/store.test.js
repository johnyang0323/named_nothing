import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, sanitizeDay, STORAGE_PREFIX } from '../src/services/store.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const fixedNow = () => new Date(2026, 10, 4, 10, 0);
const KEY = `${STORAGE_PREFIX}2026-11-04`;

test('full journey persists and reloads', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, now: fixedNow });
  const { actions } = store;
  actions.setMood('walk');
  const first = actions.startDay();
  const second = actions.showAnother();
  assert.notEqual(first.id, second.id);
  actions.acceptRecommendation();
  let s = store.getState();
  assert.equal(s.currentId, second.id);
  assert.equal(s.route.length, 1);
  assert.equal(s.discoveryIds.length, 3);

  const extra = s.discoveryIds[0];
  assert.equal(actions.addToRoute(extra), true);
  assert.equal(actions.addToRoute(extra), false, 'no duplicates');
  assert.ok(!store.getState().discoveryIds.includes(extra));

  actions.moveInRoute(extra, -1);
  assert.equal(store.getState().route[0].id, extra);
  assert.equal(actions.moveInRoute(extra, -1), false, 'cannot move above top');

  actions.toggleVisited(extra);
  actions.saveJournal({ note: '좋은 하루', feeling: '평온했어요' });

  const reloaded = createStore({ storage, now: fixedNow }).getState();
  assert.equal(reloaded.mood, 'walk');
  assert.deepEqual(reloaded.route, [
    { id: extra, visited: true },
    { id: second.id, visited: false },
  ]);
  assert.equal(reloaded.journal.note, '좋은 하루');
  assert.equal(reloaded.journal.feeling, '평온했어요');
});

test('remove + undo restores position and current destination', () => {
  const store = createStore({ storage: memoryStorage(), now: fixedNow });
  store.actions.startDay();
  const currentId = store.actions.acceptRecommendation();
  const other = store.getState().discoveryIds[0];
  store.actions.addToRoute(other);
  const removed = store.actions.removeFromRoute(currentId);
  assert.equal(store.getState().currentId, null);
  store.actions.restoreRouteEntry(removed);
  assert.equal(store.getState().route[0].id, currentId);
  assert.equal(store.getState().currentId, currentId);
});

test('replace swaps in place and follows current destination', () => {
  const store = createStore({ storage: memoryStorage(), now: fixedNow });
  store.actions.startDay();
  const currentId = store.actions.acceptRecommendation();
  const replacement = ['p01', 'p02', 'p03'].find((id) => id !== currentId);
  assert.equal(store.actions.replaceInRoute(currentId, replacement), true);
  assert.equal(store.getState().route[0].id, replacement);
  assert.equal(store.getState().currentId, replacement);
});

test('malformed or stale storage falls back to a fresh day', () => {
  const broken = createStore({ storage: memoryStorage({ [KEY]: '{not json' }), now: fixedNow });
  assert.equal(broken.getState().route.length, 0);

  const stale = sanitizeDay({ date: '2020-01-01', mood: 'walk' }, '2026-11-04');
  assert.equal(stale.mood, 'anything');

  const messy = sanitizeDay(
    {
      date: '2026-11-04',
      mood: 'party',
      route: [{ id: 'p01', visited: 'yes' }, { id: 'nope' }, null, { id: 'p01' }],
      journal: { note: 5, feeling: '최고' },
      seenIds: 'p01',
    },
    '2026-11-04',
  );
  assert.equal(messy.mood, 'anything');
  assert.deepEqual(messy.route, [{ id: 'p01', visited: false }]);
  assert.deepEqual(messy.journal, { note: '', feeling: null, savedAt: null });
  assert.deepEqual(messy.seenIds, []);
});

test('works when storage throws (e.g. privacy mode)', () => {
  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
  const store = createStore({ storage: throwing, now: fixedNow });
  store.actions.startDay();
  assert.ok(store.getState().recommendationId);
  store.actions.resetDay();
  assert.equal(store.getState().recommendationId, null);
});

test('reset clears the day', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, now: fixedNow });
  store.actions.startDay();
  store.actions.acceptRecommendation();
  store.actions.resetDay();
  assert.equal(store.getState().route.length, 0);
  assert.equal(createStore({ storage, now: fixedNow }).getState().route.length, 0);
});
