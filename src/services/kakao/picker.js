/**
 * "지도에서 고르기": a Kakao map on the home screen. Tap to drop a pin;
 * the screen then offers to start from that spot.
 *
 * The map element is created once and moved back into each re-render
 * (so changing the mood doesn't rebuild or recenter the map).
 */
import { loadKakao } from './sdk.js';

const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 — only a neutral starting view
let picker = null;

function placeMarker(point) {
  const { kakao, marker, map } = picker;
  marker.setPosition(new kakao.maps.LatLng(point.lat, point.lng));
  marker.setMap(map);
}

/**
 * @param placeholder element to replace with the map
 * @param focus       where to look and put the pin ({lat,lng}) or null
 * @param onPick      called with {lat,lng} when the map is tapped
 * Resolves false if the SDK can't load (the caller keeps the text search).
 */
export async function mountAreaPicker(placeholder, { focus, onPick }) {
  let kakao;
  try {
    kakao = await loadKakao();
  } catch {
    if (placeholder.isConnected) {
      placeholder.textContent = '지도를 불러오지 못했어요. 동네 이름이나 현재 위치로 찾아주세요.';
      placeholder.classList.add('is-error');
    }
    return false;
  }
  if (!placeholder.isConnected) return true;

  if (!picker) {
    const el = document.createElement('div');
    el.className = 'area-map';
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', '출발할 위치를 고르는 지도. 지도를 누르면 그 자리에 핀이 꽂혀요.');
    placeholder.replaceWith(el);
    const start = focus || DEFAULT_CENTER;
    const map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(start.lat, start.lng), level: focus ? 5 : 8 });
    const pin = document.createElement('div');
    pin.className = 'km-marker km-pick';
    pin.setAttribute('aria-hidden', 'true');
    const marker = new kakao.maps.CustomOverlay({ content: pin, xAnchor: 0.5, yAnchor: 0.5, zIndex: 3 });
    picker = { el, map, marker, kakao, onPick, focusKey: focus ? `${focus.lat},${focus.lng}` : '' };
    kakao.maps.event.addListener(map, 'click', (event) => {
      const point = { lat: event.latLng.getLat(), lng: event.latLng.getLng() };
      placeMarker(point);
      picker.onPick(point);
    });
  } else {
    placeholder.replaceWith(picker.el);
    picker.onPick = onPick;
    picker.map.relayout();
  }

  if (focus) {
    placeMarker(focus);
    const key = `${focus.lat},${focus.lng}`;
    if (key !== picker.focusKey) {
      picker.focusKey = key;
      picker.map.setCenter(new kakao.maps.LatLng(focus.lat, focus.lng));
    }
  } else {
    picker.marker.setMap(null);
  }
  return true;
}
