import { test } from 'node:test';
import assert from 'node:assert/strict';
import { places } from '../src/data/places.js';
import { pickInitial, suggestNearby } from '../src/services/recommender.js';
import { createStore } from '../src/services/store.js';
import {
  emptyTaste,
  applySignal,
  tasteMultiplier,
  tasteActive,
  tasteSummary,
  sanitizeTaste,
  buildContext,
  contextMultiplier,
  makeBias,
  explainPick,
  isIndoor,
} from '../src/services/personalize.js';
import { classifyWeather } from '../src/services/weather.js';

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const byCat = (c) => places.find((p) => p.category === c);
const share = (picks, pred) => picks.filter(pred).length / picks.length;

test('signals move taste; needs a couple of signals before it counts', () => {
  let t = emptyTaste();
  t = applySignal(t, 'go', byCat('bookstore'));
  assert.equal(tasteActive(t), false, 'one signal is not enough');
  assert.equal(tasteMultiplier(t, byCat('bookstore')), 1);
  t = applySignal(t, 'visit', byCat('bookstore'));
  t = applySignal(t, 'skip', byCat('market'));
  assert.ok(tasteActive(t));
  assert.ok(tasteMultiplier(t, byCat('bookstore')) > 1.4);
  assert.ok(tasteMultiplier(t, byCat('market')) < 1);
  assert.deepEqual(tasteSummary(t).liked, ['서점']);
  const off = { ...t, enabled: false };
  assert.equal(tasteMultiplier(off, byCat('bookstore')), 1, 'turned off → neutral');
});

test('scores are clamped and multipliers bounded', () => {
  let t = emptyTaste();
  for (let i = 0; i < 50; i += 1) t = applySignal(t, 'go', byCat('cafe'));
  assert.ok(t.cat.cafe <= 6);
  assert.ok(tasteMultiplier(t, byCat('cafe')) <= 3);
  for (let i = 0; i < 80; i += 1) t = applySignal(t, 'remove', byCat('cafe'));
  assert.ok(tasteMultiplier(t, byCat('cafe')) >= 0.3);
});

test('sanitizeTaste drops junk', () => {
  const t = sanitizeTaste({ cat: { cafe: 2, '<script>': 5, park: 'x', museum: 99 }, type: null, events: -3, enabled: 'yes', updatedAt: 'nope' });
  assert.deepEqual(t.cat, { cafe: 2, museum: 6 });
  assert.equal(t.events, 0);
  assert.equal(t.enabled, true);
  assert.equal(t.updatedAt, null);
});

test('taste shifts the first pick; a wild pick goes the other way', () => {
  let t = emptyTaste();
  for (let i = 0; i < 6; i += 1) t = applySignal(t, 'go', byCat('bookstore'));
  const bias = makeBias(t, buildContext());
  const random = seeded(3);
  const normal = Array.from({ length: 300 }, () => pickInitial({ places, random, bias }));
  const plain = Array.from({ length: 300 }, () => pickInitial({ places, random }));
  const wild = Array.from({ length: 300 }, () => pickInitial({ places, random, bias, wild: true }));
  const isBook = (p) => p.category === 'bookstore';
  assert.ok(share(normal, isBook) > share(plain, isBook) * 2, `taste ${share(normal, isBook)} vs plain ${share(plain, isBook)}`);
  assert.ok(share(wild, isBook) < share(plain, isBook), 'wild avoids the favourite');
});

test('rain favours indoor places, 2 hours favours nearby ones', () => {
  const rain = buildContext({ weather: classifyWeather(63, 12) });
  assert.ok(rain.badWeather);
  const indoor = places.find((p) => isIndoor(p));
  const park = byCat('park');
  assert.ok(contextMultiplier(rain, indoor) > 1 && contextMultiplier(rain, park) < 0.5);

  const twoHours = buildContext({ budget: '2h' });
  const near = places.find((p) => p.walkingTime <= 8);
  const far = places.find((p) => p.walkingTime > 15);
  assert.ok(contextMultiplier(twoHours, near) > contextMultiplier(twoHours, far) * 2);

  const evening = buildContext({ now: new Date(2026, 10, 5, 17, 30) });
  assert.ok(contextMultiplier(evening, byCat('viewpoint')) > 1);
  const night = buildContext({ now: new Date(2026, 10, 5, 23, 0) });
  assert.ok(contextMultiplier(night, park) < 1);
});

test('weather codes are classified', () => {
  assert.equal(classifyWeather(0, 20).kind, 'clear');
  assert.equal(classifyWeather(3, 20).kind, 'cloudy');
  assert.equal(classifyWeather(61, 10).kind, 'rain');
  assert.equal(classifyWeather(81, 10).kind, 'rain');
  assert.equal(classifyWeather(73, -2).kind, 'snow');
  assert.equal(classifyWeather(95, 25).kind, 'rain');
});

test('nearby discoveries keep one "새로운 발견" slot once taste is known', () => {
  let t = emptyTaste();
  for (let i = 0; i < 6; i += 1) t = applySignal(t, 'go', byCat('cafe'));
  const result = suggestNearby({ places, from: byCat('gallery'), count: 3, random: seeded(8), bias: makeBias(t, buildContext()) });
  assert.equal(result.length, 3);
  const wild = result.filter((r) => r.wild);
  assert.equal(wild.length, 1);
  assert.notEqual(wild[0].place.category, 'cafe');
  const none = suggestNearby({ places, from: byCat('gallery'), count: 3, random: seeded(8) });
  assert.equal(none.filter((r) => r.wild).length, 0, 'no wild slot without taste');
});

test('reasons are short and honest', () => {
  let t = emptyTaste();
  for (let i = 0; i < 3; i += 1) t = applySignal(t, 'go', byCat('bookstore'));
  const rain = buildContext({ weather: classifyWeather(61, 10) });
  const r = explainPick(byCat('bookstore'), { taste: t, context: rain });
  assert.ok(r.some((x) => x.startsWith('취향 반영')));
  assert.ok(r.some((x) => x.includes('비가 와서')));
  assert.deepEqual(explainPick(byCat('market'), { taste: t, context: buildContext(), wild: true }), ['새로운 발견 · 평소 고르던 곳과 다른 곳이에요']);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), key: (i) => [...data.keys()][i], get length() { return data.size; } };
}

test('store sends the right signals and keeps time budget + wild flags', () => {
  const signals = [];
  let taste = emptyTaste();
  const store = createStore({
    storage: memoryStorage(),
    now: () => new Date(2026, 10, 5, 12),
    random: seeded(5),
    personalize: {
      bias: (state) => makeBias(taste, buildContext({ budget: state.timeBudget })),
      signal: (event, place) => {
        signals.push(event);
        taste = applySignal(taste, event, place);
      },
      wild: () => true,
    },
  });
  store.actions.setTimeBudget('2h');
  assert.equal(store.getState().timeBudget, '2h');
  store.actions.startDay();
  assert.equal(store.getState().recommendationWild, true);
  store.actions.showAnother();
  const id = store.actions.acceptRecommendation();
  const extra = store.getState().discoveryIds[0];
  store.actions.addToRoute(extra);
  store.actions.toggleVisited(id);
  store.actions.saveJournal({ note: '', feeling: '평온했어요' });
  store.actions.saveJournal({ note: '바뀜', feeling: '평온했어요' }); // same feeling: no repeat
  store.actions.removeFromRoute(extra);
  assert.deepEqual(signals, ['skip', 'go', 'add', 'visit', 'feel-good', 'remove']);
  assert.ok(taste.events === 6);
});
