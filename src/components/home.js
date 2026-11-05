import { moods, smallSuggestions } from '../data/places.js';
import { formatKoreanDate, hashString } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { horizonVisual } from './placeVisual.js';
import { isKakaoConfigured } from '../services/kakao/config.js';
import { searchArea, searchAreaAt } from '../services/kakao/areaSearch.js';
import { mountAreaPicker } from '../services/kakao/picker.js';
import { canUseLocation, getCurrentPosition } from '../services/geolocation.js';

/** With real places available, nothing is recommended until a starting point is set. */
export const needsLocation = (state) => isKakaoConfigured() && !state.area;

function areaSection(state, ui) {
  if (!isKakaoConfigured()) return '';
  const loading = ui.areaStatus === 'loading';
  const error = ui.areaStatus && ui.areaStatus.error;
  return html`
    <section class="area area-first ${state.area ? 'is-set' : ''}" aria-labelledby="area-title" id="area">
      <h2 class="area-title" id="area-title">어디서 시작할까요?</h2>
      ${state.area
        ? html`<p class="area-help"><strong>${state.area.label}</strong> 근처 ${state.area.places.length}곳에서 골라드려요. 다른 곳에서 시작하려면 아래에서 다시 정해주세요.</p>`
        : html`<p class="area-help">동네 이름을 적거나, 현재 위치를 쓰거나, 지도를 눌러 출발할 곳을 정해주세요. 그 근처의 실제 장소로 추천해 드려요.</p>`}

      <form class="area-form" data-form="area" novalidate>
        <label class="visually-hidden" for="area-query">동네 이름</label>
        <input id="area-query" class="area-input" type="text" inputmode="search" placeholder="예: 망원동, 성수역" autocomplete="off" maxlength="40" value="${ui.areaQuery || ''}" data-input="area-query" data-focus-key="area-query">
        <button type="submit" class="button button-secondary button-small" data-focus-key="area-submit" ${loading ? 'disabled' : ''}>${loading ? '찾는 중…' : '동네 찾기'}</button>
      </form>

      ${canUseLocation()
        ? html`<button type="button" class="button button-ghost button-small area-gps-button" data-action="use-location" data-focus-key="use-location" ${loading ? 'disabled' : ''}>현재 위치로 찾기</button>`
        : ''}

      <div class="area-map-wrap">
        <div class="area-map area-map-slot" data-area-map>지도를 불러오는 중…</div>
        <p class="fine-print">지도를 누르면 핀이 꽂혀요.</p>
        <button type="button" class="button button-primary button-small" data-action="use-picked" data-focus-key="use-picked" ${ui.pick ? '' : 'hidden'} ${loading ? 'disabled' : ''}>이 위치에서 시작하기</button>
      </div>

      <p class="fine-print">위치는 근처 장소를 찾을 때만 쓰고, 약 100m 단위로 어림해서 저장해요.${state.route.length ? ' 출발 위치를 바꾸면 오늘 담은 경로는 새로 시작돼요.' : ''}</p>
      ${error ? html`<p class="area-error" role="alert">${error}</p>` : ''}
    </section>`;
}

function todaysSuggestion(state) {
  const base = hashString(state.date);
  return smallSuggestions[(base + state.suggestionOffset) % smallSuggestions.length];
}

