/**
 * 함께: friends (my #tag, friend requests, invite links, friends' shared
 * entries), group rooms (a shared journal with comments), and 알림 (inbox:
 * requests, comments, reactions, place cards friends sent).
 * No follower counts or public feed — only people you know.
 */
import { html } from '../utils/dom.js';
import { getUser } from '../services/backend/auth.js';
import { isBackendConfigured } from '../services/backend/config.js';
import {
  getMyProfile,
  loadMyProfile,
  fullTag,
  requestFriend,
  listRequests,
  respondFriend,
  cancelRequest,
  createInviteToken,
  acceptInvite,
  listNotifications,
  markNotificationsRead,
  receivedCards,
  removeCard,
  reactionsFor,
  createTogetherDay,
  listTogetherDays,
  togetherItems,
  removeTogetherItem,
  toggleTogetherVote,
  leaveTogetherDay,
  endTogetherDay,
  listFriends,
  removeFriend,
  blockUser,
  sharedFeed,
  audienceOf,
  supportsMultiShare,
  listGroups,
  myEntries,
  shareEntryToGroup,
  createGroup,
  joinGroup,
  groupMembers,
  groupEntries,
  leaveGroup,
  deleteGroup,
  removeMember,
  commentsFor,
  profilesFor,
  SocialError,
} from '../services/backend/social.js';
import { entryCard, avatar } from './entryCard.js';
import { journalActions, journalInputs, journalForms } from './journalActions.js';
import { inviteLink, copyText, pendingInvite, clearInvite } from './share.js';
import { clearUnread, refreshUnread } from '../services/backend/inbox.js';
import { CATEGORY_LABELS } from '../data/places.js';

function state(ui) {
  if (!ui.together) ui.together = { tab: 'feed', prevTab: 'feed', loading: true, friends: [], feed: [], groups: [], openGroupId: null, members: [], groupFeed: [], comments: [], reactions: [], requests: { incoming: [], outgoing: [] }, notes: [], cards: [], outings: [], openOutingId: null, outingItems: [], newOuting: { title: '', members: [] }, profiles: new Map(), addText: '', groupName: '', joinCode: '' };
  return ui.together;
}

export function onEnter(ctx) {
  if (!isBackendConfigured() || !getUser()) return null;
  const invite = pendingInvite();
  const t = state(ctx.ui);
  // 알림 is a side page: coming back to 함께 shows the tabs again
  if (t.tab === 'inbox') t.tab = t.prevTab || 'feed';
  if (invite?.group) t.tab = 'meet';
  reload(ctx);
  return null;
}

export async function reload(ctx) {
  const t = state(ctx.ui);
  try {
    if (!getMyProfile()) await loadMyProfile();
    const [friends, feed, groups, requests, notes, cards] = await Promise.all([
      listFriends(),
      sharedFeed(),
      listGroups(),
      listRequests().catch(() => ({ incoming: [], outgoing: [] })),
      listNotifications().catch(() => []),
      receivedCards().catch(() => []),
    ]);
    const outings = await listTogetherDays().catch(() => []);
    if (t.openOutingId && !outings.some((o) => o.id === t.openOutingId)) t.openOutingId = null;
    t.outings = outings;
    t.outingItems = t.openOutingId ? await togetherItems(t.openOutingId).catch(() => []) : [];
    let members = [];
    let groupFeed = [];
    if (t.openGroupId && groups.some((g) => g.id === t.openGroupId)) {
      [members, groupFeed] = await Promise.all([groupMembers(t.openGroupId), groupEntries(t.openGroupId)]);
    } else {
      t.openGroupId = null;
    }
    const entries = [...feed, ...groupFeed];
    const [comments, reactions] = await Promise.all([commentsFor(entries.map((e) => e.id)), reactionsFor(entries.map((e) => e.id)).catch(() => [])]);
    const known = new Map([...friends.map((f) => [f.user_id, f]), ...members.filter((m) => m.profile).map((m) => [m.user_id, m.profile])]);
    const me = getMyProfile();
    if (me) known.set(me.user_id, me);
    const unknown = [...entries.map((e) => e.user_id), ...comments.map((c) => c.user_id), ...reactions.map((r) => r.user_id)].filter((id) => !known.has(id));
    (await profilesFor(unknown)).forEach((p, id) => known.set(id, p));
    Object.assign(t, { friends, feed, groups, members, groupFeed, comments, reactions, requests, notes, cards, profiles: known, loading: false, error: '' });
    if (t.tab === 'inbox') markRead(t);
    ctx.ui.entryIndex = new Map(entries.map((e) => [e.id, e]));
  } catch (error) {
    Object.assign(t, { loading: false, error: error instanceof SocialError ? error.message : '불러오지 못했어요. 잠시 후 다시 열어주세요.' });
  }
  if (ctx.getScreen() === 'together') ctx.rerender();
}

function inviteBanner() {
  const invite = pendingInvite();
  if (!invite) return '';
  if (invite.token || invite.friend) {
    return html`<div class="invite-banner" role="group" aria-label="친구 초대">
      <p>${invite.token ? '친구 초대 링크로 들어왔어요. 친구가 될까요?' : html`<strong>${invite.friend}</strong> 님에게 친구 요청을 보낼까요?`}</p>
      <div class="actions actions-compact">
        <button type="button" class="button button-primary button-small" data-action="invite-accept" data-focus-key="invite-accept">친구 되기</button>
        <button type="button" class="text-button text-button-muted" data-action="invite-dismiss">아니요</button>
      </div>
    </div>`;
  }
  return html`<div class="invite-banner" role="group" aria-label="단체방 초대">
    <p>초대 코드 <strong>${invite.group}</strong> 단체방에 들어갈까요?</p>
    <div class="actions actions-compact">
      <button type="button" class="button button-primary button-small" data-action="invite-accept" data-focus-key="invite-accept">들어가기</button>
      <button type="button" class="text-button text-button-muted" data-action="invite-dismiss">아니요</button>
    </div>
  </div>`;
}

