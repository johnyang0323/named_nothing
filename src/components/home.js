import { moods, smallSuggestions } from '../data/places.js';
import { formatKoreanDate, hashString } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { horizonVisual } from './placeVisual.js';
import { isKakaoConfigured } from '../services/kakao/config.js';
import { searchArea, searchAreaAt } from '../services/kakao/areaSearch.js';
import { canUseLocation, getCurrentPosition } from '../services/geolocation.js';

function areaSection(state, ui) {
  if (!isKakaoConfigured()) return '';
  const loading = ui.areaStatus === 'loading';
  const error = ui.areaStatus && ui.areaStatus.error;
  return html`
    <section class="block area" aria-labelledby="area-title">
      <h2 class="section-label" id="area-title">어디서 시작할까요? <span class="optional">(선택)</span></h2>
      ${state.area
        ? html`<p class="area-help"><strong>${state.area.label}</strong> 근처의 실제 장소로 추천하고 있어요.
            <button type="button" class="text-button" data-action="clear-area" data-focus-key="clear-area">예시 장소로 돌아가기</button></p>`
        : html`<p class="area-help">동네 이름을 적으면 그 근처의 실제 장소로 추천해요. 비워두면 예시 장소로 시작해요.</p>`}
      <form class="area-form" data-form="area" novalidate>
        <label class="visually-hidden" for="area-query">동네 이름</label>
        <input id="area-query" class="area-input" type="text" inputmode="search" placeholder="예: 망원동, 성수역" autocomplete="off" maxlength="40" value="${ui.areaQuery || ''}" data-input="area-query" data-focus-key="area-query">
        <button type="submit" class="button button-secondary button-small" data-focus-key="area-submit" ${loading ? 'disabled' : ''}>${loading ? '찾는 중…' : '동네 찾기'}</button>
      </form>
      ${canUseLocation()
        ? html`<p class="area-gps">
            <button type="button" class="text-button" data-action="use-location" data-focus-key="use-location" ${loading ? 'disabled' : ''}>현재 위치로 찾기</button>
            <span class="fine-print">위치는 근처 장소를 찾을 때만 쓰고, 약 100m 단위로 어림해서 이 기기에만 저장해요.</span>
          </p>`
        : ''}
      ${state.route.length ? html`<p class="fine-print">동네를 바꾸면 오늘 담은 경로는 새로 시작돼요.</p>` : ''}
      ${error ? html`<p class="area-error">${error}</p>` : ''}
    </section>`;
}

function todaysSuggestion(state) {
  const base = hashString(state.date);
  return smallSuggestions[(base + state.suggestionOffset) % smallSuggestions.length];
}

export function render(state, { ui }) {
  const suggestion = todaysSuggestion(state);
  const stops = state.route.length;
  return html`
    <section class="screen home" aria-labelledby="home-title">
      <p class="eyebrow">${formatKoreanDate(new Date())}</p>
      <h1 id="home-title" class="display" tabindex="-1">오늘은 어디로<br>가볼까요?</h1>
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

      ${areaSection(state, ui)}

      <div class="cta-area">
        <button type="button" class="button button-primary button-wide" data-action="start">오늘 시작하기</button>
        ${stops
          ? html`<p class="resume">오늘 담아둔 곳이 ${stops}곳 있어요. <a href="#route">이어서 보기</a></p>`
          : html`<p class="resume">고르기 어렵다면 그대로 시작해도 돼요.</p>`}
      </div>
    </section>`;
}

export const actions = {
  'next-suggestion': ({ store }) => store.actions.nextSmallSuggestion(),
  start: ({ store, navigate }) => {
    store.actions.startDay();
    navigate('discover');
  },
};

actions['clear-area'] = ({ store, ui, announce }) => {
  ui.areaStatus = null;
  store.actions.setArea(null);
  announce('예시 장소로 돌아왔어요.');
};

export const inputs = {
  mood: ({ store }, el) => store.actions.setMood(el.value),
  'area-query': ({ ui }, el) => {
    ui.areaQuery = el.value;
  },
};

/** Shared loading / success / error handling for both ways of picking an area. */
async function runAreaSearch({ store, ui, rerender, announce }, find) {
  if (ui.areaStatus === 'loading') return;
  ui.areaStatus = 'loading';
  rerender();
  announce('근처 장소를 찾고 있어요.');
  try {
    const area = await find();
    ui.areaStatus = null;
    store.actions.setArea(area);
    announce(`${area.label} 근처에서 ${area.places.length}곳을 찾았어요.`);
  } catch (error) {
    ui.areaStatus = { error: error.message || '동네를 찾지 못했어요.' };
    rerender();
    announce(ui.areaStatus.error);
  }
}

actions['use-location'] = (ctx) => runAreaSearch(ctx, async () => searchAreaAt(await getCurrentPosition()));

export const forms = {
  area: (ctx) => runAreaSearch(ctx, () => searchArea(ctx.ui.areaQuery)),
};