export function render(state, { ui }) {
  const suggestion = todaysSuggestion(state);
  const stops = state.route.length;
  const blocked = needsLocation(state);
  return html`
    <section class="screen home" aria-labelledby="home-title">
      <p class="eyebrow">${formatKoreanDate(new Date())}</p>
      <h1 id="home-title" class="display" tabindex="-1">오늘은 어디로<br>가볼까요?</h1>

      ${areaSection(state, ui)}

      <p class="lede">계획이 없어도 괜찮아요. 문을 나설 작은 이유 하나면, 오늘은 충분히 이야기가 될 수 있어요.</p>

      <section class="block" aria-labelledby="suggestion-title">
        <h2 class="section-label" id="suggestion-title">오늘의 작은 제안</h2>
        <article class="suggestion-card">
          <div class="suggestion-visual">${horizonVisual(hashString(suggestion.title))}</div>
          <div class="suggestion-body">
            <h3 class="suggestion-title">${suggestion.title}</h3>
            <p>${suggestion.body}</p>
            <button type="button" class="text-button" data-action="next-suggestion" data-focus-key="next-suggestion">다른 제안 보기</button>
          </div>
        </article>
      </section>

      <fieldset class="block moods">
        <legend class="section-label">어떤 하루가 끌리세요?</legend>
        <div class="mood-grid">
          ${moods.map(
            (mood) => html`
              <label class="mood">
                <input type="radio" name="mood" value="${mood.id}" data-input="mood" data-focus-key="mood-${mood.id}" ${state.mood === mood.id ? 'checked' : ''}>
                <span class="mood-label">${mood.label}</span>
                <span class="mood-hint">${mood.hint}</span>
              </label>`,
          )}
        </div>
      </fieldset>

      <div class="cta-area">
        <button type="button" class="button button-primary button-wide" data-action="start" data-focus-key="start" aria-describedby="start-help">오늘 시작하기</button>
        <p class="resume" id="start-help">
          ${blocked
            ? '먼저 위에서 어디서 시작할지 정해주세요.'
            : stops
              ? html`오늘 담아둔 곳이 ${stops}곳 있어요. <a href="#route">이어서 보기</a>`
              : '고르기 어렵다면 그대로 시작해도 돼요.'}
        </p>
      </div>
    </section>`;
}

/** Bring the person back to the location step with a clear message. */
function askForLocation({ ui, rerender, announce }) {
  ui.areaStatus = { error: '어디서 시작할지 먼저 정해주세요. 위치 없이는 추천하지 않아요.' };
  rerender();
  announce(ui.areaStatus.error);
  document.getElementById('area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  document.getElementById('area-query')?.focus({ preventScroll: true });
}

export const actions = {
  'next-suggestion': ({ store }) => store.actions.nextSmallSuggestion(),
  start: (ctx) => {
    if (needsLocation(ctx.store.getState())) {
      askForLocation(ctx);
      return;
    }
    ctx.store.actions.startDay();
    ctx.navigate('discover');
  },
};

export const inputs = {
  mood: ({ store }, el) => store.actions.setMood(el.value),
  'area-query': ({ ui }, el) => {
    ui.areaQuery = el.value;
  },
};

/** Shared loading / success / error handling for every way of picking an area. */
async function runAreaSearch({ store, ui, rerender, announce }, find) {
  if (ui.areaStatus === 'loading') return;
  ui.areaStatus = 'loading';
  rerender();
  announce('근처 장소를 찾고 있어요.');
  try {
    const area = await find();
    ui.areaStatus = null;
    ui.pick = null;
    store.actions.setArea(area);
    announce(`${area.label} 근처에서 ${area.places.length}곳을 찾았어요.`);
  } catch (error) {
    ui.areaStatus = { error: error.message || '동네를 찾지 못했어요.' };
    rerender();
    announce(ui.areaStatus.error);
  }
}

actions['use-location'] = (ctx) => runAreaSearch(ctx, async () => searchAreaAt(await getCurrentPosition(), { origin: 'gps' }));
actions['use-picked'] = (ctx) => {
  if (!ctx.ui.pick) return;
  runAreaSearch(ctx, () => searchAreaAt(ctx.ui.pick, { origin: 'map' }));
};

export const forms = {
  area: (ctx) => runAreaSearch(ctx, () => searchArea(ctx.ui.areaQuery)),
};

/** Mount (or re-attach) the tap-to-pick map. */
export function afterRender(state, { ui, announce }) {
  const slot = document.querySelector('[data-area-map]');
  if (!slot) return;
  mountAreaPicker(slot, {
    focus: ui.pick || state.area?.center || null,
    onPick: (point) => {
      ui.pick = point;
      const button = document.querySelector('[data-action="use-picked"]');
      if (button) button.hidden = false;
      announce('지도에 위치를 표시했어요. ‘이 위치에서 시작하기’를 누르면 그 근처로 추천해 드려요.');
    },
  });
}