function commentsOf(t, entry) {
  return t.comments.filter((c) => c.entry_id === entry.id);
}

function reactionsOf(t, entry) {
  return t.reactions.filter((r) => r.entry_id === entry.id);
}

/** Opening the inbox marks everything read (once per load). */
function markRead(t) {
  if (!t.notes.some((n) => !n.read_at)) return;
  t.notes = t.notes.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
  clearUnread();
  markNotificationsRead().catch(() => {}).finally(() => refreshUnread());
}

function ago(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function requestsIncoming(t) {
  if (!t.requests.incoming.length) return '';
  return html`<section class="block" aria-labelledby="requests-title">
    <h2 class="section-label" id="requests-title">받은 친구 요청 ${t.requests.incoming.length}</h2>
    <ul class="people">
      ${t.requests.incoming.map(
        (r) => html`<li class="person request">
          ${avatar(r.profile)}
          <span class="person-name">${r.profile?.nickname || '알 수 없음'}${r.profile ? html`<span class="tag">#${r.profile.tag}</span>` : ''}</span>
          <button type="button" class="button button-primary button-small" data-action="request-accept" data-id="${r.from_id}" data-name="${r.profile?.nickname || ''}" data-focus-key="accept-${r.from_id}">수락</button>
          <button type="button" class="text-button text-button-muted" data-action="request-decline" data-id="${r.from_id}">거절</button>
        </li>`,
      )}
    </ul>
  </section>`;
}

function requestsOutgoing(t) {
  if (!t.requests.outgoing.length) return '';
  return html`<section class="block" aria-labelledby="sent-title">
    <h2 class="section-label" id="sent-title">보낸 친구 요청</h2>
    <ul class="people">
      ${t.requests.outgoing.map(
        (r) => html`<li class="person request">
          ${avatar(r.profile)}
          <span class="person-name">${r.profile?.nickname || '알 수 없음'}${r.profile ? html`<span class="tag">#${r.profile.tag}</span>` : ''}<span class="person-meta">수락을 기다리는 중</span></span>
          <button type="button" class="text-button text-button-muted" data-action="request-cancel" data-id="${r.to_id}">취소</button>
        </li>`,
      )}
    </ul>
  </section>`;
}

function noteText(n) {
  const who = n.actor?.nickname || '누군가';
  switch (n.kind) {
    case 'friend_request':
      return `${who}님이 친구 요청을 보냈어요.`;
    case 'friend_accepted':
      return `${who}님과 친구가 됐어요.`;
    case 'comment':
      return `${who}님이 내 기록에 댓글을 남겼어요${n.data?.body ? `: “${n.data.body}”` : '.'}`;
    case 'reaction':
      return `${who}님이 내 기록에 ${n.data?.emoji || '반응'}을(를) 남겼어요.`;
    case 'card':
      return `${who}님이 장소 카드를 보냈어요${n.data?.place_name ? `: ${n.data.place_name}` : '.'}`;
    case 'together_invite':
      return `${who}님이 함께 하루에 초대했어요${n.data?.title ? `: ${n.data.title}` : '.'}`;
    case 'together_item':
      return `${who}님이 함께 봉투에 장소를 담았어요${n.data?.place_name ? `: ${n.data.place_name}` : '.'}`;
    default:
      return `${who}님의 소식이 있어요.`;
  }
}

function cardItem(c) {
  const place = c.place || {};
  return html`<li class="shared-card">
    <div class="shared-card-head">
      ${avatar(c.from)}
      <p><strong>${c.from?.nickname || '친구'}</strong>님이 보낸 카드 · <span class="fine-print">${ago(c.created_at)}</span></p>
    </div>
    <p class="shared-card-place"><span class="kicker">${CATEGORY_LABELS[place.category] || '장소'}</span> <strong>${place.name || '어딘가'}</strong></p>
    ${place.address ? html`<p class="fine-print">${place.address}</p>` : ''}
    ${c.note ? html`<p class="shared-card-note">“${c.note}”</p>` : ''}
    <div class="actions actions-compact">
      <button type="button" class="button button-primary button-small" data-action="card-keep" data-id="${c.id}" data-focus-key="card-keep-${c.id}">봉투에 담기</button>
      ${place.placeUrl ? html`<a class="button button-secondary button-small" href="${place.placeUrl}" target="_blank" rel="noopener noreferrer">카카오맵에서 보기</a>` : ''}
      <button type="button" class="text-button text-button-muted" data-action="card-remove" data-id="${c.id}">지우기</button>
    </div>
  </li>`;
}

function outingList(t) {
  const n = t.newOuting;
  return html`
    <section class="block meet-section" aria-labelledby="outings-title">
      <div class="meet-head">
        <h2 class="meet-title" id="outings-title">함께 하루</h2>
        <button type="button" class="button button-secondary button-small" data-action="meet-form" data-form-name="outing" aria-expanded="${t.openForm === 'outing'}" data-focus-key="new-outing">${t.openForm === 'outing' ? '닫기' : '＋ 시작'}</button>
      </div>
      <p class="meet-desc">하루 나들이 갈 곳을 친구들과 같이 고르는 봉투예요. 각자 카드를 넘기며 담고, 👍로 정해요.</p>
      ${t.outings.length
        ? html`<ul class="group-list">
            ${t.outings.map(
              (o) => html`<li><button type="button" class="group-item" data-action="outing-open" data-id="${o.id}" data-focus-key="outing-${o.id}">
                <span class="group-name">${o.title}</span>
                <span class="group-meta">${o.members.map((m) => m.profile?.nickname).filter(Boolean).join(', ')}</span>
              </button></li>`,
            )}
          </ul>`
        : ''}
    ${t.openForm === 'outing' ? outingForm(t, n) : ''}
    </section>`;
}

function outingForm(t, n) {
  return html`
    <form class="meet-form" data-form="outing-create" novalidate>
      <label class="section-label" for="outing-title">새 함께 하루</label>
      <input id="outing-title" class="area-input" type="text" maxlength="30" placeholder="예: 토요일 망원동 나들이" value="${n.title}" data-input="outing-title" data-focus-key="outing-title" autocomplete="off">
      ${t.friends.length
        ? html`<div class="send-friends" role="group" aria-label="같이 갈 친구">
            ${t.friends.map(
              (f) => html`<label class="send-friend ${n.members.includes(f.user_id) ? 'is-on' : ''}">
                <input type="checkbox" class="visually-hidden" value="${f.user_id}" data-input="outing-member" ${n.members.includes(f.user_id) ? 'checked' : ''}>
                ${avatar(f)}<span>${f.nickname}</span>
              </label>`,
            )}
          </div>`
        : html`<p class="fine-print">먼저 친구를 추가하면 함께 하루에 초대할 수 있어요.</p>`}
      <button type="submit" class="button button-primary button-small" ${n.title.trim() && n.members.length && !n.busy ? '' : 'disabled'}>${n.busy ? '만드는 중…' : '만들고 초대하기'}</button>
    </form>`;
}

function outingView(t) {
  const o = t.outings.find((x) => x.id === t.openOutingId);
  if (!o) return outingList(t);
  const me = getUser()?.id;
  const owner = o.owner_id === me;
  const name = (id) => (id === me ? '나' : o.members.find((m) => m.user_id === id)?.profile?.nickname || '멤버');
  return html`
    <button type="button" class="text-button flow-back" data-action="outing-back" data-focus-key="outing-back">← 모임</button>
    <section class="block group-head" aria-labelledby="outing-title-h">
      <h2 class="group-title" id="outing-title-h">${o.title}</h2>
      <ul class="member-chips" aria-label="함께하는 사람">
        ${o.members.map((m) => html`<li class="member-chip">${avatar(m.profile)}<span>${m.user_id === me ? '나' : m.profile?.nickname || '멤버'}${m.user_id === o.owner_id ? ' · 만든 사람' : ''}</span></li>`)}
      </ul>
      <button type="button" class="button button-primary button-wide" data-action="outing-swipe" data-id="${o.id}" data-focus-key="outing-swipe">카드 넘기며 함께 봉투에 담기</button>
    </section>

    <section class="block" aria-labelledby="outing-items-title">
      <h2 class="section-label" id="outing-items-title">함께 봉투 ${t.outingItems.length ? `${t.outingItems.length}곳` : ''}</h2>
      ${t.outingItems.length
        ? html`<ul class="outing-items">
            ${t.outingItems.map((item, i) => {
              const mine = item.votes.includes(me);
              return html`<li class="outing-item ${i === 0 && item.votes.length ? 'is-top' : ''}">
                <div class="outing-item-main">
                  <p class="kicker">${CATEGORY_LABELS[item.place?.category] || '장소'} · ${name(item.added_by)}님이 담음</p>
                  <p class="outing-item-name">${i === 0 && item.votes.length ? '👑 ' : ''}${item.place?.name || '어딘가'}</p>
                  ${item.votes.length ? html`<p class="fine-print">👍 ${item.votes.map(name).join(', ')}</p>` : ''}
                </div>
                <div class="outing-item-actions">
                  <button type="button" class="reaction ${mine ? 'is-on' : ''}" data-action="outing-vote" data-id="${item.id}" data-mine="${mine ? '1' : ''}" aria-pressed="${mine}" aria-label="👍 투표${item.votes.length ? ` ${item.votes.length}표` : ''}">👍 <span class="reaction-count">${item.votes.length}</span></button>
                  <button type="button" class="button button-secondary button-small" data-action="outing-go" data-id="${item.id}">여기로 출발</button>
                  ${item.added_by === me || owner ? html`<button type="button" class="text-button text-button-muted" data-action="outing-remove" data-id="${item.id}">빼기</button>` : ''}
                </div>
              </li>`;
            })}
          </ul>`
        : html`<p class="empty-body">아직 비어 있어요. "카드 넘기며 함께 봉투에 담기"를 누르고, 마음에 드는 카드를 아래로 내려 담아 보세요.</p>`}
    </section>

    <section class="block">
      ${owner
        ? html`<button type="button" class="text-button text-button-muted" data-action="outing-end" data-id="${o.id}">함께 하루 끝내기</button>`
        : html`<button type="button" class="text-button text-button-muted" data-action="outing-leave" data-id="${o.id}">나가기</button>`}
    </section>`;
}

function inboxTab(t) {
  const pending = new Set(t.requests.incoming.map((r) => r.from_id));
  return html`
    ${requestsIncoming(t)}
    <section class="block" aria-labelledby="cards-title">
      <h2 class="section-label" id="cards-title">받은 장소 카드</h2>
      ${t.cards.length
        ? html`<ul class="shared-cards">${t.cards.map(cardItem)}</ul>`
        : html`<p class="empty-body">친구가 "친구에게 보내기"로 보낸 장소가 여기에 와요. 마음에 들면 봉투에 담아두세요.</p>`}
    </section>
    <section class="block" aria-labelledby="notes-title">
      <h2 class="section-label" id="notes-title">알림</h2>
      ${t.notes.length
        ? html`<ul class="notes">
            ${t.notes.map(
              (n) => html`<li class="note-item ${n.read_at ? '' : 'is-unread'}">
                ${avatar(n.actor)}
                <p class="note-text">${noteText(n)} <span class="fine-print">${ago(n.created_at)}</span></p>
                ${['together_invite', 'together_item'].includes(n.kind) && n.data?.day_id && t.outings.some((o) => o.id === n.data.day_id)
                  ? html`<span class="note-actions"><button type="button" class="button button-secondary button-small" data-action="outing-open" data-id="${n.data.day_id}">열기</button></span>`
                  : ''}
                ${n.kind === 'friend_request' && pending.has(n.actor_id)
                  ? html`<span class="note-actions">
                      <button type="button" class="button button-primary button-small" data-action="request-accept" data-id="${n.actor_id}" data-name="${n.actor?.nickname || ''}">수락</button>
                      <button type="button" class="text-button text-button-muted" data-action="request-decline" data-id="${n.actor_id}">거절</button>
                    </span>`
                  : ''}
              </li>`,
            )}
          </ul>`
        : html`<p class="empty-body">아직 알림이 없어요. 친구 요청, 댓글, 반응, 받은 카드가 여기에 모여요.</p>`}
    </section>`;
}

function friendsTab(t, ui) {
  const me = getMyProfile();
  return html`
    ${requestsIncoming(t)}
    <section class="block" aria-labelledby="my-tag-title">
      <h2 class="section-label" id="my-tag-title">내 이름표</h2>
      ${me
        ? html`<p class="tag-big">${me.nickname}<span class="tag">#${me.tag}</span></p>
            <div class="actions actions-compact">
              <button type="button" class="button button-secondary button-small" data-action="copy-tag">이름표 복사</button>
              <button type="button" class="button button-ghost button-small" data-action="copy-invite">초대 링크 복사</button>
            </div>`
        : html`<p class="empty-body">프로필을 불러오는 중…</p>`}
    </section>

    <form class="block add-friend" data-form="friend-add" novalidate>
      <label class="section-label" for="friend-tag">친구 추가</label>
      <div class="area-form">
        <input id="friend-tag" class="area-input" type="text" placeholder="닉네임#12345" autocomplete="off" value="${t.addText}" data-input="friend-tag" data-focus-key="friend-tag">
        <button type="submit" class="button button-primary button-small" ${t.adding ? 'disabled' : ''}>${t.adding ? '보내는 중…' : '요청 보내기'}</button>
      </div>
      ${t.addError ? html`<p class="area-error" role="alert">${t.addError}</p>` : html`<p class="fine-print">상대가 수락하면 친구가 돼요. 초대 링크로 들어온 사람은 바로 친구가 돼요.</p>`}
    </form>

    <section class="block" aria-labelledby="friends-title">
      <h2 class="section-label" id="friends-title">친구 ${t.friends.length ? `${t.friends.length}명` : ''}</h2>
      ${t.friends.length
        ? html`<ul class="people">
            ${t.friends.map(
              (f) => html`<li class="person">
                ${avatar(f)}
                <span class="person-name">${f.nickname}<span class="tag">#${f.tag}</span></span>
                <button type="button" class="text-button text-button-muted" data-action="friend-remove" data-id="${f.user_id}" data-name="${f.nickname}" aria-label="${f.nickname} 친구 삭제">삭제</button>
                <button type="button" class="text-button text-button-muted" data-action="friend-block" data-id="${f.user_id}" data-name="${f.nickname}" aria-label="${f.nickname} 차단">차단</button>
              </li>`,
            )}
          </ul>`
        : html`<p class="empty-body">아직 친구가 없어요. 내 이름표나 초대 링크를 보내보세요.</p>`}
    </section>
    ${requestsOutgoing(t)}`;
}

function groupList(t) {
  return html`
    <section class="block meet-section" aria-labelledby="groups-title">
      <div class="meet-head">
        <h2 class="meet-title" id="groups-title">단체방</h2>
        <span class="meet-head-actions">
          <button type="button" class="button button-ghost button-small" data-action="meet-form" data-form-name="join" aria-expanded="${t.openForm === 'join'}" data-focus-key="join-group">코드로 들어가기</button>
          <button type="button" class="button button-secondary button-small" data-action="meet-form" data-form-name="group" aria-expanded="${t.openForm === 'group'}" data-focus-key="new-group">＋ 만들기</button>
        </span>
      </div>
      <p class="meet-desc">계속 함께 쓰는 기록장이에요. 다녀온 곳의 사진과 소감을 모아요.</p>
      ${t.groups.length
        ? html`<ul class="group-list">
            ${t.groups.map(
              (g) => html`<li><button type="button" class="group-item" data-action="group-open" data-id="${g.id}" data-focus-key="group-${g.id}">
                <span class="group-name">${g.name}</span>
                <span class="group-meta">${g.owner_id === getUser()?.id ? '내가 만든 방' : '참여 중'}</span>
              </button></li>`,
            )}
          </ul>`
        : ''}
      ${t.openForm === 'group' ? groupCreateForm(t) : ''}
      ${t.openForm === 'join' ? groupJoinForm(t) : ''}
    </section>`;
}

function groupCreateForm(t) {
  return html`
    <form class="meet-form" data-form="group-create" novalidate>
      <label class="section-label" for="group-name">새 단체방 이름</label>
      <div class="area-form">
        <input id="group-name" class="area-input" type="text" maxlength="30" placeholder="예: 주말 산책 모임" value="${t.groupName}" data-input="group-name" data-focus-key="group-name">
        <button type="submit" class="button button-primary button-small">만들기</button>
      </div>
    </form>`;
}

function groupJoinForm(t) {
  return html`
    <form class="meet-form" data-form="group-join" novalidate>
      <label class="section-label" for="group-code">초대 코드로 들어가기</label>
      <div class="area-form">
        <input id="group-code" class="area-input" type="text" maxlength="8" placeholder="8자리 코드" autocomplete="off" value="${t.joinCode}" data-input="group-code" data-focus-key="group-code">
        <button type="submit" class="button button-secondary button-small">들어가기</button>
      </div>
    </form>`;
}

const groupNames = (t) => new Map(t.groups.map((g) => [g.id, g.name]));

function whereText(t, e) {
  const a = audienceOf(e);
  const names = [...(a.friends ? ['친구'] : []), ...a.groups.map((g) => groupNames(t).get(g) || '다른 단체방')];
  return names.length ? names.join(', ') : '나만 보기';
}

function matches(entry, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.place_name, entry.note, entry.area_label, entry.date].some((v) => String(v || '').toLowerCase().includes(q));
}

