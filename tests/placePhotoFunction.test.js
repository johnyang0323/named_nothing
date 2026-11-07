/**
 * The Supabase Edge Function (Deno + TypeScript), run in Node: compiled
 * with esbuild, with stand-ins for Deno.serve / Deno.env and for Kakao.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SITE = 'https://johnyang0323.github.io';
const source = readFileSync(new URL('../supabase/functions/place-photo/index.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm' }).code;

/** Load a fresh copy of the function with the given secrets and Kakao replies. */
async function loadFunction(env, kakao) {
  let handler;
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url) => {
    const reply = kakao(String(url));
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`);
  return { handler, mod };
}

const post = (body, origin = SITE) =>
  new Request('https://x/functions/v1/place-photo', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const now = new Date().toISOString();
const img = (id, doc, extra = {}) => ({ collection: 'blog', image_url: `https://img/${id}.jpg`, thumbnail_url: `https://t/${id}`, display_sitename: '네이버블로그', doc_url: doc, width: 800, height: 600, datetime: now, ...extra });
const IMAGES = [
  img('food-closeup', 'https://blog.naver.com/eater/111'),
  img('shop', 'https://shopping.example/1', { display_sitename: '쿠팡', collection: 'web' }),
  img('banner', 'https://blog.naver.com/x/9', { width: 1600, height: 400 }),
  img('real-1', 'http://m.blog.naver.com/walker/222'),
  img('real-2', 'https://blog.naver.com/PostView.naver?blogId=cafe_lover&logNo=333'),
  img('old', 'https://blog.naver.com/old/1', { datetime: '2015-01-01T00:00:00Z' }),
  img('news', 'https://news.example/1', { collection: 'news', display_sitename: '서울일보' }),
  img('tiny', 'https://blog.naver.com/t/1', { width: 200, height: 150 }),
];
const BLOGS = [
  { title: '망원동 <b>작은</b> 카페 <b>소소</b> 다녀왔어요', url: 'https://blog.naver.com/walker/222', blogname: 'w' },
  { title: '[망원] 카페소소 솔직후기', url: 'https://blog.naver.com/cafe_lover/333', blogname: 'c' },
  { title: '카페 소소 창가 자리', url: 'https://blog.naver.com/window/444', blogname: '창가', thumbnail: 'http://search1.kakaocdn.net/argon/130x130_85_c/ABC' },
  { title: '카페 소소 또 갔다', url: 'https://blog.naver.com/walker/222', blogname: 'w', thumbnail: 'https://search1.kakaocdn.net/argon/130x130_85_c/DUP' },
  { title: '망원동 맛집 리스트 (소소 근처)', url: 'https://blog.naver.com/eater/111', blogname: 'e' },
];
const kakaoOk = (url) => ({ body: { documents: url.includes('/search/blog') ? BLOGS : url.includes('/search/cafe') ? [] : IMAGES } });
const SECRETS = { KAKAO_REST_API_KEY: 'k', ALLOWED_ORIGINS: SITE };

test('only photos from posts whose title names the place are returned', async () => {
  const { handler } = await loadFunction(SECRETS, kakaoOk);
  const res = await handler(post({ query: '카페 소소 서울 마포구', name: '카페 소소' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const order = body.photos.map((p) => p.url.replace('https://img/', '').replace('.jpg', ''));
  assert.deepEqual(order.slice(0, 2), ['real-1', 'real-2'], 'image results from those posts first');
  const preview = body.photos[2];
  assert.equal(preview.url, 'https://search1.kakaocdn.net/argon/600x0_65_wr/ABC', 'then a larger version of a titled post’s preview');
  assert.equal(preview.thumb, 'https://search1.kakaocdn.net/argon/130x130_85_c/ABC', 'original preview kept as fallback');
  assert.equal(preview.site, '창가');
  assert.equal(body.photos.length, 3, 'unrelated search results left out; a post already covered adds nothing');
  assert.ok(body.photos.every((p) => p.relevant));
  assert.equal(body.relevantPosts, 3, 'a title that only mentions part of the name does not count (same post counted once)');
  assert.equal(body.photo.url, body.photos[0].url, 'older apps still get `photo`');
});

test('no matching post → no photos (the app keeps its illustration)', async () => {
  const { handler } = await loadFunction(SECRETS, kakaoOk);
  const body = await (await handler(post({ query: '이름없는 곳 서울', name: '이름없는 곳' }))).json();
  assert.deepEqual(body.photos, []);
  assert.equal(body.photo, null);
});

test('blog URL forms and title matching', async () => {
  const { mod } = await loadFunction(SECRETS, kakaoOk);
  assert.equal(mod.postKey('http://m.blog.naver.com/walker/222/'), mod.postKey('https://blog.naver.com/walker/222'));
  assert.equal(mod.postKey('https://blog.naver.com/PostView.naver?blogId=a&logNo=1'), mod.postKey('https://blog.naver.com/a/1'));
  assert.ok(mod.titleMentions('[망원] 카페소소 후기', '카페 소소'));
  assert.ok(!mod.titleMentions('망원동 맛집 리스트 (소소 근처)', '카페 소소'));
});

test('health check, origin rules and error replies', async () => {
  const { handler } = await loadFunction(SECRETS, kakaoOk);
  const health = await (await handler(new Request('https://x/f', { method: 'GET' }))).json();
  assert.equal(health.deployed, true);
  assert.equal(health.kakaoRestKeySet, true);
  assert.equal(JSON.stringify(health).includes('"k"'), false, 'never reveals the key');

  const other = await handler(post({ query: '테스트 장소' }, 'https://evil.example'));
  assert.equal(other.status, 403);
  assert.equal(other.headers.get('access-control-allow-origin'), 'https://evil.example', 'refusal readable by the self-check');

  assert.equal((await handler(post({ query: 'x' }))).status, 400);

  const slash = await loadFunction({ ...SECRETS, ALLOWED_ORIGINS: SITE + '/' }, kakaoOk);
  assert.equal((await slash.handler(post({ query: '테스트 장소' }))).status, 200, 'trailing slash in the secret is fine');

  const noKey = await loadFunction({ ALLOWED_ORIGINS: SITE }, kakaoOk); // no search key at all
  assert.equal((await noKey.handler(post({ query: '테스트 장소' }))).status, 500);

  const rejected = await loadFunction(SECRETS, () => ({ status: 401 }));
  const r = await rejected.handler(post({ query: '테스트 장소' }));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).status, 401);
});

// ---- Naver search + 한국관광공사 TourAPI ---------------------------------------
const NAVER_ITEMS = [
  { title: '망원 카페 소소 창가 자리', link: 'https://blogfiles.pstatic.net/a.jpg', thumbnail: 'https://search.pstatic.net/common/?src=https%3A%2F%2Fa.jpg&type=b150', sizewidth: '1000', sizeheight: '750' },
  { title: '서울 카페 추천 모음', link: 'https://blogfiles.pstatic.net/b.jpg', thumbnail: 'https://search.pstatic.net/common/?src=b&type=b150', sizewidth: '1000', sizeheight: '750' },
  { title: '카페소소 배너', link: 'https://x/c.jpg', thumbnail: 'https://search.pstatic.net/common/?src=c&type=b150', sizewidth: '1600', sizeheight: '300' },
];
const tourJson = (items) => ({ response: { header: { resultCode: '0000' }, body: { items: items.length ? { item: items } : '' } } });
const replies = ({ tour = true, naverStatus = 200 } = {}) => (url) => {
  if (url.includes('openapi.naver.com')) return naverStatus === 200 ? { body: { items: NAVER_ITEMS } } : { status: naverStatus };
  if (url.includes('locationBasedList2')) return tour ? { body: tourJson([{ title: '카페 소소(망원)', contentid: '77', dist: '35', firstimage: 'http://tong.visitkorea.or.kr/1.jpg', firstimage2: 'http://tong.visitkorea.or.kr/1s.jpg' }, { title: '망원시장', contentid: '78', dist: '300', firstimage: 'http://tong/x.jpg' }]) } : { body: tourJson([]) };
  if (url.includes('detailImage2')) return { body: tourJson([{ originimgurl: 'http://tong.visitkorea.or.kr/2.jpg', smallimageurl: 'http://tong.visitkorea.or.kr/2s.jpg' }]) };
  return kakaoOk(url);
};
const NEW_SECRETS = { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'sec', TOUR_API_KEY: 'tk', ALLOWED_ORIGINS: SITE };

test('TourAPI photos first, then Naver images whose title names the place', async () => {
  const { handler } = await loadFunction(NEW_SECRETS, replies());
  const body = await (await handler(post({ query: '카페 소소 서울 마포구', name: '카페 소소', lat: 37.556, lng: 126.91 }))).json();
  assert.equal(body.tour, 'ok');
  assert.equal(body.search, 'naver');
  assert.deepEqual(body.photos.map((p) => p.source), ['tour', 'tour', 'naver']);
  assert.equal(body.photos[0].url, 'https://tong.visitkorea.or.kr/1.jpg', 'https, nearest matching spot');
  assert.equal(body.photos[0].site, '한국관광공사');
  assert.equal(body.photos[2].url, 'https://search.pstatic.net/common/?src=https%3A%2F%2Fa.jpg&type=w800', 'larger Naver thumbnail');
  assert.ok(body.photos[2].thumb.endsWith('type=b150'), 'original thumbnail kept as fallback');
  assert.ok(!body.photos.some((p) => p.url.includes('src=b')), 'title without the place name left out');
});

test('no TourAPI match or outside Korea → Naver only; Naver refusal is reported', async () => {
  const none = await loadFunction(NEW_SECRETS, replies({ tour: false }));
  const a = await (await none.handler(post({ query: '카페 소소 서울', name: '카페 소소', lat: 37.5, lng: 126.9 }))).json();
  assert.equal(a.tour, 'no match');
  assert.deepEqual(a.photos.map((p) => p.source), ['naver']);
  const abroad = await (await none.handler(post({ query: 'Cafe Soso Tokyo', name: '카페 소소', lat: 35.68, lng: 139.76 }))).json();
  assert.equal(abroad.tour, 'skipped');

  const refused = await loadFunction({ ...NEW_SECRETS, TOUR_API_KEY: '' }, replies({ naverStatus: 401 }));
  const r = await refused.handler(post({ query: '카페 소소 서울', name: '카페 소소' }));
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'naver search failed', provider: 'naver', status: 401, tour: 'off' });
});

