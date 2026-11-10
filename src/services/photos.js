/**
 * Photos for REAL (Kakao) places, via the photo Edge Function, which keeps
 * the Kakao REST key on the server and ranks Kakao image-search results:
 * photos from blog posts whose TITLE names the place come first, shops,
 * news and odd shapes sink.
 *
 * On top of that, everyone's votes (supabase/photo_votes.sql) are shared:
 * "이 사진으로 정하기" (+1) and "이 사진 아니에요" (-1). A photo is hidden
 * for everyone at a net score of -2 or lower, and right away for the
 * person who voted it down. Upvoted photos come first for everyone.
 *
 * Only trustworthy search results are shown: photos from a post whose title
 * names the place, or ones people picked. With nothing like that, the place
 * keeps its illustration (and a link to its photos on Kakao Map) rather
 * than a random picture.
 *
 * Before all of those come photos people took there themselves and chose to
 * share as place photos (journal entries with share_place_photos), credited
 * with their nickname. They can be reported, which also hides them here.
 *
 * Search results are credited with their source. The illustration stays
 * underneath as a placeholder and fallback.
 */
import { getSupabase } from './backend/client.js';
import { isBackendConfigured, SUPABASE_URL, SUPABASE_ANON_KEY, PHOTO_FUNCTION, DELETE_FUNCTION } from './backend/config.js';
import { getUser } from './backend/auth.js';
import { getPlaceById } from './placeRepository.js';
import { escapeHtml } from '../utils/dom.js';
import { placePhotos, report } from './backend/social.js';

const CACHE_KEY = 'plannish-photos';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SCORES_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const MAX_PHOTOS = 6;
export const HIDE_AT_SCORE = -2;
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
    cache[id] = { ...entry, at: entry.at || Date.now() };
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
    relevant: photo.relevant === true,
    score: Number.isFinite(photo.score) ? photo.score : 0,
  };
}

/** Candidates from the function's reply (newer `photos`, or older single `photo`). */
function photoList(data) {
  const list = Array.isArray(data?.photos) && data.photos.length ? data.photos : [data?.photo];
  const seen = new Set();
  return list
    .map(cleanPhoto)
    .filter((p) => p && !seen.has(p.url) && seen.add(p.url))
    .slice(0, MAX_PHOTOS);
}

/**
 * Is this search result likely to be of the place? From a post whose title
 * names it, or picked by people. Everything else (the rest of a keyword image
 * search) is too often unrelated, so it isn't shown.
 */
export const isTrusted = (photo) => Boolean(photo && (photo.relevant || photo.score >= 1));

/** Cached entry → { photos, chosen }. Also reads the older formats. */
function fromCache(entry) {
  if (entry.none) return { photos: [], chosen: 0 };
  const photos = (Array.isArray(entry.photos) ? entry.photos.map(cleanPhoto) : [cleanPhoto(entry)]).filter(Boolean);
  let chosen = photos.findIndex((p) => p.url === entry.chosenUrl);
  if (chosen < 0) chosen = Number.isInteger(entry.chosen) && entry.chosen < photos.length ? entry.chosen : 0;
  return { photos, chosen };
}

function saveEntry(id, { photos, chosen }, extra = {}) {
  const old = readCache()[id] || {};
  writeCache(id, photos.length ? { photos, chosenUrl: photos[chosen]?.url || null, at: old.at, scoredAt: old.scoredAt, ...extra } : { none: true, at: old.at, ...extra });
}

// ---- shared votes (B) --------------------------------------------------------

/** Net community score per image URL for one place. Empty if votes aren't set up yet. */
async function fetchScores(placeId) {
  const supabase = await getSupabase();
  if (!supabase || !getUser()) return null;
  const { data, error } = await supabase.rpc('photo_scores', { ids: [placeId] });
  if (error || !Array.isArray(data)) return null;
  return new Map(data.map((row) => [String(row.image_url).replace(/^http:/, 'https:'), row]));
}

/**
 * Hide photos the community voted down and order the rest: score, then
 * title relevance, then search order. Votes only reorder or hide what the
 * search returned; they can never add an image (so nobody can push an
 * arbitrary picture to everyone by voting for its URL).
 */
export function applyScores(photos, scores) {
  if (!scores) return photos;
  return photos
    .map((p, order) => ({ ...p, order }))
    .map((p) => ({ ...p, score: scores.get(p.url)?.score ?? 0 }))
    .filter((p) => p.score > HIDE_AT_SCORE)
    .sort((a, b) => b.score - a.score || Number(b.relevant) - Number(a.relevant) || a.order - b.order)
    .slice(0, MAX_PHOTOS)
    .map(({ order, ...p }) => p);
}