function pickPanel(t, group) {
  const header = html`<div class="pick-head">
      <h3 class="pick-title" id="pick-title">내 기록에서 고르기</h3>
      <button type="button" class="text-button" data-action="group-pick-close" data-focus-key="group-pick-close">닫기</button>
    </div>`;
  if (t.pickLoading) return html`<div class="pick-panel" role="region" aria-labelledby="pick-title">${header}<p class="empty-body">기록을 불러오는 중…</p></div>`;
  const all = t.myEntries || [];
  if (!all.length) {
    return html`<div class="pick-panel" role="region" aria-labelledby="pick-title">${header}
      <p class="empty-body">아직 남긴 기록이 없어요. 나의 하루에서 다녀온 곳에 소감이나 사진을 남겨보세요.</p>
      <button type="button" class="button button-secondary button-small" data-action="go-myday">나의 하루로 가기</button>
    </div>`;
  }
  const shown = all.filter((e) => matches(e, t.pickQuery || ''));
  return html`<div class="pick-panel" role="region" aria-labelledby="pick-title">${header}
    <input class="area-input pick-search" type="search" placeholder="장소, 소감, 날짜로 찾기" aria-label="내 기록 찾기" value="${t.pickQuery || ''}" data-input="pick-query" data-focus-key="pick-query">
    ${shown.length
      ? html`<ul class="pick-list">
          ${shown.map((e) => {
            const here = audienceOf(e).groups.includes(group.id);
            const where = whereText(t, e);
            return html`<li class="pick-item${here ? ' is-here' : ''}">
              <div class="pick-main">
                <p class="pick-meta">${e.date}${e.area_label ? ` · ${e.area_label}` : ''} · ${here ? '이 방에 올라가 있음' : where}${e.photo_paths?.length ? ` · 사진 ${e.photo_paths.length}장` : ''}</p>
                <p class="pick-name">${e.place_name || '기록'}</p>
                ${e.note ? html`<p class="pick-note">${e.note.length > 60 ? `${e.note.slice(0, 60)}…` : e.note}</p>` : ''}
              </div>
              ${here
                ? html`<span class="pick-done" aria-label="올라가 있음">✓</span>`
                : html`<button type="button" class="button button-secondary button-small" data-action="group-pick" data-id="${e.id}">올리기</button>`}
            </li>`;
          })}
        </ul>`
      : html`<p class="empty-body">‘${t.pickQuery}’에 맞는 기록이 없어요.</p>`}
  </div>`;
}

