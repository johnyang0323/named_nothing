/**
 * Render a real Kakao map for the exploration screen.
 * Markers use the same visual language as the schematic diagram.
 */
import { loadKakao } from './sdk.js';

function marker(className, text, label) {
  const el = document.createElement('div');
  el.className = `km-marker ${className}`;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  if (label) el.title = label;
  return el;
}

/**
 * Mounts a map into `container`. Resolves true on success, false if the
 * SDK is unavailable (the caller then shows the schematic fallback).
 */
export async function mountKakaoMap(container, { current, discoveries, routePlaces }) {
  let kakao;
  try {
    kakao = await loadKakao();
  } catch {
    return false;
  }
  if (!container.isConnected) return true; // screen changed while loading

  const toLatLng = (p) => new kakao.maps.LatLng(p.coords.lat, p.coords.lng);
  container.textContent = '';
  const map = new kakao.maps.Map(container, { center: toLatLng(current), level: 4 });
  map.setZoomable(true);
  const bounds = new kakao.maps.LatLngBounds();

  const add = (place, el, z) => {
    const position = toLatLng(place);
    bounds.extend(position);
    new kakao.maps.CustomOverlay({ position, content: el, yAnchor: 0.5, xAnchor: 0.5, zIndex: z }).setMap(map);
  };

  routePlaces
    .filter((p) => p.coords && p.id !== current.id)
    .forEach((p) => add(p, marker('km-route', '', p.name), 1));
  discoveries
    .filter((p) => p.coords)
    .forEach((p, i) => add(p, marker('km-num', String(i + 1), p.name), 2));
  add(current, marker('km-current', '', current.name), 3);

  if (discoveries.length || routePlaces.length > 1) map.setBounds(bounds, 40, 40, 40, 40);
  return true;
}
