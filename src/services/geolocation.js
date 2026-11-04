/**
 * One-shot, user-initiated location lookup. Asked only when the user taps
 * "현재 위치로 찾기" — never on load, never watched in the background.
 */
export class LocationError extends Error {}

export const canUseLocation = () => typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!canUseLocation()) {
      reject(new LocationError('이 브라우저에서는 위치를 쓸 수 없어요. 동네 이름으로 찾아주세요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (error) => {
        const messages = {
          1: '위치 권한이 꺼져 있어요. 브라우저나 휴대폰 설정에서 이 사이트의 위치를 허용하거나, 동네 이름으로 찾아주세요.',
          2: '지금은 위치를 알 수 없어요. 잠시 후 다시 시도하거나 동네 이름으로 찾아주세요.',
          3: '위치를 찾는 데 시간이 너무 오래 걸려요. 다시 시도하거나 동네 이름으로 찾아주세요.',
        };
        reject(new LocationError(messages[error.code] || messages[2]));
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
