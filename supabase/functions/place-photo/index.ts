// Supabase Edge Function: place-photo
// Returns the best Kakao image-search result for a place query.
// Keeps the Kakao REST API key on the server (secret KAKAO_REST_API_KEY).
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   KAKAO_REST_API_KEY  = Kakao Developers → 앱 키 → REST API 키
//   ALLOWED_ORIGINS     = https://johnyang0323.github.io   (comma-separated, optional)
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
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || 'https://johnyang0323.github.io')
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
  image_url: string;
  thumbnail_url: string;
  display_sitename: string;
  doc_url: string;
  width: number;
  height: number;
};

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
  try {
    const body = await req.json();
    query = typeof body?.query === 'string' ? body.query.trim() : '';
  } catch {
    /* invalid body */
  }
  if (query.length < 2 || query.length > 60) return json({ error: 'invalid query' }, 400, headers);

  const url = `https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(query)}&sort=accuracy&size=10`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  if (!res.ok) return json({ error: 'kakao search failed', status: res.status }, 502, headers);
  const { documents = [] } = (await res.json()) as { documents: KakaoImage[] };

  const usable = documents.filter((d) => d.image_url && d.width >= 400 && d.height >= 300 && d.width / d.height < 2.5);
  const best = usable.find((d) => d.image_url.startsWith('https://')) ?? usable[0] ?? documents[0];
  const photo = best
    ? { url: best.image_url, thumb: best.thumbnail_url, site: best.display_sitename, link: best.doc_url }
    : null;
  return json({ photo }, 200, headers, true);
});
