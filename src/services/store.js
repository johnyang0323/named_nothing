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
import { sanitizeArea } from './kakao/mapper.js';
import { pickInitial, pickAlternative, suggestNearby } from './recommender.js';
import { moods } from '../data/places.js';

export const STORAGE_PREFIX = 'plannish-day:';
const SCHEMA_VERSION = 1;
const MOOD_IDS = moods.map((m) => m.id);
export const FEELINGS = ['평온했어요', '설렜어요', '포근했어요', '조금 지쳤어요', '그저 그랬어요'];
export const NOTE_MAX_LENGTH = 300;
const DISCOVERY_COUNT = 3;

export function createEmptyDay(date) {
  return {
    version: SCHEMA_VERSION,
    date,
    mood: 'anything',
    suggestionOffset: 0,
    recommendationId: null,
    seenIds: [],
    currentId: null,
    discoveryIds: [],
    route: [],
    journal: { note: '', feeling: null, savedAt: null },
    area: null,
    updatedAt: null,
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
  if (Number.isInteger(input.suggestionOffset) && input.suggestionOffset >= 0) {
    day.suggestionOffset = input.suggestionOffset;
  }
  if (placeExists(input.recommendationId)) day.recommendationId = input.recommendationId;
  if (placeExists(input.currentId)) day.currentId = input.currentId;
  day.seenIds = uniqueValidIds(input.seenIds);
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

export function createStore({ storage = globalThis.localStorage, now = () => new Date(), random = Math.random } = {}) {
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

  function computeDiscoveries(fromId, base = state) {
    const from = getPlaceById(fromId);
    return suggestNearby({
      places: places(),
      from,
      excludeIds: base.route.map((s) => s.id),
      visitedIds: base.route.filter((s) => s.visited).map((s) => s.id),
      count: DISCOVERY_COUNT,
      random,
    }).map((d) => d.place.id);
  }

  const actions = {
    setMood(mood) {
      if (!MOOD_IDS.includes(mood) || mood === state.mood) return;
      update({ mood });
    },

    nextSmallSuggestion() {
      update({ suggestionOffset: state.suggestionOffset + 1 });
    },

    /** Fresh first suggestion for the chosen mood. */
    startDay() {
      const place = pickInitial({
        places: places(),
        mood: state.mood,
        excludeIds: [...routeIds(), state.recommendationId].filter(Boolean),
        visitedIds: visitedIds(),
        random,
      });
      update({ recommendationId: place.id, seenIds: [place.id] });
      return place;
    },

    showAnother() {
      const current = getPlaceById(state.recommendationId);
      const place = pickAlternative({
        places: places(),
        mood: state.mood,
        current,
        seenIds: [...state.seenIds, ...routeIds()],
        visitedIds: visitedIds(),
        random,
      });
      if (!place) return null;
      // once every option has been seen, start the "seen" cycle again
      const unseenLeft = places().some((p) => p.id !== place.id && !state.seenIds.includes(p.id));
      const seenIds = unseenLeft ? [...new Set([...state.seenIds, place.id])] : [place.id];
      update({ recommendationId: place.id, seenIds });
      return place;
    },

    /** "여기로 가보기": make the recommendation the current destination. */
    acceptRecommendation() {
      const id = state.recommendationId;
      if (!placeExists(id)) return null;
      const route = routeIds().includes(id) ? state.route : [...state.route, { id, visited: false }];
      const base = { ...state, route };
      commit({ ...base, currentId: id, discoveryIds: computeDiscoveries(id, base) });
      return id;
    },

    /** Explore from any place on the route. */
    setCurrent(id) {
      if (!placeExists(id)) return;
      commit({ ...state, currentId: id, discoveryIds: computeDiscoveries(id) });
    },

    refreshDiscoveries() {
      if (!state.currentId) return;
      const previous = state.discoveryIds;
      const from = getPlaceById(state.currentId);
      // prefer not to show the exact same set again
      const fresh = suggestNearby({
        places: places(),
        from,
        excludeIds: [...routeIds(), ...previous],
        visitedIds: visitedIds(),
        count: DISCOVERY_COUNT,
        random,
      }).map((d) => d.place.id);
      update({ discoveryIds: fresh.length ? fresh : computeDiscoveries(state.currentId) });
    },

    addToRoute(id) {
      if (!placeExists(id) || routeIds().includes(id)) return false;
      update({
        route: [...state.route, { id, visited: false }],
        discoveryIds: state.discoveryIds.filter((d) => d !== id),
      });
      return true;
    },

    /** Returns what was removed so the UI can offer "되돌리기". */
    removeFromRoute(id) {
      const index = state.route.findIndex((s) => s.id === id);
      if (index < 0) return null;
      const entry = state.route[index];
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
      update({ route: state.route.map((s) => (s.id === id ? { ...s, visited: !s.visited } : s)) });
    },

    replaceInRoute(id, newId) {
      if (!placeExists(newId) || routeIds().includes(newId)) return false;
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