function groupView(t, ui) {
  const group = t.groups.find((g) => g.id === t.openGroupId);
  if (!group) return groupList(t);
  const me = getUser()?.id;
  const owner = group.owner_id === me;
  return html`
    <button type="button" class="text-button flow-back" data-action="group-back" data-focus-key="group-back">← 모임</button>
    <section class="block group-head" aria-labelledby="group-title">
      <h2 class="group-title" id="group-title">${group.name}</h2>
      <button type="button" class="member-stack" data-action="group-manage" aria-expanded="${Boolean(t.manageOpen)}" data-focus-key="group-manage">
        <span class="member-stack-faces" aria-hidden="true">${t.members.slice(0, 5).map((m) => avatar(m.profile))}</span>
        <span>멤버 ${t.members.length}명 · 방 관리</span>
      </button>
      ${t.manageOpen
        ? html`<div class="group-manage">
            <p class="fine-print">초대 코드 <strong class="tag-text">${group.invite_code}</strong></p>
            <ul class="member-chips" aria-label="멤버">
              ${t.members.map(
                (m) => html`<li class="member-chip">${avatar(m.profile)}<span>${m.user_id === me ? '나' : m.profile?.nickname || '멤버'}${m.user_id === group.owner_id ? ' · 방장' : ''}</span>
                  ${owner && m.user_id !== me ? html`<button type="button" class="text-button text-button-muted" data-action="member-remove" data-id="${m.user_id}" data-name="${m.profile?.nickname || '멤버'}" aria-label="${m.profile?.nickname || '멤버'} 내보내기">내보내기</button>` : ''}
                </li>`,
              )}
            </ul>
            <div class="actions actions-compact">
              ${owner
                ? html`<button type="button" class="text-button text-button-muted" data-action="group-delete" data-id="${group.id}">단체방 지우기</button>`
                : html`<button type="button" class="text-button text-button-muted" data-action="group-leave" data-id="${group.id}">방 나가기</button>
                    <button type="button" class="text-button text-button-muted" data-action="report" data-type="group" data-id="${group.id}">단체방 신고</button>`}
            </div>
          </div>`
        : ''}
      <div class="group-cta">
        <button type="button" class="button button-primary button-small" data-action="group-pick-open" data-focus-key="group-pick-open" ${t.picking ? 'disabled' : ''}>내 기록 올리기</button>
        <button type="button" class="button button-secondary button-small" data-action="group-copy-invite" data-code="${group.invite_code}">초대 링크 복사</button>
      </div>
    </section>

    ${t.picking ? pickPanel(t, group) : ''}

    <section class="block" aria-labelledby="group-feed-title">
      <h2 class="section-label" id="group-feed-title">함께 쓰는 기록장 ${t.groupFeed.length ? `${t.groupFeed.length}` : ''}</h2>
      ${t.groupFeed.length
        ? html`<div class="entries">${t.groupFeed.map((e) => entryCard(e, { me, author: t.profiles.get(e.user_id), comments: commentsOf(t, e), reactions: reactionsOf(t, e), profiles: t.profiles, groupNames: groupNames(t), roomId: group.id, canModerate: owner, showOwnerActions: false, ui }))}</div>`
        : html`<p class="empty-body">아직 올라온 기록이 없어요. "내 기록 올리기"로 첫 기록을 올려보세요.</p>`}
    </section>`;
}

