/**
 * 계정 (React + glisse): profile card, nickname, name tag, taste switch,
 * account, connection checks, legal links — iOS Settings layout on liquid
 * glass. The actions themselves live in account.js and are shared.
 */
import { Button, Glass, Input, Switch } from 'glisse';
import { isBackendConfigured } from '../services/backend/config.js';
import { getUser, avatarUrl } from '../services/backend/auth.js';
import { getMyProfile, fullTag, avatarSrc, NICKNAME_MAX } from '../services/backend/social.js';
import { tasteSummary, MIN_EVENTS } from '../services/personalize.js';
import { actions, forms, inputs, profileDraft, loginMethod } from './account.js';

const Chevron = () => <span className="row-chevron" aria-hidden="true" />;

function SyncLine({ sync, ctx }) {
  const { status, lastSavedAt } = sync.getStatus();
  if (status === 'syncing') return <span>저장하는 중…</span>;
  if (status === 'error') {
    return (
      <>
        <span>계정에 저장하지 못했어요. 이 기기에는 남아 있어요.</span>{' '}
        <button type="button" className="text-button" data-action="sync-retry" onClick={() => actions['sync-retry'](ctx)}>다시 시도</button>
      </>
    );
  }
  if (status === 'saved' && lastSavedAt) {
    return <span>{lastSavedAt.getHours()}시 {String(lastSavedAt.getMinutes()).padStart(2, '0')}분에 계정에 저장했어요.</span>;
  }
  return null;
}

function Profile({ ctx }) {
  const { ui } = ctx;
  const profile = getMyProfile();
  if (ui.profileState === 'loading' && !profile) return <section className="block"><p className="empty-body">프로필을 불러오는 중…</p></section>;
  if (!profile) return <section className="block"><p className="empty-body">프로필을 불러오지 못했어요. 잠시 후 다시 열어주세요.</p></section>;
  const d = profileDraft(ui, profile);
  const preview = d.previewUrl || (d.clear ? null : avatarSrc(profile) || avatarUrl(getUser()));
  const changed = d.nickname.trim() !== profile.nickname || d.file || d.clear;
  return (
    <section className="block profile" aria-labelledby="profile-title">
      <h2 className="visually-hidden" id="profile-title">프로필</h2>
      <Glass className="group profile-card">
        <div className="profile-row">
          <span className="avatar avatar-lg" aria-hidden="true">
            <span className="avatar-initial">{Array.from(d.nickname || profile.nickname || '·')[0]}</span>
            {preview ? <img className="avatar-img" src={preview} alt="" /> : null}
          </span>
          <div className="profile-id">
            <p className="profile-name">{profile.nickname}</p>
            <p className="profile-sub">{fullTag(profile)}</p>
          </div>
        </div>
        <div className="profile-photo-actions">
          <label className="row row-button file-button">
            사진 바꾸기
            <input type="file" accept="image/*" className="visually-hidden" data-input="avatar-file" data-focus-key="avatar-file" onChange={(e) => inputs['avatar-file'](ctx, e.target)} />
          </label>
          {preview ? (
            <button type="button" className="row row-button row-muted" data-action="avatar-clear" onClick={() => actions['avatar-clear'](ctx)}>사진 지우기</button>
          ) : null}
        </div>
      </Glass>

      <form
        className="profile-form"
        data-form="profile"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          forms.profile(ctx);
        }}
      >
        <label className="group-header" htmlFor="nickname">닉네임</label>
        <div className="nickname-row">
          <Input
            id="nickname"
            className="nickname-input"
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            value={d.nickname}
            data-focus-key="nickname"
            onValueChange={(value) => {
              d.nickname = value;
              ctx.rerender();
            }}
          />
          <Button type="submit" className="is-selected-glass" disabled={d.busy || !changed}>{d.busy ? '저장 중…' : '저장'}</Button>
        </div>
        {d.error ? <p className="area-error" role="alert">{d.error}</p> : null}
      </form>

      <div className="my-tag">
        <p className="group-header">내 이름표</p>
        <Glass className="group">
          <button type="button" className="row row-button" data-action="copy-tag" onClick={() => actions['copy-tag'](ctx)}>
            <span>이름표 복사</span>
            <strong className="row-value tag-text">{fullTag(profile)}</strong>
          </button>
          <button type="button" className="row row-button" data-action="copy-invite" onClick={() => actions['copy-invite'](ctx)}>
            <span>초대 링크 복사</span>
            <Chevron />
          </button>
        </Glass>
        <p className="group-footer">친구가 이 이름표를 입력하거나 초대 링크를 열면 바로 친구가 돼요. 이름표를 아는 사람만 나를 친구로 추가할 수 있어요.</p>
      </div>
    </section>
  );
}

