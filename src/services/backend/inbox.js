/**
 * The unread count for the 알림 inbox (badge on the 함께 tab). Refreshed on
 * sign-in, every minute while the app is open, and when it comes back to
 * the foreground.
 */
import { getUser } from './auth.js';
import { unreadCount } from './social.js';

let unread = 0;
let timer = null;
const listeners = new Set();

const set = (n) => {
  if (n === unread) return;
  unread = n;
  listeners.forEach((fn) => fn(unread));
};

export const getUnread = () => unread;

export function onUnread(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshUnread() {
  if (!getUser()) {
    set(0);
    return;
  }
  try {
    set(await unreadCount());
  } catch {
    /* offline or not set up: keep the last count */
  }
}

export function clearUnread() {
  set(0);
}

export function startInbox() {
  refreshUnread();
  if (timer) return;
  timer = setInterval(() => document.visibilityState === 'visible' && refreshUnread(), 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshUnread());
}
