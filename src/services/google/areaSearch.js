/**
 * Areas outside Korea with the Google Maps JavaScript API: find a place by
 * name (Places API New text search), gather nearby places, name a point
 * (Geocoding). Photos that come with the search are kept in memory only
 * (Google's terms don't allow storing them) for photos.js.
 */
import { loadGoogle, GoogleUnavailableError } from './sdk.js';
import { GOOGLE_SEARCHES, buildGooglePlaces } from './mapper.js';
import { SEARCH_RADIUS_METERS, MIN_AREA_PLACES, WALKING_FROM, coarseCoords } from '../kakao/mapper.js';

export class GoogleAreaError extends Error {}

const FIELDS = ['id', 'displayName', 'location', 'types', 'primaryTypeDisplayName', 'formattedAddress', 'googleMapsURI', 'photos'];
const photoMemo = new Map(); // 'g-…' → [{ url, thumb, author, authorUrl }]

async function places() {
  try {
    const google = await loadGoogle();
    return await google.maps.importLibrary('places');
  } catch (error) {
    throw new GoogleAreaError(error instanceof GoogleUnavailableError ? error.message : '구글 지도를 불러오지 못했어요.');
  }
}

function rememberPhotos(list) {
  list.forEach((p) => {
    if (!p?.id || !Array.isArray(p.photos) || !p.photos.length) return;
    photoMemo.set(`g-${p.id}`, p.photos.slice(0, 4).map(photoOf).filter(Boolean));
  });
}

function photoOf(photo) {
  try {
    const author = photo.authorAttributions?.[0];
    return {
      url: photo.getURI({ maxWidth: 900 }),
      thumb: photo.getURI({ maxWidth: 400 }),
      author: author?.displayName || '',
      authorUrl: author?.uri || null,
    };
  } catch {
    return null;
  }
}

/** Photos for a Google place: from the search if we still have them, else ask Google. */
export async function googlePlacePhotos(placeId) {
  if (photoMemo.has(placeId)) return photoMemo.get(placeId);
  const { Place } = await places();
  const place = new Place({ id: placeId.replace(/^g-/, '') });
  await place.fetchFields({ fields: ['photos'] });
  const list = (place.photos || []).slice(0, 4).map(photoOf).filter(Boolean);
  photoMemo.set(placeId, list);
  return list;
}

/** Name → center (or null). Also tells whether it's in Korea. */
export async function findCenterGoogle(query) {
  const { Place } = await places();
  try {
    const { places: found } = await Place.searchByText({ textQuery: query, fields: ['location', 'displayName'], maxResultCount: 1, language: 'ko' });
    const loc = found?.[0]?.location;
    return loc ? { lat: loc.lat(), lng: loc.lng() } : null;
  } catch {
    throw new GoogleAreaError('구글 장소 검색에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export async function gatherGooglePlaces(center, walkingFrom) {
  const { Place, SearchNearbyRankPreference } = await places();
  const lists = await Promise.all(
    GOOGLE_SEARCHES.map(async ({ includedTypes }) => {
      try {
        const { places: found } = await Place.searchNearby({
          fields: FIELDS,
          locationRestriction: { center, radius: SEARCH_RADIUS_METERS },
          includedTypes,
          maxResultCount: 20,
          rankPreference: SearchNearbyRankPreference?.POPULARITY,
          language: 'ko',
        });
        return found || [];
      } catch {
        return [];
      }
    }),
  );
  rememberPhotos(lists.flat());
  return buildGooglePlaces(lists, center, walkingFrom);
}

async function regionName(center) {
  try {
    const google = await loadGoogle();
    const { Geocoder } = await google.maps.importLibrary('geocoding');
    const { results } = await new Geocoder().geocode({ location: center, language: 'ko' });
    const parts = results?.[0]?.address_components || [];
    const pick = (type) => parts.find((c) => c.types.includes(type))?.long_name;
    return pick('sublocality_level_1') || pick('neighborhood') || pick('locality') || pick('administrative_area_level_2') || null;
  } catch {
    return null; // Geocoding API not enabled: fine, a generic label is used
  }
}

export async function searchAreaGoogle(query, center) {
  const areaPlaces = await gatherGooglePlaces(center, WALKING_FROM.name);
  if (areaPlaces.length < MIN_AREA_PLACES) {
    throw new GoogleAreaError(`‘${query}’ 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 다른 동네로 시도해 보세요.`);
  }
  return { label: query, origin: 'name', center, places: areaPlaces };
}

export async function searchAreaAtGoogle(position, { origin = 'gps' } = {}) {
  const center = coarseCoords(position);
  const from = origin === 'map' ? WALKING_FROM.map : WALKING_FROM.gps;
  const [name, areaPlaces] = await Promise.all([regionName(center), gatherGooglePlaces(center, from)]);
  if (areaPlaces.length < MIN_AREA_PLACES) {
    throw new GoogleAreaError(origin === 'map' ? '고른 위치 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 조금 더 번화한 곳을 눌러보세요.' : '지금 위치 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 동네 이름으로 찾아보세요.');
  }
  const suffix = origin === 'map' ? '지도에서 고른 곳' : '현재 위치';
  return { label: name ? `${name} (${suffix})` : suffix, origin, center, places: areaPlaces };
}
