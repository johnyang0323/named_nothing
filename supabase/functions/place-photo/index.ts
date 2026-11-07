// Supabase Edge Function: place-photo
// Photos for a place, best first:
//   1. 한국관광공사 TourAPI — official photos of the nearest matching spot (needs lat/lng)
//   2. Naver search — images whose title names the place
//   3. Kakao (Daum) search — only when the Naver keys are not set
// Every key stays on the server.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   TOUR_API_KEY        = 공공데이터포털 → 한국관광공사_국문 관광정보 서비스 → 일반 인증키 (Decoding)
//   NAVER_CLIENT_ID     = Naver Developers → 애플리케이션 → Client ID (검색 API)
//   NAVER_CLIENT_SECRET = Naver Developers → 애플리케이션 → Client Secret
//   KAKAO_REST_API_KEY  = (optional backup) Kakao Developers → 앱 키 → REST API 키
//   ALLOWED_ORIGINS     = https://johnyang0323.github.io,https://localhost   (comma-separated, optional; https://localhost is the Android app)
//
// Function settings: turn OFF "Verify JWT" (projects with sb_publishable_ keys
// send a non-JWT key). Access is limited to the site's origin below instead.
//
// Health check: open https://<project>.supabase.co/functions/v1/place-photo
// in a browser tab. It shows whether the function is deployed and whether
// its secrets are set (never the key itself).

const KAKAO_KEY = Deno.env.get('KAKAO_REST_API_KEY') ?? '';
const NAVER_ID = Deno.env.get('NAVER_CLIENT_ID') ?? '';
const NAVER_SECRET = Deno.env.get('NAVER_CLIENT_SECRET') ?? '';
const TOUR_KEY = (Deno.env.get('TOUR_API_KEY') ?? '').trim();
// "https://site.io/" and "https://site.io" mean the same origin
const normalize = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || 'https://johnyang0323.github.io,https://localhost')
  .split(',')
  .map(normalize)
  .filter(Boolean);

// Echo the caller's origin so even refusals are readable by the app's
// self-check; the refusal itself (403) is what blocks other sites.
function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>, cache = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      ...(cache ? { 'Cache-Control': 'public, max-age=86400' } : {}),
    },
  });
}

type KakaoImage = {
  collection?: string;
  image_url: string;
  thumbnail_url: string;
  display_sitename: string;
  doc_url: string;
  width: number;
  height: number;
  datetime?: string;
};

type KakaoBlog = { title: string; url: string; blogname?: string; cafename?: string; thumbnail?: string; datetime?: string };

// ---- relevance helpers (A + C) ------------------------------------------------

/** Lowercase, drop tags/HTML entities, spaces and punctuation: "골목 끝<b>서점</b>!" → "골목끝서점". */
const squash = (text: string) =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');

