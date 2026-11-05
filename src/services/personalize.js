/**
 * Personal recommendations without asking anything up front.
 *
 * 1. Taste: what the person actually does (가보기 / 다른 곳 / 담기 / 빼기 /
 *    다녀왔어요 / how the day felt) nudges a score per kind of place.
 * 2. Context: weather, time of day and "오늘 쓸 수 있는 시간".
 *
 * Both become multipliers on top of the mood weights. Serendipity is kept
 * on purpose: a share of picks deliberately goes AGAINST the taste
 * ("새로운 발견"). Everything here is pure, so it is unit-tested.
 */
import { CATEGORY_LABELS } from '../data/places.js';

// ---------------------------------------------------------------- taste ----

export const TASTE_VERSION = 1;
const LIMIT = 6;
const TYPE_SHARE = 0.6; // experience type learns a bit slower than the place kind
export const MIN_EVENTS = 2; // ignore taste until there are a couple of signals
export const WILDCARD_RATE = 0.2;

/** How much each action says about the person's taste. */
export const SIGNALS = {
  go: 1, // 여기로 가보기 / swipe right
  skip: -0.4, // 다른 곳 보기 — mild: skipping is part of browsing
  add: 0.7, // 경로에 담기
  remove: -0.5, // 경로에서 빼기
  visit: 1, // 다녀왔어요
  unvisit: -1, // undo of the above
  'feel-good': 0.5, // the day felt good (for places visited that day)
  'feel-bad': -0.3,
};

export function emptyTaste() {
  return { v: TASTE_VERSION, cat: {}, type: {}, events: 0, enabled: true, updatedAt: null };
}

const clamp = (n) => Math.max(-LIMIT, Math.min(LIMIT, n));
const round = (n) => Math.round(n * 100) / 100;

/** New taste after one signal about one place. */
export function applySignal(taste, event, place, now = new Date()) {
  const delta = SIGNALS[event];
  if (!delta || !place) return taste;
  const cat = { ...taste.cat, [place.category]: round(clamp((taste.cat[place.category] || 0) + delta)) };
  const type = { ...taste.type, [place.experienceType]: round(clamp((taste.type[place.experienceType] || 0) + delta * TYPE_SHARE)) };
  return { ...taste, cat, type, events: taste.events + 1, updatedAt: now.toISOString() };
}

export function tasteActive(taste) {
  return Boolean(taste?.enabled) && taste.events >= MIN_EVENTS;
}

export function tasteScore(taste, place) {
  return (taste.cat[place.category] || 0) + (taste.type[place.experienceType] || 0);
}

/** 0.3 … 3: how much more (or less) likely this kind of place should be. */
export function tasteMultiplier(taste, place) {
  if (!tasteActive(taste)) return 1;
  return Math.max(0.3, Math.min(3, Math.exp(0.22 * tasteScore(taste, place))));
}

/** Liked / less-liked kinds of places, for display. */
export function tasteSummary(taste) {
  const entries = Object.entries(taste?.cat || {}).filter(([k]) => CATEGORY_LABELS[k]);
  const liked = entries.filter(([, v]) => v >= 0.7).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const less = entries.filter(([, v]) => v <= -0.7).sort((a, b) => a[1] - b[1]).slice(0, 2);
  const label = ([k]) => CATEGORY_LABELS[k];
  return { liked: liked.map(label), less: less.map(label), likedKeys: liked.map(([k]) => k) };
}

/** Validate a stored / synced taste object. */
export function sanitizeTaste(input) {
  const base = emptyTaste();
  if (!input || typeof input !== 'object') return base;
  const scores = (obj) =>
    Object.fromEntries(
      Object.entries(obj && typeof obj === 'object' ? obj : {})
        .filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && Number.isFinite(v))
        .map(([k, v]) => [k, round(clamp(v))]),
    );
  return {
    v: TASTE_VERSION,
    cat: scores(input.cat),
    type: scores(input.type),
    events: Number.isInteger(input.events) && input.events >= 0 ? input.events : 0,
    enabled: input.enabled !== false,
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : null,
  };
}

// -------------------------------------------------------------- context ----

const INDOOR = new Set(['cafe', 'bookstore', 'library', 'gallery', 'museum', 'workshop', 'recordshop']);
const OUTDOOR = new Set(['park', 'street', 'trail', 'riverside', 'viewpoint', 'architecture']);
const LONG_STAY = new Set(['workshop', 'museum', 'library']);

