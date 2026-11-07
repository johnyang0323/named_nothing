/**
 * Profiles, photo journal, friends, groups, comments, reports
 * (tables and rules in supabase/social.sql). Who may read what is enforced
 * by the database; these helpers just ask for it.
 */
import { getSupabase } from './client.js';
import { SUPABASE_URL } from './config.js';
import { getUser, displayName } from './auth.js';
import { resizeImage } from '../../utils/image.js';

export class SocialError extends Error {}

export const NICKNAME_MAX = 20;
export const NOTE_MAX = 1000;
export const COMMENT_MAX = 300;
export const PHOTOS_MAX = 4;
export const VISIBILITY = [
  { id: 'private', label: '나만 보기' },
  { id: 'friends', label: '친구에게' },
  { id: 'group', label: '단체방에' },
];

async function client() {
  const supabase = await getSupabase();
  const user = getUser();
  if (!supabase || !user) throw new SocialError('로그인이 필요해요.');
  return { supabase, user };
}

const fail = (message) => (error) => {
  if (error) throw new SocialError(message);
};

const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ─────────────────────────── profile ───────────────────────────

let myProfile = null;
const profileListeners = new Set();
export const getMyProfile = () => myProfile;
export function onProfileChange(fn) {
  profileListeners.add(fn);
  return () => profileListeners.delete(fn);
}
function setMyProfile(profile) {
  myProfile = profile;
  profileListeners.forEach((fn) => fn(profile));
}

export const fullTag = (profile) => (profile ? `${profile.nickname}#${profile.tag}` : '');

export function avatarSrc(profile) {
  if (!profile?.avatar_path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${profile.avatar_path.split('/').map(encodeURIComponent).join('/')}`;
}

/** A starting nickname: Kakao nickname, or the part of the email before @. */
function defaultNickname(user) {
  const name = displayName(user) || '';
  const base = (name.includes('@') ? name.split('@')[0] : name).replace(/#/g, '').trim();
  return (base || '산책자').slice(0, NICKNAME_MAX);
}

/** Load my profile, creating one (with a fresh #tag) on first sign-in. */
export async function loadMyProfile() {
  const { supabase, user } = await client();
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) {
    setMyProfile(null);
    return null; // tables not set up yet
  }
  if (data) {
    setMyProfile(data);
    return data;
  }
  const { data: created, error: e2 } = await supabase.rpc('upsert_profile', { p_nickname: defaultNickname(user) });
  if (e2) return null;
  setMyProfile(created);
  return created;
}

export function forgetMyProfile() {
  setMyProfile(null);
}

/** Save nickname and (optionally) a new photo or removal of the photo. */
export async function saveProfile({ nickname, avatarFile = null, clearAvatar = false }) {
  const name = String(nickname || '').trim();
  if (!name || name.length > NICKNAME_MAX) throw new SocialError(`닉네임은 1~${NICKNAME_MAX}자로 정해주세요.`);
  if (name.includes('#')) throw new SocialError('닉네임에는 #을 쓸 수 없어요.');
  const { supabase, user } = await client();
  let path = null;
  if (avatarFile) {
    const blob = await resizeImage(avatarFile, 400, 0.85);
    path = `${user.id}/avatar-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new SocialError('프로필 사진을 올리지 못했어요.');
  }
  const previous = myProfile?.avatar_path;
  const { data, error } = await supabase.rpc('upsert_profile', { p_nickname: name, p_avatar_path: path, p_clear_avatar: clearAvatar && !path });
  if (error) throw new SocialError('프로필을 저장하지 못했어요.');
  if (previous && previous !== data.avatar_path) supabase.storage.from('avatars').remove([previous]).catch(() => {});
  setMyProfile(data);
  return data;
}

/** Profiles of some users (only those the database lets me see). */
export async function profilesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { supabase } = await client();
  const { data, error } = await supabase.from('profiles').select('user_id, nickname, tag, avatar_path').in('user_id', unique);
  if (error) return new Map();
  return new Map(data.map((p) => [p.user_id, p]));
}

// ─────────────────────────── journal ───────────────────────────

const signed = new Map(); // path → { url, until }

/** Short-lived links to private journal photos (only ones I'm allowed to read). */
export async function photoUrls(paths) {
  const now = Date.now();
  const missing = [...new Set(paths)].filter((p) => !(signed.get(p)?.until > now));
  if (missing.length) {
    const { supabase } = await client();
    const { data } = await supabase.storage.from('journal').createSignedUrls(missing, 3600);
    (data || []).forEach((d) => d.signedUrl && signed.set(d.path, { url: d.signedUrl, until: now + 50 * 60 * 1000 }));
  }
  return new Map(paths.map((p) => [p, signed.get(p)?.url || null]));
}

