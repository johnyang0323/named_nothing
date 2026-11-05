import { getPlaceById } from '../services/placeRepository.js';
import { FEELINGS, NOTE_MAX_LENGTH } from '../services/store.js';
import { formatKoreanDate } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel } from './common.js';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser, isAuthReady, displayName, avatarUrl, signInWithKakao, signInWithEmail, signUpWithEmail, signOut, PASSWORD_MIN } from '../services/backend/auth.js';
import { places as samplePlaces } from '../data/places.js';
import { checkPhotoService } from '../services/photos.js';

function authUi(ui) {
  if (!ui.auth) ui.auth = { mode: 'signin', email: '', password: '', busy: false, error: '', info: '' };
  return ui.auth;
}

function syncLine(sync) {
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

function accountSection(ui, sync) {
  if (!isBackendConfigured()) return '';
  const a = authUi(ui);
  const user = getUser();
  let body;
  if (!isAuthReady()) {
    body = html`<p class="empty-body">계정 상태를 확인하고 있어요…</p>`;
  } else if (user) {
    body = html`
      <div class="account-who">
        <span class="avatar" aria-hidden="true">
          <span class="avatar-initial">${Array.from(displayName(user))[0] || '·'}</span>
          ${avatarUrl(user) ? html`<img class="avatar-img" src="${avatarUrl(user)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}
        </span>
        <p class="account-line"><strong>${displayName(user)}</strong> 계정에 오늘을 저장하고 있어요.</p>
      </div>
      <p class="account-sync" role="status">${syncLine(sync)}</p>
      <button type="button" class="text-button text-button-muted" data-action="sign-out" data-focus-key="sign-out">로그아웃</button>`;
  } else {
    body = html`
      <p class="empty-body">로그인하면 기록이 계정에 저장돼서 다른 기기에서도 이어볼 수 있어요. 로그인하지 않아도 이 기기에는 그대로 남아요.</p>
      <button type="button" class="kakao-login" data-action="kakao-login" data-focus-key="kakao-login" ${a.busy ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M12 3C6.48 3 2 6.48 2 10.78c0 2.77 1.86 5.2 4.65 6.58l-.95 3.5c-.08.3.26.54.52.37l4.17-2.76c.53.06 1.07.09 1.61.09 5.52 0 10-3.48 10-7.78S17.52 3 12 3z"/></svg>
        카카오 로그인
      </button>
      <form class="email-form" data-form="email-auth" novalidate>
        <p class="note-label">${a.mode === 'signin' ? '또는 이메일로 로그인' : '이메일로 가입하기'}</p>
        <div class="auth-fields">
          <label class="visually-hidden" for="auth-email">이메일</label>
          <input id="auth-email" class="area-input" type="email" inputmode="email" autocomplete="${a.mode === 'signin' ? 'username' : 'email'}" placeholder="이메일" value="${a.email}" data-input="auth-email" data-focus-key="auth-email">
          <label class="visually-hidden" for="auth-password">비밀번호</label>
          <input id="auth-password" class="area-input" type="password" autocomplete="${a.mode === 'signin' ? 'current-password' : 'new-password'}" placeholder="${a.mode === 'signin' ? '비밀번호' : `비밀번호 (${PASSWORD_MIN}자 이상)`}" minlength="${PASSWORD_MIN}" value="${a.password}" data-input="auth-password" data-focus-key="auth-password">
          <button type="submit" class="button button-primary button-small" ${a.busy ? 'disabled' : ''}>
            ${a.busy ? '잠시만요…' : a.mode === 'signin' ? '로그인' : '가입하고 시작하기'}
          </button>
        </div>
        <button type="button" class="text-button text-button-muted" data-action="auth-mode" data-focus-key="auth-mode">
          ${a.mode === 'signin' ? '처음이에요 (가입하기)' : '이미 계정이 있어요 (로그인)'}
        </button>
      </form>
      ${a.info ? html`<p class="save-status">${a.info}</p>` : ''}
      ${a.error ? html`<p class="area-error">${a.error}</p>` : ''}`;
  }
  return html`
    <section class="block account" aria-labelledby="account-title">
      <h2 class="section-label" id="account-title">계정에 저장 <span class="optional">(선택)</span></h2>
      ${body}
    </section>`;
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

export function onEnter({ ui, sync, rerender, getScreen }) {
  ui.history = ui.history || null;
  sync.history().then((list) => {
    ui.history = list;
    if (getScreen() === 'day') rerender();
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

export function render(state, { ui, sync }) {
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

      ${accountSection(ui, sync)}

      ${historySection(ui)}

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

async function authStep(ctx, run) {
  const a = authUi(ctx.ui);
  a.busy = true;
  a.error = '';
  ctx.rerender();
  try {
    await run(a);
  } catch (error) {
    a.error = error.message || '로그인하지 못했어요.';
    ctx.announce(a.error);
  } finally {
    a.busy = false;
    if (ctx.getScreen() === 'day') ctx.rerender();
  }
}

actions['kakao-login'] = (ctx) => authStep(ctx, () => signInWithKakao('day'));
actions['sign-out'] = async (ctx) => {
  await signOut();
  ctx.ui.auth = null;
  ctx.announce('로그아웃했어요. 오늘 기록은 이 기기에 그대로 있어요.');
  ctx.rerender();
};
actions['auth-mode'] = ({ ui, rerender }) => {
  const a = authUi(ui);
  ui.auth = { ...a, mode: a.mode === 'signin' ? 'signup' : 'signin', error: '', info: '' };
  rerender();
};
actions['sync-retry'] = ({ sync }) => sync.retry();
actions['check-photos'] = async ({ ui, rerender, announce, getScreen }) => {
  ui.photoCheck = 'running';
  rerender();
  ui.photoCheck = await checkPhotoService();
  announce(ui.photoCheck.message);
  if (getScreen() === 'day') rerender();
};

export const inputs = {
  'auth-email': ({ ui }, el) => {
    authUi(ui).email = el.value;
  },
  'auth-password': ({ ui }, el) => {
    authUi(ui).password = el.value;
  },
  note: ({ ui }, el) => {
    ui.journalDraft.note = el.value;
    const counter = document.querySelector('[data-counter]');
    if (counter) counter.textContent = `${el.value.length}/${NOTE_MAX_LENGTH}`;
    const status = document.querySelector('.save-status');
    if (status) status.textContent = '저장하지 않은 변경이 있어요.';
  },
};

export const forms = {
  'email-auth': (ctx) =>
    authStep(ctx, async (a) => {
      if (a.mode === 'signin') {
        await signInWithEmail(a.email, a.password);
      } else {
        const { needsConfirmation } = await signUpWithEmail(a.email, a.password);
        if (needsConfirmation) {
          a.password = '';
          a.mode = 'signin';
          a.info = '확인 메일을 보냈어요. 메일의 링크를 이 브라우저에서 연 뒤 로그인해 주세요.';
          ctx.announce(a.info);
          return;
        }
      }
      ctx.ui.auth = null;
      ctx.announce('로그인했어요. 오늘 기록을 계정에 저장할게요.');
    }),
  journal: ({ store, ui, announce }) => {
    store.actions.saveJournal(ui.journalDraft);
    ui.journalDraft = null;
    announce('기록을 저장했어요.');
  },
};
