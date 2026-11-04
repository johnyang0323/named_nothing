import { SUPABASE_URL, SUPABASE_ANON_KEY, isBackendConfigured } from './config.js';

let clientPromise = null;

/**
 * The Supabase client, loaded on demand so the app stays small for anyone
 * not using accounts. Resolves null when the backend is not configured.
 */
export function getSupabase() {
  if (!isBackendConfigured()) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // PKCE returns ?code=… instead of tokens in the #hash our router uses
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          storageKey: 'plannish-auth',
        },
      }),
    );
  }
  return clientPromise;
}
