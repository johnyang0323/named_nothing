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
import { isBackendConfigured, SUPABASE_URL, PHOTO_FUNCTION } from './backend/config.js';
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
    .then((supabase) => supabase.functions.invoke(PHOTO_FUNCTION, { body: { query: photoQuery(place) } }))
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

function tryLoadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(false), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = src;
  });
}

/** Forget cached "no photo" results so places are looked up again. */
export function clearPhotoMisses() {
  try {
    const cache = readCache();
    Object.keys(cache).forEach((id) => cache[id].none && delete cache[id]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/**
 * Self-check for the photo pipeline, for people who can't open dev tools.
 * Calls the Edge Function with a well-known query and explains the result
 * in plain language. Returns { ok, message, detail? }.
 */
export async function checkPhotoService() {
  if (!isBackendConfigured()) return { ok: false, message: 'Supabase가 연결되지 않은 빌드예요.' };
  const supabase = await getSupabase();
  let result;
  try {
    result = await supabase.functions.invoke(PHOTO_FUNCTION, { body: { query: '남산서울타워 서울 용산구' } });
  } catch (error) {
    result = { error };
  }
  const { data, error } = result;

  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    let body = null;
    try {
      body = response ? await response.clone().json() : null;
    } catch {
      body = null;
    }
    const status = response?.status;
    const detail = [status && `HTTP ${status}`, body?.error, body?.message, body?.msg, body?.status && `카카오 응답 ${body.status}`]
      .filter(Boolean)
      .join(' · ');

    if (!response) {
      return {
        ok: false,
        message:
          '사진 함수에 연결하지 못했어요. 아래 주소를 새 탭에서 열어보세요. "Requested function was not found"가 나오면 함수가 배포되지 않은 것이고, "Missing authorization header"나 "Invalid JWT"가 나오면 함수 설정에서 Verify JWT를 꺼야 해요. "deployed": true가 보이면 최신 함수 코드로 다시 배포해 주세요.',
        detail: `${SUPABASE_URL}/functions/v1/${PHOTO_FUNCTION}`,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        message: `사진 함수를 찾지 못했어요. 앱은 ${SUPABASE_URL}/functions/v1/${PHOTO_FUNCTION} 주소를 부르고 있어요. Supabase 함수 개요(Overview)에 나오는 주소와 같은지 확인해 주세요.`,
        detail,
      };
    }
    if (status === 401) return { ok: false, message: '함수가 로그인 토큰(JWT)을 요구하고 있어요. 함수 설정(Details)에서 Verify JWT(Enforce JWT)를 끄고 저장해 주세요.', detail };
    if (status === 403 && /origin/i.test(body?.error || '')) {
      return {
        ok: false,
        message: `Secrets의 ALLOWED_ORIGINS 값이 이 사이트 주소(${window.location.origin})와 달라요. 그 값으로 바꿔주세요.`,
        detail: `지금 설정: ${(body?.allowedOrigins || []).join(', ') || '(없음)'}`,
      };
    }
    if (status === 500 && /KAKAO_REST_API_KEY/.test(body?.error || '')) return { ok: false, message: 'Secrets에 KAKAO_REST_API_KEY가 없어요. 카카오 REST API 키를 추가해 주세요.', detail };
    if (status === 502) {
      if (body?.status === 401) return { ok: false, message: '카카오가 REST API 키를 거절했어요. KAKAO_REST_API_KEY에 JavaScript 키가 아니라 REST API 키를 넣었는지 확인해 주세요.', detail };
      if (body?.status === 403) return { ok: false, message: '카카오가 검색 권한을 거절했어요. 카카오 앱 설정에서 다음(Daum) 검색 API 사용 권한을 확인해 주세요.', detail };
      return { ok: false, message: '카카오 이미지 검색이 실패했어요.', detail };
    }
    return { ok: false, message: '사진 함수가 오류를 냈어요.', detail };
  }

  const photo = cleanPhoto(data?.photo);
  if (!photo) return { ok: false, message: '함수는 동작하지만 검색 결과가 비어 있어요. 카카오 REST API 키의 검색 권한을 확인해 주세요.', detail: JSON.stringify(data).slice(0, 200) };

  const fullOk = await tryLoadImage(photo.url);
  const thumbOk = fullOk || (photo.thumb ? await tryLoadImage(photo.thumb) : false);
  clearPhotoMisses();
  if (!thumbOk) return { ok: false, message: '사진 주소는 받았지만 이 브라우저에서 이미지가 열리지 않아요(이미지 사이트가 외부 표시를 막는 경우).', detail: photo.url };
  return { ok: true, message: fullOk ? '사진 기능이 정상이에요.' : '사진 기능이 동작해요(원본 대신 작은 미리보기 이미지로 표시돼요).', detail: photo.site };
}
