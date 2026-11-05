// Supabase Edge Function: delete-account
// Permanently deletes the signed-in person's account. Their days, taste and
// photo votes go with it (those tables reference auth.users ON DELETE CASCADE);
// error reports keep no link to them (ON DELETE SET NULL).
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

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

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
  const user = (await who.json()) as { id?: string };
  if (!user?.id) return json({ error: 'invalid session' }, 401, headers);

  // 2) delete exactly that user (cascades to their rows)
  const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: adminHeaders() });
  if (!del.ok) return json({ error: 'delete failed', status: del.status }, 502, headers);
  return json({ deleted: true }, 200, headers);
});
