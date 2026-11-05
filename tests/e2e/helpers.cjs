const { ROOT } = require('./env.cjs');
/** Shared stand-ins for browser tests: Supabase (auth + days + photo function) and Kakao. */
const fs = require('fs');
const FAKE_KAKAO = fs.readFileSync(__dirname + '/fake-kakao.js', 'utf8');
const PNG = fs.readFileSync(ROOT + '/public/icons/icon-512.png');
const SB = 'https://test.supabase.co';

function createBackend({ photos } = {}) {
  const db = new Map();
  const votes = new Map(); // place|url|user -> vote
  const prefs = new Map(); // user -> { taste, updated_at }
  const accounts = new Map(); // email -> { password, id }
  const log = [];
  const fnBodies = [];
  const userFor = (email, meta = {}) => ({ id: accounts.get(email)?.id || 'kakao-user', aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: meta, created_at: '2026-01-01T00:00:00Z' });
  const session = (user) => ({ access_token: 'at-' + user.id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt', user });
  const kakaoUser = { id: 'user-1', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'kakao' }, user_metadata: { name: '산책하는 사람', avatar_url: 'http://k.kakaocdn.net/dn/profile.png' }, created_at: '2026-01-01T00:00:00Z' };
  const photoReply = photos || [{ url: 'https://photos.example.com/a.png', thumb: null, site: '예시 블로그', link: 'https://blog.example.com/post' }];

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    log.push(`${req.method()} ${path}`);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    if (path === '/auth/v1/signup') {
      const b = req.postDataJSON();
      if (accounts.has(b.email)) return json({ ...userFor(b.email), identities: [] });
      accounts.set(b.email, { password: b.password, id: b.email === 'me@test.com' ? 'user-1' : 'user-' + (accounts.size + 1) });
      return json(session(userFor(b.email)));
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = req.postDataJSON();
      return accounts.get(b.email)?.password === b.password ? json(session(userFor(b.email))) : json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    }
    if (path === '/auth/v1/token') return json(session(kakaoUser)); // PKCE after Kakao
    if (path === '/auth/v1/authorize') return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_to')}?code=kakao-code` } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (path === '/rest/v1/days') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        (Array.isArray(body) ? body : [body]).forEach((r) => db.set(`${r.user_id}|${r.date}`, r));
        return route.fulfill({ status: 201, headers: cors, body: '' });
      }
      let rows = [...db.values()];
      for (const [k, v] of url.searchParams) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        const [op, ...rest] = v.split('.');
        const val = rest.join('.');
        rows = rows.filter((r) => (op === 'eq' ? String(r[k]) === val : op === 'neq' ? String(r[k]) !== val : true));
      }
      rows.sort((a, b) => b.date.localeCompare(a.date));
      const sel = (url.searchParams.get('select') || '*').split(',');
      rows = rows.map((r) => Object.fromEntries(sel.map((c) => [c, r[c]])));
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return rows.length ? json(rows[0]) : json({ code: 'PGRST116' }, 406);
      return json(rows);
    }
    const userId = (req.headers().authorization || '').replace('Bearer at-', '');
    if (path === '/rest/v1/photo_votes' && req.method() === 'POST') {
      if (!userId || userId.startsWith('Bearer')) return json({ message: 'not signed in' }, 401);
      const rows = [].concat(req.postDataJSON());
      rows.forEach((r) => votes.set(`${r.place_id}|${r.image_url}|${userId}`, r.vote));
      return route.fulfill({ status: 201, headers: cors, body: '' });
    }
    if (path === '/rest/v1/prefs') {
      if (req.method() === 'POST') {
        const row = [].concat(req.postDataJSON())[0];
        prefs.set(row.user_id, row);
        return route.fulfill({ status: 201, headers: cors, body: '' });
      }
      const uid = (url.searchParams.get('user_id') || '').replace('eq.', '');
      const row = prefs.get(uid);
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return row ? json({ taste: row.taste, updated_at: row.updated_at }) : json({ code: 'PGRST116' }, 406);
      return json(row ? [row] : []);
    }
    if (path === '/rest/v1/rpc/photo_scores') {
      const { ids } = req.postDataJSON();
      const sums = new Map();
      votes.forEach((v, key) => {
        const [place, url] = key.split('|');
        if (!ids.includes(place)) return;
        const k = place + '|' + url;
        sums.set(k, (sums.get(k) || 0) + v);
      });
      return json([...sums].map(([k, score]) => ({ place_id: k.split('|')[0], image_url: k.split('|')[1], score })));
    }
    if (path.startsWith('/functions/v1/')) {
      const body = req.postDataJSON();
      fnBodies.push(body);
      return json({ photo: photoReply[0], photos: photoReply });
    }
    return json({ error: 'unmocked ' + path }, 404);
  }
  return { db, accounts, log, handle, votes, fnBodies, prefs };
}

async function wire(ctx, backend, { kakao = true, errors, weather = { weather_code: 1, temperature_2m: 18, precipitation: 0 } } = {}) {
  await ctx.route(SB + '/**', backend.handle);
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: weather }) }));
  if (kakao) await ctx.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_KAKAO }));
  await ctx.route('https://photos.example.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://k.kakaocdn.net/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  if (errors) {
    ctx.on('page', (p) => {
      p.on('pageerror', (e) => errors.push(String(e)));
      p.on('console', (m) => m.type() === 'error' && !/40[0369]/.test(m.text()) && errors.push(m.text()));
    });
  }
}

/** Sign up (or in) through the welcome screen. */
async function signUp(page, email = 'me@test.com', password = 'correct-horse') {
  await page.waitForSelector('.welcome');
  await page.click('[data-action="auth-mode"]');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.click('[data-form="email-auth"] button[type=submit]');
  await page.waitForSelector('body:not(.is-gated) #home-title, body:not(.is-gated) h1');
  await page.waitForFunction(() => !document.body.classList.contains('is-gated'));
}

async function setArea(page, name = '망원동') {
  await page.fill('#area-query', name);
  await page.press('#area-query', 'Enter');
  await page.waitForSelector('.home-mood');
}

module.exports = { createBackend, wire, signUp, setArea, SB };