function feedTab(t, ui) {
  const me = getUser()?.id;
  const nudges = [];
  if (t.requests.incoming.length) nudges.push(html`<button type="button" class="feed-nudge" data-action="together-tab" data-tab="friends">👋 받은 친구 요청 ${t.requests.incoming.length}개 · 보기</button>`);
  if (t.cards.length) nudges.push(html`<button type="button" class="feed-nudge" data-action="together-tab" data-tab="inbox">✉︎ 받은 장소 카드 ${t.cards.length}장 · 보기</button>`);
  const lonely = !t.friends.length && !t.groups.length;
  return html`
    ${nudges.length ? html`<div class="feed-nudges">${nudges}</div>` : ''}
    <section class="block feed" aria-labelledby="feed-title">
      <h2 class="section-label" id="feed-title">친구와 모임의 새 기록</h2>
      ${t.feed.length
        ? html`<div class="entries">${t.feed.map((e) => entryCard(e, { me, author: t.profiles.get(e.user_id), comments: commentsOf(t, e), reactions: reactionsOf(t, e), profiles: t.profiles, groupNames: groupNames(t), ui }))}</div>`
        : lonely
          ? html`<div class="feed-empty">
              <p class="empty-body">아직 함께할 사람이 없어요. 친구를 추가하거나 단체방을 만들면, 서로 나눈 기록이 여기에 모여요.</p>
              <div class="actions actions-compact">
                <button type="button" class="button button-primary button-small" data-action="together-tab" data-tab="friends">친구 추가하기</button>
                <button type="button" class="button button-secondary button-small" data-action="together-tab" data-tab="meet">모임 만들기</button>
              </div>
            </div>`
          : html`<p class="empty-body">아직 새 기록이 없어요. 친구나 모임에 공개된 기록이 여기에 모여요.</p>`}
    </section>`;
}

