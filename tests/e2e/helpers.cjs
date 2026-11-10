const { ROOT } = require('./env.cjs');
/** Shared stand-ins for browser tests: Supabase (auth + days + photo function) and Kakao. */
const fs = require('fs');
const FAKE_KAKAO = fs.readFileSync(__dirname + '/fake-kakao.js', 'utf8');
const PNG = fs.readFileSync(ROOT + '/public/icons/icon-512.png');
const SB = 'https://test.supabase.co';

function createBackend({ photos, photoFunction = null, confirmEmail = false, mailDown = false, noMultiShare = false } = {}) {
  const resent = [];
  const db = new Map();
  const votes = new Map(); // place|url|user -> vote
  const prefs = new Map(); // user -> { taste, updated_at }
  const errorsLog = []; // client_errors rows
  const resetCodes = new Map(); // email -> code
  const deleted = [];
  const social = {
    profiles: new Map(), // id -> profile
    friendships: [], // { user_id, friend_id }
    blocks: [], // { blocker_id, blocked_id }
    groups: new Map(), // id -> group
    members: [], // { group_id, user_id }
    entries: new Map(), // id -> entry
    comments: new Map(), // id -> comment
    reports: [],
    files: new Map(), // 'bucket/path' -> Buffer
    // social_plus.sql
    requests: [], // { from_id, to_id, created_at }
    invites: new Map(), // token -> owner_id
    notes: [], // notifications
    reactions: [], // { entry_id, user_id, emoji }
    cards: [], // shared_cards
    // together.sql
    tdays: new Map(), // id -> { id, owner_id, title, created_at }
    tmembers: [], // { day_id, user_id }
    titems: [], // { id, day_id, place_id, place, added_by, created_at }
    tvotes: [], // { item_id, user_id }
    noMultiShare, // multi_share.sql not run yet
  };
  const accounts = new Map(); // email -> { password, id }
  const log = [];
  const fnBodies = [];
  const userFor = (email, meta = {}) => ({ id: accounts.get(email)?.id || 'kakao-user', aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: meta, created_at: '2026-01-01T00:00:00Z' });
  const session = (user) => ({ access_token: 'at-' + user.id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt', user });
  const kakaoUser = { id: 'user-1', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'kakao' }, user_metadata: { name: '산책하는 사람', avatar_url: 'http://k.kakaocdn.net/dn/profile.png' }, created_at: '2026-01-01T00:00:00Z' };
  const logouts = [];
  const photoReply = photos || [{ url: 'https://photos.example.com/a.png', thumb: null, site: '예시 블로그', link: 'https://blog.example.com/post', relevant: true }];

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
      // like Supabase with custom SMTP that can't send: the sign-up fails
      if (mailDown) return json({ code: 500, error_code: 'unexpected_failure', msg: 'Error sending confirmation email' }, 500);
      accounts.set(b.email, { password: b.password, id: b.email === 'me@test.com' ? 'user-1' : 'user-' + (accounts.size + 1), confirmed: !confirmEmail });
      // "Confirm email" on: a user comes back but no session until the link is opened
      if (confirmEmail) return json({ ...userFor(b.email), identities: [{ id: 'x' }] });
      return json(session(userFor(b.email)));
    }
    if (path === '/auth/v1/resend') {
      const b = req.postDataJSON();
      if (resent.filter((r) => r === b.email).length >= 1 && resent.at(-1) === b.email && Date.now() - (resent.lastAt || 0) < 1500) {
        return json({ code: 429, msg: 'For security purposes, you can only request this after 60 seconds.' }, 429);
      }
      resent.push(b.email);
      resent.lastAt = Date.now();
      return json({});
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = req.postDataJSON();
      const acct = accounts.get(b.email);
      if (acct && acct.password === b.password && acct.confirmed === false) return json({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400);
      return acct?.password === b.password ? json(session(userFor(b.email))) : json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    }
    if (path === '/auth/v1/recover') {
      const b = req.postDataJSON();
      if (accounts.has(b.email)) resetCodes.set(b.email, '654321');
      return json({}); // same answer either way
    }
    if (path === '/auth/v1/verify') {
      const b = req.postDataJSON();
      if (b.type === 'recovery' && resetCodes.get(b.email) === b.token) {
        resetCodes.delete(b.email);
        return json(session(userFor(b.email)));
      }
      return json({ code: 403, msg: 'Token has expired or is invalid' }, 403);
    }
    if (path === '/auth/v1/user' && req.method() === 'PUT') {
      const b = req.postDataJSON();
      const id = (req.headers().authorization || '').replace('Bearer at-', '');
      const email = [...accounts].find(([, a]) => a.id === id)?.[0];
      if (email && b.password) accounts.get(email).password = b.password;
      return json(userFor(email));
    }
    if (path === '/auth/v1/token') return json(session(kakaoUser)); // PKCE after Kakao
    if (path === '/auth/v1/authorize') return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_to')}?code=kakao-code` } });
    if (path === '/auth/v1/logout') {
      logouts.push(url.searchParams.get('scope') || 'global');
      return route.fulfill({ status: 204, headers: cors });
    }
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
    const handled = handleSocial(route, req, url, path, userId, json, cors, social);
    if (handled) return handled;
    // 서버 설정 점검 reads zero rows from these
    if ((path === '/rest/v1/client_errors' || path === '/rest/v1/photo_votes') && req.method() === 'GET') return json([]);
    if (path === '/rest/v1/client_errors' && req.method() === 'POST') {
      [].concat(req.postDataJSON()).forEach((r) => errorsLog.push(r));
      return route.fulfill({ status: 201, headers: cors, body: '' });
    }
    if (path === '/functions/v1/delete-account') {
      if (!(req.headers().authorization || '').startsWith('Bearer at-')) return json({ error: 'not signed in' }, 401);
      const id = (req.headers().authorization || '').replace('Bearer at-', '');
      const email = [...accounts].find(([, a]) => a.id === id)?.[0];
      if (!email && id !== 'kakao-user' && id !== 'user-1') return json({ error: 'invalid session' }, 401);
      if (email) accounts.delete(email);
      [...db.keys()].filter((k) => k.startsWith(id + '|')).forEach((k) => db.delete(k));
      prefs.delete(id);
      purgeSocialUser(social, id);
      [...votes.keys()].filter((k) => k.endsWith('|' + id)).forEach((k) => votes.delete(k));
      deleted.push(id);
      return json({ deleted: true });
    }
    if (path.startsWith('/functions/v1/')) {
      // like Supabase: an unknown function name is a 404 without CORS headers
      if (photoFunction && path !== '/functions/v1/' + photoFunction) return route.fulfill({ status: 404, body: 'Requested function was not found' });
      const body = req.postDataJSON();
      fnBodies.push(body);
      return json({ photo: photoReply[0], photos: photoReply });
    }
    return json({ error: 'unmocked ' + path }, 404);
  }
  return { db, accounts, log, logouts, resent, handle, votes, fnBodies, prefs, errorsLog, resetCodes, deleted, social };
}

