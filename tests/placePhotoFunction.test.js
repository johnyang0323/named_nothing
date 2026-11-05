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
  { title: '망원동 맛집 리스트 (소소 근처)', url: 'https://blog.naver.com/eater/111', blogname: 'e' },
];
const kakaoOk = (url) => ({ body: { documents: url.includes('/search/blog') ? BLOGS : IMAGES } });
const SECRETS = { KAKAO_REST_API_KEY: 'k', ALLOWED_ORIGINS: SITE };

test('photos from posts whose title names the place come first; shops/news/odd shapes sink', async () => {
  const { handler } = await loadFunction(SECRETS, kakaoOk);
  const res = await handler(post({ query: '카페 소소 서울 마포구', name: '카페 소소' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const order = body.photos.map((p) => p.url.replace('https://img/', '').replace('.jpg', ''));
  assert.deepEqual(order.slice(0, 2), ['real-1', 'real-2']);
  assert.ok(body.photos[0].relevant && body.photos[1].relevant && !body.photos[2].relevant);
  assert.ok(!order.includes('tiny') && !order.includes('news'));
  assert.ok(order.indexOf('shop') > order.indexOf('food-closeup'));
  assert.equal(body.relevantPosts, 2, 'a title that only mentions part of the name does not count');
  assert.equal(body.photo.url, body.photos[0].url, 'older apps still get `photo`');
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

  const noKey = await loadFunction({ ALLOWED_ORIGINS: SITE }, kakaoOk);
  assert.equal((await noKey.handler(post({ query: '테스트 장소' }))).status, 500);

  const rejected = await loadFunction(SECRETS, () => ({ status: 401 }));
  const r = await rejected.handler(post({ query: '테스트 장소' }));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).status, 401);
});