function Taste({ ctx }) {
  const { taste } = ctx;
  if (!taste) return null;
  const t = taste.get();
  const { liked, less } = tasteSummary(t);
  let body;
  if (t.events < MIN_EVENTS) body = <p className="empty-body">아직 배운 게 없어요. 가보기, 다른 곳 보기, 다녀왔어요를 누르다 보면 조금씩 알아가요.</p>;
  else if (liked.length || less.length)
    body = (
      <>
        {liked.length ? <p className="taste-line">자주 고른 곳 <strong>{liked.join(' · ')}</strong></p> : null}
        {less.length ? <p className="taste-line">덜 끌렸던 곳 <strong>{less.join(' · ')}</strong></p> : null}
      </>
    );
  else body = <p className="empty-body">아직 뚜렷한 취향은 보이지 않아요. 고르는 대로 조금씩 알아갈게요.</p>;
  return (
    <section className="block taste" aria-labelledby="taste-title">
      <h2 className="group-header" id="taste-title">나의 취향</h2>
      <Glass className="group">
        <div className="row toggle-row">
          <span id="taste-switch-label">추천에 취향 반영하기</span>
          <Switch
            aria-labelledby="taste-switch-label"
            data-input="taste-enabled"
            data-focus-key="taste-enabled"
            checked={t.enabled}
            onCheckedChange={(checked) => taste.setEnabled(checked)}
          />
        </div>
        <div className="row row-text">{body}</div>
        {t.events ? (
          <button type="button" className="row row-button" data-action="taste-reset" data-focus-key="taste-reset" onClick={() => actions['taste-reset'](ctx)}>취향 초기화</button>
        ) : null}
      </Glass>
      <p className="group-footer">
        고른 곳과 다녀온 곳, 그날의 기분으로만 배워요. 추천의 일부는 일부러 평소와 다른 곳으로 섞어요. 우연한 발견도 하루의 일부니까요. 날씨·시간대·쓸 수 있는 시간도 함께 반영해요. 날씨 정보:{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0)
      </p>
    </section>
  );
}

function AccountBlock({ ctx }) {
  const { ui, sync } = ctx;
  const user = getUser();
  if (!isBackendConfigured() || !user) return null;
  const busy = ui.confirmDelete === 'busy';
  return (
    <section className="block account" aria-labelledby="account-title">
      <h2 className="group-header" id="account-title">계정</h2>
      <Glass className="group">
        <div className="row row-text">
          <p className="account-line">{loginMethod(user)}</p>
          <p className="account-sync" role="status"><SyncLine sync={sync} ctx={ctx} /></p>
        </div>
        <button type="button" className="row row-button" data-action="sign-out" data-focus-key="sign-out" onClick={() => actions['sign-out'](ctx)}>로그아웃</button>
      </Glass>
      <Glass className="group">
        {ui.confirmDelete ? (
          <div className="row row-text danger-zone" role="group" aria-labelledby="delete-title">
            <p className="danger-title" id="delete-title">계정을 삭제할까요?</p>
            <p className="fine-print">
              계정과 함께 프로필, 모든 하루 기록과 사진, 나의 취향, 친구 관계, 내가 만든 단체방, 댓글과 사진 투표가 <strong>영구히</strong> 지워져요. 되돌릴 수 없어요.
            </p>
            <div className="actions">
              <Button destructive data-action="delete-account-confirm" data-focus-key="delete-account-confirm" disabled={busy} onClick={() => actions['delete-account-confirm'](ctx)}>
                {busy ? '삭제하는 중…' : '네, 모두 삭제할게요'}
              </Button>
              <button type="button" className="text-button" data-action="delete-account-cancel" disabled={busy} onClick={() => actions['delete-account-cancel'](ctx)}>취소</button>
            </div>
            {ui.deleteError ? <p className="area-error" role="alert">{ui.deleteError}</p> : null}
          </div>
        ) : (
          <button type="button" className="row row-button row-danger" data-action="delete-account" data-focus-key="delete-account" onClick={() => actions['delete-account'](ctx)}>계정 삭제</button>
        )}
      </Glass>
    </section>
  );
}

