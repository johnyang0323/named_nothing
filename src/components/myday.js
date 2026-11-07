/**
 * 나의 하루: what today was (visited / kept places), a note and photos for
 * each place visited (the journal), today's one line, and earlier days.
 * Account settings live on the 계정 screen.
 */
import { getPlaceById } from '../services/placeRepository.js';
import { refreshCommunityPhotos } from '../services/photos.js';
import { FEELINGS, NOTE_MAX_LENGTH } from '../services/store.js';
import { formatKoreanDate } from '../utils/date.js';
import { html } from '../utils/dom.js';
import { categoryLabel, moodLabel } from './common.js';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser } from '../services/backend/auth.js';
import { places as samplePlaces } from '../data/places.js';
import { myEntries, saveEntry, listGroups, commentsFor, reactionsFor, profilesFor, VISIBILITY, PHOTOS_MAX, NOTE_MAX, SocialError } from '../services/backend/social.js';
import { entryCard, hydrateJournalPhotos } from './entryCard.js';
import { journalActions, journalInputs, journalForms } from './journalActions.js';

const journalOn = () => isBackendConfigured() && Boolean(getUser());

/** Options for an entry card on this screen (my own entries). */
const cardOptions = (ui, entry, groupNames) => ({
  me: getUser()?.id,
  showOwnerActions: true,
  groupName: groupNames.get(entry.group_id) || '',
  comments: (ui.myComments || []).filter((c) => c.entry_id === entry.id),
  reactions: (ui.myReactions || []).filter((r) => r.entry_id === entry.id),
  profiles: ui.commentProfiles || new Map(),
  ui,
});

/** Resolve a stored day's place ids to names using that day's own places. */
function dayPlaceNames(day, ids) {
  const pool = new Map([...samplePlaces, ...(day.area?.places || [])].map((p) => [p.id, p.name]));
  return ids.map((id) => pool.get(id)).filter(Boolean);
}

function entriesOn(ui, date) {
  return (ui.myEntries || []).filter((e) => e.date === date);
}

// ───────────────────────── editor ─────────────────────────

function editorForm(ui) {
  const e = ui.editor;
  const total = e.keepPaths.length + e.files.length;
  const groups = ui.myGroups || [];
  return html`
    <form class="entry-editor" data-form="entry-save" novalidate aria-label="소감 쓰기">
      <label class="note-label" for="entry-note">소감</label>
      <textarea id="entry-note" class="note" rows="3" maxlength="${NOTE_MAX}" data-input="entry-note" data-focus-key="entry-note" placeholder="무엇이 좋았나요? 한 줄이면 충분해요.">${e.note}</textarea>

      <div class="editor-photos">
        ${e.keepPaths.map(
          (p, i) => html`<span class="editor-photo"><img data-journal-photo="${p}" alt="올린 사진 ${i + 1}">
            <button type="button" class="photo-remove" data-action="editor-photo-remove" data-kind="keep" data-index="${i}" aria-label="사진 ${i + 1} 빼기">×</button></span>`,
        )}
        ${e.files.map(
          (f, i) => html`<span class="editor-photo"><img src="${f.url}" alt="새 사진 ${i + 1}">
            <button type="button" class="photo-remove" data-action="editor-photo-remove" data-kind="new" data-index="${i}" aria-label="새 사진 ${i + 1} 빼기">×</button></span>`,
        )}
        ${total < PHOTOS_MAX
          ? html`<label class="editor-photo editor-photo-add">
              <span aria-hidden="true">＋</span><span class="visually-hidden">사진 추가</span>
              <input type="file" accept="image/*" multiple class="visually-hidden" data-input="entry-files" data-focus-key="entry-files">
            </label>`
          : ''}
      </div>
      <p class="fine-print">사진은 ${PHOTOS_MAX}장까지, 크기를 줄이고 위치 정보(GPS)를 지운 뒤 올려요.</p>
      ${total && canSharePlace(e.placeId)
        ? html`<label class="row toggle share-place">
            <span class="share-place-text">
              <span>장소 사진으로 함께 보여주기</span>
              <span class="share-place-hint">이 장소를 보는 다른 사용자에게 사진과 닉네임만 보여요. 소감은 보이지 않아요.</span>
            </span>
            <input type="checkbox" role="switch" data-input="entry-share-place" data-focus-key="entry-share-place" ${e.sharePlace ? 'checked' : ''}>
          </label>`
        : ''}

      <fieldset class="visibility">
        <legend class="note-label">누구에게 보일까요?</legend>
        <div class="budget-options">
          ${VISIBILITY.map(
            (v) => html`<label class="budget-chip">
              <input type="radio" name="entry-visibility" value="${v.id}" data-input="entry-visibility" data-focus-key="vis-${v.id}" ${e.visibility === v.id ? 'checked' : ''}>
              <span>${v.label}</span>
            </label>`,
          )}
        </div>
        ${e.visibility === 'group'
          ? groups.length
            ? html`<label class="visually-hidden" for="entry-group">단체방</label>
                <select id="entry-group" class="area-input group-select" data-input="entry-group" data-focus-key="entry-group">
                  ${groups.map((g) => html`<option value="${g.id}" ${e.groupId === g.id ? 'selected' : ''}>${g.name}</option>`)}
                </select>`
            : html`<p class="fine-print">아직 들어간 단체방이 없어요. <a href="#together">함께</a>에서 만들거나 초대 코드로 들어가세요.</p>`
          : ''}
      </fieldset>

      ${e.error ? html`<p class="area-error" role="alert">${e.error}</p>` : ''}
      <div class="actions actions-compact">
        <button type="submit" class="button button-primary button-small" data-focus-key="entry-submit" ${e.busy ? 'disabled' : ''}>${e.busy ? '올리는 중…' : '저장'}</button>
        <button type="button" class="text-button" data-action="editor-cancel" ${e.busy ? 'disabled' : ''}>취소</button>
      </div>
    </form>`;
}