function meetTab(t, ui) {
  if (t.openGroupId) return groupView(t, ui);
  if (t.openOutingId) return outingView(t);
  return html`${groupList(t)}${outingList(t)}`;
}

function unreadCount(t) {
  return t.notes.filter((x) => !x.read_at).length;
}

export function render(_state, { ui }) {
  if (!isBackendConfigured()) {
    return html`<section class="screen"><h1 class="title" tabindex="-1">함께</h1><p class="empty-body">이 기능은 계정이 연결된 버전에서 쓸 수 있어요.</p></section>`;
  }
  const t = state(ui);
  return html`
    <section class="screen together" aria-labelledby="together-title">
      <div class="together-top">
        <div>
          <p class="eyebrow">아는 사람끼리만 나누는 하루</p>
          <h1 id="together-title" class="title" tabindex="-1">함께</h1>
        </div>
        ${(() => {
          const n = unreadCount(t);
          return html`<button type="button" class="bell ${t.tab === 'inbox' ? 'is-on' : ''}" data-action="together-tab" data-tab="inbox" data-focus-key="tab-inbox" aria-label="알림${n ? ` ${n}개 새로 옴` : ''}">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.4A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${n && t.tab !== 'inbox' ? html`<span class="tab-badge bell-badge">${n > 9 ? '9+' : n}</span>` : ''}
          </button>`;
        })()}
      </div>
      ${inviteBanner()}
      ${t.tab === 'inbox'
        ? html`<button type="button" class="text-button flow-back" data-action="together-tab" data-tab="${t.prevTab || 'feed'}" data-focus-key="inbox-back">← 돌아가기</button>
            <h2 class="inbox-title">알림</h2>`
        : html`<div class="tabs" role="tablist" aria-label="함께">
            <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="feed" data-focus-key="tab-feed" aria-selected="${t.tab === 'feed'}">소식</button>
            <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="meet" data-focus-key="tab-meet" aria-selected="${t.tab === 'meet'}">모임</button>
            <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="friends" data-focus-key="tab-friends" aria-selected="${t.tab === 'friends'}">
              친구${t.requests.incoming.length ? html` <span class="tab-badge">${t.requests.incoming.length}</span>` : ''}
            </button>
          </div>`}
      ${t.error ? html`<p class="area-error" role="alert">${t.error}</p>` : ''}
      ${t.loading
        ? html`<p class="empty-body">불러오는 중…</p>`
        : t.tab === 'friends'
          ? friendsTab(t, ui)
          : t.tab === 'inbox'
            ? inboxTab(t)
            : t.tab === 'meet'
              ? meetTab(t, ui)
              : feedTab(t, ui)}
    </section>`;
}

async function attempt(ctx, run, done) {
  try {
    const result = await run();
    if (done) ctx.toast(typeof done === 'function' ? done(result) : done);
    await reload(ctx);
    return result;
  } catch (error) {
    ctx.toast(error instanceof SocialError ? error.message : '잠시 후 다시 시도해 주세요.');
    return null;
  }
}

