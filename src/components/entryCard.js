/**
 * One journal entry: place, photos, note, who can see it, and (when it is
 * shared) comments. Used on 나의 하루 and 함께. Private photos are loaded
 * through short-lived signed links after render (hydrateJournalPhotos).
 */
import { html } from '../utils/dom.js';
import { CATEGORY_LABELS } from '../data/places.js';
import { photoUrls, avatarSrc, fullTag, COMMENT_MAX } from '../services/backend/social.js';

const VIS_LABEL = { private: '나만 보기', friends: '친구 공개', group: '단체방' };

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
 * @param opts.groupName name of the group it was posted to
 * @param opts.canModerate  group owner: may delete others' entries/comments
 * @param opts.showOwnerActions  show edit/delete (my own entries)
 * @param opts.ui        screen ui state (comment drafts)
 */
export function entryCard(entry, { me, author = null, comments = [], profiles = new Map(), groupName = '', canModerate = false, showOwnerActions = false, ui = {} } = {}) {
  const mine = entry.user_id === me;
  const shared = entry.visibility !== 'private';
  const draft = ui.commentDrafts?.[entry.id] || '';
  return html`
    <article class="entry" data-entry-id="${entry.id}">
      ${author && !mine
        ? html`<header class="entry-author">${avatar(author)}<span class="entry-author-name">${author.nickname}<span class="tag">#${author.tag}</span></span></header>`
        : ''}
      <p class="kicker">
        ${when(entry)} · ${CATEGORY_LABELS[entry.place_category] || '어딘가'}${entry.area_label ? ` · ${entry.area_label}` : ''}
        <span class="vis-badge vis-${entry.visibility}">${entry.visibility === 'group' && groupName ? groupName : VIS_LABEL[entry.visibility]}</span>
        ${entry.share_place_photos ? html`<span class="vis-badge vis-place" title="이 장소를 보는 다른 사용자에게 사진이 보여요">장소 사진</span>` : ''}
      </p>
      <h3 class="entry-place">${entry.place_name}</h3>
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
        ${!mine && canModerate ? html`<button type="button" class="text-button text-button-muted" data-action="entry-delete" data-id="${entry.id}">방장 권한으로 지우기</button>` : ''}
        ${!mine ? html`<button type="button" class="text-button text-button-muted" data-action="report" data-type="entry" data-id="${entry.id}">신고</button>` : ''}
      </div>

      ${shared
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
