/**
 * Pure helpers that turn Kakao place search results into the app's place
 * shape (see src/data/places.js). No DOM and no SDK, so this is unit-tested.
 */
import { CATEGORY_TEMPLATES } from '../../data/categoryTemplates.js';
import { CATEGORY_LABELS, EXPERIENCE_TYPES } from '../../data/places.js';
import { hashString } from '../../utils/date.js';

export const SEARCH_RADIUS_METERS = 1500;
export const MAX_PER_SEARCH = 6;
export const MIN_AREA_PLACES = 6;

/**
 * What to ask Kakao for. `match` filters keyword results whose category or
 * name does not really fit (e.g. "공원 주차장").
 */
export const SEARCHES = [
  { type: 'category', code: 'CE7', category: 'cafe' },
  { type: 'category', code: 'CT1', category: 'museum' },
  { type: 'category', code: 'AT4', category: 'street' },
  { type: 'keyword', query: '서점', category: 'bookstore', match: ['서점', '책방', '도서'] },
  { type: 'keyword', query: '공원', category: 'park', match: ['공원'] },
  { type: 'keyword', query: '도서관', category: 'library', match: ['도서관'] },
  { type: 'keyword', query: '갤러리', category: 'gallery', match: ['미술', '갤러리', '화랑', '전시'] },
  { type: 'keyword', query: '공방', category: 'workshop', match: ['공방', '공예', '체험', '만들기', '도자기'] },
  { type: 'keyword', query: '레코드', category: 'recordshop', match: ['음반', '레코드', 'LP'] },
  { type: 'keyword', query: '시장', category: 'market', match: ['시장'] },
  { type: 'keyword', query: '산책로', category: 'trail', match: ['산책', '둘레길', '공원', '하천', '숲'] },
];

/** Big chains feel less like a discovery; skip them for cafés. */
const CAFE_CHAINS = [
  '스타벅스', '투썸', '이디야', '메가MGC', '메가커피', '컴포즈', '빽다방', '할리스', '파스쿠찌',
  '커피빈', '폴바셋', '엔제리너스', '탐앤탐스', '더벤티', '매머드', '공차', '배스킨', '던킨',
];
const EXCLUDE_CATEGORY_WORDS = ['주차장', '주유소', '부동산', '은행', '병원', '약국'];

export function isChainCafe(name = '') {
  return CAFE_CHAINS.some((chain) => name.includes(chain));
}

export function matchesSearch(doc, search) {
  const category = doc.category_name || '';
  if (EXCLUDE_CATEGORY_WORDS.some((w) => category.includes(w))) return false;
  if (search.category === 'cafe' && isChainCafe(doc.place_name)) return false;
  if (!search.match) return true;
  const haystack = `${category} ${doc.place_name || ''}`;
  return search.match.some((word) => haystack.includes(word));
}

