// Supabase Edge Function: place-photo
// Returns the best Kakao image-search result for a place query.
// Keeps the Kakao REST API key on the server (secret KAKAO_REST_API_KEY).
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   KAKAO_REST_API_KEY  = Kakao Developers → 앱 키 → REST API 키
//   ALLOWED_ORIGINS     = https://johnyang0323.github.io,https://localhost   (comma-separated, optional; https://localhost is the Android app)
//
// Function settings: turn OFF "Verify JWT" (projects with sb_publishable_ keys
// send a non-JWT key). Access is limited to the site's origin below instead.
//
// Health check: open https://<project>.supabase.co/functions/v1/place-photo
// in a browser tab. It shows whether the function is deployed and whether
// its secrets are set (never the key itself).

const KAKAO_KEY = Deno.env.get('KAKAO_REST_API_KEY') ?? '';
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

type KakaoBlog = { title: string; url: string; blogname: string; datetime?: string };

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

async function kakaoSearch<T>(kind: 'image' | 'blog', query: string, size: number): Promise<{ ok: boolean; status: number; documents: T[] }> {
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
  if (!KAKAO_KEY) return json({ error: 'KAKAO_REST_API_KEY is not set' }, 500, headers);

  let query = '';
  let name = '';
  try {
    const body = await req.json();
    query = typeof body?.query === 'string' ? body.query.trim() : '';
    name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  } catch {
    /* invalid body */
  }
  if (query.length < 2 || query.length > 60) return json({ error: 'invalid query' }, 400, headers);

  // A: blog posts whose TITLE names the place; their photos are probably of it
  const [images, blogs] = await Promise.all([
    kakaoSearch<KakaoImage>('image', query, 30),
    name ? kakaoSearch<KakaoBlog>('blog', query, 30) : Promise.resolve({ ok: true, status: 200, documents: [] as KakaoBlog[] }),
  ]);
  if (!images.ok) return json({ error: 'kakao search failed', status: images.status }, 502, headers);
  const relevantPosts = new Set(blogs.documents.filter((b) => titleMentions(b.title, name)).map((b) => postKey(b.url)));

  const seen = new Set<string>();
  const ranked = images.documents
    .filter((d) => d.image_url && d.width >= 400 && d.height >= 300)
    .filter((d) => (seen.has(d.image_url) ? false : (seen.add(d.image_url), true)))
    .map((d) => ({ d, score: scoreImage(d, relevantPosts) }))
    .sort((a, b) => b.score - a.score);
  const pool = ranked.length ? ranked : images.documents.filter((d) => d.image_url).map((d) => ({ d, score: 0 }));

  const photos = pool.slice(0, 6).map(({ d, score }) => ({
    url: d.image_url,
    thumb: d.thumbnail_url,
    site: d.display_sitename,
    link: d.doc_url,
    relevant: score >= 10,
  }));
  // `photo` keeps older app versions working
  return json({ photo: photos[0] ?? null, photos, relevantPosts: relevantPosts.size }, 200, headers, true);
});