// ───────────── social stand-in (mirrors the rules in supabase/social.sql) ─────────────
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function parseFilters(url) {
  const filters = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    filters.push((row) => {
      const cell = row[k] == null ? '' : String(row[k]);
      if (op === 'eq') return cell === val;
      if (op === 'neq') return cell !== val;
      if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(cell);
      if (op === 'is') return val === 'null' ? row[k] == null : cell === val;
      if (op === 'cs') return val.replace(/^\{|\}$/g, '').split(',').filter(Boolean).every((x) => (row[k] || []).includes(x.replace(/^"|"$/g, '')));
      return true;
    });
  }
  return (row) => filters.every((f) => f(row));
}

function applyOrder(rows, url) {
  const order = url.searchParams.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
  }
  const limit = Number(url.searchParams.get('limit'));
  return limit ? rows.slice(0, limit) : rows;
}

const blocked = (S, a, b) => S.blocks.some((x) => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a));
const isFriend = (S, a, b) => S.friendships.some((f) => f.user_id === a && f.friend_id === b);
const isMember = (S, g, u) => S.members.some((m) => m.group_id === g && m.user_id === u);
const sharesGroup = (S, a, b) => S.members.some((x) => x.user_id === a && S.members.some((y) => y.group_id === x.group_id && y.user_id === b));
const hasRequest = (S, a, b) => S.requests.some((r) => (r.from_id === a && r.to_id === b) || (r.from_id === b && r.to_id === a));
const makeFriends = (S, a, b) => {
  if (!isFriend(S, a, b)) S.friendships.push({ user_id: a, friend_id: b, created_at: new Date().toISOString() }, { user_id: b, friend_id: a, created_at: new Date().toISOString() });
  S.requests = S.requests.filter((r) => !((r.from_id === a && r.to_id === b) || (r.from_id === b && r.to_id === a)));
};
const notify = (S, user, actor, kind, entry = null, data = {}) => {
  if (!user || user === actor || blocked(S, user, actor)) return;
  S.notes.push({ id: uid(), user_id: user, actor_id: actor, kind, entry_id: entry, data, read_at: null, created_at: new Date(Date.now() + S.notes.length).toISOString() });
};
const inDay = (S, d, u) => S.tmembers.some((m) => m.day_id === d && m.user_id === u);
const sharesDay = (S, a, b) => S.tmembers.some((x) => x.user_id === a && inDay(S, x.day_id, b));
// multi_share.sql: share_friends + group_ids (old visibility/group_id kept in step)
const audience = (e) => ({ friends: e.share_friends ?? e.visibility === 'friends', groups: e.group_ids ?? (e.visibility === 'group' && e.group_id ? [e.group_id] : []) });
const canRead = (S, e, me) => {
  if (e.user_id === me) return true;
  if (blocked(S, e.user_id, me)) return false;
  const a = audience(e);
  return (a.friends && isFriend(S, me, e.user_id)) || a.groups.some((g) => isMember(S, g, me));
};
/** Mirrors the journal_entries_audience trigger. Returns an error string or null. */
function normalizeEntry(S, row, old = null) {
  if (S.noMultiShare) {
    if ('share_friends' in row || 'group_ids' in row) return 'PGRST204';
    if (row.visibility === 'group' && !(row.group_id && isMember(S, row.group_id, row.user_id ?? old?.user_id))) return 'rls';
    return null;
  }
  const legacyChange = old
    ? row.share_friends === undefined && row.group_ids === undefined && (row.visibility !== undefined || row.group_id)
    : row.share_friends === undefined && row.group_ids === undefined;
  if (legacyChange) {
    const vis = row.visibility ?? old?.visibility ?? 'private';
    const gid = row.group_id !== undefined ? row.group_id : old?.group_id;
    row.share_friends = vis === 'friends';
    row.group_ids = vis === 'group' && gid ? [gid] : [];
  }
  const merged = { ...(old || {}), ...row };
  const groups = [...new Set(merged.group_ids || [])].filter((g) => S.groups.has(g));
  for (const g of groups) if (!(old?.group_ids || []).includes(g) && !isMember(S, g, merged.user_id)) return 'rls';
  row.group_ids = groups;
  row.share_friends = Boolean(merged.share_friends);
  row.visibility = groups.length && !row.share_friends ? 'group' : row.share_friends ? 'friends' : 'private';
  row.group_id = groups[0] || null;
  return null;
}
const ownsRoomOf = (S, e, me) => audience(e).groups.some((g) => S.groups.get(g)?.owner_id === me);

