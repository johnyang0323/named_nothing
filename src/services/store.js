/**
 * Centralised application state for "today".
 *
 * - One state object per calendar day, persisted to localStorage under a
 *   date-specific key, so refreshing never loses progress and a new day
 *   starts fresh.
 * - Every value read back from storage is validated; anything malformed is
 *   dropped instead of crashing the app.
 * - Storage and the clock are injectable for tests.
 */
import { toDateKey } from '../utils/date.js';
import { getAllPlaces, getPlaceById, placeExists, usePlaces, useSamplePlaces } from './placeRepository.js';
import { sanitizeArea, sanitizePlace } from './kakao/mapper.js';
import { pickInitial, pickAlternative, suggestNearby } from './recommender.js';
import { moods } from '../data/places.js';

export const STORAGE_PREFIX = 'plannish-day:';
const SCHEMA_VERSION = 1;
const MOOD_IDS = moods.map((m) => m.id);
export const FEELINGS = ['평온했어요', '설렜어요', '포근했어요', '조금 지쳤어요', '그저 그랬어요'];
export const NOTE_MAX_LENGTH = 300;
const DISCOVERY_COUNT = 3;
const TIME_BUDGET_IDS = ['2h', 'half', 'day'];
const GOOD_FEELINGS = ['평온했어요', '설렜어요', '포근했어요'];
const BAD_FEELINGS = ['조금 지쳤어요'];
const NO_PERSONALIZE = { bias: () => undefined, signal: () => {}, wild: () => false };

export function createEmptyDay(date) {
  return {
    version: SCHEMA_VERSION,
    date,
    mood: 'anything',
    suggestionOffset: 0,
    recommendationId: null,
    seenIds: [],
    // cards shown today, in order, and which one is on screen (← / → to move)
    cardHistory: [],
    cardPos: 0,
    currentId: null,
    discoveryIds: [],
    route: [],
    journal: { note: '', feeling: null, savedAt: null },
    area: null,
    updatedAt: null,
    timeBudget: 'half',
    recommendationWild: false,
    wildDiscoveryId: null,
  };
}

/** Point the place repository at the area's real places, or back at the sample. */
function activateArea(area) {
  if (area) usePlaces(area.places);
  else useSamplePlaces();
}

const uniqueValidIds = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && placeExists(id)))] : [];

/** Turn whatever was in storage into a valid day state (or a fresh one). */
export function sanitizeDay(input, date) {
  const day = createEmptyDay(date);
  if (!input || typeof input !== 'object' || input.date !== date) return day;

  if (MOOD_IDS.includes(input.mood)) day.mood = input.mood;
  if (TIME_BUDGET_IDS.includes(input.timeBudget)) day.timeBudget = input.timeBudget;
  day.recommendationWild = input.recommendationWild === true;
  if (placeExists(input.wildDiscoveryId)) day.wildDiscoveryId = input.wildDiscoveryId;
  if (Number.isInteger(input.suggestionOffset) && input.suggestionOffset >= 0) {
    day.suggestionOffset = input.suggestionOffset;
  }
  if (placeExists(input.recommendationId)) day.recommendationId = input.recommendationId;
  if (placeExists(input.currentId)) day.currentId = input.currentId;
  day.seenIds = uniqueValidIds(input.seenIds);
  day.cardHistory = Array.isArray(input.cardHistory) ? input.cardHistory.filter((id) => typeof id === 'string' && placeExists(id)).slice(-100) : [];
  day.cardPos = Number.isInteger(input.cardPos) ? Math.min(Math.max(input.cardPos, 0), Math.max(day.cardHistory.length - 1, 0)) : 0;
  if (day.recommendationId && day.cardHistory[day.cardPos] !== day.recommendationId) {
    day.cardHistory = [...day.cardHistory, day.recommendationId];
    day.cardPos = day.cardHistory.length - 1;
  }
  day.discoveryIds = uniqueValidIds(input.discoveryIds);

  if (Array.isArray(input.route)) {
    const seen = new Set();
    day.route = input.route
      .filter((stop) => stop && placeExists(stop.id) && !seen.has(stop.id) && seen.add(stop.id))
      .map((stop) => ({ id: stop.id, visited: stop.visited === true }));
  }

  const journal = input.journal;
  if (journal && typeof journal === 'object') {
    day.journal = {
      note: typeof journal.note === 'string' ? journal.note.slice(0, NOTE_MAX_LENGTH) : '',
      feeling: FEELINGS.includes(journal.feeling) ? journal.feeling : null,
      savedAt: typeof journal.savedAt === 'string' ? journal.savedAt : null,
    };
  }
  if (typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt))) day.updatedAt = input.updatedAt;
  return day;
}