function Diagnostics({ ctx }) {
  const { ui } = ctx;
  if (!isBackendConfigured()) return null;
  const results = [ui.setupCheck, ui.photoCheck, ui.deleteCheck].filter((r) => r && r !== 'running');
  return (
    <section className="block diagnostics" aria-labelledby="diag-title">
      <h2 className="group-header" id="diag-title">연결 점검</h2>
      <Glass className="group">
        <button type="button" className="row row-button" data-action="check-setup" data-focus-key="check-setup" disabled={ui.setupCheck === 'running'} onClick={() => actions['check-setup'](ctx)}>
          <span>{ui.setupCheck === 'running' ? '점검하는 중…' : '서버 설정 점검 (SQL)'}</span>
          <Chevron />
        </button>
        <button type="button" className="row row-button" data-action="check-photos" data-focus-key="check-photos" disabled={ui.photoCheck === 'running'} onClick={() => actions['check-photos'](ctx)}>
          <span>{ui.photoCheck === 'running' ? '점검하는 중…' : '사진 기능 점검'}</span>
          <Chevron />
        </button>
        <button type="button" className="row row-button" data-action="check-delete" data-focus-key="check-delete" disabled={ui.deleteCheck === 'running'} onClick={() => actions['check-delete'](ctx)}>
          <span>{ui.deleteCheck === 'running' ? '점검하는 중…' : '계정 삭제 기능 점검'}</span>
          <Chevron />
        </button>
        {results.map((r) => (
          <div key={r.message} className={`row row-text diag-result ${r.ok ? 'is-ok' : 'is-bad'}`} role="status">
            <p>{r.ok ? '✓ ' : '✕ '}{r.message}</p>
            {r.detail ? <p className="diag-detail">{r.detail}</p> : null}
          </div>
        ))}
      </Glass>
      <p className="group-footer">기능이 안 될 때 눌러보세요. 무엇이 문제인지 알려드려요. 점검은 아무것도 바꾸거나 지우지 않아요.</p>
    </section>
  );
}

export function AccountScreen({ ctx }) {
  const signedIn = isBackendConfigured() && getUser();
  return (
    <section className="screen account-screen" aria-labelledby="account-screen-title">
      <h1 id="account-screen-title" className="title large-title" tabIndex={-1}>계정</h1>
      {signedIn ? <Profile ctx={ctx} /> : null}
      <Taste ctx={ctx} />
      <AccountBlock ctx={ctx} />
      <Diagnostics ctx={ctx} />
      <section className="block" aria-label="약관">
        <Glass className="group legal-links">
          <a className="row row-button" href="./privacy.html" target="_blank" rel="noopener"><span>개인정보 처리방침</span><Chevron /></a>
          <a className="row row-button" href="./terms.html" target="_blank" rel="noopener"><span>이용약관</span><Chevron /></a>
        </Glass>
      </section>
    </section>
  );
}