async function castVote(placeId, photo, vote) {
  const supabase = await getSupabase();
  if (!supabase || !getUser()) return false;
  const { error } = await supabase
    .from('photo_votes')
    .upsert(
      { place_id: placeId, image_url: photo.url, vote },
      { onConflict: 'place_id,image_url,user_id' },
    );
  return !error;
}

// ---- which photo function to call -----------------------------------------
// The function's URL name (slug) is set when it's created in Supabase. Try the
// configured one, then the usual names, and stick with whichever answers.
const PHOTO_FUNCTIONS = [...new Set([PHOTO_FUNCTION, 'place-photo', 'hyper-responder'])];
let workingFunction = null;

/** Not deployed under this name (404), or unreachable as such (no CORS on a 404). */
const notThere = (error) => Boolean(error) && (!(error.context instanceof Response) || error.context.status === 404);

async function invokePhotoFunction(body) {
  const supabase = await getSupabase();
  let last = null;
  for (const name of workingFunction ? [workingFunction] : PHOTO_FUNCTIONS) {
    let result;
    try {
      result = await supabase.functions.invoke(name, { body });
    } catch (error) {
      result = { data: null, error };
    }
    last = { ...result, name };
    if (!notThere(result.error)) {
      workingFunction = name;
      return last;
    }
  }
  workingFunction = null;
  return last;
}

export const photosEnabled = (place) => place?.source === 'kakao' && isBackendConfigured();

export function photoQuery(place) {
  const district = (place.address || '').split(' ').slice(0, 2).join(' ');
  return `${place.name} ${district}`.trim().slice(0, 60);
}

/** Refresh community scores on a cached list (no new search). */
async function rescore(place, entry) {
  const current = fromCache(entry);
  const scores = await fetchScores(place.id);
  if (!scores) return current;
  const chosenUrl = current.photos[current.chosen]?.url;
  const photos = applyScores(current.photos, scores);
  const chosen = Math.max(0, photos.findIndex((p) => p.url === chosenUrl));
  saveEntry(place.id, { photos, chosen }, { scoredAt: Date.now() });
  return { photos, chosen };
}

/**
 * All photo candidates for a place and which one is shown first.
 * Resolves { photos, chosen } or null on failure. Search results are
 * cached for two weeks (including "no photos"); community scores are
 * refreshed every few hours. Failures aren't cached.
 */
function webPhotos(place) {
  if (inflight.has(place.id)) return inflight.get(place.id);
  const cached = readCache()[place.id];
  let request;
  if (cached && Date.now() - cached.at < TTL_MS) {
    request =
      cached.none || Date.now() - (cached.scoredAt || 0) < SCORES_TTL_MS
        ? Promise.resolve(fromCache(cached))
        : rescore(place, cached).catch(() => fromCache(cached));
  } else {
    request = invokePhotoFunction({ query: photoQuery(place), name: place.name })
      .then(async ({ data, error }) => {
        if (error) return null;
        const scores = await fetchScores(place.id).catch(() => null);
        const photos = applyScores(photoList(data), scores);
        writeCache(place.id, photos.length ? { photos, chosenUrl: photos[0].url, scoredAt: Date.now() } : { none: true });
        return { photos, chosen: 0 };
      })
      .catch(() => null);
  }
  request = request
    .then((r) => {
      if (!r) return r;
      const chosenUrl = r.photos[r.chosen]?.url;
      const photos = r.photos.filter(isTrusted);
      return { photos, chosen: Math.max(0, photos.findIndex((p) => p.url === chosenUrl)), pinned: Boolean(chosenUrl && photos[0] && chosenUrl !== photos[0].url && photos.some((p) => p.url === chosenUrl)) };
    })
    .finally(() => inflight.delete(place.id));
  inflight.set(place.id, request);
  return request;
}

// ---- photos people shared (journal → "장소 사진으로 함께 보여주기") ------------

const HIDDEN_KEY = 'plannish-hidden-place-photos';
const communityCache = new Map(); // place id → { at, photos }
const COMMUNITY_TTL_MS = 5 * 60 * 1000;

function hiddenSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function hideCommunity(path) {
  try {
    const set = hiddenSet();
    set.add(path);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    /* ignore */
  }
  communityCache.forEach((entry) => {
    entry.photos = entry.photos.filter((p) => p.path !== path);
  });
}

