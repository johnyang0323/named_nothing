/**
 * 계정: profile (photo, nickname, my #tag + invite link), what the app
 * learned (나의 취향), the account itself (sync, sign-out, deletion),
 * a connection check, and the legal pages.
 */
import { html } from '../utils/dom.js';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser, signOut, deleteAccount, avatarUrl } from '../services/backend/auth.js';
import { getMyProfile, loadMyProfile, saveProfile, fullTag, avatarSrc, NICKNAME_MAX, SocialError, forgetMyProfile } from '../services/backend/social.js';
import { checkPhotoService, checkDeleteFunction } from '../services/photos.js';
import { tasteSummary, MIN_EVENTS } from '../services/personalize.js';
import { inviteLink, copyText } from './share.js';

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

export function profileDraft(ui, profile) {
  if (!ui.profileDraft || ui.profileDraft.forUser !== profile?.user_id) {
    ui.profileDraft = { forUser: profile?.user_id, nickname: profile?.nickname || '', file: null, previewUrl: null, clear: false, busy: false, error: '' };
  }
  return ui.profileDraft;
}

function profileSection(ui) {
  if (!isBackendConfigured() || !getUser()) return '';
  const profile = getMyProfile();
  if (ui.profileState === 'loading' && !profile) {
    return html`<section class="block"><p class="empty-body">프로필을 불러오는 중…</p></section>`;
  }
  if (!profile) {
    return html`<section class="block"><p class="empty-body">프로필을 불러오지 못했어요. 잠시 후 다시 열어주세요.</p></section>`;
  }
  const d = profileDraft(ui, profile);
  const preview = d.previewUrl || (d.clear ? null : avatarSrc(profile) || avatarUrl(getUser()));
  const changed = d.nickname.trim() !== profile.nickname || d.file || d.clear;
  return html`
    <section class="block profile" aria-labelledby="profile-title">
      <h2 class="visually-hidden" id="profile-title">프로필</h2>
      <div class="group profile-card">
        <div class="profile-row">
          <span class="avatar avatar-lg" aria-hidden="true">
            <span class="avatar-initial">${Array.from(d.nickname || profile.nickname || '·')[0]}</span>
            ${preview ? html`<img class="avatar-img" src="${preview}" alt="">` : ''}
          </span>
          <div class="profile-id">
            <p class="profile-name">${profile.nickname}</p>
            <p class="profile-sub">${fullTag(profile)}</p>
          </div>
        </div>
        <div class="profile-photo-actions">
          <label class="row row-button file-button">
            사진 바꾸기
            <input type="file" accept="image/*" class="visually-hidden" data-input="avatar-file" data-focus-key="avatar-file">
          </label>
          ${preview ? html`<button type="button" class="row row-button row-muted" data-action="avatar-clear">사진 지우기</button>` : ''}
        </div>
      </div>

      <form class="profile-form" data-form="profile" novalidate>
        <label class="group-header" for="nickname">닉네임</label>
        <div class="group group-inline">
          <input id="nickname" class="row-input" type="text" maxlength="${NICKNAME_MAX}" autocomplete="nickname" value="${d.nickname}" data-input="nickname" data-focus-key="nickname">
          <button type="submit" class="row-inline-button" ${d.busy || !changed ? 'disabled' : ''}>${d.busy ? '저장 중…' : '저장'}</button>
        </div>
        ${d.error ? html`<p class="area-error" role="alert">${d.error}</p>` : ''}
      </form>

      <div class="my-tag">
        <p class="group-header">내 이름표</p>
        <div class="group">
          <button type="button" class="row row-button" data-action="copy-tag"><span>이름표 복사</span><strong class="row-value tag-text">${fullTag(profile)}</strong></button>
          <button type="button" class="row row-button" data-action="copy-invite"><span>초대 링크 복사</span><span class="row-chevron" aria-hidden="true"></span></button>
        </div>
        <p class="group-footer">친구가 이 이름표를 입력하거나 초대 링크를 열면 바로 친구가 돼요. 이름표를 아는 사람만 나를 친구로 추가할 수 있어요.</p>
      </div>
    </section>`;
}

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
      <h2 class="group-header" id="taste-title">나의 취향</h2>
      <div class="group">
        <label class="row toggle">
          <span>추천에 취향 반영하기</span>
          <input type="checkbox" role="switch" data-input="taste-enabled" data-focus-key="taste-enabled" ${t.enabled ? 'checked' : ''}>
        </label>
        <div class="row row-text">${body}</div>
        ${t.events ? html`<button type="button" class="row row-button" data-action="taste-reset" data-focus-key="taste-reset">취향 초기화</button>` : ''}
      </div>
      <p class="group-footer">고른 곳과 다녀온 곳, 그날의 기분으로만 배워요. 추천의 일부는 일부러 평소와 다른 곳으로 섞어요. 우연한 발견도 하루의 일부니까요.
        날씨·시간대·쓸 수 있는 시간도 함께 반영해요. 날씨 정보: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0)</p>
    </section>`;
}

export function loginMethod(user) {
  const provider = user?.app_metadata?.provider;
  if (provider === 'kakao') return '카카오 계정으로 로그인했어요.';
  return user?.email ? `${user.email} 으로 로그인했어요.` : '';
}

function accountSection(sync, ui) {
  const user = getUser();
  if (!isBackendConfigured() || !user) return '';
  return html`
    <section class="block account" aria-labelledby="account-title">
      <h2 class="group-header" id="account-title">계정</h2>
      <div class="group">
        <div class="row row-text">
          <p class="account-line">${loginMethod(user)}</p>
          <p class="account-sync" role="status">${syncLine(sync)}</p>
        </div>
        <button type="button" class="row row-button" data-action="sign-out" data-focus-key="sign-out">로그아웃</button>
      </div>
      <div class="group">
        ${ui.confirmDelete ? deleteConfirm(ui) : html`<button type="button" class="row row-button row-danger" data-action="delete-account" data-focus-key="delete-account">계정 삭제</button>`}
      </div>
    </section>`;
}

function deleteConfirm(ui) {
  const busy = ui.confirmDelete === 'busy';
  return html`
    <div class="row row-text danger-zone" role="group" aria-labelledby="delete-title">
      <p class="danger-title" id="delete-title">계정을 삭제할까요?</p>
      <p class="fine-print">계정과 함께 프로필, 모든 하루 기록과 사진, 나의 취향, 친구 관계, 내가 만든 단체방, 댓글과 사진 투표가 <strong>영구히</strong> 지워져요. 되돌릴 수 없어요.</p>
      <div class="actions">
        <button type="button" class="button button-danger button-small" data-action="delete-account-confirm" data-focus-key="delete-account-confirm" ${busy ? 'disabled' : ''}>${busy ? '삭제하는 중…' : '네, 모두 삭제할게요'}</button>
        <button type="button" class="text-button" data-action="delete-account-cancel" ${busy ? 'disabled' : ''}>취소</button>
      </div>
      ${ui.deleteError ? html`<p class="area-error" role="alert">${ui.deleteError}</p>` : ''}
    </div>`;
}

function diagnosticsSection(ui) {
  if (!isBackendConfigured()) return '';
  return html`
    <section class="block diagnostics" aria-labelledby="diag-title">
      <h2 class="group-header" id="diag-title">연결 점검</h2>
      <div class="group">
        <button type="button" class="row row-button" data-action="check-photos" data-focus-key="check-photos" ${ui.photoCheck === 'running' ? 'disabled' : ''}>
          <span>${ui.photoCheck === 'running' ? '점검하는 중…' : '사진 기능 점검'}</span><span class="row-chevron" aria-hidden="true"></span>
        </button>
        <button type="button" class="row row-button" data-action="check-delete" data-focus-key="check-delete" ${ui.deleteCheck === 'running' ? 'disabled' : ''}>
          <span>${ui.deleteCheck === 'running' ? '점검하는 중…' : '계정 삭제 기능 점검'}</span><span class="row-chevron" aria-hidden="true"></span>
        </button>
        ${[ui.photoCheck, ui.deleteCheck]
          .filter((r) => r && r !== 'running')
          .map(
            (r) => html`<div class="row row-text diag-result ${r.ok ? 'is-ok' : 'is-bad'}" role="status">
              <p>${r.ok ? '✓ ' : '✕ '}${r.message}</p>
              ${r.detail ? html`<p class="diag-detail">${r.detail}</p>` : ''}
            </div>`,
          )}
      </div>
      <p class="group-footer">기능이 안 될 때 눌러보세요. 무엇이 문제인지 알려드려요. 점검은 아무것도 바꾸거나 지우지 않아요.</p>
    </section>`;
}

export function onEnter(ctx) {
  if (!isBackendConfigured() || !getUser() || getMyProfile()) return null;
  ctx.ui.profileState = 'loading';
  loadMyProfile()
    .catch(() => null)
    .finally(() => {
      ctx.ui.profileState = null;
      if (ctx.getScreen() === 'account') ctx.rerender();
    });
  return null;
}

export { AccountScreen as Component } from './Account.jsx';

/** Clear everything personal from this device (after sign-out or deletion). */
function leaveDevice(ctx) {
  ctx.store.actions.forgetDevice();
  ctx.taste.forgetDevice();
  ctx.sync.forgetOwner();
  forgetMyProfile();
  Object.assign(ctx.ui, {
    journalDraft: null,
    history: null,
    myEntries: null,
    confirmDelete: false,
    deleteError: '',
    profileDraft: null,
    together: null,
    editor: null,
  });
}

export const actions = {
  'avatar-clear': ({ ui, rerender }) => {
    const d = ui.profileDraft;
    if (!d) return;
    if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    Object.assign(d, { file: null, previewUrl: null, clear: true });
    rerender();
  },
  'copy-tag': async ({ toast }) => {
    const ok = await copyText(fullTag(getMyProfile()));
    toast(ok ? '이름표를 복사했어요. 친구에게 보내주세요.' : `이름표: ${fullTag(getMyProfile())}`);
  },
  'copy-invite': async ({ toast }) => {
    const ok = await copyText(inviteLink({ friend: fullTag(getMyProfile()) }));
    toast(ok ? '초대 링크를 복사했어요. 카톡 등으로 보내주세요.' : '복사하지 못했어요. 이름표를 직접 알려주세요.');
  },
  'delete-account': ({ ui, rerender }) => {
    ui.confirmDelete = true;
    ui.deleteError = '';
    rerender();
    document.querySelector('[data-focus-key="delete-account-confirm"]')?.focus();
  },
  'delete-account-cancel': ({ ui, rerender }) => {
    ui.confirmDelete = false;
    ui.deleteError = '';
    rerender();
    document.querySelector('[data-focus-key="delete-account"]')?.focus();
  },
  'delete-account-confirm': async (ctx) => {
    ctx.ui.confirmDelete = 'busy';
    ctx.rerender();
    try {
      // no save may be left waiting to run after the account is gone
      await ctx.sync.flush().catch(() => {});
      await ctx.taste.flush().catch(() => {});
      const { kakaoUnlinked } = await deleteAccount();
      leaveDevice(ctx);
      ctx.toast(
        kakaoUnlinked === false
          ? '계정과 모든 기록을 삭제했어요. 카카오로 다시 로그인하면 새 빈 계정으로 시작돼요.'
          : '계정과 모든 기록을 삭제했어요. 그동안 고마웠어요.',
      );
    } catch (error) {
      ctx.ui.confirmDelete = true;
      ctx.ui.deleteError = error.message || '계정을 삭제하지 못했어요.';
      ctx.rerender();
    }
  },
  'sign-out': async (ctx) => {
    // save the latest changes first, then leave nothing behind on this device
    await ctx.sync.flush();
    await ctx.taste.flush();
    await signOut();
    leaveDevice(ctx);
    ctx.toast('로그아웃했어요. 기록은 계정에 남아 있어요.');
  },
  'sync-retry': ({ sync }) => sync.retry(),
  'taste-reset': ({ taste, toast }) => {
    const previous = taste.reset();
    toast('취향을 초기화했어요.', { label: '되돌리기', run: (ctx) => ctx.taste.restore(previous) });
  },
  'check-delete': async ({ ui, rerender, announce, getScreen }) => {
    ui.deleteCheck = 'running';
    rerender();
    ui.deleteCheck = await checkDeleteFunction();
    announce(ui.deleteCheck.message);
    if (getScreen() === 'account') rerender();
  },
  'check-photos': async ({ ui, rerender, announce, getScreen }) => {
    ui.photoCheck = 'running';
    rerender();
    ui.photoCheck = await checkPhotoService();
    announce(ui.photoCheck.message);
    if (getScreen() === 'account') rerender();
  },
};

export const inputs = {
  'taste-enabled': ({ taste }, el) => taste.setEnabled(el.checked),
  nickname: ({ ui }, el) => {
    if (!ui.profileDraft) return;
    ui.profileDraft.nickname = el.value;
    const button = el.closest('form')?.querySelector('button[type=submit]');
    const profile = getMyProfile();
    if (button) button.disabled = !(el.value.trim() !== profile?.nickname || ui.profileDraft.file || ui.profileDraft.clear);
  },
  'avatar-file': ({ ui, rerender }, el) => {
    const file = el.files?.[0];
    if (!file || !ui.profileDraft) return;
    if (ui.profileDraft.previewUrl) URL.revokeObjectURL(ui.profileDraft.previewUrl);
    Object.assign(ui.profileDraft, { file, previewUrl: URL.createObjectURL(file), clear: false });
    rerender();
  },
};

export const forms = {
  profile: async ({ ui, rerender, toast, refreshAccountButton }) => {
    const d = ui.profileDraft;
    if (!d || d.busy) return;
    d.busy = true;
    d.error = '';
    rerender();
    try {
      await saveProfile({ nickname: d.nickname, avatarFile: d.file, clearAvatar: d.clear });
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
      ui.profileDraft = null;
      toast('프로필을 저장했어요.');
      refreshAccountButton?.();
    } catch (error) {
      d.error = error instanceof SocialError ? error.message : '프로필을 저장하지 못했어요.';
    } finally {
      if (ui.profileDraft) ui.profileDraft.busy = false;
      rerender();
    }
  },
};

export async function reload(ctx) {
  await loadMyProfile().catch(() => null);
  ctx.rerender();
}
