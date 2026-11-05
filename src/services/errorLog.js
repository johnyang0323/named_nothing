/**
 * Report errors that happen on people's devices to the client_errors table
 * (supabase/client_errors.sql). Only the error itself is sent — never notes,
 * places or locations. Each distinct message is sent once, at most 10 per
 * visit. Read them in the Supabase dashboard.
 */
import { getSupabase } from './backend/client.js';
import { isBackendConfigured } from './backend/config.js';

const MAX_PER_VISIT = 10;
const sent = new Set();
// eslint-disable-next-line no-undef
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** Cross-origin script noise and network blips we can't act on. */
const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i, /Load failed/i, /Failed to fetch/i, /NetworkError/i, /AbortError/i];

export function reportError(error, { screen = '' } = {}) {
  if (!isBackendConfigured()) return;
  const message = String(error?.message || error || '').trim().slice(0, 500);
  if (!message || IGNORED.some((re) => re.test(message))) return;
  if (sent.has(message) || sent.size >= MAX_PER_VISIT) return;
  sent.add(message);
  const row = {
    message,
    stack: typeof error?.stack === 'string' ? error.stack.slice(0, 4000) : null,
    screen: String(screen).slice(0, 40),
    app_version: String(APP_VERSION).slice(0, 40),
    user_agent: (navigator.userAgent || '').slice(0, 300),
  };
  getSupabase()
    .then((supabase) => supabase?.from('client_errors').insert(row))
    .catch(() => {
      /* reporting must never cause more errors */
    });
}

/** Catch everything that slips through: thrown errors and rejected promises. */
export function installErrorReporting(getScreen) {
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) return; // a failed <img>/<script> load, not a code error
    reportError(event.error || event.message, { screen: getScreen() });
  });
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason, { screen: getScreen() }));
}
