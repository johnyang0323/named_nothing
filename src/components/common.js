import { CATEGORY_LABELS, moods } from '../data/places.js';
import { html } from '../utils/dom.js';

export const categoryLabel = (place) => CATEGORY_LABELS[place?.category] || '어딘가';
export const moodLabel = (moodId) => moods.find((m) => m.id === moodId)?.label || '아무거나';

/** Practical facts for a place, always marked as illustrative. */
export function placeFacts(place) {
  const rows = [];
  if (Number.isFinite(place.walkingTime)) rows.push(['걸어서', `약 ${place.walkingTime}분`]);
  if (place.estimatedStay) rows.push(['머무는 시간', place.estimatedStay]);
  if (place.estimatedCost) rows.push(['비용', place.estimatedCost]);
  if (!rows.length) return '';
  return html`
    <dl class="facts">
      ${rows.map(([term, value]) => html`<div class="fact"><dt>${term}</dt><dd>${value}</dd></div>`)}
    </dl>
    <p class="fine-print">예시 데이터예요. 실제 장소·시간·비용 정보가 아니에요.</p>`;
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