/** Only real (Kakao) places have a card other people can see the photo on. */
function canSharePlace(placeId) {
  return getPlaceById(placeId)?.source === 'kakao';
}

function openEditor(ui, { placeId, entry = null }) {
  closeEditor(ui);
  ui.editor = {
    placeId,
    entryId: entry?.id || null,
    note: entry?.note || '',
    keepPaths: [...(entry?.photo_paths || [])],
    files: [],
    visibility: entry?.visibility || 'private', // 기본: 나만 보기
    sharePlace: entry?.share_place_photos === true, // 기본: 꺼짐
    groupId: entry?.group_id || ui.myGroups?.[0]?.id || null,
    busy: false,
    error: '',
  };
}

function closeEditor(ui) {
  ui.editor?.files.forEach((f) => URL.revokeObjectURL(f.url));
  ui.editor = null;
}

// ───────────────────────── sections ─────────────────────────

function visitsSection(state, ui) {
  const visited = state.route.filter((s) => s.visited);
  if (!visited.length) return html`<p class="empty-body">아직 다녀온 곳으로 표시한 곳이 없어요. 경로에서 "다녀왔어요"를 누르면 여기에 소감을 남길 수 있어요.</p>`;
  const today = entriesOn(ui, state.date);
  const me = getUser()?.id;
  const groupNames = new Map((ui.myGroups || []).map((g) => [g.id, g.name]));
  return html`<ul class="visit-list">
    ${visited.map((stop) => {
      const place = getPlaceById(stop.id);
      const entries = today.filter((e) => e.place_id === stop.id);
      const editing = ui.editor?.placeId === stop.id;
      return html`<li class="visit">
        <div class="visit-head"><span class="memory-name">${place.name}</span><span class="memory-meta">${categoryLabel(place)}</span></div>
        ${entries
          .filter((e) => !(editing && ui.editor.entryId === e.id))
          .map((e) => entryCard(e, cardOptions(ui, e, groupNames)))}
        ${editing ? editorForm(ui) : ''}
        ${journalOn() && !editing && !entries.length
          ? html`<button type="button" class="button button-ghost button-small" data-action="editor-open" data-id="${stop.id}" data-focus-key="editor-open-${stop.id}">소감 남기기</button>`
          : ''}
      </li>`;
    })}
  </ul>`;
}