async function communityPhotos(place) {
  if (!getUser()) return [];
  const cached = communityCache.get(place.id);
  if (cached && Date.now() - cached.at < COMMUNITY_TTL_MS) return cached.photos;
  const hidden = hiddenSet();
  const rows = await placePhotos(place.id).catch(() => []);
  const photos = rows
    .filter((r) => !hidden.has(r.path))
    .map((r) => ({ url: r.url, thumb: null, site: r.nickname, link: null, relevant: true, score: 0, community: true, path: r.path, entryId: r.entryId }));
  communityCache.set(place.id, { at: Date.now(), photos });
  return photos;
}

/** Forget shared-photo lookups (e.g. after saving an entry that shares one). */
export function refreshCommunityPhotos() {
  communityCache.clear();
}

/**
 * All photo candidates for a place and which one is shown first:
 * photos people shared there, then trustworthy search results (a photo this
 * person pinned stays first). Resolves { photos, chosen } or null.
 */
export function getPhotos(place) {
  if (!photosEnabled(place)) return Promise.resolve(null);
  return Promise.all([webPhotos(place).catch(() => null), communityPhotos(place).catch(() => [])]).then(([web, mine]) => {
    if (!web && !mine.length) return null;
    const searched = web?.photos || [];
    const photos = [...mine, ...searched];
    const chosen = web?.pinned ? mine.length + web.chosen : 0;
    return { photos, chosen };
  });
}

/** The first (pinned / best) photo, for thumbnails. */
export function getPhoto(place) {
  return getPhotos(place).then((r) => (r && r.photos.length ? r.photos[r.chosen] : null));
}

/** "이 사진으로 정하기": remember it here and vote it up for everyone. */
export function pinPhoto(id, photo) {
  if (photo.community) return Promise.resolve(false);
  const cached = readCache()[id];
  if (cached && !cached.none) {
    const current = fromCache(cached);
    saveEntry(id, { photos: current.photos, chosen: Math.max(0, current.photos.findIndex((p) => p.url === photo.url)) });
  }
  return castVote(id, photo, 1);
}

/** Forget a candidate on this device (voted down, or can't be displayed). */
function dropPhoto(id, url) {
  const cached = readCache()[id];
  if (!cached || cached.none) return;
  const { photos, chosen } = fromCache(cached);
  const chosenUrl = photos[chosen]?.url;
  const rest = photos.filter((p) => p.url !== url);
  saveEntry(id, { photos: rest, chosen: Math.max(0, rest.findIndex((p) => p.url === chosenUrl)) });
}

/** "이 사진 아니에요": hide it here now, and count a vote against it for everyone. */
export function rejectPhoto(id, photo) {
  if (photo.community) {
    // someone's own photo: report it (the operator reviews) and hide it here
    hideCommunity(photo.path);
    return photo.entryId ? report('entry', photo.entryId, '장소 사진 신고').then(() => true, () => false) : Promise.resolve(false);
  }
  dropPhoto(id, photo.url);
  return castVote(id, photo, -1);
}

function creditNote(photo, place) {
  if (photo.community) return '다녀온 사람이 직접 찍어 공유한 사진이에요.';
  if (photo.score >= 1) return '다른 사람들이 이 장소의 사진으로 고른 사진이에요.';
  if (photo.relevant) return `‘${place.name}’을(를) 다룬 글에 실린 사진이에요.`;
  return '검색 결과라 실제 장소와 다를 수 있어요.';
}

function showCredit(root, place, photo) {
  root.querySelectorAll(`[data-photo-credit-for="${CSS.escape(place.id)}"]`).forEach((el) => {
    if (!photo) {
      el.hidden = true;
      return;
    }
    if (photo.community) {
      el.innerHTML = `사진: ${escapeHtml(photo.site)}님 · ${escapeHtml(creditNote(photo, place))}`;
      el.hidden = false;
      return;
    }
    const source = photo.link
      ? `<a href="${escapeHtml(photo.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(photo.site || '출처 보기')}</a>`
      : escapeHtml(photo.site || '웹 검색');
    el.innerHTML = `사진: ${source} · ${escapeHtml(creditNote(photo, place))}`;
    el.hidden = false;
  });
}

/** Try the full image, then the search thumbnail. */
function loadInto(img, photo, onLoad, onFail) {
  const sources = [photo.url, photo.thumb].filter(Boolean);
  img.onerror = () => {
    sources.shift();
    if (sources.length) img.src = sources[0];
    else onFail();
  };
  img.onload = onLoad;
  img.src = sources[0];
}

/** Which candidate each gallery is showing, kept across re-renders. */
const viewIndex = new Map();

function button(className, label, text) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.setAttribute('aria-label', label);
  el.textContent = text;
  return el;
}