// Every column, so share_place_photos comes along once place_photos.sql has run
// (and nothing breaks before that).
const ENTRY_FIELDS = '*';

/** PostgREST / Postgres "no such column" (place_photos.sql not run yet). */
const missingColumn = (error) => /share_place_photos/.test(`${error?.message || ''} ${error?.details || ''}`) || error?.code === 'PGRST204' || error?.code === '42703';

export async function myEntries({ date = null, limit = 200 } = {}) {
  const { supabase, user } = await client();
  let query = supabase.from('journal_entries').select(ENTRY_FIELDS).eq('user_id', user.id);
  if (date) query = query.eq('date', date);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new SocialError('기록을 불러오지 못했어요.');
  return data;
}

/**
 * Create or update an entry. New photos are resized (location data
 * removed) and uploaded; photos taken out of the entry are deleted.
 */
export async function saveEntry({ entry = null, date, place, areaLabel = null, note = '', keepPaths = [], newFiles = [], visibility = 'private', groupId = null, sharePlacePhotos = false }) {
  const text = String(note || '').trim();
  if (text.length > NOTE_MAX) throw new SocialError(`소감은 ${NOTE_MAX}자까지 쓸 수 있어요.`);
  if (keepPaths.length + newFiles.length > PHOTOS_MAX) throw new SocialError(`사진은 ${PHOTOS_MAX}장까지 올릴 수 있어요.`);
  if (!text && !keepPaths.length && !newFiles.length) throw new SocialError('소감이나 사진을 하나는 남겨주세요.');
  if (visibility === 'group' && !groupId) throw new SocialError('올릴 단체방을 골라주세요.');
  const { supabase, user } = await client();

  const uploaded = [];
  for (const file of newFiles) {
    const blob = await resizeImage(file);
    const path = `${user.id}/${randomId()}.jpg`;
    const { error } = await supabase.storage.from('journal').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      if (uploaded.length) supabase.storage.from('journal').remove(uploaded).catch(() => {});
      throw new SocialError('사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    uploaded.push(path);
  }

  const row = {
    date,
    place_id: place?.id || null,
    place_name: (place?.name || '').slice(0, 80),
    place_category: place?.category || null,
    area_label: areaLabel ? String(areaLabel).slice(0, 40) : null,
    note: text,
    photo_paths: [...keepPaths, ...uploaded],
    visibility,
    group_id: visibility === 'group' ? groupId : null,
    updated_at: new Date().toISOString(),
  };
  // Only send the column when it matters, so saving works before place_photos.sql.
  const share = Boolean(sharePlacePhotos && place?.id && row.photo_paths.length);
  if (share || entry?.share_place_photos) row.share_place_photos = share;
  const write = (values) =>
    entry
      ? supabase.from('journal_entries').update(values).eq('id', entry.id).select(ENTRY_FIELDS).single()
      : supabase.from('journal_entries').insert({ ...values, user_id: user.id }).select(ENTRY_FIELDS).single();
  let { data, error } = await write(row);
  let sharingUnavailable = false;
  if (error && 'share_place_photos' in row && missingColumn(error)) {
    delete row.share_place_photos;
    sharingUnavailable = share;
    ({ data, error } = await write(row));
  }
  if (error) {
    if (uploaded.length) supabase.storage.from('journal').remove(uploaded).catch(() => {});
    throw new SocialError('기록을 저장하지 못했어요.');
  }
  const removed = (entry?.photo_paths || []).filter((p) => !keepPaths.includes(p));
  if (removed.length) supabase.storage.from('journal').remove(removed).catch(() => {});
  return sharingUnavailable ? { ...data, sharingUnavailable } : data;
}

/**
 * Photos people chose to share for this place ("장소 사진으로 함께 보여주기"),
 * newest first, as short-lived links with the author's nickname. Empty when
 * nobody shared any, or place_photos.sql hasn't been run.
 */
export async function placePhotos(placeId, limit = 8) {
  if (!placeId) return [];
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('place_photos', { p_place_id: String(placeId), p_limit: limit });
  if (error || !Array.isArray(data) || !data.length) return [];
  const urls = await photoUrls(data.map((r) => r.path));
  return data
    .map((r) => ({ path: r.path, url: urls.get(r.path), nickname: r.nickname || '사용자', entryId: r.entry_id }))
    .filter((p) => p.url);
}

export async function deleteEntry(entry) {
  const { supabase, user } = await client();
  const { error } = await supabase.from('journal_entries').delete().eq('id', entry.id);
  fail('기록을 지우지 못했어요.')(error);
  const own = (entry.photo_paths || []).filter((p) => p.startsWith(`${user.id}/`));
  if (own.length) supabase.storage.from('journal').remove(own).catch(() => {});
}

// ─────────────────────────── friends ───────────────────────────

/** "닉네임#12345" → { nickname, tag } or null. */
export function parseTag(text) {
  const m = String(text || '').trim().match(/^(.{1,20})#(\d{5})$/u);
  return m ? { nickname: m[1].trim(), tag: m[2] } : null;
}

export async function addFriend(text) {
  const parsed = parseTag(text);
  if (!parsed) throw new SocialError('닉네임#12345 형식으로 입력해 주세요.');
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('add_friend', { p_nickname: parsed.nickname, p_tag: parsed.tag });
  if (error) {
    if (/self/.test(error.message)) throw new SocialError('내 이름표예요. 친구의 이름표를 입력해 주세요.');
    throw new SocialError('그 이름표를 찾지 못했어요. 닉네임과 #뒤 숫자를 다시 확인해 주세요.');
  }
  return data;
}

export async function listFriends() {
  const { supabase, user } = await client();
  const { data, error } = await supabase.from('friendships').select('friend_id, created_at').eq('user_id', user.id);
  if (error) throw new SocialError('친구 목록을 불러오지 못했어요.');
  const profiles = await profilesFor(data.map((f) => f.friend_id));
  return data
    .map((f) => profiles.get(f.friend_id))
    .filter(Boolean)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
}

export async function removeFriend(userId) {
  const { supabase } = await client();
  const { error } = await supabase.rpc('remove_friend', { p_friend: userId });
  fail('친구를 삭제하지 못했어요.')(error);
}

export async function blockUser(userId) {
  const { supabase } = await client();
  const { error } = await supabase.rpc('block_user', { p_user: userId });
  fail('차단하지 못했어요.')(error);
}

export async function listBlocked() {
  const { supabase, user } = await client();
  const { data, error } = await supabase.from('blocks').select('blocked_id, created_at').eq('blocker_id', user.id);
  if (error) return [];
  return data;
}

export async function unblock(userId) {
  const { supabase, user } = await client();
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', userId);
  fail('차단을 풀지 못했어요.')(error);
}

/** Entries my friends shared with friends (the database filters what I may see). */
export async function friendsFeed(limit = 50) {
  const { supabase, user } = await client();
  const { data, error } = await supabase
    .from('journal_entries')
    .select(ENTRY_FIELDS)
    .eq('visibility', 'friends')
    .neq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new SocialError('친구들의 기록을 불러오지 못했어요.');
  return data;
}

// ─────────────────────────── groups ───────────────────────────

export async function listGroups() {
  const { supabase } = await client();
  const { data, error } = await supabase.from('groups').select('id, name, invite_code, owner_id, created_at').order('created_at', { ascending: false });
  if (error) throw new SocialError('단체방을 불러오지 못했어요.');
  return data;
}

export async function createGroup(name) {
  const title = String(name || '').trim();
  if (!title || title.length > 30) throw new SocialError('방 이름은 1~30자로 정해주세요.');
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('create_group', { p_name: title });
  fail('단체방을 만들지 못했어요.')(error);
  return data;
}

export async function joinGroup(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(clean)) throw new SocialError('초대 코드 8자리를 확인해 주세요.');
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('join_group', { p_code: clean });
  if (error) throw new SocialError(/full/.test(error.message) ? '방이 가득 찼어요(최대 50명).' : '그 초대 코드의 방을 찾지 못했어요.');
  return data;
}

export async function groupMembers(groupId) {
  const { supabase } = await client();
  const { data, error } = await supabase.from('group_members').select('user_id, joined_at').eq('group_id', groupId);
  if (error) throw new SocialError('멤버를 불러오지 못했어요.');
  const profiles = await profilesFor(data.map((m) => m.user_id));
  return data.map((m) => ({ ...m, profile: profiles.get(m.user_id) || null }));
}

export async function groupEntries(groupId, limit = 100) {
  const { supabase } = await client();
  const { data, error } = await supabase
    .from('journal_entries')
    .select(ENTRY_FIELDS)
    .eq('group_id', groupId)
    .eq('visibility', 'group')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new SocialError('방의 기록을 불러오지 못했어요.');
  return data;
}

export async function leaveGroup(groupId) {
  const { supabase, user } = await client();
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
  fail('방에서 나가지 못했어요.')(error);
}

export async function removeMember(groupId, userId) {
  const { supabase } = await client();
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  fail('멤버를 내보내지 못했어요.')(error);
}

export async function deleteGroup(groupId) {
  const { supabase } = await client();
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  fail('방을 지우지 못했어요.')(error);
}

// ─────────────────────────── comments & reports ───────────────────────────

export async function commentsFor(entryIds) {
  if (!entryIds.length) return [];
  const { supabase } = await client();
  const { data, error } = await supabase.from('comments').select('id, entry_id, user_id, body, created_at').in('entry_id', entryIds).order('created_at');
  if (error) return [];
  return data;
}

export async function addComment(entryId, body) {
  const text = String(body || '').trim();
  if (!text || text.length > COMMENT_MAX) throw new SocialError(`댓글은 1~${COMMENT_MAX}자로 써주세요.`);
  const { supabase, user } = await client();
  const { error } = await supabase.from('comments').insert({ entry_id: entryId, user_id: user.id, body: text });
  fail('댓글을 달지 못했어요.')(error);
}

export async function deleteComment(id) {
  const { supabase } = await client();
  const { error } = await supabase.from('comments').delete().eq('id', id);
  fail('댓글을 지우지 못했어요.')(error);
}

export async function report(targetType, targetId, reason = '') {
  const { supabase, user } = await client();
  const { error } = await supabase.from('reports').insert({ reporter_id: user.id, target_type: targetType, target_id: String(targetId), reason: String(reason).slice(0, 300) || null });
  fail('신고를 보내지 못했어요.')(error);
}

// ─────────────────────────── friend requests & invites (social_plus.sql) ───────────────────────────

/** The SQL for a feature hasn't been run yet (missing table or function). */
const notSetUp = (error) =>
  Boolean(error) && (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code) || /could not find|does not exist|schema cache/i.test(error.message || ''));

