/** "지도에서 고르기" abroad: a Google map; tap to drop a pin. */
import { loadGoogle } from './sdk.js';
import { htmlOverlay } from './overlay.js';

const WORLD_CENTER = { lat: 35.6812, lng: 139.7671 }; // 도쿄역 — only a neutral starting view
let picker = null;

export async function mountGooglePicker(placeholder, { focus, onPick }) {
  let google;
  try {
    google = await loadGoogle();
    await google.maps.importLibrary('maps');
  } catch (error) {
    if (placeholder.isConnected) {
      placeholder.textContent = error?.message || '구글 지도를 불러오지 못했어요.';
      placeholder.classList.add('is-error');
    }
    return false;
  }
  if (!placeholder.isConnected) return true;

  if (!picker) {
    const el = document.createElement('div');
    el.className = 'area-map';
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', '해외에서 출발할 위치를 고르는 지도. 지도를 누르면 그 자리에 핀이 꽂혀요.');
    placeholder.replaceWith(el);
    const start = focus || WORLD_CENTER;
    const map = new google.maps.Map(el, { center: start, zoom: focus ? 14 : 5, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy' });
    const pin = document.createElement('div');
    pin.className = 'km-marker km-pick';
    pin.setAttribute('aria-hidden', 'true');
    picker = { el, map, pin, overlay: null, onPick, focusKey: '' };
    map.addListener('click', (event) => {
      const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      place(google, point);
      picker.onPick(point);
    });
  } else {
    placeholder.replaceWith(picker.el);
    picker.onPick = onPick;
  }
  if (focus) {
    place(google, focus);
    const key = `${focus.lat},${focus.lng}`;
    if (key !== picker.focusKey) {
      picker.focusKey = key;
      picker.map.setCenter(focus);
    }
  } else if (picker.overlay) {
    picker.overlay.setMap(null);
    picker.overlay = null;
  }
  return true;
}

function place(google, point) {
  if (picker.overlay) picker.overlay.setPosition(point);
  else picker.overlay = htmlOverlay(google, picker.map, point, picker.pin, 3);
}
