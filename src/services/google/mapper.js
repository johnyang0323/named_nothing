/**
 * Google Places (New) results → the app's place shape. Pure (no SDK), so
 * it is unit-tested. Google is used outside Korea; Kakao inside.
 */
import { makePlace, isChainCafe, SEARCH_RADIUS_METERS, MAX_PER_SEARCH, WALKING_FROM, metersBetween } from '../kakao/mapper.js';

/** Rough box around South Korea (incl. Jeju, Ulleung, Dokdo). */
export function inKorea(point) {
  return Boolean(point) && point.lat > 33 && point.lat < 38.7 && point.lng > 124.5 && point.lng < 132;
}

/**
 * Three nearby searches per area (keeps cost down); each place's types
 * decide its category. includedTypes are Places API (New) table A types.
 */
export const GOOGLE_SEARCHES = [
  { includedTypes: ['cafe', 'coffee_shop'] },
  { includedTypes: ['museum', 'art_gallery', 'book_store', 'library', 'tourist_attraction'] },
  { includedTypes: ['park', 'hiking_area', 'market'] },
];

const TYPE_TO_CATEGORY = [
  ['art_gallery', 'gallery'],
  ['museum', 'museum'],
  ['book_store', 'bookstore'],
  ['library', 'library'],
  ['hiking_area', 'trail'],
  ['park', 'park'],
  ['market', 'market'],
  ['cafe', 'cafe'],
  ['coffee_shop', 'cafe'],
  ['tourist_attraction', 'street'],
];

const GLOBAL_CHAINS = ['starbucks', 'tully', 'doutor', 'dunkin', 'costa coffee', 'tim hortons', 'mcdonald', 'blue bottle', '% arabica', 'peet'];
const SKIP_TYPES = ['parking', 'gas_station', 'lodging', 'hospital', 'bank', 'real_estate_agency'];

export function googleCategory(types = []) {
  const found = TYPE_TO_CATEGORY.find(([t]) => types.includes(t));
  return found ? found[1] : null;
}

/** Plain object from a Place (google.maps.places.Place) or a test stub. */
export function placeFacts(p) {
  const loc = p.location;
  const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
  return {
    id: p.id,
    name: typeof p.displayName === 'string' ? p.displayName : p.displayName?.text || '',
    types: Array.isArray(p.types) ? p.types : [],
    kind: p.primaryTypeDisplayName?.text || p.primaryTypeDisplayName || '',
    address: p.formattedAddress || p.shortFormattedAddress || '',
    url: p.googleMapsURI || p.googleMapsUri || null,
    coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

export function toGooglePlace(raw, center, walkingFrom = WALKING_FROM.name) {
  const f = placeFacts(raw);
  if (!f.id || !f.name || !f.coords) return null;
  if (f.types.some((t) => SKIP_TYPES.includes(t))) return null;
  const category = googleCategory(f.types);
  if (!category) return null;
  if (category === 'cafe' && (isChainCafe(f.name) || GLOBAL_CHAINS.some((c) => f.name.toLowerCase().includes(c)))) return null;
  return makePlace({
    id: `g-${f.id}`,
    name: f.name.slice(0, 80),
    category,
    kind: typeof f.kind === 'string' ? f.kind : '',
    address: f.address,
    coords: f.coords,
    meters: metersBetween(center, f.coords),
    placeUrl: typeof f.url === 'string' && /^https:\/\//.test(f.url) ? f.url : null,
    source: 'google',
  }, center, walkingFrom);
}

/** Merge the searches: dedupe, closest few per category so no kind dominates. */
export function buildGooglePlaces(resultLists, center, walkingFrom = WALKING_FROM.name) {
  const seen = new Set();
  const byCategory = new Map();
  resultLists.flat().forEach((raw) => {
    const place = toGooglePlace(raw, center, walkingFrom);
    if (!place || seen.has(place.id)) return;
    if ((place.walkingTime ?? 0) > Math.round(SEARCH_RADIUS_METERS / 67) + 5) return;
    seen.add(place.id);
    if (!byCategory.has(place.category)) byCategory.set(place.category, []);
    byCategory.get(place.category).push(place);
  });
  return [...byCategory.values()].flatMap((list) => list.sort((a, b) => (a.walkingTime ?? 99) - (b.walkingTime ?? 99)).slice(0, MAX_PER_SEARCH));
}
