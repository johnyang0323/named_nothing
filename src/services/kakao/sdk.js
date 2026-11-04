import { KAKAO_MAP_KEY } from './config.js';

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';
const LOAD_TIMEOUT_MS = 10000;
let loading = null;

export class KakaoUnavailableError extends Error {}

/**
 * Load the Kakao Maps SDK (with the `services` library) once.
 * Resolves with `window.kakao`. A failed load can be retried later.
 */
export function loadKakao() {
  if (window.kakao?.maps?.services) return Promise.resolve(window.kakao);
  if (loading) return loading;
  if (!KAKAO_MAP_KEY) return Promise.reject(new KakaoUnavailableError('카카오맵 키가 설정되지 않았어요.'));

  loading = new Promise((resolve, reject) => {
    const fail = (message) => {
      loading = null;
      script.remove();
      reject(new KakaoUnavailableError(message));
    };
    const timer = setTimeout(() => fail('카카오맵 응답이 늦어요. 잠시 후 다시 시도해 주세요.'), LOAD_TIMEOUT_MS);
    const script = document.createElement('script');
    script.src = `${SDK_URL}?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps?.load) {
        clearTimeout(timer);
        fail('카카오맵을 불러오지 못했어요. 키와 등록된 도메인을 확인해 주세요.');
        return;
      }
      window.kakao.maps.load(() => {
        clearTimeout(timer);
        resolve(window.kakao);
      });
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail('카카오맵을 불러오지 못했어요. 키와 등록된 도메인을 확인해 주세요.');
    };
    document.head.append(script);
  });
  return loading;
}