function safeStorage(storage) {
  return {
    read(key) {
      try {
        const rawValue = storage?.getItem(key);
        return rawValue ? JSON.parse(rawValue) : null;
      } catch {
        return null; // malformed JSON or storage unavailable
      }
    },
    write(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false; // quota exceeded / private mode
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * personalize (optional): { bias() → recommender bias, signal(event, place),
 * wild() → should this pick deliberately go against the taste? }
 */
export function createStore({ storage = globalThis.localStorage, now = () => new Date(), random = Math.random, personalize = NO_PERSONALIZE } = {}) {
  const persist = safeStorage(storage);
  const date = toDateKey(now());
  const key = STORAGE_PREFIX + date;
  const stored = persist.read(key);
  // the area decides which places exist, so restore it before validating ids
  const storedArea = stored?.date === date ? sanitizeArea(stored.area) : null;
  activateArea(storedArea);
  let state = { ...sanitizeDay(stored, date), area: storedArea };
  const listeners = new Set();
  const places = () => getAllPlaces();

  const visitedIds = () => state.route.filter((s) => s.visited).map((s) => s.id);
  const routeIds = () => state.route.map((s) => s.id);

  /** Every user change stamps updatedAt so devices can tell which copy is newer. */
  function commit(next, { stamp = true } = {}) {
    state = stamp ? { ...next, updatedAt: now().toISOString() } : next;
    persist.write(key, state);
    listeners.forEach((fn) => fn(state));
  }

  const update = (patch) => commit({ ...state, ...patch });

  const signal = (event, id) => {
    const place = getPlaceById(id);
    if (place) personalize.signal(event, place);
  };

  /** Ids of nearby discoveries, plus which one (if any) is a deliberate "새로운 발견". */
  function discover(fromId, base = state, extraExclude = []) {
    const result = suggestNearby({
      places: places(),
      from: getPlaceById(fromId),
      excludeIds: [...base.route.map((s) => s.id), ...extraExclude],
      visitedIds: base.route.filter((s) => s.visited).map((s) => s.id),
      count: DISCOVERY_COUNT,
      random,
      bias: personalize.bias(base),
    });
    return { discoveryIds: result.map((d) => d.place.id), wildDiscoveryId: result.find((d) => d.wild)?.place.id || null };
  }
  const computeDiscoveries = (fromId, base = state) => discover(fromId, base).discoveryIds;

  const actions = {
    setMood(mood) {
      if (!MOOD_IDS.includes(mood) || mood === state.mood) return;
      update({ mood });
    },

    nextSmallSuggestion() {
      update({ suggestionOffset: state.suggestionOffset + 1 });
    },

    setTimeBudget(budget) {
      if (!TIME_BUDGET_IDS.includes(budget) || budget === state.timeBudget) return;
      update({ timeBudget: budget });
    },

    /** Fresh first suggestion for the chosen mood (and taste + situation). */
    startDay() {
      const wild = personalize.wild();
      const place = pickInitial({
        places: places(),
        mood: state.mood,
        excludeIds: [...routeIds(), state.recommendationId].filter(Boolean),
        visitedIds: visitedIds(),
        random,
        bias: personalize.bias(state),
        wild,
      });
      update({ recommendationId: place.id, seenIds: [place.id], recommendationWild: wild, cardHistory: [place.id], cardPos: 0 });
      return place;
    },

    /** ← Back to the card shown before this one. Null at the first card. */
    showPrevious() {
      if (state.cardPos <= 0) return null;
      const pos = state.cardPos - 1;
      const id = state.cardHistory[pos];
      if (!placeExists(id)) return null;
      update({ recommendationId: id, cardPos: pos, recommendationWild: false });
      return getPlaceById(id);
    },

    /** Next card: forward through ones already seen (after going back), then a new one. */
    showAnother({ asSkip = true } = {}) {
      if (state.cardPos < state.cardHistory.length - 1) {
        const pos = state.cardPos + 1;
        const id = state.cardHistory[pos];
        if (placeExists(id)) {
          update({ recommendationId: id, cardPos: pos, recommendationWild: false });
          return getPlaceById(id);
        }
      }
      const current = getPlaceById(state.recommendationId);
      if (current && asSkip) personalize.signal('skip', current);
      const wild = personalize.wild();
      const place = pickAlternative({
        places: places(),
        mood: state.mood,
        current,
        seenIds: [...state.seenIds, ...routeIds()],
        visitedIds: visitedIds(),
        random,
        bias: personalize.bias(state),
        wild,
      });
      if (!place) return null;
      // once every option has been seen, start the "seen" cycle again
      const unseenLeft = places().some((p) => p.id !== place.id && !state.seenIds.includes(p.id));
      const seenIds = unseenLeft ? [...new Set([...state.seenIds, place.id])] : [place.id];
      const cardHistory = [...state.cardHistory.slice(0, state.cardPos + 1), place.id].slice(-100);
      update({ recommendationId: place.id, seenIds, recommendationWild: wild, cardHistory, cardPos: cardHistory.length - 1 });
      return place;
    },

    /** ↓ Keep this card (담아두기) and move on to the next one. */
    keepRecommendation() {
      const id = state.recommendationId;
      if (!placeExists(id)) return null;
      const kept = getPlaceById(id);
      if (!routeIds().includes(id)) {
        signal('add', id);
        update({ route: [...state.route, { id, visited: false }] });
      }
      const next = actions.showAnother({ asSkip: false });
      return { kept, next };
    },

    /** "여기로 가보기": make the recommendation the current destination. */
    acceptRecommendation() {
      const id = state.recommendationId;
      if (!placeExists(id)) return null;
      signal('go', id);
      const route = routeIds().includes(id) ? state.route : [...state.route, { id, visited: false }];
      const base = { ...state, route };
      commit({ ...base, currentId: id, ...discover(id, base) });
      return id;
    },

    /** Explore from any place on the route. */
    setCurrent(id) {
      if (!placeExists(id)) return;
      commit({ ...state, currentId: id, ...discover(id) });
    },

    refreshDiscoveries() {
      if (!state.currentId) return;
      // prefer not to show the exact same set again
      const fresh = discover(state.currentId, state, state.discoveryIds);
      update(fresh.discoveryIds.length ? fresh : discover(state.currentId));
    },

    addToRoute(id) {
      if (!placeExists(id) || routeIds().includes(id)) return false;
      signal('add', id);
      update({
        route: [...state.route, { id, visited: false }],
        discoveryIds: state.discoveryIds.filter((d) => d !== id),
      });
      return true;
    },

    /**
     * Keep a place someone sent (a shared card) in today's envelope, even if
     * it's from another neighborhood: it joins today's places, then the route.
     * Returns 'kept', 'already', or null (no starting area yet / bad place).
     */
    keepPlace(place) {
      const clean = sanitizePlace(place);
      if (!clean || !state.area) return null;
      const known = state.area.places.some((p) => p.id === clean.id);
      const area = known ? state.area : { ...state.area, places: [...state.area.places, clean] };
      if (!known) activateArea(area);
      if (routeIds().includes(clean.id)) {
        if (!known) update({ area });
        return 'already';
      }
      signal('add', clean.id);
      update({ area, route: [...state.route, { id: clean.id, visited: false }] });
      return 'kept';
    },

    /** Returns what was removed so the UI can offer "되돌리기". */
    removeFromRoute(id) {
      const index = state.route.findIndex((s) => s.id === id);
      if (index < 0) return null;
      const entry = state.route[index];
      signal('remove', id);
      const route = state.route.filter((s) => s.id !== id);
      const currentId = state.currentId === id ? null : state.currentId;
      const wasCurrent = state.currentId === id;
      update({ route, currentId, discoveryIds: wasCurrent ? [] : state.discoveryIds });
      return { entry, index, wasCurrent };
    },

    restoreRouteEntry({ entry, index, wasCurrent }) {
      if (!entry || !placeExists(entry.id) || routeIds().includes(entry.id)) return;
      const route = [...state.route];
      route.splice(Math.min(index, route.length), 0, entry);
      if (wasCurrent && !state.currentId) {
        const base = { ...state, route };
        commit({ ...base, currentId: entry.id, discoveryIds: computeDiscoveries(entry.id, base) });
      } else {
        update({ route });
      }
    },

    moveInRoute(id, delta) {
      const index = state.route.findIndex((s) => s.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= state.route.length) return false;
      const route = [...state.route];
      [route[index], route[target]] = [route[target], route[index]];
      update({ route });
      return true;
    },

    toggleVisited(id) {
      const stop = state.route.find((s) => s.id === id);
      if (stop) signal(stop.visited ? 'unvisit' : 'visit', id);
      update({ route: state.route.map((s) => (s.id === id ? { ...s, visited: !s.visited } : s)) });
    },

    replaceInRoute(id, newId) {
      if (!placeExists(newId) || routeIds().includes(newId)) return false;
      signal('remove', id);
      signal('add', newId);
      const route = state.route.map((s) => (s.id === id ? { id: newId, visited: false } : s));
      const currentId = state.currentId === id ? newId : state.currentId;
      const base = { ...state, route, currentId };
      commit({
        ...base,
        discoveryIds: currentId === state.currentId ? state.discoveryIds.filter((d) => d !== newId) : computeDiscoveries(currentId, base),
      });
      return true;
    },

    saveJournal({ note = '', feeling = null }) {
      // how the day felt says something about the places actually visited
      const tone = (f) => (GOOD_FEELINGS.includes(f) ? 'feel-good' : BAD_FEELINGS.includes(f) ? 'feel-bad' : null);
      const before = tone(state.journal.feeling);
      const after = tone(FEELINGS.includes(feeling) ? feeling : null);
      if (before !== after) {
        visitedIds().forEach((visited) => {
          if (after) signal(after, visited);
        });
      }
      update({
        journal: {
          note: String(note).slice(0, NOTE_MAX_LENGTH),
          feeling: FEELINGS.includes(feeling) ? feeling : null,
          savedAt: now().toISOString(),
        },
      });
    },

    /**
     * Switch to real places around a neighborhood (or back to the sample
     * with null). The route and suggestions start over because place ids
     * differ between sources; mood and the journal are kept.
     */
    setArea(area) {
      const clean = area ? sanitizeArea(area) : null;
      if (area && !clean) return false;
      activateArea(clean);
      commit({
        ...createEmptyDay(date),
        mood: state.mood,
        suggestionOffset: state.suggestionOffset,
        journal: state.journal,
        area: clean,
      });
      return true;
    },

    /** Apply a copy of today pulled from the account (already newer than ours). */
    replaceDay(remote) {
      if (!remote || remote.date !== date) return false;
      const area = sanitizeArea(remote.area);
      activateArea(area);
      commit({ ...sanitizeDay(remote, date), area }, { stamp: false });
      return true;
    },

    /**
     * Sign-out: remove every day kept in this browser (the account keeps
     * its copy). The emptied day has no updatedAt, so it is never pushed
     * over the account's version.
     */
    forgetDevice() {
      try {
        const keys = [];
        for (let i = 0; i < storage.length; i += 1) {
          const k = storage.key(i);
          if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
        }
        keys.forEach((k) => storage.removeItem(k));
      } catch {
        /* storage unavailable */
      }
      activateArea(null);
      commit(createEmptyDay(date), { stamp: false });
    },

    resetDay() {
      persist.remove(key);
      activateArea(null);
      commit(createEmptyDay(date));
    },
  };

  return {
    getState: () => state,
    dateKey: date,
    /** Earlier days still kept in this browser, newest first (for history and first-login upload). */
    listLocalDays() {
      const days = [];
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const k = storage.key(i);
          if (!k?.startsWith(STORAGE_PREFIX) || k === key) continue;
          const value = persist.read(k);
          if (value && typeof value.date === 'string' && k === STORAGE_PREFIX + value.date) days.push(value);
        }
      } catch {
        /* storage unavailable */
      }
      return days.sort((a, b) => b.date.localeCompare(a.date));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    actions,
  };
}