/** Same blog post, whatever the URL form (http/https, m./www., naver PostView vs /id/logNo). */
export function postKey(raw: string) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'blog.naver.com') {
      const blogId = u.searchParams.get('blogId');
      const logNo = u.searchParams.get('logNo');
      if (blogId && logNo) return `${host}/${blogId}/${logNo}`.toLowerCase();
    }
    return `${host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** Does this post title really talk about the place? Full name, or every word of it. */
export function titleMentions(title: string, name: string) {
  const t = squash(title);
  const full = squash(name);
  if (full.length >= 2 && t.includes(full)) return true;
  const words = name.split(/\s+/).map(squash).filter((w) => w.length >= 2);
  return words.length >= 2 && words.every((w) => t.includes(w));
}

const SHOP_OR_NEWS = /(쿠팡|11번가|g마켓|지마켓|옥션|위메프|티몬|인터파크|스마트스토어|쇼핑|다나와|뉴스|일보|신문|news)/i;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Higher is better. Relevance dominates; the rest only breaks ties. */
export function scoreImage(d: KakaoImage, relevantPosts: Set<string>, now = Date.now()) {
  let score = 0;
  if (relevantPosts.has(postKey(d.doc_url))) score += 10; // A: from a post whose title names the place
  const ratio = d.width / d.height;
  if (ratio < 0.6 || ratio > 2.0) score -= 3; // C: banners, long screenshots
  if (d.width >= 640) score += 1;
  if (d.collection === 'news' || SHOP_OR_NEWS.test(d.display_sitename || '')) score -= 4; // C: shops, press photos
  if (d.collection === 'blog' || d.collection === 'cafe') score += 1;
  const age = d.datetime ? now - Date.parse(d.datetime) : 0;
  if (age > 4 * YEAR_MS) score -= 2; // C: the place may have changed
  if (d.image_url.startsWith('https://')) score += 0.5;
  return score;
}

/**
 * Kakao's preview images are tiny crops (…/argon/130x130_85_c/ID). The same
 * service resizes on request, so ask for a larger one; the app falls back to
 * the original preview if that doesn't load.
 */
export function largerPreview(url: string) {
  return url.replace(/\/argon\/\d+x\d+_\d+_[a-z]+\//, '/argon/600x0_65_wr/').replace(/^http:/, 'https:');
}

// ---- Naver search -------------------------------------------------------------

type NaverImage = { title: string; link: string; thumbnail: string; sizeheight: string; sizewidth: string };

/**
 * Naver's image thumbnails (search.pstatic.net/common/?src=…&type=…) load on
 * any site and resize on request; the original `link` is often a blog file
 * that refuses other sites. Ask for a larger thumbnail.
 */
export function naverLarger(thumb: string) {
  const url = thumb.replace(/^http:/, 'https:');
  return /search\.pstatic\.net\/common\//.test(url)
    ? (/[?&]type=/.test(url) ? url.replace(/([?&]type=)[^&]*/, '$1w800') : `${url}&type=w800`)
    : url;
}

/** Higher is better; a title naming the place dominates. */
export function scoreNaver(item: NaverImage, name: string) {
  let score = 0;
  if (name && titleMentions(item.title || '', name)) score += 10;
  const w = Number(item.sizewidth) || 0;
  const h = Number(item.sizeheight) || 0;
  if (w && h) {
    const ratio = w / h;
    if (ratio < 0.6 || ratio > 2.0) score -= 3;
    if (w >= 640) score += 1;
  }
  if (SHOP_OR_NEWS.test(item.title || '') || SHOP_OR_NEWS.test(item.link || '')) score -= 4;
  if (/blog|cafe/.test(item.link || '')) score += 1;
  return score;
}

async function naverImages(query: string): Promise<{ ok: boolean; status: number; items: NaverImage[] }> {
  const res = await fetch(`https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=30&sort=sim&filter=large`, {
    headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
  });
  if (!res.ok) return { ok: false, status: res.status, items: [] };
  const body = (await res.json()) as { items?: NaverImage[] };
  return { ok: true, status: res.status, items: body.items ?? [] };
}

type Photo = { url: string; thumb: string; site: string; link: string; relevant: boolean; source: string };

async function fromNaver(query: string, name: string): Promise<{ ok: boolean; status: number; photos: Photo[]; relevant: number }> {
  const r = await naverImages(query);
  if (!r.ok) return { ok: false, status: r.status, photos: [], relevant: 0 };
  const seen = new Set<string>();
  const ranked = r.items
    .filter((i) => typeof i.thumbnail === 'string' && /^https?:\/\//.test(i.thumbnail))
    .filter((i) => (Number(i.sizewidth) || 400) >= 400 && (Number(i.sizeheight) || 300) >= 300)
    .filter((i) => (seen.has(i.thumbnail) ? false : (seen.add(i.thumbnail), true)))
    .map((i) => ({ i, score: scoreNaver(i, name) }))
    .filter(({ score }) => score >= 10) // only images whose title names the place
    .sort((a, b) => b.score - a.score);
  return {
    ok: true,
    status: r.status,
    relevant: ranked.length,
    photos: ranked.map(({ i }) => ({
      url: naverLarger(i.thumbnail),
      thumb: i.thumbnail.replace(/^http:/, 'https:'),
      site: '네이버 검색',
      link: /^https?:\/\//.test(i.link) ? i.link : i.thumbnail,
      relevant: true,
      source: 'naver',
    })),
  };
}

// ---- 한국관광공사 TourAPI ---------------------------------------------------------

type TourItem = { title?: string; firstimage?: string; firstimage2?: string; contentid?: string; dist?: string; mapx?: string; mapy?: string };
type TourImage = { originimgurl?: string; smallimageurl?: string; imgname?: string };

const TOUR_BASES = [
  { base: 'https://apis.data.go.kr/B551011/KorService2', list: 'locationBasedList2', images: 'detailImage2' },
  { base: 'https://apis.data.go.kr/B551011/KorService1', list: 'locationBasedList1', images: 'detailImage1' },
];
let tourBase: (typeof TOUR_BASES)[number] | null = null;

/** The portal hands out an "Encoding" and a "Decoding" key; accept either. */
const tourKeyParam = () => (TOUR_KEY.includes('%') ? TOUR_KEY : encodeURIComponent(TOUR_KEY));

function tourItems<T>(body: unknown): T[] | null {
  const b = body as { response?: { header?: { resultCode?: string }; body?: { items?: { item?: T | T[] } | string } } };
  const code = b?.response?.header?.resultCode;
  if (code && code !== '0000' && code !== '00') return null;
  const items = b?.response?.body?.items;
  if (!items || typeof items === 'string') return [];
  const item = items.item;
  return Array.isArray(item) ? item : item ? [item] : [];
}

async function tourCall<T>(op: 'list' | 'images', params: Record<string, string>): Promise<T[] | null> {
  const bases = tourBase ? [tourBase] : TOUR_BASES;
  for (const b of bases) {
    const qs = new URLSearchParams({ MobileOS: 'ETC', MobileApp: 'plannish', _type: 'json', ...params });
    try {
      const res = await fetch(`${b.base}/${op === 'list' ? b.list : b.images}?serviceKey=${tourKeyParam()}&${qs}`);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim().startsWith('{')) continue; // XML error (bad key, wrong service)
      const items = tourItems<T>(JSON.parse(text));
      if (items === null) continue;
      tourBase = b;
      return items;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Same spot? Names overlap (ignoring spaces/punctuation), or practically the same point. */
export function tourMatches(item: TourItem, name: string) {
  const t = squash(item.title || '');
  const n = squash(name);
  const dist = Number(item.dist);
  if (n.length >= 2 && t.length >= 2 && (t.includes(n) || n.includes(t))) return Number.isFinite(dist) ? dist <= 500 : true;
  return Number.isFinite(dist) && dist <= 40 && titleMentions(item.title || '', name);
}

const https = (u?: string) => (u && /^https?:\/\//.test(u) ? u.replace(/^http:/, 'https:') : '');

async function fromTour(name: string, lat: number, lng: number): Promise<{ state: string; photos: Photo[] }> {
  if (!TOUR_KEY) return { state: 'off', photos: [] };
  const list = await tourCall<TourItem>('list', { mapX: String(lng), mapY: String(lat), radius: '500', arrange: 'E', numOfRows: '20', pageNo: '1' });
  if (list === null) return { state: 'error', photos: [] };
  const hit = list.filter((i) => tourMatches(i, name)).sort((a, b) => Number(a.dist) - Number(b.dist))[0];
  if (!hit) return { state: 'no match', photos: [] };
  const photos: Photo[] = [];
  const credit = (url: string, thumb: string) => ({ url, thumb, site: '한국관광공사', link: 'https://korean.visitkorea.or.kr', relevant: true, source: 'tour' });
  if (https(hit.firstimage)) photos.push(credit(https(hit.firstimage), https(hit.firstimage2) || https(hit.firstimage)));
  if (hit.contentid) {
    const more = (await tourCall<TourImage>('images', { contentId: hit.contentid, imageYN: 'Y', numOfRows: '6', pageNo: '1' })) || [];
    more.forEach((m) => {
      const url = https(m.originimgurl);
      if (url && !photos.some((p) => p.url === url)) photos.push(credit(url, https(m.smallimageurl) || url));
    });
  }
  return { state: photos.length ? 'ok' : 'no photo', photos: photos.slice(0, 4) };
}

async function kakaoSearch<T>(kind: 'image' | 'blog' | 'cafe', query: string, size: number): Promise<{ ok: boolean; status: number; documents: T[] }> {
  const res = await fetch(`https://dapi.kakao.com/v2/search/${kind}?query=${encodeURIComponent(query)}&sort=accuracy&size=${size}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  if (!res.ok) return { ok: false, status: res.status, documents: [] };
  const body = (await res.json()) as { documents?: T[] };
  return { ok: true, status: res.status, documents: body.documents ?? [] };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  // Opened directly in a browser tab (no Origin): report status, never secrets.
  if (!origin && req.method === 'GET') {
    return json(
      {
        function: 'place-photo',
        deployed: true,
        kakaoRestKeySet: Boolean(KAKAO_KEY),
        naverKeySet: Boolean(NAVER_ID && NAVER_SECRET),
        tourApiKeySet: Boolean(TOUR_KEY),
        webSearch: NAVER_ID && NAVER_SECRET ? 'naver' : KAKAO_KEY ? 'kakao' : 'none',
        allowedOrigins: ALLOWED,
        note: '이 화면이 보이면 함수는 배포됐고 Verify JWT도 꺼져 있어요.',
      },
      200,
      headers,
    );
  }

  // Browsers always send Origin on cross-site requests; require ours.
  if (!origin || !ALLOWED.includes(normalize(origin))) {
    return json({ error: 'origin not allowed', origin, allowedOrigins: ALLOWED }, 403, headers);
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);
  const useNaver = Boolean(NAVER_ID && NAVER_SECRET);
  if (!useNaver && !KAKAO_KEY && !TOUR_KEY) return json({ error: 'no search key is set (NAVER_CLIENT_ID/NAVER_CLIENT_SECRET, TOUR_API_KEY or KAKAO_REST_API_KEY)' }, 500, headers);

  let query = '';
  let name = '';
  let lat = NaN;
  let lng = NaN;
  try {
    const body = await req.json();
    query = typeof body?.query === 'string' ? body.query.trim() : '';
    name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
    lat = Number(body?.lat);
    lng = Number(body?.lng);
  } catch {
    /* invalid body */
  }
  if (query.length < 2 || query.length > 60) return json({ error: 'invalid query' }, 400, headers);
  const inKorea = Number.isFinite(lat) && Number.isFinite(lng) && lat > 33 && lat < 39 && lng > 124 && lng < 132;

  const tourPromise = name && inKorea ? fromTour(name, lat, lng) : Promise.resolve({ state: TOUR_KEY ? 'skipped' : 'off', photos: [] as Photo[] });

  if (useNaver || !KAKAO_KEY) {
    const [tour, naver] = await Promise.all([tourPromise, useNaver ? fromNaver(query, name) : Promise.resolve({ ok: true, status: 200, photos: [] as Photo[], relevant: 0 })]);
    if (!naver.ok && !tour.photos.length) return json({ error: 'naver search failed', provider: 'naver', status: naver.status, tour: tour.state }, 502, headers);
    const seen = new Set<string>();
    const photos = [...tour.photos, ...naver.photos].filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true))).slice(0, 6);
    return json({ photo: photos[0] ?? null, photos, relevantPosts: naver.relevant, tour: tour.state, search: useNaver ? 'naver' : 'none' }, 200, headers, true);
  }

  // ---- backup: Kakao (Daum) search, as before ----
  // A: blog posts whose TITLE names the place; their photos are probably of it
  const none = Promise.resolve({ ok: true, status: 200, documents: [] as KakaoBlog[] });
  const [tour, images, blogs, cafes] = await Promise.all([
    tourPromise,
    kakaoSearch<KakaoImage>('image', query, 30),
    name ? kakaoSearch<KakaoBlog>('blog', query, 30) : none,
    name ? kakaoSearch<KakaoBlog>('cafe', query, 20) : none,
  ]);
  if (!images.ok && !tour.photos.length) return json({ error: 'kakao search failed', provider: 'kakao', status: images.status, tour: tour.state }, 502, headers);
  const posts = [...blogs.documents, ...cafes.documents].filter((b) => typeof b.title === 'string' && typeof b.url === 'string' && titleMentions(b.title, name));
  const relevantPosts = new Set(posts.map((b) => postKey(b.url)));

  const seen = new Set<string>();
  const ranked = images.documents
    .filter((d) => d.image_url && d.width >= 400 && d.height >= 300)
    .filter((d) => (seen.has(d.image_url) ? false : (seen.add(d.image_url), true)))
    .map((d) => ({ d, score: scoreImage(d, relevantPosts) }))
    .sort((a, b) => b.score - a.score);
  // Only photos from a post whose title names the place. The rest of a keyword
  // image search is too often unrelated; the app shows its illustration and a
  // link to the place's own photos on Kakao Map instead.
  const pool = ranked.filter(({ score }) => score >= 10);

  const fromImages = pool.map(({ d, score }) => ({
    url: d.image_url,
    thumb: d.thumbnail_url,
    site: d.display_sitename,
    link: d.doc_url,
    relevant: score >= 10,
    source: 'kakao',
  }));
  // B: the preview picture of each post titled with the place (usually a
  // photo taken there), for posts the image search didn't already cover
  const covered = new Set(pool.map(({ d }) => postKey(d.doc_url)));
  const fromPosts = posts
    .filter((b) => b.thumbnail && /^https?:\/\//.test(b.thumbnail) && !covered.has(postKey(b.url)))
    .filter((b) => (seen.has(b.thumbnail!) ? false : (seen.add(b.thumbnail!), true)))
    .map((b) => ({
      url: largerPreview(b.thumbnail!),
      thumb: b.thumbnail!.replace(/^http:/, 'https:'),
      site: b.blogname || b.cafename || '블로그',
      link: b.url,
      relevant: true,
      source: 'kakao',
    }));
  const photos = [...tour.photos, ...fromImages, ...fromPosts].slice(0, 6);
  // `photo` keeps older app versions working
  return json({ photo: photos[0] ?? null, photos, relevantPosts: relevantPosts.size, tour: tour.state, search: 'kakao' }, 200, headers, true);
});
