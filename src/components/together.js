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
  listFriends,
  removeFriend,
  blockUser,
  friendsFeed,
  listGroups,
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
  if (!ui.together) ui.together = { tab: 'friends', loading: true, friends: [], feed: [], groups: [], openGroupId: null, members: [], groupFeed: [], comments: [], reactions: [], requests: { incoming: [], outgoing: [] }, notes: [], cards: [], profiles: new Map(), addText: '', groupName: '', joinCode: '' };
  return ui.together;
}

export function onEnter(ctx) {
  if (!isBackendConfigured() || !getUser()) return null;
  const invite = pendingInvite();
  if (invite?.group) state(ctx.ui).tab = 'groups';
  reload(ctx);
  return null;
}

export async function reload(ctx) {
  const t = state(ctx.ui);
  try {
    if (!getMyProfile()) await loadMyProfile();
    const [friends, feed, groups, requests, notes, cards] = await Promise.all([
      listFriends(),
      friendsFeed(),
      listGroups(),
      listRequests().catch(() => ({ incoming: [], outgoing: [] })),
      listNotifications().catch(() => []),
      receivedCards().catch(() => []),
    ]);
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
    ${requestsOutgoing(t)}

    <section class="block" aria-labelledby="feed-title">
      <h2 class="section-label" id="feed-title">친구들이 나눈 기록</h2>
      ${t.feed.length
        ? html`<div class="entries">${t.feed.map((e) => entryCard(e, { me: getUser()?.id, author: t.profiles.get(e.user_id), comments: commentsOf(t, e), reactions: reactionsOf(t, e), profiles: t.profiles, ui }))}</div>`
        : html`<p class="empty-body">친구가 "친구에게" 공개한 기록이 여기에 모여요.</p>`}
    </section>`;
}

function groupList(t) {
  return html`
    <section class="block" aria-labelledby="groups-title">
      <h2 class="section-label" id="groups-title">내 단체방</h2>
      ${t.groups.length
        ? html`<ul class="group-list">
            ${t.groups.map(
              (g) => html`<li><button type="button" class="group-item" data-action="group-open" data-id="${g.id}" data-focus-key="group-${g.id}">
                <span class="group-name">${g.name}</span>
                <span class="group-meta">${g.owner_id === getUser()?.id ? '내가 만든 방' : '참여 중'}</span>
              </button></li>`,
            )}
          </ul>`
        : html`<p class="empty-body">아직 들어간 단체방이 없어요. 새로 만들거나 초대 코드로 들어가 보세요.</p>`}
    </section>

    <form class="block" data-form="group-create" novalidate>
      <label class="section-label" for="group-name">새 단체방 만들기</label>
      <div class="area-form">
        <input id="group-name" class="area-input" type="text" maxlength="30" placeholder="예: 주말 산책 모임" value="${t.groupName}" data-input="group-name" data-focus-key="group-name">
        <button type="submit" class="button button-primary button-small">만들기</button>
      </div>
    </form>

    <form class="block" data-form="group-join" novalidate>
      <label class="section-label" for="group-code">초대 코드로 들어가기</label>
      <div class="area-form">
        <input id="group-code" class="area-input" type="text" maxlength="8" placeholder="8자리 코드" autocomplete="off" value="${t.joinCode}" data-input="group-code" data-focus-key="group-code">
        <button type="submit" class="button button-secondary button-small">들어가기</button>
      </div>
    </form>`;
}

function groupView(t, ui) {
  const group = t.groups.find((g) => g.id === t.openGroupId);
  if (!group) return groupList(t);
  const me = getUser()?.id;
  const owner = group.owner_id === me;
  return html`
    <button type="button" class="text-button flow-back" data-action="group-back" data-focus-key="group-back">← 단체방 목록</button>
    <section class="block group-head" aria-labelledby="group-title">
      <h2 class="group-title" id="group-title">${group.name}</h2>
      <p class="fine-print">초대 코드 <strong class="tag-text">${group.invite_code}</strong></p>
      <div class="actions actions-compact">
        <button type="button" class="button button-secondary button-small" data-action="group-copy-invite" data-code="${group.invite_code}">초대 링크 복사</button>
      </div>
      <ul class="member-chips" aria-label="멤버">
        ${t.members.map(
          (m) => html`<li class="member-chip">${avatar(m.profile)}<span>${m.profile?.nickname || '멤버'}${m.user_id === group.owner_id ? ' · 방장' : ''}</span>
            ${owner && m.user_id !== me ? html`<button type="button" class="text-button text-button-muted" data-action="member-remove" data-id="${m.user_id}" data-name="${m.profile?.nickname || '멤버'}" aria-label="${m.profile?.nickname || '멤버'} 내보내기">내보내기</button>` : ''}
          </li>`,
        )}
      </ul>
    </section>

    <section class="block" aria-labelledby="group-feed-title">
      <h2 class="section-label" id="group-feed-title">함께 쓰는 기록장</h2>
      <p class="fine-print">나의 하루에서 다녀온 곳에 소감을 쓰고 공개 범위를 "단체방에 · ${group.name}"으로 고르면 여기에 올라와요.</p>
      ${t.groupFeed.length
        ? html`<div class="entries">${t.groupFeed.map((e) => entryCard(e, { me, author: t.profiles.get(e.user_id), comments: commentsOf(t, e), reactions: reactionsOf(t, e), profiles: t.profiles, groupName: group.name, canModerate: owner, showOwnerActions: e.user_id === me, ui }))}</div>`
        : html`<p class="empty-body">아직 올라온 기록이 없어요. 첫 기록을 남겨보세요.</p>`}
    </section>

    <section class="block">
      ${owner
        ? html`<button type="button" class="text-button text-button-muted" data-action="group-delete" data-id="${group.id}">단체방 지우기</button>`
        : html`<button type="button" class="text-button text-button-muted" data-action="group-leave" data-id="${group.id}">방 나가기</button>
            <button type="button" class="text-button text-button-muted" data-action="report" data-type="group" data-id="${group.id}">단체방 신고</button>`}
    </section>`;
}

export function render(_state, { ui }) {
  if (!isBackendConfigured()) {
    return html`<section class="screen"><h1 class="title" tabindex="-1">함께</h1><p class="empty-body">이 기능은 계정이 연결된 버전에서 쓸 수 있어요.</p></section>`;
  }
  const t = state(ui);
  return html`
    <section class="screen together" aria-labelledby="together-title">
      <p class="eyebrow">아는 사람끼리만 나누는 하루</p>
      <h1 id="together-title" class="title" tabindex="-1">함께</h1>
      ${inviteBanner()}
      <div class="tabs" role="tablist" aria-label="함께">
        <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="friends" data-focus-key="tab-friends" aria-selected="${t.tab === 'friends'}">친구</button>
        <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="groups" data-focus-key="tab-groups" aria-selected="${t.tab === 'groups'}">단체방</button>
        <button type="button" role="tab" class="tab" data-action="together-tab" data-tab="inbox" data-focus-key="tab-inbox" aria-selected="${t.tab === 'inbox'}">
          알림${(() => {
            const n = t.notes.filter((x) => !x.read_at).length + t.requests.incoming.length;
            return n && t.tab !== 'inbox' ? html` <span class="tab-badge">${n > 9 ? '9+' : n}</span>` : '';
          })()}
        </button>
      </div>
      ${t.error ? html`<p class="area-error" role="alert">${t.error}</p>` : ''}
      ${t.loading
        ? html`<p class="empty-body">불러오는 중…</p>`
        : t.tab === 'friends'
          ? friendsTab(t, ui)
          : t.tab === 'inbox'
            ? inboxTab(t)
            : t.openGroupId
              ? groupView(t, ui)
              : groupList(t)}
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
        Object.assign(state(ctx.ui), { tab: 'groups', openGroupId: g.id });
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
    Object.assign(state(ctx.ui), { openGroupId: data.id, loading: true });
    ctx.rerender();
    reload(ctx);
  },
  'group-back': ({ ui, rerender }) => {
    state(ui).openGroupId = null;
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
  'group-create': async (ctx) => {
    const t = state(ctx.ui);
    const g = await attempt(ctx, () => createGroup(t.groupName), (g) => `‘${g.name}’ 방을 만들었어요. 초대 링크를 보내보세요.`);
    if (g) {
      Object.assign(t, { groupName: '', openGroupId: g.id });
      await reload(ctx);
    }
  },
  'group-join': async (ctx) => {
    const t = state(ctx.ui);
    const g = await attempt(ctx, () => joinGroup(t.joinCode), (g) => `‘${g.name}’ 방에 들어왔어요.`);
    if (g) {
      Object.assign(t, { joinCode: '', openGroupId: g.id });
      await reload(ctx);
    }
  },
};
