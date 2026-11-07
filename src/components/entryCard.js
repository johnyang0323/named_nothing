/**
 * One journal entry: place, photos, note, who can see it, and (when it is
 * shared) comments. Used on 나의 하루 and 함께. Private photos are loaded
 * through short-lived signed links after render (hydrateJournalPhotos).
 */
import { html } from '../utils/dom.js';
import { CATEGORY_LABELS } from '../data/places.js';
import { photoUrls, avatarSrc, fullTag, COMMENT_MAX, REACTIONS, audienceOf } from '../services/backend/social.js';

/** Where an entry is shown, as chips: 나만 보기, or 친구 + room names. */
export function audienceChips(entry, groupNames = new Map(), mine = true) {
  const a = audienceOf(entry);
  // on someone else's entry, only name the places I am part of
  if (!mine) a.groups = a.groups.filter((g) => groupNames.has(g));
  if (!a.friends && !a.groups.length) return mine ? html`<span class="vis-badge vis-private">나만 보기</span>` : '';
  return html`${a.friends ? html`<span class="vis-badge vis-friends">친구</span>` : ''}${a.groups.map((g) => html`<span class="vis-badge vis-group">${groupNames.get(g) || '단체방'}</span>`)}`;
}

export function avatar(profile, size = 'sm') {
  // fallbackSrc: e.g. my Kakao profile photo until I upload my own
  const src = avatarSrc(profile) || profile?.fallbackSrc || null;
  const initial = Array.from(profile?.nickname || '·')[0];
  return html`<span class="avatar avatar-${size}" aria-hidden="true"><span class="avatar-initial">${initial}</span>${src ? html`<img class="avatar-img" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;
}

