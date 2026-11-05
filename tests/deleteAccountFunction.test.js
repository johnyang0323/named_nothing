/**
 * supabase/functions/delete-account, run in Node with stand-ins for Deno
 * and Supabase Auth. The key promise: it deletes exactly the account whose
 * token was sent, and only after Supabase confirms that token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SITE = 'https://johnyang0323.github.io';
const compiled = transformSync(readFileSync(new URL('../supabase/functions/delete-account/index.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-secret', ALLOWED_ORIGINS: SITE };

async function load(env = ENV, { deleteStatus = 200, kakao = false, stillExists = false } = {}) {
  let handler;
  const calls = [];
  let deleted = false;
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url, init = {}) => {
    const headers = init.headers || {};
    calls.push({ url: String(url), method: init.method || 'GET', auth: headers.Authorization });
    if (String(url).endsWith('/auth/v1/user')) {
      const identities = kakao ? [{ provider: 'kakao', id: 'uuid-x', identity_data: { sub: '4321098765', provider_id: '4321098765' } }] : [{ provider: 'email', id: 'user-123' }];
      return headers.Authorization === 'Bearer good-token'
        ? new Response(JSON.stringify({ id: 'user-123', email: 'a@test.com', identities }), { status: 200 })
        : new Response('{"msg":"invalid JWT"}', { status: 401 });
    }
    if (String(url).includes('kapi.kakao.com/v1/user/unlink')) {
      calls.at(-1).body = init.body;
      return new Response('{"id":4321098765}', { status: 200 });
    }
    if (String(url).includes('/auth/v1/admin/users/')) {
      if ((init.method || 'GET') === 'DELETE') {
        calls.at(-1).body = init.body;
        if (deleteStatus < 300 && !stillExists) deleted = true;
        return new Response('{}', { status: deleteStatus });
      }
      return deleted ? new Response('{"msg":"User not found"}', { status: 404 }) : new Response('{"id":"user-123"}', { status: 200 });
    }
    if (String(url).includes('/storage/v1/object/list/')) {
      calls.at(-1).body = init.body;
      return new Response(JSON.stringify([{ name: 'a.jpg' }, { name: 'b.jpg' }]), { status: 200 });
    }
    if (String(url).includes('/storage/v1/object/')) {
      calls.at(-1).body = init.body;
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`);
  return { handler, calls };
}

const post = (token, origin = SITE) =>
  new Request('https://x/functions/v1/delete-account', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: '{}',
  });

test('deletes exactly the signed-in user, checked with their own token', async () => {
  const { handler, calls } = await load();
  const res = await handler(post('good-token'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true, kakaoUnlinked: null });
  const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/admin/users/'));
  assert.deepEqual(JSON.parse(del.body), { should_soft_delete: false }, 'permanent delete');
  assert.ok(calls.some((c) => c.method === 'GET' && c.url.includes('/admin/users/user-123')), 'checks it is gone');
  assert.equal(calls.some((c) => c.url.includes('kapi.kakao.com')), false, 'email account: no Kakao call');
  assert.equal(del.url, 'https://proj.supabase.co/auth/v1/admin/users/user-123');
  assert.equal(del.auth, 'Bearer service-secret', 'admin call uses the server-only key');
  assert.equal(calls[0].auth, 'Bearer good-token', 'identity comes from the caller’s token');
  const removed = calls.filter((c) => c.method === 'DELETE' && c.url.includes('/storage/'));
  assert.equal(removed.length, 2, 'photos removed from both buckets');
  assert.deepEqual(JSON.parse(removed[1].body).prefixes, ['user-123/a.jpg', 'user-123/b.jpg'], 'only their own folder');
  assert.ok(calls.findIndex((c) => c.url.includes('/storage/')) < calls.findIndex((c) => c.url.includes('/admin/users/')), 'files first, then the account');
});

test('Kakao accounts are unlinked from Kakao (admin key), then deleted', async () => {
  const { handler, calls } = await load({ ...ENV, KAKAO_ADMIN_KEY: 'kakao-admin' }, { kakao: true });
  const res = await handler(post('good-token'));
  assert.deepEqual(await res.json(), { deleted: true, kakaoUnlinked: true });
  const unlink = calls.find((c) => c.url.includes('kapi.kakao.com/v1/user/unlink'));
  assert.equal(unlink.auth, 'KakaoAK kakao-admin');
  assert.equal(unlink.body, 'target_id_type=user_id&target_id=4321098765');

  const noKey = await load(ENV, { kakao: true });
  const r2 = await noKey.handler(post('good-token'));
  assert.deepEqual(await r2.json(), { deleted: true, kakaoUnlinked: false }, 'still deletes; reports it could not unlink');
});

test('a delete that did not really happen is reported as a failure', async () => {
  const { handler } = await load(ENV, { stillExists: true });
  const res = await handler(post('good-token'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /still exists/);
});

test('refuses without a valid session, from other sites, or without the service key', async () => {
  const a = await load();
  assert.equal((await a.handler(post(null))).status, 401);
  assert.equal((await a.handler(post('forged-token'))).status, 401);
  assert.equal(a.calls.some((c) => c.method === 'DELETE'), false, 'nothing deleted (no files, no account)');
  assert.equal((await a.handler(post('good-token', 'https://evil.example'))).status, 403);

  const noKey = await load({ SUPABASE_URL: 'https://proj.supabase.co', ALLOWED_ORIGINS: SITE });
  assert.equal((await noKey.handler(post('good-token'))).status, 500);
  const fallback = await load({ SUPABASE_URL: 'https://proj.supabase.co', SERVICE_ROLE_KEY: 'manual', ALLOWED_ORIGINS: SITE });
  assert.equal((await fallback.handler(post('good-token'))).status, 200, 'manually added SERVICE_ROLE_KEY works too');

  const failing = await load(ENV, { deleteStatus: 500 });
  assert.equal((await failing.handler(post('good-token'))).status, 502);
});

test('health check shows setup without revealing the key', async () => {
  const { handler } = await load();
  const body = await (await handler(new Request('https://x/f', { method: 'GET' }))).json();
  assert.equal(body.deployed, true);
  assert.equal(body.serviceKeySet, true);
  assert.equal(JSON.stringify(body).includes('service-secret'), false);
  assert.equal(body.kakaoAdminKeySet, false);
});