function historySection(state, ui) {
  const days = new Map((ui.history || []).map((d) => [d.date, d]));
  (ui.myEntries || []).forEach((e) => {
    if (e.date !== state.date && !days.has(e.date)) days.set(e.date, { date: e.date });
  });
  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return '';
  const me = getUser()?.id;
  const groupNames = new Map((ui.myGroups || []).map((g) => [g.id, g.name]));
  return html`
    <section class="block history" aria-labelledby="history-title">
      <h2 class="section-label" id="history-title">지난 날들</h2>
      <ol class="history-list">
        ${list.map((day) => {
          const route = Array.isArray(day.route) ? day.route : [];
          const visited = dayPlaceNames(day, route.filter((s) => s?.visited).map((s) => s.id));
          const entries = entriesOn(ui, day.date);
          const date = new Date(`${day.date}T12:00:00`);
          return html`
            <li class="history-item">
              <p class="kicker">${Number.isNaN(date.getTime()) ? day.date : formatKoreanDate(date)}${day.area?.label ? ` · ${day.area.label}` : ''}${day.journal?.feeling ? ` · ${day.journal.feeling}` : ''}</p>
              ${day.journal?.note ? html`<p class="history-note">${day.journal.note}</p>` : ''}
              ${entries.length
                ? html`<div class="entries">${entries.map((e) => entryCard(e, cardOptions(ui, e, groupNames)))}</div>`
                : html`<p class="history-meta">${visited.length ? `다녀온 곳: ${visited.join(', ')}` : route.length ? `${route.length}곳을 담아두었던 날` : '조용히 지나간 날'}</p>`}
            </li>`;
        })}
      </ol>
    </section>`;
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

/** Fill the parts that depend on loaded data, without redrawing the screen. */
function refreshSlots(ctx) {
  if (ctx.getScreen() !== 'day') return;
  const state = ctx.store.getState();
  const visits = document.querySelector('[data-visits-slot]');
  const history = document.querySelector('[data-history-slot]');
  if (visits && !ctx.ui.editor) visits.innerHTML = String(visitsSection(state, ctx.ui));
  if (history) history.innerHTML = String(historySection(state, ctx.ui));
  hydrateJournalPhotos(document.getElementById('view'));
}

async function loadJournal(ctx) {
  if (!journalOn()) return;
  try {
    const [entries, groups] = await Promise.all([myEntries(), listGroups().catch(() => [])]);
    // comments on my shared entries, and who wrote them
    const sharedIds = entries.filter((e) => e.visibility !== 'private').map((e) => e.id);
    const [comments, reactions] = await Promise.all([commentsFor(sharedIds), reactionsFor(sharedIds)]);
    const profiles = await profilesFor([...comments.map((c) => c.user_id), ...reactions.map((r) => r.user_id)]);
    ctx.ui.myReactions = reactions;
    ctx.ui.myEntries = entries;
    ctx.ui.myGroups = groups;
    ctx.ui.myComments = comments;
    ctx.ui.commentProfiles = profiles;
    ctx.ui.entryIndex = new Map(entries.map((e) => [e.id, e]));
  } catch {
    ctx.ui.myEntries = ctx.ui.myEntries || [];
  }
}

export function onEnter(ctx) {
  const { ui, sync } = ctx;
  sync.history().then((list) => {
    ui.history = list;
    refreshSlots(ctx);
  });
  loadJournal(ctx).then(() => refreshSlots(ctx));
  return null;
}

export async function reload(ctx) {
  await loadJournal(ctx);
  ctx.rerender();
}

export function render(state, { ui }) {
  const d = draft(state, ui);
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
        <div data-visits-slot>${visitsSection(state, ui)}</div>
      </section>

      ${notYet.length
        ? html`<section class="block" aria-labelledby="kept-title">
            <h2 class="section-label" id="kept-title">담아두었던 곳</h2>
            ${placeList(notYet)}
            <p class="fine-print">못 가도 괜찮아요. 다음에 가볼 이유가 하나 생긴 거예요.</p>
          </section>`
        : ''}

      <form class="block journal" data-form="journal" novalidate>
        <h2 class="section-label">오늘 한 줄 <span class="optional">(선택)</span></h2>
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

      <div data-history-slot>${historySection(state, ui)}</div>

      <section class="block reset" aria-labelledby="reset-title">
        <h2 class="section-label" id="reset-title">새로 시작하기</h2>
        ${ui.confirmReset
          ? html`<p>오늘 담은 곳과 한 줄 기록을 ${getUser() ? '이 기기와 계정에서' : '이 기기에서'} 모두 지울까요? 남긴 소감과 사진은 그대로 있어요.</p>
              <div class="actions">
                <button type="button" class="button button-secondary" data-action="reset-confirm" data-focus-key="reset-confirm">네, 지울게요</button>
                <button type="button" class="text-button" data-action="reset-cancel">취소</button>
              </div>`
          : html`<p class="fine-print">${getUser() ? '오늘의 기록은 이 기기와 계정에 저장돼요. 지난 날들은 그대로 남아요.' : '오늘의 기록은 이 브라우저에만 저장돼요.'}</p>
              <button type="button" class="text-button text-button-muted" data-action="reset" data-focus-key="reset">오늘 기록 지우기</button>`}
      </section>
    </section>`;
}

export function afterRender() {
  hydrateJournalPhotos(document.getElementById('view'));
}

export const actions = {
  ...journalActions,
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
  'editor-open': ({ ui, rerender }, data) => {
    openEditor(ui, { placeId: data.id });
    rerender();
    document.getElementById('entry-note')?.focus();
  },
  'entry-edit': ({ ui, rerender }, data) => {
    const entry = ui.entryIndex?.get(data.id);
    if (!entry) return;
    openEditor(ui, { placeId: entry.place_id, entry });
    rerender();
    document.getElementById('entry-note')?.focus();
  },
  'editor-cancel': ({ ui, rerender }) => {
    closeEditor(ui);
    rerender();
  },
  'editor-photo-remove': ({ ui, rerender }, data) => {
    const e = ui.editor;
    if (!e) return;
    const i = Number(data.index);
    if (data.kind === 'keep') e.keepPaths.splice(i, 1);
    else {
      URL.revokeObjectURL(e.files[i]?.url);
      e.files.splice(i, 1);
    }
    rerender();
  },
};

export const inputs = {
  ...journalInputs,
  note: ({ ui }, el) => {
    ui.journalDraft.note = el.value;
    const counter = document.querySelector('[data-counter]');
    if (counter) counter.textContent = `${el.value.length}/${NOTE_MAX_LENGTH}`;
    const status = document.querySelector('.save-status');
    if (status) status.textContent = '저장하지 않은 변경이 있어요.';
  },
  'entry-note': ({ ui }, el) => {
    if (ui.editor) ui.editor.note = el.value;
  },
  'entry-files': ({ ui, rerender, toast }, el) => {
    const e = ui.editor;
    if (!e) return;
    const room = PHOTOS_MAX - e.keepPaths.length - e.files.length;
    const picked = [...(el.files || [])].filter((f) => /^image\//.test(f.type));
    if (picked.length > room) toast(`사진은 ${PHOTOS_MAX}장까지예요. 앞의 ${room}장만 넣었어요.`);
    picked.slice(0, Math.max(0, room)).forEach((file) => e.files.push({ file, url: URL.createObjectURL(file) }));
    rerender();
  },
  'entry-visibility': ({ ui, rerender }, el) => {
    if (!ui.editor) return;
    ui.editor.visibility = el.value;
    if (el.value === 'group' && !ui.editor.groupId) ui.editor.groupId = ui.myGroups?.[0]?.id || null;
    rerender();
  },
  'entry-group': ({ ui }, el) => {
    if (ui.editor) ui.editor.groupId = el.value;
  },
  'entry-share-place': ({ ui }, el) => {
    if (ui.editor) ui.editor.sharePlace = el.checked;
  },
};

export const forms = {
  ...journalForms,
  journal: ({ store, ui, announce }) => {
    store.actions.saveJournal(ui.journalDraft);
    ui.journalDraft = null;
    announce('기록을 저장했어요.');
  },
  'entry-save': async (ctx) => {
    const e = ctx.ui.editor;
    if (!e || e.busy) return;
    const state = ctx.store.getState();
    const place = getPlaceById(e.placeId) || { id: e.placeId, name: ctx.ui.entryIndex?.get(e.entryId)?.place_name || '어딘가' };
    e.busy = true;
    e.error = '';
    ctx.rerender();
    try {
      const saved = await saveEntry({
        entry: e.entryId ? ctx.ui.entryIndex?.get(e.entryId) : null,
        date: e.entryId ? ctx.ui.entryIndex?.get(e.entryId)?.date || state.date : state.date,
        place,
        areaLabel: state.area?.label || null,
        note: e.note,
        keepPaths: e.keepPaths,
        newFiles: e.files.map((f) => f.file),
        visibility: e.visibility,
        groupId: e.groupId,
        sharePlacePhotos: e.sharePlace && canSharePlace(e.placeId),
      });
      closeEditor(ctx.ui);
      refreshCommunityPhotos();
      if (saved?.sharingUnavailable) ctx.toast('소감은 남겼어요. 장소 사진 공유는 아직 준비 중이에요.');
      else ctx.toast(e.visibility === 'private' ? '소감을 남겼어요.' : e.visibility === 'friends' ? '소감을 친구들과 나눴어요.' : '단체방에 소감을 올렸어요.');
      await reload(ctx);
    } catch (error) {
      e.busy = false;
      e.error = error instanceof SocialError ? error.message : error.message || '저장하지 못했어요.';
      ctx.rerender();
    }
  },
};
