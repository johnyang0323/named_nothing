import { CATEGORY_LABELS, moods } from '../data/places.js';
import { html } from '../utils/dom.js';

export const categoryLabel = (place) => CATEGORY_LABELS[place?.category] || '어딘가';
export const moodLabel = (moodId) => moods.find((m) => m.id === moodId)?.label || '아무거나';

/**
 * Kakao Map directions to a real place (opens the Kakao Map app on phones,
 * the web map elsewhere). Sample places have no coordinates → null.
 */
export function directionsUrl(place) {
  if (!place?.coords) return null;
  if (place.source === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${place.coords.lat},${place.coords.lng}`;
  const name = place.name.replace(/,/g, ' ');
  return `https://map.kakao.com/link/to/${encodeURIComponent(name)},${place.coords.lat},${place.coords.lng}`;
}

export function directionsLink(place, { className = 'directions-link' } = {}) {
  const url = directionsUrl(place);
  if (!url) return '';
  return html`<a class="${className}" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${place.name}까지 ${place.source === 'google' ? '구글 지도' : '카카오맵'} 길찾기">길찾기 ↗</a>`;
}

/** Practical facts for a place, always marked as illustrative. */
export function placeFacts(place) {
  const rows = [];
  const isReal = place.source === 'kakao' || place.source === 'google';
  const google = place.source === 'google';
  if (Number.isFinite(place.walkingTime)) {
    rows.push(isReal ? [place.walkingFrom || '동네 중심에서', `걸어서 약 ${place.walkingTime}분`] : ['걸어서', `약 ${place.walkingTime}분`]);
  }
  if (place.estimatedStay) rows.push(['머무는 시간', place.estimatedStay]);
  if (place.estimatedCost) rows.push(['비용', place.estimatedCost]);
  if (!rows.length) return '';
  return html`
    <dl class="facts">
      ${rows.map(([term, value]) => html`<div class="fact"><dt>${term}</dt><dd>${value}</dd></div>`)}
    </dl>
    ${isReal
      ? html`<p class="fine-print">장소 정보: ${google ? 'Google' : '카카오'}. 걷는 시간은 직선거리로 어림한 값이고, 영업시간과 비용은 방문 전에 확인해 주세요.
          ${place.placeUrl ? html`<a href="${place.placeUrl}" target="_blank" rel="noopener noreferrer">${google ? '구글 지도에서 보기' : '카카오맵에서 보기'}</a>` : ''}</p>
        ${directionsLink(place, { className: 'button button-ghost button-small directions-button' })}`
      : html`<p class="fine-print">예시 데이터예요. 실제 장소·시간·비용 정보가 아니에요.</p>`}`;
}

export function emptyState({ title, body, actionLabel, action, href }) {
  const button = href
    ? html`<a class="button button-primary" href="${href}">${actionLabel}</a>`
    : html`<button type="button" class="button button-primary" data-action="${action}">${actionLabel}</button>`;
  return html`
    <div class="empty">
      <p class="empty-title">${title}</p>
      <p class="empty-body">${body}</p>
      ${actionLabel ? button : ''}
    </div>`;
}
