import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCHES,
  buildAreaPlaces,
  matchesSearch,
  toPlace,
  toSchematicPosition,
  metersBetween,
  walkMinutes,
  sanitizeArea,
} from '../src/services/kakao/mapper.js';
import { createStore } from '../src/services/store.js';
import { getPlaceSource, getAllPlaces } from '../src/services/placeRepository.js';

const center = { lat: 37.556, lng: 126.906 };
const search = (category) => SEARCHES.find((s) => s.category === category);

function doc(id, name, category_name, dLat = 0.001, dLng = 0.001, extra = {}) {
  return {
    id: String(id),
    place_name: name,
    category_name,
    x: String(center.lng + dLng),
    y: String(center.lat + dLat),
    address_name: '서울 마포구 예시동 1-1',
    road_address_name: '서울 마포구 예시로 1',
    place_url: `http://place.map.kakao.com/${id}`,
    distance: '',
    ...extra,
  };
}

function fakeArea(n = 8) {
  const results = [
    { search: search('cafe'), docs: Array.from({ length: n }, (_, i) => doc(100 + i, `작은 카페 ${i}`, '음식점 > 카페', 0.001 * i, 0.001)) },
    { search: search('bookstore'), docs: [doc(200, '골목 책방', '문화,예술 > 서점')] },
  ];
  return { label: '망원동', center, places: buildAreaPlaces(results, center) };
}

test('distance helpers are sane', () => {
  const m = metersBetween(center, { lat: center.lat + 0.009, lng: center.lng }); // ~1 km north
  assert.ok(m > 950 && m < 1050, String(m));
  assert.equal(walkMinutes(670), 10);
  assert.equal(walkMinutes(10), 1);
  const north = toSchematicPosition({ lat: center.lat + 0.005, lng: center.lng }, center);
  assert.equal(north.x, 50);
  assert.ok(north.y < 50, 'north is up');
  const far = toSchematicPosition({ lat: center.lat + 1, lng: center.lng + 1 }, center);
  assert.ok(far.x <= 98 && far.y >= 2, 'clamped to canvas');
});

test('filters chain cafés, parking lots and off-topic keyword hits', () => {
  assert.equal(matchesSearch(doc(1, '스타벅스 망원점', '음식점 > 카페 > 커피전문점 > 스타벅스'), search('cafe')), false);
  assert.equal(matchesSearch(doc(2, '동네 로스터리', '음식점 > 카페'), search('cafe')), true);
  assert.equal(matchesSearch(doc(3, '망원공원 공영주차장', '교통,수송 > 주차장'), search('park')), false);
  assert.equal(matchesSearch(doc(4, '망원한강공원', '여행 > 공원'), search('park')), true);
  assert.equal(matchesSearch(doc(5, '서점 옆 분식', '음식점 > 분식'), search('bookstore')), true, 'name match is kept');
  assert.equal(matchesSearch(doc(6, '시장 정육점', '음식점 > 한식'), search('gallery')), false);
});

test('toPlace builds a complete, honest place', () => {
  const p = toPlace(doc(42, '골목 책방', '문화,예술 > 서점', 0.003, 0), search('bookstore'), center);
  assert.equal(p.id, 'k-42');
  assert.equal(p.category, 'bookstore');
  assert.equal(p.experienceType, 'enriching');
  assert.equal(p.source, 'kakao');
  assert.match(p.description, /서점 · 서울 마포구 예시로 1/);
  assert.equal(p.estimatedCost, '방문 전 확인해 주세요');
  assert.ok(p.walkingTime >= 4 && p.walkingTime <= 6, String(p.walkingTime));
  assert.ok(p.suggestedActivities.length >= 1 && p.whyVisit);
  assert.equal(toPlace({ ...doc(1, 'x', ''), y: 'nope' }, search('cafe'), center), null);
  assert.equal(toPlace(doc(1, 'x', '', 0, 0, { place_url: 'javascript:alert(1)' }), search('cafe'), center).placeUrl, null);
});