/**
 * Ask to be friends by nickname#tag. Resolves { status: 'requested' |
 * 'accepted' | 'already' }. Before social_plus.sql runs, falls back to the
 * old instant add.
 */
export async function requestFriend(text) {
  const parsed = parseTag(text);
  if (!parsed) throw new SocialError('닉네임#12345 형식으로 입력해 주세요.');
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('request_friend', { p_nickname: parsed.nickname, p_tag: parsed.tag });
  if (notSetUp(error)) {
    const profile = await addFriend(text);
    return { status: 'accepted', profile };
  }
  if (error) {
    if (/self/.test(error.message)) throw new SocialError('내 이름표예요. 친구의 이름표를 입력해 주세요.');
    if (/too many/.test(error.message)) throw new SocialError('보낸 요청이 너무 많아요. 오래된 요청을 취소한 뒤 다시 보내주세요.');
    throw new SocialError('그 이름표를 찾지 못했어요. 닉네임과 #뒤 숫자를 다시 확인해 주세요.');
  }
  return { status: data || 'requested' };
}

/** Pending requests, both ways, with the other person's profile. */
export async function listRequests() {
  const { supabase, user } = await client();
  const { data, error } = await supabase.from('friend_requests').select('from_id, to_id, created_at').order('created_at', { ascending: false });
  if (error) return { incoming: [], outgoing: [] };
  const profiles = await profilesFor(data.map((r) => (r.from_id === user.id ? r.to_id : r.from_id)));
  const withProfile = (r, id) => ({ ...r, profile: profiles.get(id) || null });
  return {
    incoming: data.filter((r) => r.to_id === user.id).map((r) => withProfile(r, r.from_id)),
    outgoing: data.filter((r) => r.from_id === user.id).map((r) => withProfile(r, r.to_id)),
  };
}

