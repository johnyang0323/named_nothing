import { getPlaceById } from '../services/placeRepository.js';
import { FEELINGS, NOTE_MAX_LENGTH } from '../services/store.js';
import { formatKoreanDate } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel } from './common.js';

function summarize(state) {
  const visited = state.route.filter((s) => s.visited).length;
  const kept = state.route.length;
  if (!kept) return '아직 아무 곳에도 가지 않았어도 괜찮아요. 오늘은 아직 끝나지 않았으니까요.';
  if (!visited) return `오늘은 ${kept}곳을 마음에 담아두었어요. 가보지 않아도, 궁금해진 것만으로 충분해요.`;
  if (visited === kept) return `오늘은 ${visited}곳에 다녀왔어요. 계획 없이 시작한 하루치고 꽤 멋진 이야기네요.`;
  return `오늘은 ${kept}곳을 담았고, 그중 ${visited}곳에 다녀왔어요. 나머지는 다음 날의 이유로 남겨둬요.`;
}

function draft(state, ui) {
  if (!ui.journalDraft || ui.journalDraft.date !== state.date) {
    ui.journalDraft = { date: state.date, note: state.journal.note, feeling: state.journal.feeling };
  }
  return ui.journalDraft;
}

const placeList = (stops) =>
  html`<ul class="memory-list">
    ${stops.map((s) => {
      const p = getPlaceById(s.id);
      return html`<li><span class="memory-name">${p.name}</span><span class="memory-meta">${categoryLabel(p)}</span></li>`;
    })}
  </ul>`;

export function render(state, { ui }) {
  const d = draft(state, ui);
  const visited = state.route.filter((s) => s.visited);
  const notYet = state.route.filter((s) => !s.visited);
  const savedAt = state.journal.savedAt ? new Date(state.journal.savedAt) : null;
  const dirty = d.note !== state.journal.note || d.feeling !== state.journal.feeling;

  return html`
    <section class="screen myday" aria-labelledby="myday-title">
      <p class="eyebrow">${formatKoreanDate(new Date())} · ${moodLabel(state.mood)}</p>
      <h1 id="myday-title" class="title" tabindex="-1">나의 하루</h1>
      <p class="lede">${summarize(state)}</p>

      <section class="block" aria-labelledby="visited-title">
        <h2 class="section-label" id="visited-title">다녀온 곳</h2>
        ${visited.length ? placeList(visited) : html`<p class="empty-body">아직 다녀온 곳으로 표시한 곳이 없어요.</p>`}
      </section>

      ${notYet.length
        ? html`<section class="block" aria-labelledby="kept-title">
            <h2 class="section-label" id="kept-title">담아두었던 곳</h2>
            ${placeList(notYet)}
            <p class="fine-print">못 가도 괜찮아요. 다음에 가볼 이유가 하나 생긴 거예요.</p>
          </section>`
        : ''}

      <form class="block journal" data-form="journal" novalidate>
        <h2 class="section-label">한 줄 남기기 <span class="optional">(선택)</span></h2>
        <fieldset class="feelings">
          <legend class="visually-hidden">오늘의 기분</legend>
          ${FEELINGS.map(
            (f) => html`<button type="button" class="chip ${d.feeling === f ? 'is-on' : ''}" data-action="feeling" data-value="${f}" data-focus-key="feeling-${f}" aria-pressed="${d.feeling === f ? 'true' : 'false'}">${f}</button>`,
          )}
        </fieldset>
        <label class="note-label" for="journal-note">오늘을 기억할 한 문장</label>
        <textarea id="journal-note" class="note" rows="3" maxlength="${NOTE_MAX_LENGTH}" data-input="note" placeholder="예: 처음 가본 골목에서 고양이를 만났다.">${d.note}</textarea>
        <div class="journal-foot">
          <span class="counter" data-counter>${d.note.length}/${NOTE_MAX_LENGTH}</span>
          <button type="submit" class="button button-primary button-small" data-focus-key="save-journal">기록 저장</button>
        </div>
        <p class="save-status" role="status">
          ${savedAt && !dirty ? `${savedAt.getHours()}시 ${String(savedAt.getMinutes()).padStart(2, '0')}분에 이 기기에 저장했어요.` : dirty ? '저장하지 않은 변경이 있어요.' : ''}
        </p>
      </form>

      <section class="block reset" aria-labelledby="reset-title">
        <h2 class="section-label" id="reset-title">새로 시작하기</h2>
        ${ui.confirmReset
          ? html`<p>오늘 담은 곳과 기록을 이 기기에서 모두 지울까요?</p>
              <div class="actions">
                <button type="button" class="button button-secondary" data-action="reset-confirm" data-focus-key="reset-confirm">네, 지울게요</button>
                <button type="button" class="text-button" data-action="reset-cancel">취소</button>
              </div>`
          : html`<p class="fine-print">오늘의 기록은 이 브라우저에만 저장돼요.</p>
              <button type="button" class="text-button text-button-muted" data-action="reset" data-focus-key="reset">오늘 기록 지우기</button>`}
      </section>
    </section>`;
}

export const actions = {
  feeling: ({ ui, rerender }, data) => {
    ui.journalDraft.feeling = ui.journalDraft.feeling === data.value ? null : data.value;
    rerender();
  },
  reset: ({ ui, rerender }) => {
    ui.confirmReset = true;
    rerender();
    document.querySelector('[data-focus-key="reset-confirm"]')?.focus();
  },
  'reset-cancel': ({ ui, rerender }) => {
    ui.confirmReset = false;
    rerender();
    document.querySelector('[data-focus-key="reset"]')?.focus();
  },
  'reset-confirm': ({ store, ui, navigate, toast }) => {
    ui.confirmReset = false;
    ui.journalDraft = null;
    store.actions.resetDay();
    toast('오늘을 새로 시작해요.');
    navigate('home');
  },
};

export const inputs = {
  note: ({ ui }, el) => {
    ui.journalDraft.note = el.value;
    const counter = document.querySelector('[data-counter]');
    if (counter) counter.textContent = `${el.value.length}/${NOTE_MAX_LENGTH}`;
    const status = document.querySelector('.save-status');
    if (status) status.textContent = '저장하지 않은 변경이 있어요.';
  },
};

export const forms = {
  journal: ({ store, ui, announce }) => {
    store.actions.saveJournal(ui.journalDraft);
    ui.journalDraft = null;
    announce('기록을 저장했어요.');
  },
};
