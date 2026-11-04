/**
 * Photos for REAL (Kakao) places, via the `place-photo` Supabase Edge
 * Function, which keeps the Kakao REST key on the server and returns the
 * best Kakao image-search hit for "<name> <district>".
 *
 * These are web search results (often blog photos), not official photos,
 * so the UI always credits the source and says they may differ.
 * The illustration stays underneath as a placeholder and fallback.
 */
import { getSupabase } from './backend/client.js';
import { isBackendConfigured } from './backend/config.js';
import { getPlaceById } from './placeRepository.js';
import { escapeHtml } from '../utils/dom.js';

const CACHE_KEY = 'plannish-photos';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const inflight = new Map();

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(id, entry) {
  try {
    const cache = readCache();
    cache[id] = { ...entry, at: Date.now() };
    const ids = Object.keys(cache);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => cache[a].at - cache[b].at).slice(0, ids.length - MAX_ENTRIES).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or unavailable */
  }
}

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);

function cleanPhoto(photo) {
  if (!photo || !isHttpUrl(photo.url)) return null;
  return {
    url: photo.url.replace(/^http:/, 'https:'),
    thumb: isHttpUrl(photo.thumb) ? photo.thumb.replace(/^http:/, 'https:') : null,
    site: typeof photo.site === 'string' ? photo.site.slice(0, 40) : '',
    link: isHttpUrl(photo.link) ? photo.link : null,
  };
}

export const photosEnabled = (place) => place?.source === 'kakao' && isBackendConfigured();

export function photoQuery(place) {
  const district = (place.address || '').split(' ').slice(0, 2).join(' ');
  return `${place.name} ${district}`.trim().slice(0, 60);
}

/** Resolves a photo object or null. Cached (including "no photo") for two weeks. */
export function getPhoto(place) {
  if (!photosEnabled(place)) return Promise.resolve(null);
  const cached = readCache()[place.id];
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.none ? null : cleanPhoto(cached));
  if (inflight.has(place.id)) return inflight.get(place.id);

  const request = getSupabase()
    .then((supabase) => supabase.functions.invoke('place-photo', { body: { query: photoQuery(place) } }))
    .then(({ data, error }) => {
      if (error) return null; // don't cache failures; try again next time
      const photo = cleanPhoto(data?.photo);
      writeCache(place.id, photo || { none: true });
      return photo;
    })
    .catch(() => null)
    .finally(() => inflight.delete(place.id));
  inflight.set(place.id, request);
  return request;
}

function showCredit(root, id, photo) {
  root.querySelectorAll(`[data-photo-credit-for="${CSS.escape(id)}"]`).forEach((el) => {
    const source = photo.link
      ? `<a href="${escapeHtml(photo.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(photo.site || '출처 보기')}</a>`
      : escapeHtml(photo.site || '웹 검색');
    el.innerHTML = `사진: ${source} · 검색 결과라 실제 장소와 다를 수 있어요.`;
    el.hidden = false;
  });
}

/**
 * Upgrade every [data-photo-for] slot inside `root` with a photo, keeping
 * the illustration if nothing loads. Safe to call after every render.
 */
export function hydratePhotos(root) {
  root.querySelectorAll('[data-photo-for]').forEach((slot) => {
    const id = slot.dataset.photoFor;
    const place = getPlaceById(id);
    if (!place || slot.dataset.photoState) return;
    slot.dataset.photoState = 'loading';
    getPhoto(place).then((photo) => {
      if (!photo || !slot.isConnected) return;
      const img = new Image();
      img.alt = '';
      img.className = 'photo';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer'; // many image hosts block hotlinks by referrer
      const sources = [photo.url, photo.thumb].filter(Boolean);
      img.onerror = () => {
        sources.shift();
        if (sources.length) img.src = sources[0];
        else img.remove();
      };
      img.onload = () => {
        slot.classList.add('has-photo');
        slot.dataset.photoState = 'shown';
        showCredit(root, id, photo);
      };
      img.src = sources[0];
      slot.append(img);
    });
  });
}
