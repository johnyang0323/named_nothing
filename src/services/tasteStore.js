/**
 * The person's learned taste: kept on this device, mirrored to their
 * account (supabase/prefs.sql) so it follows them across devices.
 * The newer copy wins; nothing breaks if the table isn't set up.
 */
import { applySignal, emptyTaste, sanitizeTaste } from './personalize.js';
import { getSupabase } from './backend/client.js';
import { getUser } from './backend/auth.js';

const KEY = 'plannish-taste';
const PUSH_DELAY_MS = 2000;

function read() {
  try {
    return sanitizeTaste(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return emptyTaste();
  }
}

function write(taste) {
  try {
    localStorage.setItem(KEY, JSON.stringify(taste));
  } catch {
    /* ignore */
  }
}

export function createTasteStore({ now = () => new Date() } = {}) {
  let taste = read();
  let timer = null;
  const listeners = new Set();

  const set = (next, { push = true } = {}) => {
    taste = next;
    write(taste);
    listeners.forEach((fn) => fn(taste));
    if (push) schedulePush();
  };

  async function pushNow() {
    clearTimeout(timer);
    const user = getUser();
    const supabase = await getSupabase();
    if (!user || !supabase) return;
    await supabase.from('prefs').upsert({ user_id: user.id, taste, updated_at: taste.updatedAt || now().toISOString() }, { onConflict: 'user_id' });
  }

  function schedulePush() {
    if (!getUser()) return;
    clearTimeout(timer);
    timer = setTimeout(() => pushNow().catch(() => {}), PUSH_DELAY_MS);
  }

  return {
    get: () => taste,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signal(event, place) {
      if (!taste.enabled) return;
      set(applySignal(taste, event, place, now()));
    },
    setEnabled(enabled) {
      set({ ...taste, enabled: Boolean(enabled), updatedAt: now().toISOString() });
    },
    reset() {
      const previous = taste;
      set({ ...emptyTaste(), enabled: taste.enabled, updatedAt: now().toISOString() });
      return previous;
    },
    restore(previous) {
      set({ ...sanitizeTaste(previous), updatedAt: now().toISOString() });
    },
    /** On sign-in: take the account's copy if it is newer, otherwise upload ours. */
    async pull() {
      const user = getUser();
      const supabase = await getSupabase();
      if (!user || !supabase) return;
      const { data, error } = await supabase.from('prefs').select('taste, updated_at').eq('user_id', user.id).maybeSingle();
      if (error) return; // table not set up yet: stay local
      const remote = data?.taste ? sanitizeTaste(data.taste) : null;
      const remoteTime = Date.parse(remote?.updatedAt || 0) || 0;
      const localTime = Date.parse(taste.updatedAt || 0) || 0;
      if (remote && remoteTime > localTime) set(remote, { push: false });
      else if (localTime > remoteTime) await pushNow().catch(() => {});
    },
    /** Sign-out / another account on this browser: forget it here (the account keeps it). */
    forgetDevice() {
      clearTimeout(timer);
      taste = emptyTaste();
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      listeners.forEach((fn) => fn(taste));
    },
    flush: () => pushNow().catch(() => {}),
  };
}
