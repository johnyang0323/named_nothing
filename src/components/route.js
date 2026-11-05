import { getAllPlaces, getPlaceById } from '../services/placeRepository.js';
import { suggestReplacements } from '../services/recommender.js';
import { html } from '../utils/dom.js';
import { categoryLabel, emptyState, directionsLink } from './common.js';
import { placeVisual, photoSlot } from './placeVisual.js';
import { needsLocation } from './home.js';

function replacementPanel(stop, ui) {
  if (ui.replacingId !== stop.id) return '';
  const options = ui.replacementOptions.map(getPlaceById).filter(Boolean);
  return html`
    <div class="replace-panel" role="group" aria-label="${getPlaceById(stop.id).name} 대신 갈 곳">
      <p class="replace-title">대신 이런 곳은 어때요?</p>
      ${options.length
        ? html`<ul class="replace-list">
            ${options.map(
              (p) => html`<li>
                <button type="button" class="replace-option" data-action="replace-with" data-id="${stop.id}" data-new-id="${p.id}">
                  <span class="replace-name">${p.name}</span>
                  <span class="replace-meta">${categoryLabel(p)} · ${p.whyVisit}</span>
                </button>
              </li>`,
            )}
          </ul>`
        : html`<p class="empty-body">지금은 바꿀 만한 곳이 없어요.</p>`}
      <button type="button" class="text-button" data-action="replace-cancel" data-id="${stop.id}" data-focus-key="replace-${stop.id}">그대로 둘게요</button>
    </div>`;
}

function stopItem(stop, index, total, state, ui) {
  const place = getPlaceById(stop.id);
  const isCurrent = state.currentId === stop.id;
  const name = place.name;
  return html`
    <li class="stop ${stop.visited ? 'is-visited' : ''}" data-focus-key="item-${stop.id}" tabindex="-1">
      <div class="stop-main">
        <span class="stop-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <div class="stop-visual"${photoSlot(place)}>${placeVisual(place)}</div>
        <div class="stop-text">
          <p class="kicker">${categoryLabel(place)}${isCurrent ? ' · 지금 여기' : ''}</p>
          <h3 class="stop-name">${name}</h3>
          <p class="stop-status">${stop.visited ? '✓ 다녀왔어요' : '가볼 수도 있는 곳'}</p>
        </div>
      </div>
      <div class="stop-controls">
        <div class="order-controls">
          <button type="button" class="icon-button" data-action="move-up" data-id="${stop.id}" data-focus-key="up-${stop.id}" aria-label="${name} 위로 옮기기" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-button" data-action="move-down" data-id="${stop.id}" data-focus-key="down-${stop.id}" aria-label="${name} 아래로 옮기기" ${index === total - 1 ? 'disabled' : ''}>↓</button>
        </div>
        <button type="button" class="chip ${stop.visited ? 'is-on' : ''}" data-action="toggle-visited" data-id="${stop.id}" data-focus-key="visit-${stop.id}" aria-pressed="${stop.visited ? 'true' : 'false'}" aria-label="${name} 다녀왔어요">
          ${stop.visited ? '✓ 다녀왔어요' : '다녀왔어요'}
        </button>
        <button type="button" class="text-button" data-action="replace" data-id="${stop.id}" data-focus-key="replace-${stop.id}" aria-expanded="${ui.replacingId === stop.id ? 'true' : 'false'}" aria-label="${name} 다른 곳으로 바꾸기">바꾸기</button>
        ${isCurrent ? '' : html`<button type="button" class="text-button" data-action="explore-from" data-id="${stop.id}" aria-label="${name}에서 둘러보기">여기서 둘러보기</button>`}
        ${directionsLink(place, { className: 'text-button directions-link' })}
        <button type="button" class="text-button text-button-muted" data-action="remove" data-id="${stop.id}" aria-label="${name} 경로에서 빼기">빼기</button>
      </div>
      ${replacementPanel(stop, ui)}
    </li>`;
}

export function render(state, { ui }) {
  const visitedCount = state.route.filter((s) => s.visited).length;
  return html`
    <section class="screen route" aria-labelledby="route-title">
      <p class="eyebrow">오늘의 경로</p>
      <h1 id="route-title" class="title" tabindex="-1">흘러가는 대로,<br>오늘의 길</h1>
      <blockquote class="philosophy">계획은 바뀌어도 괜찮아요. 오늘은 당신의 하루니까요.</blockquote>

      ${state.route.length
        ? html`
            <p class="route-summary">${state.route.length}곳을 담았고, ${visitedCount ? `${visitedCount}곳에 다녀왔어요.` : '아직 아무 데도 안 갔어도 괜찮아요.'}</p>
            <ol class="stops">${state.route.map((stop, i) => stopItem(stop, i, state.route.length, state, ui))}</ol>`
        : emptyState({
            title: '아직 담은 곳이 없어요',
            body: '마음에 드는 곳을 하나만 찾아도, 오늘은 이미 시작된 거예요.',
            actionLabel: '첫 목적지 추천받기',
            href: '#discover',
          })}

      <div class="actions route-actions">
        ${state.currentId ? html`<a class="button button-secondary" href="#explore">근처에서 더 발견하기</a>` : ''}
        <button type="button" class="button button-ghost" data-action="new-destination">새로운 곳 추천받기</button>
      </div>
    </section>`;
}

export const actions = {
  'move-up': ({ store }, data) => store.actions.moveInRoute(data.id, -1),
  'move-down': ({ store }, data) => store.actions.moveInRoute(data.id, 1),
  'toggle-visited': ({ store }, data) => store.actions.toggleVisited(data.id),
  replace: ({ store, ui, rerender }, data) => {
    if (ui.replacingId === data.id) {
      ui.replacingId = null;
    } else {
      const target = getPlaceById(data.id);
      ui.replacingId = data.id;
      ui.replacementOptions = suggestReplacements({
        places: getAllPlaces(),
        target,
        excludeIds: store.getState().route.map((s) => s.id),
      }).map((p) => p.id);
    }
    rerender();
  },
  'replace-cancel': ({ ui, rerender }) => {
    ui.replacingId = null;
    rerender();
  },
  'replace-with': ({ store, ui, announce }, data) => {
    ui.replacingId = null;
    const oldName = getPlaceById(data.id)?.name;
    const next = getPlaceById(data.newId);
    if (store.actions.replaceInRoute(data.id, data.newId)) {
      announce(`‘${oldName}’ 대신 ‘${next.name}’을(를) 담았어요.`);
      document.querySelector(`[data-focus-key="item-${data.newId}"]`)?.focus();
    }
  },
  'explore-from': ({ store, navigate }, data) => {
    store.actions.setCurrent(data.id);
    navigate('explore');
  },
  remove: ({ store, toast }, data) => {
    const name = getPlaceById(data.id)?.name;
    const removed = store.actions.removeFromRoute(data.id);
    if (removed) {
      toast(`‘${name}’을(를) 뺐어요.`, { label: '되돌리기', run: ({ store: s }) => s.actions.restoreRouteEntry(removed) });
      document.getElementById('route-title')?.focus();
    }
  },
  'new-destination': ({ store, navigate }) => {
    if (needsLocation(store.getState())) {
      navigate('home');
      return;
    }
    store.actions.startDay();
    navigate('discover');
  },
};
