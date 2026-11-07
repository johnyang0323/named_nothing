import { getPlaceById } from '../services/placeRepository.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel, placeFacts } from './common.js';
import { placeVisual, photoSlot } from './placeVisual.js';
import { attachSwipe, hasLearnedSwipe, markSwipeLearned } from './swipe.js';
import { needsLocation } from './home.js';
import { explainPick } from '../services/personalize.js';

export function onEnter({ store, ui }) {
  const state = store.getState();
  if (needsLocation(state)) {
    ui.areaStatus = { error: '어디서 시작할지 먼저 정해주세요. 위치 없이는 추천하지 않아요.' };
    ui.homeStep = 'place';
    return 'home';
  }
  if (!getPlaceById(state.recommendationId)) store.actions.startDay();
  return null;
}

export function render(state, { ui, taste, context }) {
  const place = getPlaceById(state.recommendationId);
  if (!place) return html`<section class="screen"><h1 class="title" tabindex="-1">잠시만요</h1></section>`;
  const inRoute = state.route.some((s) => s.id === place.id);

  return html`
    <section class="screen discover" aria-labelledby="discover-title">
      <p class="eyebrow">오늘의 첫 목적지 · ${moodLabel(state.mood)}${state.area ? ` · ${state.area.label} 근처` : ''}</p>
      <div class="discover-layout">
        <div class="deck-column">
          <div class="swipe-deck">
            <article class="destination swipe-card ${ui.cardEnter ? `card-enter-${ui.cardEnter}` : ''}" data-swipe-card aria-roledescription="넘길 수 있는 카드">
              <span class="swipe-hint swipe-hint-go" aria-hidden="true">가보기</span>
              <span class="swipe-hint swipe-hint-skip" aria-hidden="true">다른 곳</span>
              <figure class="destination-figure">
                <div class="destination-visual"${photoSlot(place, { gallery: true })}>${placeVisual(place)}</div>
                <figcaption class="photo-credit fine-print" data-photo-credit-for="${place.id}" hidden></figcaption>
              </figure>
              <div class="destination-body">
                <p class="kicker">${categoryLabel(place)}</p>
                <h1 id="discover-title" class="title" tabindex="-1">${place.name}</h1>
                ${(() => {
                  const reasons = taste && context ? explainPick(place, { taste: taste.get(), context: context(), wild: state.recommendationWild }) : [];
                  return reasons.length ? html`<ul class="why-tags" aria-label="이 장소를 고른 이유">${reasons.map((r) => html`<li>${r}</li>`)}</ul>` : '';
                })()}
                <p class="description">${place.description}</p>
              </div>
            </article>
          </div>

          <div class="swipe-actions">
            <button type="button" class="button button-secondary swipe-skip" data-action="another" data-focus-key="another">
              <span aria-hidden="true">←</span> 다른 곳
            </button>
            <button type="button" class="button button-primary swipe-go" data-action="go" data-focus-key="go">
              ${inRoute ? '여기서 둘러보기' : '가보기'} <span aria-hidden="true">→</span>
            </button>
          </div>
          ${hasLearnedSwipe()
            ? ''
            : html`<p class="swipe-tip"><span>← 왼쪽으로 밀면 다른 곳</span><span>오른쪽으로 밀면 가보기 →</span></p>`}
        </div>

        <div class="destination-details">
          ${place.placeUrl
            ? html`<a class="kakao-photos-link" href="${place.placeUrl}" target="_blank" rel="noopener noreferrer">카카오맵에서 실제 사진 보기<span aria-hidden="true"> ↗</span></a>`
            : ''}
          <h2 class="section-label">왜 가볼 만할까</h2>
          <p class="why">${place.whyVisit}</p>

          <h2 class="section-label">거기서 해볼 만한 것</h2>
          <ul class="activities">
            ${place.suggestedActivities.slice(0, 2).map((a) => html`<li>${a}</li>`)}
          </ul>

          ${placeFacts(place)}
          <p class="quiet-link"><a href="#home">조건 바꾸기 (위치·시간·기분)</a></p>
        </div>
      </div>
    </section>`;
}

export const actions = {
  go: ({ store, navigate }) => {
    store.actions.acceptRecommendation();
    navigate('explore');
  },
  another: (ctx) => {
    ctx.ui.cardEnter = 'next';
    const place = ctx.store.actions.showAnother();
    ctx.ui.cardEnter = null;
    if (place) ctx.announce(`새로운 제안: ${place.name}`);
  },
};

/** Swipe right = 가보기, left = 다른 곳 보기 (same as the buttons). */
/** First visit: the card sways left and right once, showing both stamps. */
function nudge(card) {
  if (!card.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const timing = { duration: 1600, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
  card.animate(
    [
      { transform: 'none' },
      { transform: 'translateX(-34px) rotate(-3deg)', offset: 0.2 },
      { transform: 'translateX(30px) rotate(3deg)', offset: 0.45 },
      { transform: 'none', offset: 0.65 },
      { transform: 'none' },
    ],
    timing,
  );
  card.querySelector('.swipe-hint-skip')?.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.28 }, { opacity: 0, offset: 0.38 }, { opacity: 0 }],
    timing,
  );
  card.querySelector('.swipe-hint-go')?.animate(
    [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.42 }, { opacity: 1, offset: 0.55 }, { opacity: 0, offset: 0.66 }, { opacity: 0 }],
    timing,
  );
}

export function afterRender(_state, ctx) {
  const card = document.querySelector('[data-swipe-card]');
  if (!card) return;
  if (!hasLearnedSwipe() && !ctx.ui.swipeNudged) {
    ctx.ui.swipeNudged = true;
    // after the first redraws settle (photo, weather), on whichever card is showing
    setTimeout(() => {
      const current = document.querySelector('[data-swipe-card]');
      if (current && !current.classList.contains('is-dragging')) nudge(current);
    }, 600);
  }
  attachSwipe(card, {
    mouseArea: '.destination-figure',
    onCommit: (direction) => {
      markSwipeLearned();
      if (direction === 'right') actions.go(ctx);
      else actions.another(ctx);
      // nothing re-rendered (e.g. no other place) → bring the card back
      if (card.isConnected) ctx.rerender();
    },
  });
}
