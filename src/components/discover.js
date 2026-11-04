import { getPlaceById } from '../services/placeRepository.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel, placeFacts } from './common.js';
import { placeVisual } from './placeVisual.js';

export function onEnter({ store }) {
  if (!getPlaceById(store.getState().recommendationId)) store.actions.startDay();
}

export function render(state) {
  const place = getPlaceById(state.recommendationId);
  if (!place) return html`<section class="screen"><h1 class="title" tabindex="-1">잠시만요</h1></section>`;
  const inRoute = state.route.some((s) => s.id === place.id);

  return html`
    <section class="screen discover" aria-labelledby="discover-title">
      <p class="eyebrow">오늘의 첫 목적지 · ${moodLabel(state.mood)}</p>
      <article class="destination">
        <div class="destination-visual">${placeVisual(place)}</div>
        <div class="destination-body">
          <p class="kicker">${categoryLabel(place)}</p>
          <h1 id="discover-title" class="title" tabindex="-1">${place.name}</h1>
          <p class="description">${place.description}</p>

          <h2 class="section-label">왜 가볼 만할까</h2>
          <p class="why">${place.whyVisit}</p>

          <h2 class="section-label">거기서 해볼 만한 것</h2>
          <ul class="activities">
            ${place.suggestedActivities.slice(0, 2).map((a) => html`<li>${a}</li>`)}
          </ul>

          ${placeFacts(place)}

          <div class="actions">
            <button type="button" class="button button-primary" data-action="go" data-focus-key="go">
              ${inRoute ? '여기서 둘러보기' : '여기로 가보기'}
            </button>
            <button type="button" class="button button-secondary" data-action="another" data-focus-key="another">다른 곳 보기</button>
          </div>
          <p class="quiet-link"><a href="#home">기분 다시 고르기</a></p>
        </div>
      </article>
    </section>`;
}

export const actions = {
  go: ({ store, navigate }) => {
    store.actions.acceptRecommendation();
    navigate('explore');
  },
  another: ({ store, announce }) => {
    const place = store.actions.showAnother();
    if (place) announce(`새로운 제안: ${place.name}`);
  },
};