export async function respondFriend(fromId, accept) {
  const { supabase } = await client();
  const { error } = await supabase.rpc('respond_friend', { p_from: fromId, p_accept: Boolean(accept) });
  fail(accept ? '요청을 수락하지 못했어요.' : '요청을 거절하지 못했어요.')(error);
}

export async function cancelRequest(toId) {
  const { supabase, user } = await client();
  const { error } = await supabase.from('friend_requests').delete().eq('from_id', user.id).eq('to_id', toId);
  fail('요청을 취소하지 못했어요.')(error);
}

/** A one-time invite token for a link; null before social_plus.sql runs. */
export async function createInviteToken() {
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('create_friend_invite');
  if (error) return null;
  return typeof data === 'string' ? data : null;
}

export async function acceptInvite(token) {
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('accept_friend_invite', { p_token: String(token || '') });
  if (error) {
    if (/self/.test(error.message)) throw new SocialError('내가 만든 초대 링크예요. 친구에게 보내주세요.');
    throw new SocialError('초대 링크가 만료됐거나 잘못됐어요. 친구에게 새 링크를 부탁해 주세요.');
  }
  return data;
}

// ─────────────────────────── notifications ───────────────────────────

export async function listNotifications(limit = 50) {
  const { supabase } = await client();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, actor_id, kind, entry_id, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  const profiles = await profilesFor(data.map((n) => n.actor_id).filter(Boolean));
  return data.map((n) => ({ ...n, actor: profiles.get(n.actor_id) || null }));
}

