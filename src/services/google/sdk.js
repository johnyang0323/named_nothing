import { GOOGLE_MAPS_KEY } from './config.js';

const LOAD_TIMEOUT_MS = 12000;
let loading = null;

export class GoogleUnavailableError extends Error {}

/**
 * Load the Google Maps JavaScript API once (dynamic library loading).
 * Resolves with `window.google`; libraries come from google.maps.importLibrary.
 */
export function loadGoogle() {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
  if (loading) return loading;
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new GoogleUnavailableError('구글 지도 키가 설정되지 않았어요.'));

  loading = new Promise((resolve, reject) => {
    const callback = `__plannishGoogle${Date.now()}`;
    const script = document.createElement('script');
    const fail = (message) => {
      loading = null;
      script.remove();
      delete window[callback];
      reject(new GoogleUnavailableError(message));
    };
    const timer = setTimeout(() => fail('구글 지도 응답이 늦어요. 잠시 후 다시 시도해 주세요.'), LOAD_TIMEOUT_MS);
    window[callback] = () => {
      clearTimeout(timer);
      delete window[callback];
      if (window.google?.maps?.importLibrary) resolve(window.google);
      else fail('구글 지도를 불러오지 못했어요.');
    };
    // a refused key (wrong site, API not enabled) calls this instead
    window.gm_authFailure = () => fail('구글 지도 키가 거절됐어요. 키의 웹사이트 제한과 사용 설정된 API를 확인해 주세요.');
    const params = new URLSearchParams({ key: GOOGLE_MAPS_KEY, v: 'weekly', language: 'ko', loading: 'async', callback });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail('구글 지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    };
    document.head.append(script);
  });
  return loading;
}
