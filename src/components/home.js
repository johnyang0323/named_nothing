/**
 * Home, as two short steps that each fit on one screen (no scrolling):
 *   1. 어디서 시작할까요?  — search / current location / tap the map
 *   2. 어떤 하루가 끌리세요? — mood, one-line small suggestion, start
 * Without Kakao (sample data) there is no location step.
 */
import { moods, smallSuggestions } from '../data/places.js';
import { formatKoreanDate, hashString } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { isKakaoConfigured } from '../services/kakao/config.js';
import { searchArea, searchAreaAt } from '../services/kakao/areaSearch.js';
import { mountAreaPicker } from '../services/kakao/picker.js';
import { canUseLocation, getCurrentPosition } from '../services/geolocation.js';
import { TIME_BUDGETS } from '../services/personalize.js';

/** With real places available, nothing is recommended until a starting point is set. */
export const needsLocation = (state) => isKakaoConfigured() && !state.area;

function currentStep(state, ui) {
  if (!isKakaoConfigured()) return 'mood';
  if (!state.area) return 'place';
  return ui.homeStep === 'place' ? 'place' : 'mood';
}

function todaysSuggestion(state) {
  const base = hashString(state.date);
  return smallSuggestions[(base + state.suggestionOffset) % smallSuggestions.length];
}

function stepEyebrow(step) {
  if (!isKakaoConfigured()) return formatKoreanDate(new Date());
  return `${formatKoreanDate(new Date())} · ${step === 'place' ? '1' : '2'} / 2`;
}

function placeStep(state, ui) {
  const loading = ui.areaStatus === 'loading';
  const error = ui.areaStatus && ui.areaStatus.error;
  return html`
    <section class="screen home home-flow home-place" aria-labelledby="home-title">
      <p class="eyebrow">${stepEyebrow('place')}</p>
      <h1 id="home-title" class="flow-title" tabindex="-1">어디서 시작할까요?</h1>

      <form class="area-form" data-form="area" novalidate>
        <label class="visually-hidden" for="area-query">동네 이름</label>
        <input id="area-query" class="area-input" type="text" inputmode="search" placeholder="동네·역 이름 (예: 망원동)" autocomplete="off" maxlength="40" value="${ui.areaQuery || ''}" data-input="area-query" data-focus-key="area-query">
        <button type="submit" class="button button-secondary button-small" data-focus-key="area-submit" ${loading ? 'disabled' : ''}>${loading ? '찾는 중…' : '찾기'}</button>
      </form>

      <div class="area-map-wrap">
        <div class="area-map area-map-slot" data-area-map>지도를 불러오는 중…</div>
        ${canUseLocation()
          ? html`<button type="button" class="map-chip map-chip-gps" data-action="use-location" data-focus-key="use-location" ${loading ? 'disabled' : ''}>◎ 현재 위치</button>`
          : ''}
        <p class="map-hint" aria-hidden="true">지도를 눌러 핀을 꽂아도 돼요</p>
        <button type="button" class="button button-primary button-small map-confirm" data-action="use-picked" data-focus-key="use-picked" ${ui.pick ? '' : 'hidden'} ${loading ? 'disabled' : ''}>이 위치에서 시작하기</button>
      </div>

      ${error
        ? html`<p class="area-error" role="alert">${error}</p>`
        : html`<p class="fine-print">위치는 근처 장소를 찾을 때만 쓰고, 약 100m 단위로 어림해서 저장해요.${state.route.length ? ' 위치를 바꾸면 오늘 경로는 새로 시작돼요.' : ''}</p>`}
      ${state.area ? html`<button type="button" class="text-button text-button-muted flow-back" data-action="to-mood">${state.area.label}에서 계속하기 →</button>` : ''}
    </section>`;
}

function weatherBadge(context) {
  const w = context?.weather;
  if (!w) return '';
  return html`<span class="weather-badge" title="날씨: Open-Meteo">
    <span aria-hidden="true">${w.icon}</span> ${w.label} ${w.temp}°${context.badWeather ? html`<span class="weather-note"> · 실내 위주로</span>` : ''}
  </span>`;
}