export const actions = {
  ...journalActions,
  'together-tab': ({ ui, rerender }, data) => {
    const t = state(ui);
    if (data.tab === 'inbox' && t.tab !== 'inbox') t.prevTab = t.tab;
    // tapping 모임 again goes back to the list
    if (data.tab === 'meet' && t.tab === 'meet') Object.assign(t, { openGroupId: null, openOutingId: null });
    t.tab = data.tab;
    if (t.tab === 'inbox') markRead(t);
    rerender();
  },
  'request-accept': (ctx, data) => attempt(ctx, () => respondFriend(data.id, true), `${data.name || '그분'}님과 친구가 됐어요.`),
  'request-decline': (ctx, data) => attempt(ctx, () => respondFriend(data.id, false), '요청을 거절했어요.'),
  'request-cancel': (ctx, data) => attempt(ctx, () => cancelRequest(data.id), '요청을 취소했어요.'),
  'card-keep': async (ctx, data) => {
    const card = state(ctx.ui).cards.find((c) => c.id === data.id);
    if (!card) return;
    const result = ctx.store.actions.keepPlace(card.place);
    if (!result) {
      ctx.toast('먼저 오늘 어디서 시작할지 정해 주세요.', { label: '위치 정하기', run: (c) => c.navigate('home') });
      return;
    }
    await attempt(ctx, () => removeCard(card.id));
    ctx.toast(result === 'already' ? '이미 봉투에 있는 곳이에요.' : `‘${card.place.name}’을(를) 봉투에 담았어요.`, { label: '경로 보기', run: (c) => c.navigate('route') });
  },
  'card-remove': (ctx, data) => attempt(ctx, () => removeCard(data.id), '카드를 지웠어요.'),
  'outing-open': (ctx, data) => {
    Object.assign(state(ctx.ui), { tab: 'meet', openOutingId: data.id, openGroupId: null, loading: true });
    ctx.rerender();
    reload(ctx);
  },
  'outing-back': ({ ui, rerender }) => {
    state(ui).openOutingId = null;
    rerender();
  },
  'outing-swipe': (ctx, data) => {
    const o = state(ctx.ui).outings.find((x) => x.id === data.id);
    if (!o) return;
    ctx.ui.activeTogether = { id: o.id, title: o.title };
    if (!ctx.store.getState().area) {
      ctx.toast('먼저 오늘 어디서 시작할지 정해 주세요.');
      ctx.navigate('home');
      return;
    }
    if (!ctx.store.getState().recommendationId) ctx.store.actions.startDay();
    ctx.navigate('discover');
  },
  'outing-vote': (ctx, data) => attempt(ctx, () => toggleTogetherVote(data.id, data.mine === '1')),
  'outing-remove': (ctx, data) => attempt(ctx, () => removeTogetherItem(data.id), '함께 봉투에서 뺐어요.'),
  'outing-go': (ctx, data) => {
    const item = state(ctx.ui).outingItems.find((i) => i.id === data.id);
    if (!item) return;
    const result = ctx.store.actions.keepPlace(item.place);
    if (!result) {
      ctx.toast('먼저 오늘 어디서 시작할지 정해 주세요.', { label: '위치 정하기', run: (c) => c.navigate('home') });
      return;
    }
    ctx.toast(`‘${item.place.name}’을(를) 내 경로에 담았어요. 출발해요!`);
    ctx.navigate('route');
  },
  'outing-leave': (ctx, data) => {
    if (!window.confirm('이 함께 하루에서 나갈까요?')) return;
    state(ctx.ui).openOutingId = null;
    if (ctx.ui.activeTogether?.id === data.id) ctx.ui.activeTogether = null;
    attempt(ctx, () => leaveTogetherDay(data.id), '나왔어요.');
  },
  'outing-end': (ctx, data) => {
    if (!window.confirm('이 함께 하루를 끝낼까요? 함께 봉투와 투표가 모두 지워져요.')) return;
    state(ctx.ui).openOutingId = null;
    if (ctx.ui.activeTogether?.id === data.id) ctx.ui.activeTogether = null;
    attempt(ctx, () => endTogetherDay(data.id), '함께 하루를 끝냈어요.');
  },
  'copy-tag': async ({ toast }) => {
    const ok = await copyText(fullTag(getMyProfile()));
    toast(ok ? '이름표를 복사했어요. 친구에게 보내주세요.' : `이름표: ${fullTag(getMyProfile())}`);
  },
  'copy-invite': async ({ toast }) => {
    const token = await createInviteToken().catch(() => null);
    const ok = await copyText(token ? inviteLink({ invite: token }) : inviteLink({ friend: fullTag(getMyProfile()) }));
    toast(ok ? '초대 링크를 복사했어요. 링크를 연 사람은 바로 친구가 돼요(14일 동안).' : '복사하지 못했어요. 이름표를 직접 알려주세요.');
  },
  'invite-accept': async (ctx) => {
    const invite = pendingInvite();
    clearInvite();
    if (!invite) return;
    if (invite.token) {
      await attempt(ctx, () => acceptInvite(invite.token), (p) => `${p?.nickname || '친구'} 님과 친구가 됐어요.`);
    } else if (invite.friend) {
      await attempt(ctx, () => requestFriend(invite.friend), (r) => (r.status === 'requested' ? '친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.' : '친구가 됐어요.'));
    } else if (invite.group) {
      const g = await attempt(ctx, () => joinGroup(invite.group), (g) => `‘${g.name}’ 방에 들어왔어요.`);
      if (g) {
        Object.assign(state(ctx.ui), { tab: 'meet', openGroupId: g.id, openOutingId: null });
        await reload(ctx);
      }
    }
  },
  'invite-dismiss': ({ rerender }) => {
    clearInvite();
    rerender();
  },
  'friend-remove': (ctx, data) => {
    if (!window.confirm(`${data.name} 님을 친구에서 삭제할까요?`)) return;
    attempt(ctx, () => removeFriend(data.id), '친구에서 삭제했어요.');
  },
  'friend-block': (ctx, data) => {
    if (!window.confirm(`${data.name} 님을 차단할까요? 친구에서 삭제되고, 서로의 기록과 댓글이 보이지 않아요.`)) return;
    attempt(ctx, () => blockUser(data.id), '차단했어요.');
  },
  'group-open': (ctx, data) => {
    Object.assign(state(ctx.ui), { openGroupId: data.id, openOutingId: null, loading: true, picking: false, manageOpen: false });
    ctx.rerender();
    reload(ctx);
  },
  'group-pick-open': async (ctx) => {
    const t = state(ctx.ui);
    Object.assign(t, { picking: true, pickLoading: true, pickQuery: '' });
    ctx.rerender();
    try {
      t.myEntries = await myEntries();
    } catch (error) {
      t.picking = false;
      ctx.toast(error instanceof SocialError ? error.message : '기록을 불러오지 못했어요.');
    }
    t.pickLoading = false;
    ctx.rerender();
  },
  'group-pick-close': ({ ui, rerender }) => {
    state(ui).picking = false;
    rerender();
  },
  'group-pick': async (ctx, data) => {
    const t = state(ctx.ui);
    const group = t.groups.find((g) => g.id === t.openGroupId);
    if (!group) return;
    const entry = (t.myEntries || []).find((e) => e.id === data.id);
    if (!entry) return;
    const a = audienceOf(entry);
    // older database (multi_share.sql not run): an entry lives in one place, so it moves
    if (!supportsMultiShare(entry) && (a.friends || a.groups.length) && !window.confirm(`지금 ‘${whereText(t, entry)}’에 공개된 기록이에요. ‘${group.name}’ 방으로 옮길까요?`)) return;
    const saved = await attempt(ctx, () => shareEntryToGroup(entry, group.id), `‘${group.name}’ 방에도 올렸어요.`);
    if (saved) {
      t.myEntries = (t.myEntries || []).map((e) => (e.id === saved.id ? saved : e));
      t.picking = false;
      ctx.rerender();
    }
  },
  'go-myday': ({ navigate }) => navigate('day'),
  'meet-form': ({ ui, rerender }, data) => {
    const t = state(ui);
    t.openForm = t.openForm === data.formName ? null : data.formName;
    rerender();
    const focus = { group: 'group-name', join: 'group-code', outing: 'outing-title' }[t.openForm];
    if (focus) document.getElementById(focus)?.focus();
  },
  'group-manage': ({ ui, rerender }) => {
    state(ui).manageOpen = !state(ui).manageOpen;
    rerender();
  },
  'group-back': ({ ui, rerender }) => {
    state(ui).openGroupId = null;
    state(ui).picking = false;
    rerender();
  },
  'group-copy-invite': async ({ toast }, data) => {
    const ok = await copyText(inviteLink({ group: data.code }));
    toast(ok ? '단체방 초대 링크를 복사했어요.' : `초대 코드: ${data.code}`);
  },
  'member-remove': (ctx, data) => {
    if (!window.confirm(`${data.name} 님을 이 방에서 내보낼까요?`)) return;
    attempt(ctx, () => removeMember(state(ctx.ui).openGroupId, data.id), '내보냈어요.');
  },
  'group-leave': (ctx, data) => {
    if (!window.confirm('이 방에서 나갈까요? 내가 올린 기록은 나만 보기로 남아요.')) return;
    state(ctx.ui).openGroupId = null;
    attempt(ctx, () => leaveGroup(data.id), '방에서 나왔어요.');
  },
  'group-delete': (ctx, data) => {
    if (!window.confirm('이 단체방을 지울까요? 멤버들이 올린 기록은 각자에게만 보이게 남아요.')) return;
    state(ctx.ui).openGroupId = null;
    attempt(ctx, () => deleteGroup(data.id), '단체방을 지웠어요.');
  },
};

