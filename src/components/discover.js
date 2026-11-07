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
              <span class="swipe-hint swipe-hint-go" aria-hidden="true">이전</span>
              <span class="swipe-hint swipe-hint-skip" aria-hidden="true">다음</span>
              <span class="swipe-hint swipe-hint-keep" aria-hidden="true">보관 ↓</span>
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
            <button type="button" class="button button-secondary swipe-prev" data-action="previous" data-focus-key="previous" aria-label="이전 카드" ${state.cardPos > 0 ? '' : 'disabled'}>
              <span aria-hidden="true">‹</span> 이전
            </button>
            ${envelope(state)}
            <button type="button" class="button button-secondary swipe-next" data-action="another" data-focus-key="another" aria-label="다음 카드">
              다음 <span aria-hidden="true">›</span>
            </button>
          </div>
          <button type="button" class="button button-primary button-wide swipe-go" data-action="go" data-focus-key="go">
            ${inRoute ? '여기서 둘러보기' : '여기로 가보기'}
          </button>
          ${hasLearnedSwipe()
            ? ''
            : html`<p class="swipe-tip"><span>← 밀면 다음</span><span>↓ 내리면 보관</span><span>밀면 이전 →</span></p>`}
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

/** The envelope under the card: press it (or pull the card down) to keep a place; kept ones pile up inside. */
function envelope(state) {
  const n = state.route.length;
  const peek = Math.min(n, 3);
  return html`<button type="button" class="envelope ${n ? 'has-items' : ''}" data-action="keep" data-focus-key="keep" data-envelope aria-label="이 장소 봉투에 보관하기 (지금 ${n}곳)">
    <span class="envelope-art" aria-hidden="true">
      <span class="envelope-cards">${Array.from({ length: peek }, (_, i) => html`<span class="envelope-card envelope-card-${i + 1}"></span>`)}</span>
      <svg class="envelope-svg" viewBox="0 0 64 44" focusable="false">
        <path class="envelope-back" d="M4 10a6 6 0 0 1 6-6h44a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z"/>
        <path class="envelope-front" d="M4 16l28 16 28-16v20a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z"/>
      </svg>
      <span class="envelope-count" data-envelope-count>${n}</span>
    </span>
    <span class="envelope-label">보관 ↓</span>
  </button>`;
}

/** The card shrinks into the envelope, then the next card comes in. */
function flyIntoEnvelope(card, done) {
  const target = document.querySelector('[data-envelope]');
  if (!card || !target || !card.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }
  const from = card.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const current = card.style.transform || 'none';
  card.style.transition = 'none';
  const animation = card.animate(
    [
      { transform: current, opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.5}px) scale(0.45) rotate(-4deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0.2 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'forwards' },
  );
  animation.onfinish = done;
  animation.oncancel = done;
}

function keep(ctx, card) {
  const run = () => {
    const result = ctx.store.actions.keepRecommendation();
    if (!result) return;
    ctx.ui.envelopeBump = true;
    ctx.toast(`‘${result.kept.name}’을(를) 봉투에 담았어요.`, { label: '경로 보기', run: (c) => c.navigate('route') });
    if (card?.isConnected) ctx.rerender();
  };
  flyIntoEnvelope(card || document.querySelector('[data-swipe-card]'), run);
}

function previous(ctx) {
  ctx.ui.cardEnter = 'prev';
  const place = ctx.store.actions.showPrevious();
  ctx.ui.cardEnter = null;
  if (place) ctx.announce(`이전 카드: ${place.name}`);
  else ctx.toast('첫 카드예요. 오른쪽으로 밀면 이전 카드를 볼 수 있어요.');
}

export const actions = {
  previous: (ctx) => previous(ctx),
  keep: (ctx) => keep(ctx),
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
      { transform: 'none', offset: 0.4 },
      { transform: 'translateY(28px)', offset: 0.6 },
      { transform: 'none', offset: 0.8 },
      { transform: 'none' },
    ],
    timing,
  );
  card.querySelector('.swipe-hint-skip')?.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.28 }, { opacity: 0, offset: 0.38 }, { opacity: 0 }],
    timing,
  );
  card.querySelector('.swipe-hint-keep')?.animate(
    [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1, offset: 0.55 }, { opacity: 1, offset: 0.68 }, { opacity: 0, offset: 0.78 }, { opacity: 0 }],
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
  if (ctx.ui.envelopeBump) {
    ctx.ui.envelopeBump = false;
    document.querySelector('[data-envelope]')?.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18) translateY(-4px)' }, { transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' },
    );
  }
  // ← next · → previous · ↓ keep (into the envelope)
  attachSwipe(card, {
    mouseArea: '.destination-figure',
    allowDown: true,
    canCommit: (direction) => direction !== 'right' || ctx.store.getState().cardPos > 0,
    onRefused: (direction) => {
      if (direction === 'right') ctx.toast('첫 카드예요. 이전 카드가 없어요.');
    },
    onCommit: (direction, el) => {
      markSwipeLearned();
      if (direction === 'down') {
        keep(ctx, el);
        return;
      }
      if (direction === 'right') previous(ctx);
      else actions.another(ctx);
      // nothing re-rendered (e.g. no other place) → bring the card back
      if (card.isConnected) ctx.rerender();
    },
  });
}
