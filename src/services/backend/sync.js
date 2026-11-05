/**
 * Keeps today's day in the signed-in account, and lists earlier days.
 *
 * Local-first: the app always reads and writes localStorage. When signed
 * in, changes are pushed (debounced) to the `days` table, and on sign-in
 * the newer of local/remote wins by `updatedAt`. Earlier days that exist
 * only in this browser are uploaded once, so nothing is lost.
 */
import { getSupabase } from './client.js';
import { getUser, onAuthChange } from './auth.js';

const PUSH_DELAY_MS = 1200;
const OWNER_KEY = 'plannish-owner';

function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(id) {
  try {
    if (id) localStorage.setItem(OWNER_KEY, id);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* ignore */
  }
}
const HISTORY_DAYS = 60;

export function createSync(store) {
  let status = 'off'; // off | syncing | saved | error
  let lastSavedAt = null;
  let timer = null;
  let unsubscribeStore = null;
  const listeners = new Set();

  const setStatus = (next) => {
    status = next;
    if (next === 'saved') lastSavedAt = new Date();
    listeners.forEach((fn) => fn());
  };

  async function upsert(day) {
    const supabase = await getSupabase();
    const user = getUser();
    if (!supabase || !user) return;
    const { error } = await supabase
      .from('days')
      .upsert({ user_id: user.id, date: day.date, data: day, updated_at: day.updatedAt || new Date().toISOString() }, { onConflict: 'user_id,date' });
    if (error) throw error;
  }

  async function pushToday() {
    clearTimeout(timer);
    timer = null;
    setStatus('syncing');
    try {
      await upsert(store.getState());
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  const schedulePush = () => {
    // only days someone actually changed (an emptied/sign-out day has no updatedAt)
    if (!getUser() || !store.getState().updatedAt) return;
    clearTimeout(timer);
    timer = setTimeout(pushToday, PUSH_DELAY_MS);
  };

  async function reconcile() {
    const supabase = await getSupabase();
    const user = getUser();
    if (!supabase || !user) return;
    // this browser's days belong to someone else → keep them out of this account
    const owner = readOwner();
    if (owner && owner !== user.id) store.actions.forgetDevice();
    writeOwner(user.id);

    setStatus('syncing');
    try {
      const { data: rows, error } = await supabase.from('days').select('date, updated_at').eq('user_id', user.id).order('date', { ascending: false }).limit(366);
      if (error) throw error;
      const remoteDates = new Map(rows.map((r) => [r.date, r.updated_at]));

      // earlier days only in this browser → upload once
      const missing = store.listLocalDays().filter((d) => !remoteDates.has(d.date));
      for (const day of missing) await upsert(day);

      // today: newer copy wins
      const local = store.getState();
      if (remoteDates.has(local.date)) {
        const { data: remote, error: e2 } = await supabase.from('days').select('data').eq('user_id', user.id).eq('date', local.date).maybeSingle();
        if (e2) throw e2;
        const remoteDay = remote?.data;
        const remoteTime = Date.parse(remoteDay?.updatedAt || 0) || 0;
        const localTime = Date.parse(local.updatedAt || 0) || 0;
        if (remoteDay && remoteTime > localTime) store.actions.replaceDay(remoteDay);
        else if (localTime > remoteTime) await upsert(local);
      } else if (local.updatedAt) {
        await upsert(local);
      }
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  function start() {
    if (!unsubscribeStore) unsubscribeStore = store.subscribe(schedulePush);
    onAuthChange((user) => {
      if (user) reconcile();
      else {
        clearTimeout(timer);
        setStatus('off');
      }
    });
    if (getUser()) reconcile();
  }

  /** Earlier days: account copies when signed in, plus whatever is only in this browser. */
  async function history() {
    const byDate = new Map(store.listLocalDays().map((d) => [d.date, d]));
    const supabase = await getSupabase();
    const user = getUser();
    if (supabase && user) {
      const { data, error } = await supabase
        .from('days')
        .select('date, data')
        .eq('user_id', user.id)
        .neq('date', store.dateKey)
        .order('date', { ascending: false })
        .limit(HISTORY_DAYS);
      if (!error) data.forEach((row) => row.data && byDate.set(row.date, row.data));
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, HISTORY_DAYS);
  }

  /** Push pending changes now (before sign-out). Never throws. */
  async function flush() {
    if (!getUser() || !store.getState().updatedAt) return;
    await pushToday();
  }

  return {
    start,
    history,
    flush,
    forgetOwner: () => writeOwner(null),
    retry: pushToday,
    getStatus: () => ({ status, lastSavedAt }),
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
