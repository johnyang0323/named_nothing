// Supabase Edge Function: delete-account
// Permanently deletes the signed-in person's account. Their days, taste and
// photo votes go with it (those tables reference auth.users ON DELETE CASCADE);
// error reports keep no link to them (ON DELETE SET NULL).
//
// Their uploaded photos (storage buckets "avatars" and "journal", folder = user id)
// are removed first, since storage files are not part of the database cascade.
//
// The person proves who they are with their own login token (sent by the app
// as "Authorization: Bearer <access token>"); the function checks it with
// Supabase Auth and only then deletes that same user. Nobody can delete
// someone else's account.
//
// Settings: turn OFF "Verify JWT" for this function (the token is checked here,
// and projects with sb_publishable_ keys send a non-JWT apikey).
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase
// automatically. If the service role key is missing, add it yourself under
// Edge Functions → Secrets as SERVICE_ROLE_KEY (Project Settings → API keys →
// "service_role" / secret key). Never put it in the app.
//   ALLOWED_ORIGINS = https://johnyang0323.github.io   (comma-separated, optional)
//   KAKAO_ADMIN_KEY = Kakao Developers → 앱 키 → Admin 키 (optional but recommended)
//     Used only to "연결 끊기" (unlink) a Kakao-login account when it is deleted,
//     as Kakao's policy requires; otherwise the next Kakao login skips the consent
//     screen and silently creates a NEW account, which looks like the old one.

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const KAKAO_ADMIN_KEY = Deno.env.get('KAKAO_ADMIN_KEY') || '';

type Identity = { provider?: string; id?: string; identity_data?: { sub?: string; provider_id?: string } };

/** The person's Kakao member number, if they signed in with Kakao. */
export function kakaoUserId(user: { identities?: Identity[] }) {
  const identity = (user.identities || []).find((i) => i.provider === 'kakao');
  const id = identity?.identity_data?.provider_id || identity?.identity_data?.sub || identity?.id || '';
  return /^\d+$/.test(String(id)) ? String(id) : '';
}

const normalize = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || 'https://johnyang0323.github.io')
  .split(',')
  .map(normalize)
  .filter(Boolean);

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

const adminHeaders = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  // Opened in a browser tab: show setup status (never secrets).
  if (!origin && req.method === 'GET') {
    return json(
      {
        function: 'delete-account',
        deployed: true,
        serviceKeySet: Boolean(SERVICE_KEY),
        kakaoAdminKeySet: Boolean(KAKAO_ADMIN_KEY),
        allowedOrigins: ALLOWED,
        note: '이 화면이 보이면 함수는 배포됐고 Verify JWT도 꺼져 있어요.',
      },
      200,
      headers,
    );
  }

  if (!origin || !ALLOWED.includes(normalize(origin))) return json({ error: 'origin not allowed', origin, allowedOrigins: ALLOWED }, 403, headers);
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'service role key is not set' }, 500, headers);

  // 1) who is asking? (their own access token)
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'not signed in' }, 401, headers);
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: 'invalid session' }, 401, headers);
  const user = (await who.json()) as { id?: string; identities?: Identity[] };
  if (!user?.id) return json({ error: 'invalid session' }, 401, headers);

  // Kakao: disconnect the app from their Kakao account (Kakao requires this on
  // account deletion). A failure here must not block deleting their data.
  const kakaoId = kakaoUserId(user);
  let kakaoUnlinked: boolean | null = null;
  if (kakaoId) {
    if (KAKAO_ADMIN_KEY) {
      const unlink = await fetch('https://kapi.kakao.com/v1/user/unlink', {
        method: 'POST',
        headers: { Authorization: `KakaoAK ${KAKAO_ADMIN_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: `target_id_type=user_id&target_id=${encodeURIComponent(kakaoId)}`,
      }).catch(() => null);
      kakaoUnlinked = Boolean(unlink?.ok);
    } else {
      kakaoUnlinked = false;
    }
  }

  // 2) remove their uploaded photos (avatars/<id>/…, journal/<id>/…)
  for (const bucket of ['avatars', 'journal']) {
    const listed = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: user.id, limit: 1000, offset: 0 }),
    });
    if (!listed.ok) continue; // bucket not set up yet
    const files = ((await listed.json()) as { name: string }[]).map((f) => `${user.id}/${f.name}`);
    if (files.length) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: files }),
      });
    }
  }

  // 3) delete exactly that user, permanently (no soft delete); rows cascade
  const userUrl = `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`;
  const del = await fetch(userUrl, {
    method: 'DELETE',
    headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ should_soft_delete: false }),
  });
  if (!del.ok) return json({ error: 'delete failed', status: del.status }, 502, headers);

  // 4) make sure it is really gone before telling the app so
  const check = await fetch(userUrl, { headers: adminHeaders() });
  if (check.ok) return json({ error: 'user still exists after delete', status: check.status }, 502, headers);

  return json({ deleted: true, kakaoUnlinked }, 200, headers);
});