export const inputs = {
  ...journalInputs,
  'friend-tag': ({ ui }, el) => {
    state(ui).addText = el.value;
  },
  'group-name': ({ ui }, el) => {
    state(ui).groupName = el.value;
  },
  'outing-title': ({ ui }, el) => {
    state(ui).newOuting.title = el.value;
    const button = el.closest('form')?.querySelector('button[type=submit]');
    if (button) button.disabled = !(el.value.trim() && state(ui).newOuting.members.length);
  },
  'outing-member': ({ ui, rerender }, el) => {
    const n = state(ui).newOuting;
    n.members = el.checked ? [...new Set([...n.members, el.value])] : n.members.filter((id) => id !== el.value);
    rerender();
  },
  'pick-query': ({ ui, rerender }, el) => {
    state(ui).pickQuery = el.value;
    rerender();
  },
  'group-code': ({ ui }, el) => {
    state(ui).joinCode = el.value;
  },
};

export const forms = {
  ...journalForms,
  'friend-add': async (ctx) => {
    const t = state(ctx.ui);
    t.adding = true;
    t.addError = '';
    ctx.rerender();
    try {
      const { status } = await requestFriend(t.addText);
      t.addText = '';
      ctx.toast(
        status === 'requested'
          ? '친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.'
          : status === 'already'
            ? '이미 친구예요.'
            : '친구가 됐어요.',
      );
      await reload(ctx);
    } catch (error) {
      t.addError = error instanceof SocialError ? error.message : '친구를 추가하지 못했어요.';
    } finally {
      t.adding = false;
      ctx.rerender();
    }
  },
  'outing-create': async (ctx) => {
    const t = state(ctx.ui);
    const n = t.newOuting;
    if (n.busy) return;
    n.busy = true;
    ctx.rerender();
    const day = await attempt(ctx, () => createTogetherDay(n.title, n.members), (d) => `‘${d.title}’을(를) 만들고 친구들을 초대했어요.`);
    n.busy = false;
    if (day) {
      t.newOuting = { title: '', members: [] };
      Object.assign(t, { openOutingId: day.id, openForm: null });
      await reload(ctx);
    } else ctx.rerender();
  },
  'group-create': async (ctx) => {
    const t = state(ctx.ui);
    const g = await attempt(ctx, () => createGroup(t.groupName), (g) => `‘${g.name}’ 방을 만들었어요. 초대 링크를 보내보세요.`);
    if (g) {
      Object.assign(t, { groupName: '', openGroupId: g.id, openForm: null });
      await reload(ctx);
    }
  },
  'group-join': async (ctx) => {
    const t = state(ctx.ui);
    const g = await attempt(ctx, () => joinGroup(t.joinCode), (g) => `‘${g.name}’ 방에 들어왔어요.`);
    if (g) {
      Object.assign(t, { joinCode: '', openGroupId: g.id, openForm: null });
      await reload(ctx);
    }
  },
};
