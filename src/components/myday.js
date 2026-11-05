import { getPlaceById } from '../services/placeRepository.js';
import { FEELINGS, NOTE_MAX_LENGTH } from '../services/store.js';
import { formatKoreanDate } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel } from './common.js';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser, displayName, avatarUrl, signOut, deleteAccount } from '../services/backend/auth.js';
import { places as samplePlaces } from '../data/places.js';
import { checkPhotoService } from '../services/photos.js';
import { tasteSummary, MIN_EVENTS } from '../services/personalize.js';

function tasteSection(taste) {
  if (!taste) return '';
  const t = taste.get();
  const { liked, less } = tasteSummary(t);
  let body;
  if (t.events < MIN_EVENTS) {
    body = html`<p class="empty-body">아직 배운 게 없어요. 가보기, 다른 곳 보기, 다녀왔어요를 누르다 보면 조금씩 알아가요.</p>`;
  } else if (liked.length || less.length) {
    body = html`
      ${liked.length ? html`<p class="taste-line">자주 고른 곳 <strong>${liked.join(' · ')}</strong></p>` : ''}
      ${less.length ? html`<p class="taste-line">덜 끌렸던 곳 <strong>${less.join(' · ')}</strong></p>` : ''}`;
  } else {
    body = html`<p class="empty-body">아직 뚜렷한 취향은 보이지 않아요. 고르는 대로 조금씩 알아갈게요.</p>`;
  }
  return html`
    <section class="block taste" aria-labelledby="taste-title">
      <h2 class="section-label" id="taste-title">나의 취향</h2>
      ${body}
      <p class="fine-print">고른 곳과 다녀온 곳, 그날의 기분으로만 배워요. 추천의 일부는 일부러 평소와 다른 곳으로 섞어요. 우연한 발견도 하루의 일부니까요.</p>
      <p class="fine-print">날씨·시간대·쓸 수 있는 시간도 함께 반영해요. 날씨 정보: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0)</p>
      <div class="taste-controls">
        <label class="toggle">
          <input type="checkbox" data-input="taste-enabled" data-focus-key="taste-enabled" ${t.enabled ? 'checked' : ''}>
          <span>추천에 취향 반영하기</span>
        </label>
        ${t.events ? html`<button type="button" class="text-button text-button-muted" data-action="taste-reset" data-focus-key="taste-reset">취향 초기화</button>` : ''}
      </div>
    </section>`;
}

export function syncLine(sync) {
  const { status, lastSavedAt } = sync.getStatus();
  if (status === 'syncing') return html`<span>저장하는 중…</span>`;
  if (status === 'error') {
    return html`<span>계정에 저장하지 못했어요. 이 기기에는 남아 있어요.</span>
      <button type="button" class="text-button" data-action="sync-retry">다시 시도</button>`;
  }
  if (status === 'saved' && lastSavedAt) {
    return html`<span>${lastSavedAt.getHours()}시 ${String(lastSavedAt.getMinutes()).padStart(2, '0')}분에 계정에 저장했어요.</span>`;
  }
  return '';
}