function when(entry) {
  const d = new Date(`${entry.date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? entry.date : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * @param entry     journal_entries row
 * @param opts.me        my user id
 * @param opts.author    profile of the author (for shared entries)
 * @param opts.comments  comment rows for this entry (shared entries only)
 * @param opts.profiles  Map user_id → profile, for comment authors
 * @param opts.groupNames Map group id → name (for the audience chips)
 * @param opts.roomId    the room this card is shown in (owner can take it out)
 * @param opts.canModerate  room owner: may take others' entries out / delete comments
 * @param opts.showOwnerActions  show edit/delete (my own entries)
 * @param opts.ui        screen ui state (comment drafts)
 * @param opts.reactions reaction rows for this entry ({ user_id, emoji })
 */
export function entryCard(entry, { me, author = null, comments = [], profiles = new Map(), groupNames = new Map(), roomId = null, canModerate = false, showOwnerActions = false, ui = {}, reactions = [], showPlace = true } = {}) {
  const mine = entry.user_id === me;
  const a = audienceOf(entry);
  const shared = a.friends || a.groups.length > 0;
  const draft = ui.commentDrafts?.[entry.id] || '';
  const open = Boolean(ui.openComments?.[entry.id]);
  return html`
    <article class="entry" data-entry-id="${entry.id}">
      ${author && !mine
        ? html`<header class="entry-author">${avatar(author)}<span class="entry-author-name">${author.nickname}<span class="tag">#${author.tag}</span></span></header>`
        : ''}
      <p class="kicker">
        ${when(entry)} · ${CATEGORY_LABELS[entry.place_category] || '어딘가'}${entry.area_label ? ` · ${entry.area_label}` : ''}
      </p>
      <p class="entry-audience" aria-label="공개 범위">${audienceChips(entry, groupNames, mine)}
        ${entry.share_place_photos ? html`<span class="vis-badge vis-place" title="이 장소를 보는 다른 사용자에게 사진이 보여요">장소 사진</span>` : ''}
      </p>
      ${showPlace ? html`<h3 class="entry-place">${entry.place_name}</h3>` : ''}
      ${entry.photo_paths?.length
        ? html`<div class="entry-photos entry-photos-${Math.min(entry.photo_paths.length, 4)}">
            ${entry.photo_paths.map((p) => html`<span class="entry-photo"><img data-journal-photo="${p}" alt="${entry.place_name}에서 남긴 사진" loading="lazy"></span>`)}
          </div>`
        : ''}
      ${entry.note ? html`<p class="entry-note">${entry.note}</p>` : ''}

      <div class="entry-actions">
        ${mine && showOwnerActions
          ? html`<button type="button" class="text-button" data-action="entry-edit" data-id="${entry.id}" data-focus-key="entry-edit-${entry.id}">고치기</button>
              <button type="button" class="text-button text-button-muted" data-action="entry-delete" data-id="${entry.id}">지우기</button>`
          : ''}
        ${!mine && canModerate && roomId ? html`<button type="button" class="text-button text-button-muted" data-action="entry-unpost" data-id="${entry.id}" data-group="${roomId}">이 방에서 내리기</button>` : ''}
        ${!mine ? html`<button type="button" class="text-button text-button-muted" data-action="report" data-type="entry" data-id="${entry.id}">신고</button>` : ''}
      </div>

      ${shared ? reactionBar(entry, reactions, me, profiles, mine) : ''}

      ${shared
        ? html`<button type="button" class="comment-toggle" data-action="comment-toggle" data-entry="${entry.id}" aria-expanded="${open}" data-focus-key="comment-toggle-${entry.id}">
            💬 ${comments.length ? `댓글 ${comments.length}개` : '댓글 달기'}${open ? ' · 접기' : ''}
          </button>`
        : ''}
      ${shared && open
        ? html`<section class="comments" aria-label="${entry.place_name} 댓글">
            ${comments.map((c) => {
              const who = profiles.get(c.user_id);
              const canDelete = c.user_id === me || mine || canModerate;
              return html`<p class="comment">
                <span class="comment-author">${who ? who.nickname : '알 수 없음'}</span>
                <span class="comment-body">${c.body}</span>
                ${canDelete ? html`<button type="button" class="text-button text-button-muted comment-action" data-action="comment-delete" data-id="${c.id}" aria-label="댓글 지우기">지우기</button>` : ''}
                ${c.user_id !== me ? html`<button type="button" class="text-button text-button-muted comment-action" data-action="report" data-type="comment" data-id="${c.id}" aria-label="댓글 신고">신고</button>` : ''}
              </p>`;
            })}
            <form class="comment-form" data-form="comment" data-entry="${entry.id}" novalidate>
              <label class="visually-hidden" for="comment-${entry.id}">댓글</label>
              <input id="comment-${entry.id}" class="area-input" type="text" maxlength="${COMMENT_MAX}" placeholder="댓글 달기" value="${draft}" data-input="comment-draft" data-entry="${entry.id}" data-focus-key="comment-${entry.id}" autocomplete="off">
              <button type="submit" class="button button-secondary button-small">달기</button>
            </form>
          </section>`
        : ''}
    </article>`;
}

/** ❤️ 👍 😂 😮 🥹 — tap to react, tap again to take it back. On my own entry: just what I got. */
function reactionBar(entry, reactions, me, profiles, mine = false) {
  const forEntry = reactions.filter((r) => r.entry_id === entry.id);
  if (mine) {
    if (!forEntry.length) return '';
    return html`<p class="reactions reactions-received" aria-label="받은 반응">
      ${REACTIONS.filter((emoji) => forEntry.some((r) => r.emoji === emoji)).map((emoji) => {
        const who = forEntry.filter((r) => r.emoji === emoji);
        return html`<span class="reaction reaction-static" title="${who.map((r) => profiles.get(r.user_id)?.nickname).filter(Boolean).join(', ')}">${emoji}<span class="reaction-count">${who.length}</span></span>`;
      })}
    </p>`;
  }
  return html`<div class="reactions" role="group" aria-label="반응">
    ${REACTIONS.map((emoji) => {
      const who = forEntry.filter((r) => r.emoji === emoji);
      const mine = who.some((r) => r.user_id === me);
      const names = who.map((r) => (r.user_id === me ? '나' : profiles.get(r.user_id)?.nickname)).filter(Boolean).join(', ');
      return html`<button type="button" class="reaction ${mine ? 'is-on' : ''}" data-action="react" data-entry="${entry.id}" data-emoji="${emoji}" data-mine="${mine ? '1' : ''}" aria-pressed="${mine}" title="${names}" aria-label="${emoji} 반응${who.length ? ` ${who.length}개` : ''}">
        <span aria-hidden="true">${emoji}</span>${who.length ? html`<span class="reaction-count">${who.length}</span>` : ''}
      </button>`;
    })}
  </div>`;
}

/** Fill in private photos with signed links (only those this person may read). */
export function hydrateJournalPhotos(root) {
  const imgs = [...root.querySelectorAll('img[data-journal-photo]:not([src])')];
  if (!imgs.length) return;
  photoUrls(imgs.map((i) => i.dataset.journalPhoto))
    .then((urls) => {
      imgs.forEach((img) => {
        const url = urls.get(img.dataset.journalPhoto);
        if (url && img.isConnected) img.src = url;
        else img.closest('.entry-photo')?.classList.add('is-missing');
      });
    })
    .catch(() => {});
}

export const tagText = fullTag;