function purgeSocialUser(S, id) {
  S.profiles.delete(id);
  S.friendships = S.friendships.filter((f) => f.user_id !== id && f.friend_id !== id);
  S.blocks = S.blocks.filter((b) => b.blocker_id !== id && b.blocked_id !== id);
  [...S.groups.values()].filter((g) => g.owner_id === id).forEach((g) => {
    S.groups.delete(g.id);
    S.members = S.members.filter((m) => m.group_id !== g.id);
    S.entries.forEach((e) => { if (e.group_ids) normalizeEntry(S, Object.assign(e, { group_ids: e.group_ids.filter((x) => x !== g.id) }), e); else if (e.group_id === g.id) e.group_id = null; });
  });
  S.members = S.members.filter((m) => m.user_id !== id);
  [...S.entries.values()].filter((e) => e.user_id === id).forEach((e) => S.entries.delete(e.id));
  [...S.comments.values()].filter((c) => c.user_id === id || !S.entries.has(c.entry_id)).forEach((c) => S.comments.delete(c.id));
  [...S.files.keys()].filter((k) => k.split('/')[1] === id).forEach((k) => S.files.delete(k));
}

/** Supabase's storage client sends files as multipart/form-data; keep just the file. */
function uploadedFile(req) {
  const raw = req.postDataBuffer();
  const type = req.headers()['content-type'] || '';
  const boundary = type.match(/boundary=(.+)$/)?.[1];
  if (!boundary) return raw;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = raw.indexOf(delimiter);
  while (start !== -1) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = raw.subarray(start + delimiter.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, headerEnd).toString();
    if (/filename=|Content-Type:\s*image\//i.test(headers)) return part.subarray(headerEnd + 4, part.length - 2); // drop trailing CRLF
    start = next;
  }
  return raw;
}

