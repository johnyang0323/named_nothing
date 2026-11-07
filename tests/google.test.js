/** Google Places (New) → app places, and the Korea / abroad split. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inKorea, googleCategory, toGooglePlace, buildGooglePlaces, placeFacts } from '../src/services/google/mapper.js';
import { sanitizePlace, sanitizeArea, isRealPlace } from '../src/services/kakao/mapper.js';

const CENTER = { lat: 35.6595, lng: 139.7005 }; // 시부야
const gp = (id, name, types, dLat = 0.001, extra = {}) => ({
  id,
  displayName: name,
  types,
  location: { lat: () => CENTER.lat + dLat, lng: () => CENTER.lng },
  formattedAddress: '일본 도쿄도 시부야구',
  googleMapsURI: `https://maps.google.com/?cid=${id}`,
  primaryTypeDisplayName: { text: '카페' },
  ...extra,
});

test('Korea or abroad', () => {
  assert.ok(inKorea({ lat: 37.5563, lng: 126.9105 }), '망원동');
  assert.ok(inKorea({ lat: 33.4996, lng: 126.5312 }), '제주');
  assert.ok(!inKorea(CENTER), '시부야');
  assert.ok(!inKorea({ lat: 34.6937, lng: 135.5023 }), '오사카');
  assert.ok(!inKorea(null));
});

test('types decide the category; specific beats generic', () => {
  assert.equal(googleCategory(['art_gallery', 'tourist_attraction']), 'gallery');
  assert.equal(googleCategory(['coffee_shop', 'food']), 'cafe');
  assert.equal(googleCategory(['hiking_area', 'park']), 'trail');
  assert.equal(googleCategory(['restaurant']), null);
});

test('a Google place becomes an app place', () => {
  const p = toGooglePlace(gp('abc', 'Little Nap Coffee', ['cafe']), CENTER);
  assert.equal(p.id, 'g-abc');
  assert.equal(p.source, 'google');
  assert.equal(p.category, 'cafe');
  assert.deepEqual(p.coords, { lat: CENTER.lat + 0.001, lng: CENTER.lng });
  assert.ok(p.walkingTime >= 1 && p.walkingTime <= 3);
  assert.equal(p.placeUrl, 'https://maps.google.com/?cid=abc');
  assert.ok(p.description.includes('카페'));
  assert.ok(isRealPlace(p));
  assert.equal(toGooglePlace(gp('s', 'Starbucks Shibuya', ['cafe']), CENTER), null, 'chains skipped');
  assert.equal(toGooglePlace(gp('r', 'Ramen', ['restaurant']), CENTER), null, 'no matching category');
  assert.equal(toGooglePlace(gp('x', 'Lot', ['park', 'parking']), CENTER), null, 'parking skipped');
  assert.deepEqual(placeFacts({ id: 'p', displayName: { text: 'N' }, location: { lat: 1, lng: 2 } }).coords, { lat: 1, lng: 2 }, 'plain objects too');
});

test('merging: dedupe, a few per category, too far dropped', () => {
  const cafes = Array.from({ length: 9 }, (_, i) => gp(`c${i}`, `Cafe ${i}`, ['cafe'], 0.0005 * (i + 1)));
  const more = [gp('m1', 'Museum', ['museum']), gp('c0', 'Cafe 0', ['cafe']), gp('far', 'Far Park', ['park'], 0.05)];
  const places = buildGooglePlaces([cafes, more], CENTER);
  assert.equal(places.filter((p) => p.category === 'cafe').length, 6, 'closest six cafés');
  assert.equal(places.filter((p) => p.id === 'g-c0').length, 1, 'no duplicates');
  assert.ok(places.some((p) => p.id === 'g-m1'));
  assert.ok(!places.some((p) => p.id === 'g-far'), 'outside the walking radius');
});

test('stored Google places survive sanitizing; ids must match their source', () => {
  const places = buildGooglePlaces([Array.from({ length: 6 }, (_, i) => gp(`k${i}`, `Gallery ${i}`, ['art_gallery'], 0.0004 * (i + 1)))], CENTER);
  const area = sanitizeArea({ label: '시부야', origin: 'name', center: CENTER, places });
  assert.equal(area.places.length, 6);
  assert.ok(area.places.every((p) => p.source === 'google' && p.area === 'google'));
  assert.equal(sanitizePlace({ ...places[0], id: 'k-fake' }), null, 'google place with a kakao id refused');
  assert.equal(sanitizePlace({ ...places[0], source: 'kakao' }), null, 'kakao place with a google id refused');
});