function accountSection(sync, ui) {
  const user = getUser();
  if (!isBackendConfigured() || !user) return '';
  return html`
    <section class="block account" aria-labelledby="account-title">
      <h2 class="section-label" id="account-title">계정</h2>
      <div class="account-who">
        <span class="avatar" aria-hidden="true">
          <span class="avatar-initial">${Array.from(displayName(user))[0] || '·'}</span>
          ${avatarUrl(user) ? html`<img class="avatar-img" src="${avatarUrl(user)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}
        </span>
        <p class="account-line"><strong>${displayName(user)}</strong> 계정에 오늘을 저장하고 있어요.</p>
      </div>
      <p class="account-sync" role="status">${syncLine(sync)}</p>
      <div class="account-actions">
        <button type="button" class="text-button text-button-muted" data-action="sign-out" data-focus-key="sign-out">로그아웃</button>
        ${ui.confirmDelete ? '' : html`<button type="button" class="text-button text-button-muted" data-action="delete-account" data-focus-key="delete-account">계정 삭제</button>`}
      </div>
      ${ui.confirmDelete ? deleteConfirm(ui) : ''}
    </section>`;
}

function deleteConfirm(ui) {
  const busy = ui.confirmDelete === 'busy';
  return html`
    <div class="danger-zone" role="group" aria-labelledby="delete-title">
      <p class="danger-title" id="delete-title">계정을 삭제할까요?</p>
      <p class="fine-print">계정과 함께 지금까지의 모든 하루 기록, 나의 취향, 사진 투표가 <strong>영구히</strong> 지워져요. 되돌릴 수 없어요.</p>
      <div class="actions">
        <button type="button" class="button button-danger button-small" data-action="delete-account-confirm" data-focus-key="delete-account-confirm" ${busy ? 'disabled' : ''}>${busy ? '삭제하는 중…' : '네, 모두 삭제할게요'}</button>
        <button type="button" class="text-button" data-action="delete-account-cancel" ${busy ? 'disabled' : ''}>취소</button>
      </div>
      ${ui.deleteError ? html`<p class="area-error" role="alert">${ui.deleteError}</p>` : ''}
    </div>`;
}

/** Resolve a stored day's place ids to names using that day's own places. */
function dayPlaceNames(day, ids) {
  const pool = new Map([...samplePlaces, ...(day.area?.places || [])].map((p) => [p.id, p.name]));
  return ids.map((id) => pool.get(id)).filter(Boolean);
}

function historySection(ui) {
  const list = ui.history;
  if (!list || !list.length) return '';
  return html`
    <section class="block history" aria-labelledby="history-title">
      <h2 class="section-label" id="history-title">지난 날들</h2>
      <ol class="history-list">
        ${list.map((day) => {
          const route = Array.isArray(day.route) ? day.route : [];
          const visited = dayPlaceNames(day, route.filter((s) => s?.visited).map((s) => s.id));
          const note = day.journal?.note;
          const feeling = day.journal?.feeling;
          const date = new Date(`${day.date}T12:00:00`);
          return html`
            <li class="history-item">
              <p class="kicker">${Number.isNaN(date.getTime()) ? day.date : formatKoreanDate(date)}${day.area?.label ? ` · ${day.area.label}` : ''}${feeling ? ` · ${feeling}` : ''}</p>
              ${note ? html`<p class="history-note">${note}</p>` : ''}
              <p class="history-meta">${visited.length ? `다녀온 곳: ${visited.join(', ')}` : route.length ? `${route.length}곳을 담아두었던 날` : '조용히 지나간 날'}</p>
            </li>`;
        })}
      </ol>
    </section>`;
}

export function onEnter({ ui, sync, getScreen }) {
  ui.history = ui.history || null;
  sync.history().then((list) => {
    ui.history = list;
    // fill just that section: a full redraw could interrupt someone typing a note
    const slot = getScreen() === 'day' && document.querySelector('[data-history-slot]');
    if (slot) slot.innerHTML = String(historySection(ui));
  });
}

function summarize(state) {
  const visited = state.route.filter((s) => s.visited).length;
  const kept = state.route.length;
  if (!kept) return '아직 아무 곳에도 가지 않았어도 괜찮아요. 오늘은 아직 끝나지 않았으니까요.';
  if (!visited) return `오늘은 ${kept}곳을 마음에 담아두었어요. 가보지 않아도, 궁금해진 것만으로 충분해요.`;
  if (visited === kept) return `오늘은 ${visited}곳에 다녀왔어요. 계획 없이 시작한 하루치고 꽤 멋진 이야기네요.`;
  return `오늘은 ${kept}곳을 담았고, 그중 ${visited}곳에 다녀왔어요. 나머지는 다음 날의 이유로 남겨둬요.`;
}

function draft(state, ui) {
  const saved = state.journal;
  const d = ui.journalDraft;
  // keep unsaved edits; otherwise follow the saved journal (it can change from another device)
  const untouched = d && d.note === d.baseNote && d.feeling === d.baseFeeling;
  if (!d || d.date !== state.date || (untouched && (d.baseNote !== saved.note || d.baseFeeling !== saved.feeling))) {
    ui.journalDraft = { date: state.date, note: saved.note, feeling: saved.feeling, baseNote: saved.note, baseFeeling: saved.feeling };
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

export function render(state, { ui, sync, taste }) {
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
        <textarea id="journal-note" class="note" rows="3" maxlength="${NOTE_MAX_LENGTH}" data-input="note" data-focus-key="journal-note" placeholder="예: 처음 가본 골목에서 고양이를 만났다.">${d.note}</textarea>
        <div class="journal-foot">
          <span class="counter" data-counter>${d.note.length}/${NOTE_MAX_LENGTH}</span>
          <button type="submit" class="button button-primary button-small" data-focus-key="save-journal">기록 저장</button>
        </div>
        <p class="save-status" role="status">
          ${savedAt && !dirty ? `${savedAt.getHours()}시 ${String(savedAt.getMinutes()).padStart(2, '0')}분에 이 기기에 저장했어요.` : dirty ? '저장하지 않은 변경이 있어요.' : ''}
        </p>
      </form>

      ${accountSection(sync, ui)}

      ${tasteSection(taste)}

      <div data-history-slot>${historySection(ui)}</div>

      ${isBackendConfigured()
        ? html`<section class="block diagnostics" aria-labelledby="diag-title">
            <h2 class="section-label" id="diag-title">연결 점검</h2>
            <p class="fine-print">장소 사진이 안 보일 때 눌러보세요. 무엇이 문제인지 알려드려요.</p>
            <button type="button" class="button button-ghost button-small" data-action="check-photos" data-focus-key="check-photos" ${ui.photoCheck === 'running' ? 'disabled' : ''}>
              ${ui.photoCheck === 'running' ? '점검하는 중…' : '사진 기능 점검'}
            </button>
            ${ui.photoCheck && ui.photoCheck !== 'running'
              ? html`<div class="diag-result ${ui.photoCheck.ok ? 'is-ok' : 'is-bad'}" role="status">
                  <p>${ui.photoCheck.ok ? '✓ ' : '✕ '}${ui.photoCheck.message}</p>
                  ${ui.photoCheck.detail ? html`<p class="diag-detail">${ui.photoCheck.detail}</p>` : ''}
                </div>`
              : ''}
          </section>`
        : ''}

      <p class="legal-links">
        <a href="./privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a>
        <span aria-hidden="true">·</span>
        <a href="./terms.html" target="_blank" rel="noopener">이용약관</a>
      </p>

      <section class="block reset" aria-labelledby="reset-title">
        <h2 class="section-label" id="reset-title">새로 시작하기</h2>
        ${ui.confirmReset
          ? html`<p>오늘 담은 곳과 기록을 ${getUser() ? '이 기기와 계정에서' : '이 기기에서'} 모두 지울까요?</p>
              <div class="actions">
                <button type="button" class="button button-secondary" data-action="reset-confirm" data-focus-key="reset-confirm">네, 지울게요</button>
                <button type="button" class="text-button" data-action="reset-cancel">취소</button>
              </div>`
          : html`<p class="fine-print">${getUser() ? '오늘의 기록은 이 기기와 계정에 저장돼요. 지난 날들은 그대로 남아요.' : '오늘의 기록은 이 브라우저에만 저장돼요.'}</p>
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

/** Clear everything personal from this device (after sign-out or deletion). */
function leaveDevice(ctx) {
  ctx.store.actions.forgetDevice();
  ctx.taste.forgetDevice();
  ctx.sync.forgetOwner();
  ctx.ui.journalDraft = null;
  ctx.ui.history = null;
  ctx.ui.confirmDelete = false;
  ctx.ui.deleteError = '';
}

actions['delete-account'] = ({ ui, rerender }) => {
  ui.confirmDelete = true;
  ui.deleteError = '';
  rerender();
  document.querySelector('[data-focus-key="delete-account-confirm"]')?.focus();
};
actions['delete-account-cancel'] = ({ ui, rerender }) => {
  ui.confirmDelete = false;
  ui.deleteError = '';
  rerender();
  document.querySelector('[data-focus-key="delete-account"]')?.focus();
};
actions['delete-account-confirm'] = async (ctx) => {
  ctx.ui.confirmDelete = 'busy';
  ctx.rerender();
  try {
    await deleteAccount();
    leaveDevice(ctx);
    ctx.toast('계정과 모든 기록을 삭제했어요. 그동안 고마웠어요.');
  } catch (error) {
    ctx.ui.confirmDelete = true;
    ctx.ui.deleteError = error.message || '계정을 삭제하지 못했어요.';
    ctx.rerender();
  }
};

actions['sign-out'] = async (ctx) => {
  // save the latest changes first, then leave nothing behind on this device
  await ctx.sync.flush();
  await ctx.taste.flush();
  await signOut();
  leaveDevice(ctx);
  ctx.toast('로그아웃했어요. 기록은 계정에 남아 있어요.');
};
actions['sync-retry'] = ({ sync }) => sync.retry();
actions['taste-reset'] = ({ taste, toast }) => {
  const previous = taste.reset();
  toast('취향을 초기화했어요.', { label: '되돌리기', run: (ctx) => ctx.taste.restore(previous) });
};
actions['check-photos'] = async ({ ui, rerender, announce, getScreen }) => {
  ui.photoCheck = 'running';
  rerender();
  ui.photoCheck = await checkPhotoService();
  announce(ui.photoCheck.message);
  if (getScreen() === 'day') rerender();
};

export const inputs = {
  'taste-enabled': ({ taste }, el) => taste.setEnabled(el.checked),
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