function moodStep(state, context) {
  const suggestion = todaysSuggestion(state);
  const stops = state.route.length;
  return html`
    <section class="screen home home-flow home-mood" aria-labelledby="home-title">
      <p class="eyebrow">${stepEyebrow('mood')}</p>
      <div class="context-row">
        ${state.area
          ? html`<button type="button" class="place-chip" data-action="to-place" data-focus-key="to-place" aria-label="출발 위치 바꾸기 (지금: ${state.area.label})">
              <span class="place-chip-dot" aria-hidden="true"></span>${state.area.label}<span class="place-chip-edit" aria-hidden="true">바꾸기</span>
            </button>`
          : ''}
        ${weatherBadge(context)}
      </div>
      <h1 id="home-title" class="flow-title" tabindex="-1">어떤 하루가 끌리세요?</h1>

      <fieldset class="budget">
        <legend class="budget-label">쓸 수 있는 시간</legend>
        <div class="budget-options">
          ${TIME_BUDGETS.map(
            (b) => html`<label class="budget-chip">
              <input type="radio" name="budget" value="${b.id}" data-input="budget" data-focus-key="budget-${b.id}" ${state.timeBudget === b.id ? 'checked' : ''}>
              <span>${b.label}</span>
            </label>`,
          )}
        </div>
      </fieldset>

      <fieldset class="moods">
        <legend class="visually-hidden">오늘의 기분</legend>
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

      <p class="small-suggestion">
        <span class="small-suggestion-label">오늘의 작은 제안</span>
        <span class="small-suggestion-text">${suggestion.body}</span>
        <button type="button" class="text-button" data-action="next-suggestion" data-focus-key="next-suggestion" aria-label="다른 작은 제안 보기">다른 제안</button>
      </p>

      <div class="cta-area">
        <button type="button" class="button button-primary button-wide" data-action="start" data-focus-key="start">오늘 시작하기</button>
        ${stops ? html`<p class="resume">오늘 담아둔 곳 ${stops}곳 · <a href="#route">이어서 보기</a></p>` : ''}
      </div>
    </section>`;
}

export function render(state, { ui, context }) {
  return currentStep(state, ui) === 'place' ? placeStep(state, ui) : moodStep(state, context?.());
}

export const actions = {
  'next-suggestion': ({ store }) => store.actions.nextSmallSuggestion(),
  start: (ctx) => {
    if (needsLocation(ctx.store.getState())) {
      ctx.ui.homeStep = 'place';
      ctx.ui.areaStatus = { error: '어디서 시작할지 먼저 정해주세요. 위치 없이는 추천하지 않아요.' };
      ctx.rerender();
      return;
    }
    ctx.store.actions.startDay();
    ctx.navigate('discover');
  },
  'to-place': (ctx) => goToStep(ctx, 'place'),
  'to-mood': (ctx) => goToStep(ctx, 'mood'),
};

function goToStep({ ui, rerender }, step) {
  ui.homeStep = step;
  ui.areaStatus = null;
  rerender();
  document.getElementById('home-title')?.focus({ preventScroll: true });
}

export const inputs = {
  mood: ({ store }, el) => store.actions.setMood(el.value),
  budget: ({ store }, el) => store.actions.setTimeBudget(el.value),
  'area-query': ({ ui }, el) => {
    ui.areaQuery = el.value;
  },
};

/** Shared loading / success / error handling for every way of picking an area. */
async function runAreaSearch(ctx, find) {
  const { store, ui, rerender, announce } = ctx;
  if (ui.areaStatus === 'loading') return;
  ui.areaStatus = 'loading';
  rerender();
  announce('근처 장소를 찾고 있어요.');
  try {
    const area = await find();
    ui.areaStatus = null;
    ui.pick = null;
    ui.homeStep = 'mood'; // location set → straight to the next step
    store.actions.setArea(area);
    announce(`${area.label} 근처에서 ${area.places.length}곳을 찾았어요. 이제 어떤 하루가 끌리는지 골라주세요.`);
    document.getElementById('home-title')?.focus({ preventScroll: true });
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

/** Mount (or re-attach) the tap-to-pick map on the location step. */
export function afterRender(state, { ui, announce }) {
  const slot = document.querySelector('[data-area-map]');
  if (!slot) return;
  mountAreaPicker(slot, {
    focus: ui.pick || state.area?.center || null,
    onPick: (point) => {
      ui.pick = point;
      const button = document.querySelector('[data-action="use-picked"]');
      if (button) button.hidden = false;
      document.querySelector('.map-hint')?.setAttribute('hidden', '');
      announce('지도에 위치를 표시했어요. ‘이 위치에서 시작하기’를 누르면 그 근처로 추천해 드려요.');
    },
  });
}
