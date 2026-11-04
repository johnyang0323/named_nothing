import { moods, smallSuggestions } from '../data/places.js';
import { formatKoreanDate, hashString } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { horizonVisual } from './placeVisual.js';

function todaysSuggestion(state) {
  const base = hashString(state.date);
  return smallSuggestions[(base + state.suggestionOffset) % smallSuggestions.length];
}

export function render(state) {
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

export const inputs = {
  mood: ({ store }, el) => store.actions.setMood(el.value),
};
