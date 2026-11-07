/**
 * Which map provider to use: Kakao inside Korea, Google abroad (when a
 * Google key is set). Screens call these instead of a provider directly.
 */
import { isKakaoConfigured } from './kakao/config.js';
import { isGoogleConfigured } from './google/config.js';
import { inKorea } from './google/mapper.js';

export { inKorea };
export const isMapsConfigured = () => isKakaoConfigured() || isGoogleConfigured();
export const canGoAbroad = () => isGoogleConfigured();

/** Neighborhood name → area. A Korean address goes straight to Kakao; anything Google places abroad goes to Google. */
export async function searchArea(rawQuery) {
  const query = String(rawQuery || '').trim();
  const kakao = () => import('./kakao/areaSearch.js').then((m) => m.searchArea(query));
  if (!query || !isGoogleConfigured()) return kakao();
  const google = await import('./google/areaSearch.js');
  if (isKakaoConfigured()) {
    const { addressCenter } = await import('./kakao/areaSearch.js');
    if (await addressCenter(query).catch(() => null)) return kakao();
  }
  const center = await google.findCenterGoogle(query).catch(() => null);
  if (center && !inKorea(center)) return google.searchAreaGoogle(query, center);
  if (!isKakaoConfigured()) {
    if (!center) throw new google.GoogleAreaError(`‘${query}’을(를) 찾지 못했어요. 다른 이름으로 다시 적어보세요.`);
    return google.searchAreaGoogle(query, center);
  }
  return kakao();
}

/** A point (current position or a tap on the map) → area. */
export async function searchAreaAt(position, options) {
  if (isGoogleConfigured() && (!inKorea(position) || !isKakaoConfigured())) {
    return (await import('./google/areaSearch.js')).searchAreaAtGoogle(position, options);
  }
  return (await import('./kakao/areaSearch.js')).searchAreaAt(position, options);
}

/** Exploration map for the current place. */
export async function mountPlaceMap(container, args) {
  if (args.current?.source === 'google') return (await import('./google/map.js')).mountGoogleMap(container, args);
  return (await import('./kakao/map.js')).mountKakaoMap(container, args);
}

/** "지도에서 고르기": 'korea' (Kakao) or 'abroad' (Google). */
export async function mountPicker(placeholder, options, region = 'korea') {
  if (region === 'abroad' && isGoogleConfigured()) return (await import('./google/picker.js')).mountGooglePicker(placeholder, options);
  return (await import('./kakao/picker.js')).mountAreaPicker(placeholder, options);
}