/** ‹ 2 / 5 ›, "이 사진으로 정하기" and "이 사진 아니에요" for [data-photo-gallery] slots. */
function buildGallery(slot, place, state, { show, removeCurrent, announce }) {
  const bar = document.createElement('div');
  bar.className = 'gallery';
  const prev = button('gallery-btn gallery-prev', '이전 사진', '‹');
  const next = button('gallery-btn gallery-next', '다음 사진', '›');
  const count = document.createElement('span');
  count.className = 'gallery-count';
  count.setAttribute('aria-live', 'polite');
  const reject = button('gallery-reject', '이 사진은 이 장소가 아니에요', '아니에요');
  const pin = button('gallery-pin', '이 사진을 대표 사진으로 정하기', '');
  bar.append(prev, count, next, reject, pin);

  const step = (delta) => {
    const n = state.photos.length;
    state.index = (state.index + delta + n) % n;
    viewIndex.set(place.id, state.index);
    show();
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  pin.addEventListener('click', () => {
    state.chosen = state.index;
    pinPhoto(place.id, state.photos[state.index]);
    announce?.('대표 사진으로 정했어요. 다른 사람들에게도 이 사진이 먼저 보여요.');
    update();
  });
  reject.addEventListener('click', () => {
    const photo = state.photos[state.index];
    rejectPhoto(place.id, photo);
    announce?.(photo.community ? '신고했어요. 이 사진은 이제 보이지 않아요.' : '이 사진을 뺐어요. 알려주셔서 고마워요.');
    removeCurrent();
  });

  function update() {
    const n = state.photos.length;
    bar.hidden = n < 1;
    [prev, next, count].forEach((el) => {
      el.hidden = n < 2;
    });
    count.textContent = `${state.index + 1} / ${n}`;
    const current = state.photos[state.index];
    const pinned = state.index === state.chosen;
    pin.hidden = Boolean(current?.community);
    pin.textContent = pinned ? '✓ 대표 사진' : '이 사진으로 정하기';
    pin.setAttribute('aria-pressed', String(pinned));
    pin.classList.toggle('is-pinned', pinned);
    reject.textContent = current?.community ? '신고' : '아니에요';
    reject.setAttribute('aria-label', current?.community ? '이 사진 신고하기' : '이 사진은 이 장소가 아니에요');
  }
  slot.append(bar);
  return { update, remove: () => bar.remove() };
}

/**
 * Upgrade every [data-photo-for] slot inside `root` with a photo, keeping
 * the illustration if nothing loads. Slots marked [data-photo-gallery]
 * also get controls to flip, pin and reject. Safe after every render.
 */
export function hydratePhotos(root, { announce } = {}) {
  root.querySelectorAll('[data-photo-for]').forEach((slot) => {
    const id = slot.dataset.photoFor;
    const place = getPlaceById(id);
    if (!place || slot.dataset.photoState) return;
    slot.dataset.photoState = 'loading';
    getPhotos(place).then((result) => {
      if (!result || !result.photos.length || !slot.isConnected) return;
      const isGallery = slot.hasAttribute('data-photo-gallery');
      const state = { photos: [...result.photos], chosen: result.chosen, index: result.chosen };
      if (isGallery && viewIndex.has(id)) state.index = Math.min(viewIndex.get(id), state.photos.length - 1);

      const img = new Image();
      img.alt = '';
      img.className = 'photo';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer'; // many image hosts block hotlinks by referrer
      slot.append(img);
      let gallery = null;

      // take the current candidate out and show the next (or the illustration)
      const removeCurrent = () => {
        state.photos.splice(state.index, 1);
        if (state.chosen > state.index) state.chosen -= 1;
        if (!state.photos.length) {
          img.remove();
          gallery?.remove();
          slot.classList.remove('has-photo');
          showCredit(root, place, null);
          return;
        }
        state.chosen = Math.min(state.chosen, state.photos.length - 1);
        state.index %= state.photos.length;
        viewIndex.set(id, state.index);
        show();
      };

      function show() {
        const photo = state.photos[state.index];
        loadInto(
          img,
          photo,
          () => {
            slot.classList.add('has-photo');
            slot.dataset.photoState = 'shown';
            showCredit(root, place, photo);
            gallery?.update();
          },
          () => {
            if (!photo.community) dropPhoto(id, photo.url);
            removeCurrent();
          },
        );
      }
      if (isGallery) gallery = buildGallery(slot, place, state, { show, removeCurrent, announce });
      show();
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
  const { data, error, name: fnName } = await invokePhotoFunction({ query: '남산서울타워 서울 용산구', name: '남산서울타워' });
  const tried = PHOTO_FUNCTIONS.map((n) => `${SUPABASE_URL}/functions/v1/${n}`).join(' , ');

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
        detail: tried,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        message: `사진 함수를 찾지 못했어요. 앱은 ${PHOTO_FUNCTIONS.join(', ')} 이름으로 찾아봤어요. Supabase 함수 개요(Overview)에 나오는 주소 끝 이름과 같은지 확인해 주세요.`,
        detail: `${detail} · ${tried}`,
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
  if (!photo && data?.relevantPosts > 0) {
    return {
      ok: false,
      message: `함수와 카카오 검색은 정상이에요(장소 이름이 제목에 든 글 ${data.relevantPosts}개). 그런데 그 글들에서 사진을 고르지 못했어요. 사진 함수를 최신 코드로 다시 배포해 주세요.`,
      detail: `함수: ${fnName}`,
    };
  }
  if (!photo) return { ok: false, message: '함수는 동작하지만 검색 결과가 비어 있어요. 카카오 REST API 키의 검색 권한(다음 검색)을 확인해 주세요.', detail: `함수: ${fnName} · ${JSON.stringify(data).slice(0, 160)}` };

  const fullOk = await tryLoadImage(photo.url);
  const thumbOk = fullOk || (photo.thumb ? await tryLoadImage(photo.thumb) : false);
  clearPhotoMisses();
  if (!thumbOk) return { ok: false, message: '사진 주소는 받았지만 이 브라우저에서 이미지가 열리지 않아요(이미지 사이트가 외부 표시를 막는 경우).', detail: photo.url };
  return { ok: true, message: fullOk ? '사진 기능이 정상이에요.' : '사진 기능이 동작해요(원본 대신 작은 미리보기 이미지로 표시돼요).', detail: `함수: ${fnName} · 사진 출처: ${photo.site}` };
}

/**
 * Is the delete-account function deployed and set up? Called WITHOUT the
 * person's login token, so it can never delete anything: a ready function
 * answers "not signed in" (401).
 */
export async function checkDeleteFunction() {
  if (!isBackendConfigured()) return { ok: false, message: 'Supabase가 연결되지 않은 빌드예요.' };
  const url = `${SUPABASE_URL}/functions/v1/${DELETE_FUNCTION}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: '{}' });
  } catch {
    return {
      ok: false,
      message: `계정 삭제 함수에 연결하지 못했어요. ① 함수 이름(주소 끝)이 정확히 ${DELETE_FUNCTION}인지, ② 함수 Details에서 Verify JWT를 껐는지 확인해 주세요.`,
      detail: url,
    };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const detail = `HTTP ${res.status}${body?.error ? ` · ${body.error}` : body?.message ? ` · ${body.message}` : body?.msg ? ` · ${body.msg}` : ''}`;
  if (res.status === 401 && body?.error === 'not signed in') {
    if (body.kakaoAdminKeySet === false) {
      return {
        ok: false,
        message: '계정 삭제는 되지만, 카카오 연결 끊기 키가 없어요. Kakao Developers의 Admin 키를 Edge Functions → Secrets에 KAKAO_ADMIN_KEY로 추가해 주세요. 없으면 카카오로 다시 로그인할 때 새 빈 계정이 만들어져요.',
        detail,
      };
    }
    return {
      ok: true,
      message: body.kakaoAdminKeySet ? '계정 삭제 기능이 준비됐어요 (카카오 연결 끊기 포함).' : '계정 삭제 기능이 준비됐어요.',
      // The probe is sent without a login on purpose, so a refusal is the healthy answer.
      detail: '점검은 로그인 없이 보내서, 함수가 "로그인 필요"라고 거절하면 정상이에요.',
    };
  }
  if (res.status === 500 && /service role/i.test(body?.error || '')) {
    return { ok: false, message: '함수에 서비스 키가 없어요. Project Settings → API Keys의 service_role(secret) 키를 Edge Functions → Secrets에 SERVICE_ROLE_KEY라는 이름으로 추가해 주세요.', detail };
  }
  if (res.status === 404) return { ok: false, message: `계정 삭제 함수를 찾지 못했어요. 앱은 ${url} 주소를 부르고 있어요. 함수 Overview의 주소와 같은지 확인해 주세요.`, detail };
  if (res.status === 401) return { ok: false, message: '함수가 로그인 토큰(JWT)을 요구하고 있어요. 함수 Details에서 Verify JWT를 끄고 저장해 주세요.', detail };
  if (res.status === 403) return { ok: false, message: `Secrets의 ALLOWED_ORIGINS가 이 사이트(${window.location.origin})를 허용하지 않아요.`, detail };
  return { ok: false, message: '계정 삭제 함수가 예상과 다르게 답했어요.', detail };
}
