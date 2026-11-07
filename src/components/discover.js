import { getPlaceById } from '../services/placeRepository.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel, placeFacts } from './common.js';
import { placeVisual, photoSlot } from './placeVisual.js';
import { attachSwipe, hasLearnedSwipe, markSwipeLearned } from './swipe.js';
import { needsLocation } from './home.js';
import { explainPick } from '../services/personalize.js';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser } from '../services/backend/auth.js';
import { listFriends, sendCard, friendTraces, friendEntriesFor, profilesFor, SocialError } from '../services/backend/social.js';
import { entryCard, avatar } from './entryCard.js';

const socialOn = () => isBackendConfigured() && Boolean(getUser());

/** "친구 2명이 다녀간 곳 · 비, 산책하는A" on the card. */
function traceLine(ui, place) {
  const t = ui.traces?.get(place.id);
  if (!t || !t.friends) return '';
  const names = t.nicknames.slice(0, 2).join(', ');
  return html`<p class="friend-trace"><span aria-hidden="true">👥</span> 친구 ${t.friends}명이 다녀간 곳${names ? ` · ${names}` : ''}</p>`;
}

/** Entries friends shared about this place, under the card. */
function friendEntries(ui, place) {
  const found = ui.placeEntries?.get(place.id);
  if (!found || !found.entries.length) return '';
  return html`<h2 class="section-label">친구들의 기록</h2>
    <div class="entries">${found.entries.map((e) => entryCard(e, { me: getUser()?.id, author: found.profiles.get(e.user_id), profiles: found.profiles, ui }))}</div>`;
}

/** Pick a friend (and a short note) to send this card to. */
function sendPanel(ui) {
  const s = ui.sendCard;
  if (!s) return '';
  const friends = ui.sendFriends;
  return html`<section class="send-panel" aria-labelledby="send-title">
    <h2 class="section-label" id="send-title">누구에게 보낼까요?</h2>
    ${!friends
      ? html`<p class="empty-body">친구 목록을 불러오는 중…</p>`
      : friends.length
        ? html`<div class="send-friends" role="radiogroup" aria-label="받을 친구">
            ${friends.map(
              (f) => html`<label class="send-friend ${s.to === f.user_id ? 'is-on' : ''}">
                <input type="radio" name="send-to" value="${f.user_id}" class="visually-hidden" data-input="send-to" ${s.to === f.user_id ? 'checked' : ''}>
                ${avatar(f)}<span>${f.nickname}</span>
              </label>`,
            )}
          </div>
          <label class="visually-hidden" for="send-note">한마디</label>
          <input id="send-note" class="area-input" type="text" maxlength="100" placeholder="한마디 (예: 여기 같이 갈래?)" value="${s.note || ''}" data-input="send-note" data-focus-key="send-note" autocomplete="off">
          <div class="actions actions-compact">
            <button type="button" class="button button-primary button-small" data-action="send-card" data-focus-key="send-card" ${s.to && !s.busy ? '' : 'disabled'}>${s.busy ? '보내는 중…' : '보내기'}</button>
            <button type="button" class="text-button text-button-muted" data-action="send-close">취소</button>
          </div>`
        : html`<p class="empty-body">아직 친구가 없어요. <a href="#together">함께</a>에서 친구를 추가해 보세요.</p>`}
  </section>`;
}

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
                ${traceLine(ui, place)}
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
          <button type="button" class="button button-primary button-wide swipe-go" data-action="go-kept" data-focus-key="go-kept">
            보관한 곳으로 가보기${state.route.length || !inRoute ? html` <span class="go-count">${state.route.length + (inRoute ? 0 : 1)}</span>` : ''}
          </button>
          ${hasLearnedSwipe()
            ? ''
            : html`<p class="swipe-tip"><span>← 밀면 다음</span><span>↓ 내리면 보관</span><span>밀면 이전 →</span></p>`}
          ${socialOn() && !ui.sendCard ? html`<button type="button" class="text-button send-open" data-action="send-open" data-focus-key="send-open">✉︎ 친구에게 보내기</button>` : ''}
          ${sendPanel(ui)}
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
          ${friendEntries(ui, place)}
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

/** "보관한 곳으로 가보기": this card goes into the envelope too, then open 경로. */
function goKept(ctx) {
  const id = ctx.store.getState().recommendationId;
  if (id) ctx.store.actions.addToRoute(id);
  ctx.navigate('route');
}

async function openSend(ctx) {
  ctx.ui.sendCard = { to: null, note: '', busy: false };
  ctx.rerender();
  if (!ctx.ui.sendFriends) {
    ctx.ui.sendFriends = await listFriends().catch(() => []);
    if (ctx.getScreen() === 'discover') ctx.rerender();
  }
}

async function send(ctx) {
  const s = ctx.ui.sendCard;
  const place = getPlaceById(ctx.store.getState().recommendationId);
  if (!s?.to || !place || s.busy) return;
  s.busy = true;
  ctx.rerender();
  try {
    await sendCard(s.to, place, s.note);
    const friend = ctx.ui.sendFriends?.find((f) => f.user_id === s.to);
    ctx.ui.sendCard = null;
    ctx.toast(`${friend?.nickname || '친구'}님에게 ‘${place.name}’ 카드를 보냈어요.`);
  } catch (error) {
    s.busy = false;
    ctx.toast(error instanceof SocialError ? error.message : '카드를 보내지 못했어요.');
  }
  ctx.rerender();
}

/** Look up friends' traces for the card on screen (once per place). */
function loadTraces(ctx, place) {
  const ui = ctx.ui;
  ui.traces = ui.traces || new Map();
  ui.placeEntries = ui.placeEntries || new Map();
  if (!socialOn() || !place || ui.traces.has(place.id)) return;
  ui.traces.set(place.id, null);
  Promise.all([friendTraces([place.id]), friendEntriesFor(place.id)])
    .then(async ([traces, entries]) => {
      ui.traces.set(place.id, traces.get(place.id) || null);
      const profiles = await profilesFor(entries.map((e) => e.user_id)).catch(() => new Map());
      ui.placeEntries.set(place.id, { entries, profiles });
      if ((traces.get(place.id) || entries.length) && ctx.getScreen() === 'discover' && ctx.store.getState().recommendationId === place.id) ctx.rerender();
    })
    .catch(() => {});
}

export const actions = {
  'send-open': (ctx) => openSend(ctx),
  'send-close': (ctx) => {
    ctx.ui.sendCard = null;
    ctx.rerender();
  },
  'send-card': (ctx) => send(ctx),
  previous: (ctx) => previous(ctx),
  'go-kept': (ctx) => goKept(ctx),
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

export const inputs = {
  'send-to': (ctx, el) => {
    if (ctx.ui.sendCard) ctx.ui.sendCard.to = el.value;
    ctx.rerender();
  },
  'send-note': (ctx, el) => {
    if (ctx.ui.sendCard) ctx.ui.sendCard.note = el.value;
  },
};

export function afterRender(state, ctx) {
  loadTraces(ctx, getPlaceById(state.recommendationId));
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
