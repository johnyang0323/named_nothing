/**
 * Supabase project settings, read from the build environment.
 * Both values are PUBLIC by design: the anon key only allows what the
 * database's Row Level Security policies allow (see supabase/schema.sql).
 * Never put the service_role key in the frontend.
 */
// Accept a pasted API URL too (…supabase.co/rest/v1/) and keep only the project origin.
export const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/(rest|auth|functions)\/v1\/?.*$/, '')
  .replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = (import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim();

export const isBackendConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
