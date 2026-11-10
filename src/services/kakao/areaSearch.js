/**
 * Find a neighborhood by name, then gather real places around it
 * with the Kakao Maps JS SDK `services` library (JavaScript key only).
 */
import { loadKakao, KakaoUnavailableError } from './sdk.js';
import { SEARCHES, SEARCH_RADIUS_METERS, MIN_AREA_PLACES, WALKING_FROM, buildAreaPlaces, coarseCoords } from './mapper.js';

export class AreaSearchError extends Error {}

function callService(fn) {
  return new Promise((resolve) => {
    try {
      fn((data, status) => resolve({ data: Array.isArray(data) ? data : [], status }));
    } catch {
      resolve({ data: [], status: 'ERROR' });
    }
  });
}

async function findCenter(kakao, query) {
  const { Status } = kakao.maps.services;
  const geocoder = new kakao.maps.services.Geocoder();
  const byAddress = await callService((cb) => geocoder.addressSearch(query, cb));
  if (byAddress.status === Status.OK && byAddress.data[0]) {
    return { lat: Number(byAddress.data[0].y), lng: Number(byAddress.data[0].x) };
  }
  const places = new kakao.maps.services.Places();
  const byKeyword = await callService((cb) => places.keywordSearch(query, cb));
  if (byKeyword.status === Status.OK && byKeyword.data[0]) {
    return { lat: Number(byKeyword.data[0].y), lng: Number(byKeyword.data[0].x) };
  }
  if (byAddress.status === Status.ERROR && byKeyword.status === Status.ERROR) {
    throw new AreaSearchError('카카오 장소 검색에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
  throw new AreaSearchError(`‘${query}’을(를) 찾지 못했어요. 동 이름이나 역 이름으로 다시 적어보세요.`);
}

async function ensureKakao() {
  try {
    return await loadKakao();
  } catch (error) {
    throw new AreaSearchError(error instanceof KakaoUnavailableError ? error.message : '카카오맵을 불러오지 못했어요.');
  }
}

/** Run every search around `center` and turn the results into app places. */
async function gatherPlaces(kakao, center, walkingFrom) {
  const places = new kakao.maps.services.Places();
  const location = new kakao.maps.LatLng(center.lat, center.lng);
  const options = { location, radius: SEARCH_RADIUS_METERS, sort: kakao.maps.services.SortBy.ACCURACY };
  const resultsBySearch = await Promise.all(
    SEARCHES.map(async (search) => {
      const { data } = await callService((cb) =>
        search.type === 'category'
          ? places.categorySearch(search.code, cb, options)
          : places.keywordSearch(search.query, cb, options),
      );
      return { search, docs: data };
    }),
  );
  return buildAreaPlaces(resultsBySearch, center, walkingFrom);
}

/** Neighborhood name → area. */
export async function searchArea(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) throw new AreaSearchError('동네 이름을 적어주세요.');
  const kakao = await ensureKakao();
  const center = await findCenter(kakao, query);
  const areaPlaces = await gatherPlaces(kakao, center, WALKING_FROM.name);
  if (areaPlaces.length < MIN_AREA_PLACES) {
    throw new AreaSearchError(`‘${query}’ 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 다른 동네로 시도해 보세요.`);
  }
  return { label: query, origin: 'name', center, places: areaPlaces };
}

/** Name of the administrative 동 at a coordinate, e.g. "망원1동". */
async function regionName(kakao, center) {
  const geocoder = new kakao.maps.services.Geocoder();
  const { data, status } = await callService((cb) => geocoder.coord2RegionCode(center.lng, center.lat, cb));
  if (status !== kakao.maps.services.Status.OK) return null;
  const region = data.find((r) => r.region_type === 'H') || data[0];
  return region?.region_3depth_name || region?.region_2depth_name || null;
}

/**
 * A point → area: the current position ('gps') or a spot tapped on the
 * map ('map'). Coordinates are rounded to ~100 m before they are used or
 * stored, and never leave the device except as the Kakao search location.
 */
export async function searchAreaAt(position, { origin = 'gps' } = {}) {
  const center = coarseCoords(position);
  const kakao = await ensureKakao();
  const from = origin === 'map' ? WALKING_FROM.map : WALKING_FROM.gps;
  const [name, areaPlaces] = await Promise.all([regionName(kakao, center), gatherPlaces(kakao, center, from)]);
  if (areaPlaces.length < MIN_AREA_PLACES) {
    throw new AreaSearchError(
      origin === 'map'
        ? '고른 위치 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 조금 더 번화한 곳을 눌러보세요.'
        : '지금 위치 근처에서 가볼 만한 곳을 충분히 찾지 못했어요. 동네 이름으로 찾아보세요.',
    );
  }
  const suffix = origin === 'map' ? '지도에서 고른 곳' : '현재 위치';
  return { label: name ? `${name} (${suffix})` : suffix, origin, center, places: areaPlaces };
}
