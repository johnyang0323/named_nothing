/** The exploration map for places abroad (Google), same markers as the Kakao map. */
import { loadGoogle } from './sdk.js';
import { htmlOverlay } from './overlay.js';

function marker(className, text, label) {
  const el = document.createElement('div');
  el.className = `km-marker ${className}`;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  if (label) el.title = label;
  return el;
}

export async function mountGoogleMap(container, { current, discoveries, routePlaces }) {
  let google;
  try {
    google = await loadGoogle();
    await google.maps.importLibrary('maps');
  } catch {
    return false;
  }
  if (!container.isConnected) return true;
  container.textContent = '';
  const map = new google.maps.Map(container, {
    center: current.coords,
    zoom: 15,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'cooperative',
    clickableIcons: false,
  });
  const bounds = new google.maps.LatLngBounds();
  const add = (place, el, z) => {
    bounds.extend(place.coords);
    htmlOverlay(google, map, place.coords, el, z);
  };
  routePlaces.filter((p) => p.coords && p.id !== current.id).forEach((p) => add(p, marker('km-route', '', p.name), 1));
  discoveries.filter((p) => p.coords).forEach((p, i) => add(p, marker('km-num', String(i + 1), p.name), 2));
  add(current, marker('km-current', '', current.name), 3);
  if (discoveries.length || routePlaces.length > 1) map.fitBounds(bounds, 40);
  return true;
}