test('buildAreaPlaces dedupes and caps each search', () => {
  const dup = doc(7, '책 읽는 공원', '여행 > 공원');
  const places = buildAreaPlaces(
    [
      { search: search('cafe'), docs: Array.from({ length: 12 }, (_, i) => doc(300 + i, `카페 ${i}`, '음식점 > 카페', i * 0.001)) },
      { search: search('park'), docs: [dup] },
      { search: search('trail'), docs: [dup] },
    ],
    center,
  );
  assert.equal(places.filter((p) => p.category === 'cafe').length, 6);
  assert.equal(places.filter((p) => p.id === 'k-7').length, 1);
  assert.equal(places.find((p) => p.id === 'k-7').category, 'park', 'first search wins');
  assert.equal(places.find((p) => p.category === 'cafe').name, '카페 0', 'closest first');
});

test('sanitizeArea rejects tiny or tampered areas', () => {
  const area = fakeArea();
  assert.ok(sanitizeArea(area));
  assert.equal(sanitizeArea({ ...area, places: area.places.slice(0, 3) }), null);
  assert.equal(sanitizeArea({ ...area, center: { lat: 'x' } }), null);
  const tampered = { ...area, places: [...area.places, { ...area.places[0], id: 'p01' }, { ...area.places[1], category: 'casino' }] };
  assert.equal(sanitizeArea(tampered).places.length, area.places.length);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}
const now = () => new Date(2026, 10, 4, 10);

test('store: switching to a real area recommends only real places and survives reload', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, now });
  store.actions.setMood('relaxed');
  store.actions.saveJournal({ note: '메모' });
  store.actions.startDay();
  store.actions.acceptRecommendation();

  assert.equal(store.actions.setArea(fakeArea()), true);
  let s = store.getState();
  assert.equal(getPlaceSource(), 'kakao');
  assert.equal(s.route.length, 0, 'route restarts');
  assert.equal(s.mood, 'relaxed', 'mood kept');
  assert.equal(s.journal.note, '메모', 'journal kept');

  const first = store.actions.startDay();
  assert.ok(first.id.startsWith('k-'));
  store.actions.acceptRecommendation();
  assert.ok(store.getState().discoveryIds.every((id) => id.startsWith('k-')));

  const reloaded = createStore({ storage, now }).getState();
  assert.equal(reloaded.area.label, '망원동');
  assert.equal(reloaded.route[0].id, first.id);
  assert.ok(getAllPlaces().every((p) => p.source === 'kakao'));

  const back = createStore({ storage, now });
  back.actions.setArea(null);
  assert.equal(getPlaceSource(), 'sample');
  assert.equal(back.getState().area, null);
  assert.equal(back.actions.setArea({ label: 'x' }), false, 'invalid area ignored');
});

test('GPS areas: coordinates are coarsened and labelled', async () => {
  const { coarseCoords, WALKING_FROM } = await import('../src/services/kakao/mapper.js');
  assert.deepEqual(coarseCoords({ lat: 37.5563219, lng: 126.9061877 }), { lat: 37.556, lng: 126.906 });
  const places = buildAreaPlaces([{ search: search('cafe'), docs: [doc(9, '작은 카페', '음식점 > 카페')] }], center, WALKING_FROM.gps);
  assert.equal(places[0].walkingFrom, '현재 위치에서');
  const area = { ...fakeArea(), origin: 'gps' };
  assert.equal(sanitizeArea(area).origin, 'gps');
  assert.equal(sanitizeArea({ ...area, origin: 'evil' }).origin, 'name');
  const tampered = { ...area, places: area.places.map((p) => ({ ...p, walkingFrom: '<b>x</b>' })) };
  assert.equal(sanitizeArea(tampered).places[0].walkingFrom, '동네 중심에서');
});
