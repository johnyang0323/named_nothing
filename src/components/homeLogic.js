/** Home's rules and actions, shared by the React screen and other screens. */
import { smallSuggestions } from '../data/places.js';
import { formatKoreanDate, hashString } from '../utils/date.js';
import { isMapsConfigured as isKakaoConfigured, searchArea, searchAreaAt } from '../services/geo.js';
import { getCurrentPosition } from '../services/geolocation.js';

/** With real places available, nothing is recommended until a starting point is set. */
export const needsLocation = (state) => isKakaoConfigured() && !state.area;

export function currentStep(state, ui) {
  if (!isKakaoConfigured()) return 'mood';
  if (!state.area) return 'place';
  return ui.homeStep === 'place' ? 'place' : 'mood';
}

export function todaysSuggestion(state) {
  const base = hashString(state.date);
  return smallSuggestions[(base + state.suggestionOffset) % smallSuggestions.length];
}

export function stepEyebrow(step) {
  if (!isKakaoConfigured()) return formatKoreanDate(new Date());
  return `${formatKoreanDate(new Date())} · ${step === 'place' ? '1' : '2'} / 2`;
}

export function focusTitle() {
  requestAnimationFrame(() => document.getElementById('home-title')?.focus({ preventScroll: true }));
}

export function goToStep(ctx, step) {
  ctx.ui.homeStep = step;
  ctx.ui.areaStatus = null;
  ctx.rerender();
  focusTitle();
}

export function start(ctx) {
  if (needsLocation(ctx.store.getState())) {
    ctx.ui.homeStep = 'place';
    ctx.ui.areaStatus = { error: '어디서 시작할지 먼저 정해주세요. 위치 없이는 추천하지 않아요.' };
    ctx.rerender();
    return;
  }
  ctx.store.actions.startDay();
  ctx.navigate('discover');
}

/** Shared loading / success / error handling for every way of picking an area. */
export async function runAreaSearch(ctx, find) {
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
    focusTitle();
  } catch (error) {
    ui.areaStatus = { error: error.message || '동네를 찾지 못했어요.' };
    rerender();
    announce(ui.areaStatus.error);
  }
}

export const searchByName = (ctx) => runAreaSearch(ctx, () => searchArea(ctx.ui.areaQuery));
export const searchByLocation = (ctx) => runAreaSearch(ctx, async () => searchAreaAt(await getCurrentPosition(), { origin: 'gps' }));
export const searchByPick = (ctx) => ctx.ui.pick && runAreaSearch(ctx, () => searchAreaAt(ctx.ui.pick, { origin: 'map' }));
