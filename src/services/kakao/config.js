/**
 * Kakao Maps JavaScript key, read from VITE_KAKAO_MAP_KEY (.env).
 * This is the *JavaScript* key, which is public by design and protected by
 * the Web domains registered in Kakao Developers. Never put REST or Admin
 * keys here — they are secrets and must not ship to the browser.
 */
export const KAKAO_MAP_KEY = (import.meta.env?.VITE_KAKAO_MAP_KEY || '').trim();

export const isKakaoConfigured = () => KAKAO_MAP_KEY.length > 0;