export async function unreadCount() {
  const { supabase } = await client();
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return error ? 0 : count || 0;
}

export async function markNotificationsRead() {
  const { supabase, user } = await client();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
}

// ─────────────────────────── reactions ───────────────────────────

export const REACTIONS = ['❤️', '👍', '😂', '😮', '🥹'];

export async function reactionsFor(entryIds) {
  if (!entryIds.length) return [];
  const { supabase } = await client();
  const { data, error } = await supabase.from('reactions').select('entry_id, user_id, emoji').in('entry_id', entryIds);
  return error ? [] : data;
}

/** Add my reaction, or take it back if I already reacted with it. */
export async function toggleReaction(entryId, emoji, mine) {
  if (!REACTIONS.includes(emoji)) throw new SocialError('그 반응은 쓸 수 없어요.');
  const { supabase, user } = await client();
  const { error } = mine
    ? await supabase.from('reactions').delete().eq('entry_id', entryId).eq('user_id', user.id).eq('emoji', emoji)
    : await supabase.from('reactions').insert({ entry_id: entryId, user_id: user.id, emoji });
  if (notSetUp(error)) throw new SocialError('반응 기능은 아직 준비 중이에요.');
  fail('반응을 남기지 못했어요.')(error);
}

// ─────────────────────────── place cards ───────────────────────────

/** Send a recommendation card to a friend ("여기 같이 갈래?"). */
export async function sendCard(toId, place, note = '') {
  const { supabase, user } = await client();
  const text = String(note || '').trim().slice(0, 100);
  const { error } = await supabase.from('shared_cards').insert({ from_id: user.id, to_id: toId, place, note: text || null });
  if (notSetUp(error)) throw new SocialError('카드 보내기는 아직 준비 중이에요.');
  fail('카드를 보내지 못했어요. 친구 사이인지 확인해 주세요.')(error);
}

export async function receivedCards(limit = 30) {
  const { supabase, user } = await client();
  const { data, error } = await supabase
    .from('shared_cards')
    .select('id, from_id, place, note, created_at, seen_at')
    .eq('to_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  const profiles = await profilesFor(data.map((c) => c.from_id));
  return data.map((c) => ({ ...c, from: profiles.get(c.from_id) || null }));
}

export async function removeCard(id) {
  const { supabase } = await client();
  const { error } = await supabase.from('shared_cards').delete().eq('id', id);
  fail('카드를 지우지 못했어요.')(error);
}

// ─────────────────────────── friends' traces ───────────────────────────

/** place id → { friends, nicknames } for places friends shared entries about. */
export async function friendTraces(placeIds) {
  const ids = [...new Set(placeIds.filter(Boolean))].slice(0, 50);
  if (!ids.length) return new Map();
  const { supabase } = await client();
  const { data, error } = await supabase.rpc('friend_traces', { p_place_ids: ids });
  if (error || !Array.isArray(data)) return new Map();
  return new Map(data.map((r) => [r.place_id, { friends: r.friends, nicknames: r.nicknames || [] }]));
}

/** Entries friends shared with me about one place (newest first). */
export async function friendEntriesFor(placeId, limit = 6) {
  if (!placeId) return [];
  const { supabase, user } = await client();
  const { data, error } = await supabase
    .from('journal_entries')
    .select(ENTRY_FIELDS)
    .eq('place_id', placeId)
    .neq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return error ? [] : data;
}