/** Great-circle distance in meters. */
export function metersBetween(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line walking estimate (~4 km/h). Real routes are longer. */
export function walkMinutes(meters) {
  if (!Number.isFinite(meters)) return null;
  return Math.max(1, Math.round(meters / 67));
}

/** Project real coordinates onto the 0–100 schematic canvas around the area center. */
export function toSchematicPosition(coords, center, radius = SEARCH_RADIUS_METERS) {
  const dx = (coords.lng - center.lng) * Math.cos((center.lat * Math.PI) / 180) * 111320;
  const dy = (coords.lat - center.lat) * 110540;
  const clamp = (v) => Math.min(98, Math.max(2, v));
  return {
    x: Math.round(clamp(50 + (dx / radius) * 45) * 10) / 10,
    y: Math.round(clamp(50 - (dy / radius) * 45) * 10) / 10,
  };
}

const pick = (list, seed, offset = 0) => list[(seed + offset) % list.length];

/** Convert one Kakao document into an app place. Returns null if unusable. */
export function toPlace(doc, search, center) {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!doc.id || !doc.place_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const template = CATEGORY_TEMPLATES[search.category];
  if (!template) return null;

  const coords = { lat, lng };
  const seed = hashString(String(doc.id));
  const meters = Number.isFinite(Number(doc.distance)) && doc.distance !== '' ? Number(doc.distance) : metersBetween(center, coords);
  const kakaoKind = (doc.category_name || '').split('>').pop().trim();
  const address = doc.road_address_name || doc.address_name || '';
  const activities = [pick(template.activities, seed), pick(template.activities, seed, 1)];

  return {
    id: `k-${doc.id}`,
    name: doc.place_name,
    category: search.category,
    experienceType: template.experienceType,
    description: [kakaoKind, address].filter(Boolean).join(' · '),
    whyVisit: pick(template.whyVisit, seed),
    suggestedActivities: [...new Set(activities)],
    estimatedStay: template.estimatedStay,
    estimatedCost: '방문 전 확인해 주세요',
    walkingTime: walkMinutes(meters),
    image: null,
    tags: [kakaoKind].filter(Boolean),
    area: 'kakao',
    position: toSchematicPosition(coords, center),
    coords,
    address,
    placeUrl: typeof doc.place_url === 'string' && doc.place_url.startsWith('http') ? doc.place_url : null,
    source: 'kakao',
  };
}

/**
 * Merge results of all searches: filter, dedupe (first search wins),
 * keep the closest few per search so no single kind dominates.
 */
export function buildAreaPlaces(resultsBySearch, center) {
  const seen = new Set();
  const places = [];
  resultsBySearch.forEach(({ search, docs }) => {
    const usable = (docs || [])
      .filter((doc) => matchesSearch(doc, search))
      .map((doc) => toPlace(doc, search, center))
      .filter(Boolean)
      .filter((p) => !seen.has(p.id))
      .sort((a, b) => (a.walkingTime ?? 99) - (b.walkingTime ?? 99))
      .slice(0, MAX_PER_SEARCH);
    usable.forEach((p) => {
      seen.add(p.id);
      places.push(p);
    });
  });
  return places;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

/** Rebuild a stored place from whitelisted, type-checked fields. */
export function sanitizePlace(p) {
  if (!p || typeof p !== 'object') return null;
  if (!isStr(p.id) || !p.id.startsWith('k-') || !isStr(p.name) || !p.name) return null;
  if (!CATEGORY_LABELS[p.category] || !EXPERIENCE_TYPES.includes(p.experienceType)) return null;
  if (!p.coords || !isNum(p.coords.lat) || !isNum(p.coords.lng)) return null;
  if (!p.position || !isNum(p.position.x) || !isNum(p.position.y)) return null;
  const strList = (v) => (Array.isArray(v) ? v.filter(isStr).slice(0, 4) : []);
  const activities = strList(p.suggestedActivities);
  if (!activities.length) return null;
  return {
    id: p.id,
    name: p.name.slice(0, 80),
    category: p.category,
    experienceType: p.experienceType,
    description: isStr(p.description) ? p.description.slice(0, 200) : '',
    whyVisit: isStr(p.whyVisit) ? p.whyVisit : '',
    suggestedActivities: activities,
    estimatedStay: isStr(p.estimatedStay) ? p.estimatedStay : '',
    estimatedCost: isStr(p.estimatedCost) ? p.estimatedCost : '',
    walkingTime: isNum(p.walkingTime) ? p.walkingTime : null,
    image: null,
    tags: strList(p.tags),
    area: 'kakao',
    position: { x: p.position.x, y: p.position.y },
    coords: { lat: p.coords.lat, lng: p.coords.lng },
    address: isStr(p.address) ? p.address : '',
    placeUrl: isStr(p.placeUrl) && /^https?:\/\//.test(p.placeUrl) ? p.placeUrl : null,
    source: 'kakao',
  };
}

/** Validate a stored area ({ label, center, places }); null if unusable. */
export function sanitizeArea(area) {
  if (!area || typeof area !== 'object') return null;
  if (!isStr(area.label) || !area.label.trim()) return null;
  if (!area.center || !isNum(area.center.lat) || !isNum(area.center.lng)) return null;
  const places = Array.isArray(area.places) ? area.places.map(sanitizePlace).filter(Boolean) : [];
  if (places.length < MIN_AREA_PLACES) return null;
  return {
    label: area.label.trim().slice(0, 40),
    center: { lat: area.center.lat, lng: area.center.lng },
    places,
  };
}