test('without Naver keys the Kakao search still works (with TourAPI on top)', async () => {
  const { handler } = await loadFunction({ ...SECRETS, TOUR_API_KEY: 'tk' }, replies());
  const body = await (await handler(post({ query: '카페 소소 서울 마포구', name: '카페 소소', lat: 37.556, lng: 126.91 }))).json();
  assert.equal(body.search, 'kakao');
  assert.equal(body.photos[0].source, 'tour');
  assert.ok(body.photos.some((p) => p.url === 'https://img/real-1.jpg'));
  const health = await (await handler(new Request('https://x/f', { method: 'GET' }))).json();
  assert.equal(health.webSearch, 'kakao');
  assert.equal(health.tourApiKeySet, true);
});

test('TourAPI helpers', async () => {
  const { mod } = await loadFunction(NEW_SECRETS, replies());
  assert.ok(mod.tourMatches({ title: '카페 소소(망원)', dist: '35' }, '카페 소소'));
  assert.ok(!mod.tourMatches({ title: '망원시장', dist: '300' }, '카페 소소'));
  assert.ok(!mod.tourMatches({ title: '카페 소소', dist: '900' }, '카페 소소'), 'too far');
  assert.equal(mod.naverLarger('http://search.pstatic.net/common/?src=x'), 'https://search.pstatic.net/common/?src=x&type=w800');
});