function handleSocial(route, req, url, path, me, json, cors, S) {
  const method = req.method();
  const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (wantsObject ? (rows.length ? json(rows[0]) : json({ code: 'PGRST116' }, 406)) : json(rows));
  const body = () => { try { return req.postDataJSON(); } catch { return null; } };
  const err = (msg, status = 400) => json({ message: msg, code: 'P0001' }, status);

  // ── storage ──
  const storage = path.match(/^\/storage\/v1\/object\/(sign\/|public\/|list\/)?([^/]+)\/?(.*)$/);
  if (storage) {
    const [, kind, bucket, rest] = storage;
    if (kind === 'public/' && method === 'GET') {
      const file = S.files.get(`${bucket}/${decodeURIComponent(rest)}`);
      return file ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (kind === 'sign/' && method === 'POST' && !rest) {
      const { paths = [] } = body() || {};
      return json(paths.map((p) => {
        const readable = p.startsWith(me + '/') || [...S.entries.values()].some((e) => e.photo_paths.includes(p) && (canRead(S, e, me) || (e.share_place_photos && e.place_id && !blocked(S, me, e.user_id))));
        return readable && S.files.has(`${bucket}/${p}`) ? { path: p, signedURL: `/object/sign/${bucket}/${p}?token=t-${me}`, error: null } : { path: p, signedURL: null, error: 'not allowed' };
      }));
    }
    if (kind === 'sign/' && method === 'GET') {
      const file = S.files.get(`${bucket}/${decodeURIComponent(rest)}`);
      return file ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (!kind && method === 'POST') {
      const p = decodeURIComponent(rest);
      if (!me || p.split('/')[0] !== me) return json({ message: 'not allowed' }, 403);
      S.files.set(`${bucket}/${p}`, uploadedFile(req));
      return json({ Key: `${bucket}/${p}`, Id: uid() });
    }
    if (!kind && method === 'DELETE') {
      const { prefixes = [] } = body() || {};
      prefixes.filter((p) => p.split('/')[0] === me).forEach((p) => S.files.delete(`${bucket}/${p}`));
      return json([]);
    }
    return null;
  }

  if (!path.startsWith('/rest/v1/')) return null;
  const table = path.slice('/rest/v1/'.length);
  const where = parseFilters(url);
  if (S.noMultiShare && table === 'journal_entries' && (url.searchParams.has('group_ids') || url.searchParams.has('share_friends') || /group_ids/.test(url.searchParams.get('select') || ''))) return json({ code: '42703', message: 'column journal_entries.group_ids does not exist' }, 400);
  const profileOf = (id) => S.profiles.get(id) || null;

  // ── RPCs ──
  if (table.startsWith('rpc/')) {
    const b = body() || {};
    switch (table.slice(4)) {
      case 'upsert_profile': {
        const name = String(b.p_nickname || '').trim();
        if (!name || name.length > 20 || name.includes('#')) return err('invalid nickname');
        const old = profileOf(me);
        let tag = old?.tag;
        while (!tag || [...S.profiles.values()].some((p) => p.nickname === name && p.tag === tag && p.user_id !== me)) tag = String(10000 + Math.floor(Math.random() * 90000));
        const avatar = b.p_clear_avatar ? null : b.p_avatar_path || old?.avatar_path || null;
        const prof = { user_id: me, nickname: name, tag, avatar_path: avatar, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
        S.profiles.set(me, prof);
        return json(prof);
      }
      case 'add_friend': {
        const them = [...S.profiles.values()].find((p) => p.nickname === b.p_nickname && p.tag === b.p_tag);
        if (!them || blocked(S, me, them.user_id)) return err('not found');
        if (them.user_id === me) return err('self');
        if (!isFriend(S, me, them.user_id)) S.friendships.push({ user_id: me, friend_id: them.user_id, created_at: new Date().toISOString() }, { user_id: them.user_id, friend_id: me, created_at: new Date().toISOString() });
        return json(them);
      }
      case 'remove_friend':
        S.friendships = S.friendships.filter((f) => !((f.user_id === me && f.friend_id === b.p_friend) || (f.user_id === b.p_friend && f.friend_id === me)));
        return json(null);
      case 'block_user':
        S.blocks.push({ blocker_id: me, blocked_id: b.p_user });
        S.friendships = S.friendships.filter((f) => !((f.user_id === me && f.friend_id === b.p_user) || (f.user_id === b.p_user && f.friend_id === me)));
        return json(null);
      case 'create_group': {
        const g = { id: uid(), name: b.p_name.trim(), invite_code: Math.random().toString(36).slice(2, 10).toUpperCase().replace(/[01IO]/g, 'K').padEnd(8, 'Z').slice(0, 8), owner_id: me, created_at: new Date().toISOString() };
        S.groups.set(g.id, g);
        S.members.push({ group_id: g.id, user_id: me, joined_at: g.created_at });
        return json(g);
      }
      case 'join_group': {
        const g = [...S.groups.values()].find((x) => x.invite_code === String(b.p_code).toUpperCase());
        if (!g || blocked(S, me, g.owner_id)) return err('not found');
        if (!isMember(S, g.id, me)) S.members.push({ group_id: g.id, user_id: me, joined_at: new Date().toISOString() });
        return json(g);
      }
      case 'place_photos': {
        // mirrors supabase/place_photos.sql: shared entries for the place, paths + nickname only
        if (!me) return json([]);
        const rows = [...S.entries.values()]
          .filter((e) => e.share_place_photos && e.place_id === b.p_place_id && !blocked(S, me, e.user_id))
          .sort((x, y) => y.created_at.localeCompare(x.created_at))
          .flatMap((e) => e.photo_paths.map((path) => ({ path, nickname: profileOf(e.user_id)?.nickname || '사용자', entry_id: e.id, created_at: e.created_at })));
        return json(rows.slice(0, Math.min(Math.max(b.p_limit || 8, 1), 20)));
      }
      case 'request_friend': {
        const them = [...S.profiles.values()].find((p) => p.nickname === b.p_nickname && p.tag === b.p_tag);
        if (!them || blocked(S, me, them.user_id)) return err('not found');
        if (them.user_id === me) return err('self');
        if (isFriend(S, me, them.user_id)) return json('already');
        if (S.requests.some((r) => r.from_id === them.user_id && r.to_id === me)) {
          makeFriends(S, me, them.user_id);
          notify(S, them.user_id, me, 'friend_accepted');
          return json('accepted');
        }
        if (!S.requests.some((r) => r.from_id === me && r.to_id === them.user_id)) {
          S.requests.push({ from_id: me, to_id: them.user_id, created_at: new Date().toISOString() });
          notify(S, them.user_id, me, 'friend_request');
        }
        return json('requested');
      }
      case 'respond_friend': {
        if (!S.requests.some((r) => r.from_id === b.p_from && r.to_id === me)) return err('not found');
        if (b.p_accept) {
          makeFriends(S, me, b.p_from);
          notify(S, b.p_from, me, 'friend_accepted');
        } else S.requests = S.requests.filter((r) => !(r.from_id === b.p_from && r.to_id === me));
        S.notes = S.notes.filter((n) => !(n.user_id === me && n.actor_id === b.p_from && n.kind === 'friend_request'));
        return json(null);
      }
      case 'create_friend_invite': {
        const token = Array.from({ length: 20 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 57)]).join('');
        S.invites.set(token, me);
        return json(token);
      }
      case 'accept_friend_invite': {
        const owner = S.invites.get(b.p_token);
        if (!owner || blocked(S, me, owner)) return err('not found');
        if (owner === me) return err('self');
        makeFriends(S, me, owner);
        notify(S, owner, me, 'friend_accepted');
        return json(profileOf(owner));
      }
      case 'create_together_day': {
        const title = String(b.p_title || '').trim();
        if (!title || title.length > 30) return err('invalid title');
        const d = { id: uid(), owner_id: me, title, created_at: new Date().toISOString() };
        S.tdays.set(d.id, d);
        S.tmembers.push({ day_id: d.id, user_id: me });
        (b.p_members || []).slice(0, 10).forEach((m) => {
          if (m !== me && isFriend(S, me, m) && !blocked(S, me, m) && !inDay(S, d.id, m)) {
            S.tmembers.push({ day_id: d.id, user_id: m });
            notify(S, m, me, 'together_invite', null, { day_id: d.id, title });
          }
        });
        return json(d);
      }
      case 'remove_entry_from_group': {
        if (S.noMultiShare) return json({ code: 'PGRST202', message: 'Could not find the function public.remove_entry_from_group' }, 404);
        if (S.groups.get(b.p_group)?.owner_id !== me) return err('not the owner');
        const e = S.entries.get(b.p_entry);
        if (e) {
          e.group_ids = (e.group_ids || []).filter((g) => g !== b.p_group);
          normalizeEntry(S, e, { ...e, group_ids: [...e.group_ids, b.p_group] });
        }
        return json(null);
      }
      case 'friend_traces': {
        const rows = (b.p_place_ids || []).map((pid) => {
          const es = [...S.entries.values()].filter((e) => e.place_id === pid && e.user_id !== me && isFriend(S, me, e.user_id) && canRead(S, e, me));
          const ids = [...new Set(es.map((e) => e.user_id))];
          return { place_id: pid, friends: ids.length, nicknames: ids.map((id) => profileOf(id)?.nickname).filter(Boolean).slice(0, 3) };
        }).filter((r) => r.friends);
        return json(rows);
      }
      default:
        return null;
    }
  }

  const tables = {
    profiles: () => [...S.profiles.values()].filter((p) => p.user_id === me || ((isFriend(S, me, p.user_id) || sharesGroup(S, me, p.user_id) || hasRequest(S, me, p.user_id) || sharesDay(S, me, p.user_id)) && !blocked(S, me, p.user_id))),
    together_days: () => [...S.tdays.values()].filter((d) => inDay(S, d.id, me)),
    together_members: () => S.tmembers.filter((m) => inDay(S, m.day_id, me)),
    together_items: () => S.titems.filter((i) => inDay(S, i.day_id, me)),
    together_votes: () => S.tvotes.filter((v) => { const i = S.titems.find((x) => x.id === v.item_id); return i && inDay(S, i.day_id, me); }),
    friend_requests: () => S.requests.filter((r) => r.from_id === me || r.to_id === me),
    notifications: () => S.notes.filter((n) => n.user_id === me),
    reactions: () => S.reactions.filter((r) => S.entries.has(r.entry_id) && canRead(S, S.entries.get(r.entry_id), me) && !blocked(S, me, r.user_id)),
    shared_cards: () => S.cards.filter((c) => (c.from_id === me || c.to_id === me) && !blocked(S, c.from_id, c.to_id)),
    friendships: () => S.friendships.filter((f) => f.user_id === me),
    blocks: () => S.blocks.filter((x) => x.blocker_id === me),
    groups: () => [...S.groups.values()].filter((g) => isMember(S, g.id, me)),
    group_members: () => S.members.filter((m) => isMember(S, m.group_id, me)),
    journal_entries: () => [...S.entries.values()].filter((e) => canRead(S, e, me)),
    comments: () => [...S.comments.values()].filter((c) => S.entries.has(c.entry_id) && canRead(S, S.entries.get(c.entry_id), me) && !blocked(S, me, c.user_id)),
  };
  if (!(table in tables) && table !== 'reports') return null;

  if (method === 'HEAD') {
    const n = tables[table]().filter(where).length;
    return route.fulfill({ status: 200, headers: { ...cors, 'access-control-expose-headers': 'content-range', 'content-range': `*/${n}` }, body: '' });
  }
  if (method === 'GET') return reply(applyOrder(tables[table]().filter(where), url));

  if (method === 'POST') {
    const rows = [].concat(body());
    const out = [];
    for (const r of rows) {
      if (table === 'reports') { S.reports.push({ ...r, reporter_id: me }); continue; }
      if (table === 'journal_entries') {
        if (r.user_id !== me) return err('rls', 403);
        const bad = normalizeEntry(S, r);
        if (bad === 'PGRST204') return json({ code: 'PGRST204', message: "Could not find the 'group_ids' column of 'journal_entries' in the schema cache" }, 400);
        if (bad) return err('rls', 403);
        const row = { id: uid(), created_at: new Date(Date.now() + S.entries.size).toISOString(), photo_paths: [], ...r };
        S.entries.set(row.id, row);
        out.push(row);
      } else if (table === 'comments') {
        const e = S.entries.get(r.entry_id);
        if (!e || !canRead(S, e, me) || e.visibility === 'private') return err('rls', 403);
        const row = { id: uid(), created_at: new Date().toISOString(), ...r, user_id: me };
        S.comments.set(row.id, row);
        notify(S, e.user_id, me, 'comment', e.id, { body: String(r.body).slice(0, 80) });
        out.push(row);
      } else if (table === 'reactions') {
        const e = S.entries.get(r.entry_id);
        if (!e || !canRead(S, e, me) || r.user_id !== me) return err('rls', 403);
        if (!S.reactions.some((x) => x.entry_id === r.entry_id && x.user_id === me && x.emoji === r.emoji)) {
          S.reactions.push({ entry_id: r.entry_id, user_id: me, emoji: r.emoji });
          notify(S, e.user_id, me, 'reaction', e.id, { emoji: r.emoji });
        }
        out.push(r);
      } else if (table === 'together_items') {
        if (r.added_by !== me || !inDay(S, r.day_id, me)) return err('rls', 403);
        if (S.titems.some((i) => i.day_id === r.day_id && i.place_id === r.place_id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        const row = { id: uid(), created_at: new Date(Date.now() + S.titems.length).toISOString(), ...r };
        S.titems.push(row);
        S.tmembers.filter((m) => m.day_id === r.day_id && m.user_id !== me).forEach((m) => notify(S, m.user_id, me, 'together_item', null, { day_id: r.day_id, place_name: String(r.place?.name || '').slice(0, 80) }));
        out.push(row);
      } else if (table === 'together_votes') {
        const item = S.titems.find((i) => i.id === r.item_id);
        if (r.user_id !== me || !item || !inDay(S, item.day_id, me)) return err('rls', 403);
        if (!S.tvotes.some((v) => v.item_id === r.item_id && v.user_id === me)) S.tvotes.push({ item_id: r.item_id, user_id: me });
        out.push(r);
      } else if (table === 'shared_cards') {
        if (r.from_id !== me || !isFriend(S, me, r.to_id) || blocked(S, me, r.to_id)) return err('rls', 403);
        const row = { id: uid(), created_at: new Date().toISOString(), seen_at: null, note: null, ...r };
        S.cards.push(row);
        notify(S, r.to_id, me, 'card', null, { card_id: row.id, place_name: String(r.place?.name || '').slice(0, 80) });
        out.push(row);
      } else return err('not allowed', 403);
    }
    return (req.headers().prefer || '').includes('return=representation') ? reply(out) : route.fulfill({ status: 201, headers: cors, body: '' });
  }

  if (method === 'PATCH' && table === 'notifications') {
    const patch = body();
    const targets = S.notes.filter(where).filter((n) => n.user_id === me);
    targets.forEach((n) => Object.assign(n, { read_at: patch.read_at }));
    return reply(targets);
  }

  if (method === 'PATCH' && table === 'journal_entries') {
    const patch = body();
    const targets = [...S.entries.values()].filter(where).filter((e) => e.user_id === me);
    for (const e of targets) {
      const row = { ...patch };
      const bad = normalizeEntry(S, row, e);
      if (bad === 'PGRST204') return json({ code: 'PGRST204', message: "Could not find the 'group_ids' column of 'journal_entries' in the schema cache" }, 400);
      if (bad) return err('rls', 403);
      Object.assign(e, row);
    }
    return reply(targets);
  }

  if (method === 'DELETE') {
    if (table === 'journal_entries') {
      [...S.entries.values()].filter(where).filter((e) => e.user_id === me || (S.noMultiShare && e.group_id && S.groups.get(e.group_id)?.owner_id === me)).forEach((e) => {
        S.entries.delete(e.id);
        [...S.comments.values()].filter((c) => c.entry_id === e.id).forEach((c) => S.comments.delete(c.id));
      });
    } else if (table === 'comments') {
      [...S.comments.values()].filter(where).filter((c) => {
        const e = S.entries.get(c.entry_id);
        return c.user_id === me || e?.user_id === me || (e && ownsRoomOf(S, e, me));
      }).forEach((c) => S.comments.delete(c.id));
    } else if (table === 'group_members') {
      S.members = S.members.filter((m) => !(where(m) && (m.user_id === me || S.groups.get(m.group_id)?.owner_id === me)));
    } else if (table === 'groups') {
      [...S.groups.values()].filter(where).filter((g) => g.owner_id === me).forEach((g) => {
        S.groups.delete(g.id);
        S.members = S.members.filter((m) => m.group_id !== g.id);
        S.entries.forEach((e) => { if (e.group_ids) normalizeEntry(S, Object.assign(e, { group_ids: e.group_ids.filter((x) => x !== g.id) }), e); else if (e.group_id === g.id) e.group_id = null; });
      });
    } else if (table === 'blocks') {
      S.blocks = S.blocks.filter((x) => !(where(x) && x.blocker_id === me));
    } else if (table === 'friend_requests') {
      S.requests = S.requests.filter((r) => !(where(r) && (r.from_id === me || r.to_id === me)));
    } else if (table === 'reactions') {
      S.reactions = S.reactions.filter((r) => !(where(r) && r.user_id === me));
    } else if (table === 'shared_cards') {
      S.cards = S.cards.filter((c) => !(where(c) && (c.from_id === me || c.to_id === me)));
    } else if (table === 'notifications') {
      S.notes = S.notes.filter((n) => !(where(n) && n.user_id === me));
    } else if (table === 'together_items') {
      const gone = S.titems.filter((i) => where(i) && (i.added_by === me || S.tdays.get(i.day_id)?.owner_id === me)).map((i) => i.id);
      S.titems = S.titems.filter((i) => !gone.includes(i.id));
      S.tvotes = S.tvotes.filter((v) => !gone.includes(v.item_id));
    } else if (table === 'together_votes') {
      S.tvotes = S.tvotes.filter((v) => !(where(v) && v.user_id === me));
    } else if (table === 'together_members') {
      S.tmembers = S.tmembers.filter((m) => !(where(m) && (m.user_id === me || S.tdays.get(m.day_id)?.owner_id === me)));
    } else if (table === 'together_days') {
      [...S.tdays.values()].filter((d) => where(d) && d.owner_id === me).forEach((d) => {
        S.tdays.delete(d.id);
        S.tmembers = S.tmembers.filter((m) => m.day_id !== d.id);
        const items = S.titems.filter((i) => i.day_id === d.id).map((i) => i.id);
        S.titems = S.titems.filter((i) => i.day_id !== d.id);
        S.tvotes = S.tvotes.filter((v) => !items.includes(v.item_id));
      });
    }
    return route.fulfill({ status: 204, headers: cors, body: '' });
  }
  return null;
}

async function wire(ctx, backend, { kakao = true, errors, weather = { weather_code: 1, temperature_2m: 18, precipitation: 0 } } = {}) {
  await ctx.route(SB + '/**', backend.handle);
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: weather }) }));
  if (kakao) await ctx.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_KAKAO }));
  await ctx.route('https://photos.example.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://k.kakaocdn.net/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  if (errors) {
    ctx.on('page', (p) => {
      p.on('pageerror', (e) => errors.push(String(e) + (process.env.E2E_STACK ? '\n' + e.stack : '')));
      p.on('console', (m) => m.type() === 'error' && !/40[01369]/.test(m.text()) && errors.push(m.text()));
    });
  }
}