/** Is this place indoors? Sample places may say so in their tags. */
export function isIndoor(place) {
  if (place.tags?.includes('실내')) return true;
  if (place.tags?.includes('야외')) return false;
  return INDOOR.has(place.category);
}
const isOutdoor = (place) => !isIndoor(place) && (OUTDOOR.has(place.category) || place.tags?.includes('야외'));

export const TIME_BUDGETS = [
  { id: '2h', label: '2시간' },
  { id: 'half', label: '반나절' },
  { id: 'day', label: '하루 종일' },
];

/**
 * Situation of the moment.
 * weather: { kind: 'rain'|'snow'|'clear'|'cloudy'|'fog', temp } or null
 */
export function buildContext({ weather = null, now = new Date(), budget = 'half' } = {}) {
  const hour = now.getHours() + now.getMinutes() / 60;
  const badWeather = Boolean(weather && (weather.kind === 'rain' || weather.kind === 'snow' || weather.temp <= -3 || weather.temp >= 32));
  return {
    weather,
    badWeather,
    evening: hour >= 16.5 && hour < 19.5,
    night: hour >= 21 || hour < 6,
    morning: hour >= 6 && hour < 10,
    budget: TIME_BUDGETS.some((b) => b.id === budget) ? budget : 'half',
  };
}

export function contextMultiplier(context, place) {
  if (!context) return 1;
  let m = 1;
  if (context.badWeather) m *= isIndoor(place) ? 1.5 : isOutdoor(place) ? 0.35 : 1;
  if (context.night) m *= isOutdoor(place) ? 0.5 : place.category === 'cafe' ? 1.3 : 1;
  if (context.evening && ['viewpoint', 'riverside'].includes(place.category)) m *= 1.4;
  if (context.morning && ['park', 'trail'].includes(place.category)) m *= 1.25;
  const walk = Number.isFinite(place.walkingTime) ? place.walkingTime : null;
  if (context.budget === '2h') {
    if (walk !== null) m *= walk <= 8 ? 1.3 : walk > 15 ? 0.35 : 1;
    if (LONG_STAY.has(place.category)) m *= 0.7;
  } else if (context.budget === 'day') {
    if (walk !== null && walk > 15) m *= 1.2;
    if (LONG_STAY.has(place.category)) m *= 1.2;
  }
  return m;
}

/** How much distance matters for "가는 길에 만날 수 있는 것들". */
export function proximityWeight(context) {
  return context?.budget === '2h' ? 3 : context?.budget === 'day' ? 0.5 : 1;
}

// ----------------------------------------------------------------- bias ----

/** What the recommender needs: two multipliers plus a few switches. */
export function makeBias(taste, context) {
  return {
    taste: (place) => tasteMultiplier(taste, place),
    context: (place) => contextMultiplier(context, place),
    proximityWeight: proximityWeight(context),
    tasteActive: tasteActive(taste),
  };
}

export const NO_BIAS = { taste: () => 1, context: () => 1, proximityWeight: 1, tasteActive: false };

/** Short, honest reasons for a pick (shown on the card). */
export function explainPick(place, { taste, context, wild = false }) {
  const reasons = [];
  if (wild) reasons.push('새로운 발견 · 평소 고르던 곳과 다른 곳이에요');
  else if (tasteActive(taste) && (taste.cat[place.category] || 0) >= 1) {
    reasons.push(`취향 반영 · 최근 ${CATEGORY_LABELS[place.category] || '이런 곳'}을(를) 자주 고르셨어요`);
  }
  if (context?.badWeather && isIndoor(place)) reasons.push(weatherPhrase(context.weather));
  if (context?.budget === '2h' && Number.isFinite(place.walkingTime) && place.walkingTime <= 8) reasons.push('2시간 안에 다녀오기 좋은 거리예요');
  if (context?.evening && ['viewpoint', 'riverside'].includes(place.category)) reasons.push('해 질 녘에 가기 좋은 곳이에요');
  return reasons;
}

function weatherPhrase(weather) {
  if (!weather) return '실내 위주로 골랐어요';
  if (weather.kind === 'rain') return '비가 와서 실내 위주로 골랐어요';
  if (weather.kind === 'snow') return '눈이 와서 실내 위주로 골랐어요';
  return weather.temp <= -3 ? '많이 추워서 실내 위주로 골랐어요' : '많이 더워서 실내 위주로 골랐어요';
}
