/**
 * Running inside the Android / iOS app (Capacitor) instead of a browser.
 * The app serves its files from https://localhost, so anything meant for
 * other people (invite links) must point at the public web address instead.
 */
export const PUBLIC_APP_URL = (import.meta.env?.VITE_PUBLIC_APP_URL || 'https://johnyang0323.github.io/named_nothing/').trim();

export function isNativeApp(win = globalThis.window) {
  try {
    return Boolean(win?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Base address for links shared with other people. */
export function shareBase(win = globalThis.window) {
  if (isNativeApp(win)) return PUBLIC_APP_URL;
  return new URL(win.location.pathname, win.location.origin).toString();
}