/** Sign up (or in) through the welcome screen. */
async function signUp(page, email = 'me@test.com', password = 'correct-horse') {
  await page.waitForSelector('.welcome');
  await page.click('[data-action="auth-mode"]');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.fill('#auth-password2', password);
  await page.check('[data-input="auth-age"]');
  await page.click('[data-form="email-auth"] button[type=submit]');
  await page.waitForSelector('body:not(.is-gated) #home-title, body:not(.is-gated) h1');
  await page.waitForFunction(() => !document.body.classList.contains('is-gated'));
}

/**
 * From a recommendation card, go explore that place: "보관한 곳으로 가보기"
 * (keeps the card, opens 경로), then "여기서 둘러보기" on that stop.
 */
async function goHere(page) {
  const name = (await page.textContent('#discover-title')).trim();
  await page.click('[data-action="go-kept"]');
  await page.waitForSelector('.stop');
  const button = page.locator(`.stop:has(.stop-name:text-is("${name}")) [data-action="explore-from"]`);
  if (await button.count()) await button.first().click();
  else await page.evaluate(() => { window.location.hash = '#explore'; });
  await page.waitForSelector('#explore-title');
}

async function setArea(page, name = '망원동') {
  await page.fill('#area-query', name);
  await page.press('#area-query', 'Enter');
  await page.waitForSelector('.home-mood');
}

/** Poll until check() is truthy (for background saves); fails after `ms`. */
async function until(check, ms = 8000, label = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`ASSERT: timed out waiting for ${label}`);
}

module.exports = { createBackend, wire, signUp, setArea, goHere, until, SB };
