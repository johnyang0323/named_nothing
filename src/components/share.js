/**
 * Invite links and copying.
 *   …/named_nothing/?friend=닉네임%2312345   → become friends
 *   …/named_nothing/?group=ABCD2345          → join a group room
 * The link is remembered until the person has signed in, then confirmed
 * on the 함께 screen.
 */
const PENDING_KEY = 'plannish-invite';

export function inviteLink({ friend = null, group = null }) {
  const url = new URL(window.location.pathname, window.location.origin);
  if (friend) url.searchParams.set('friend', friend);
  if (group) url.searchParams.set('group', group);
  return url.toString();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Read ?friend= / ?group= once, remember it, and clean the address bar. */
export function captureInvite() {
  const url = new URL(window.location.href);
  const friend = url.searchParams.get('friend');
  const group = url.searchParams.get('group');
  if (!friend && !group) return null;
  const invite = { friend: friend ? friend.slice(0, 30) : null, group: group ? group.slice(0, 12).toUpperCase() : null };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(invite));
  } catch {
    /* ignore */
  }
  url.searchParams.delete('friend');
  url.searchParams.delete('group');
  window.history.replaceState(null, '', `${url.pathname}${url.search}#together`);
  return invite;
}

export function pendingInvite() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
