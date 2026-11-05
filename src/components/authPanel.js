/**
 * Sign-in / sign-up panel (Kakao + email/password), shared by the welcome
 * screen. Screens spread authActions / authInputs / authForms into theirs.
 */
import { html } from '../utils/dom.js';
import { signInWithKakao, signInWithEmail, signUpWithEmail, PASSWORD_MIN } from '../services/backend/auth.js';

export function authUi(ui) {
  if (!ui.auth) ui.auth = { mode: 'signin', email: '', password: '', busy: false, error: '', info: '' };
  return ui.auth;
}

export function renderAuthPanel(ui) {
  const a = authUi(ui);
  return html`
    <div class="auth-panel">
      <button type="button" class="kakao-login" data-action="kakao-login" data-focus-key="kakao-login" ${a.busy ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M12 3C6.48 3 2 6.48 2 10.78c0 2.77 1.86 5.2 4.65 6.58l-.95 3.5c-.08.3.26.54.52.37l4.17-2.76c.53.06 1.07.09 1.61.09 5.52 0 10-3.48 10-7.78S17.52 3 12 3z"/></svg>
        카카오 로그인
      </button>
      <p class="auth-or"><span>또는</span></p>
      <form class="email-form" data-form="email-auth" novalidate>
        <p class="note-label">${a.mode === 'signin' ? '이메일로 로그인' : '이메일로 가입하기'}</p>
        <div class="auth-fields">
          <label class="visually-hidden" for="auth-email">이메일</label>
          <input id="auth-email" class="area-input" type="email" inputmode="email" autocomplete="${a.mode === 'signin' ? 'username' : 'email'}" placeholder="이메일" value="${a.email}" data-input="auth-email" data-focus-key="auth-email">
          <label class="visually-hidden" for="auth-password">비밀번호</label>
          <input id="auth-password" class="area-input" type="password" autocomplete="${a.mode === 'signin' ? 'current-password' : 'new-password'}" placeholder="${a.mode === 'signin' ? '비밀번호' : `비밀번호 (${PASSWORD_MIN}자 이상)`}" minlength="${PASSWORD_MIN}" value="${a.password}" data-input="auth-password" data-focus-key="auth-password">
          <button type="submit" class="button button-primary" ${a.busy ? 'disabled' : ''}>
            ${a.busy ? '잠시만요…' : a.mode === 'signin' ? '로그인' : '가입하고 시작하기'}
          </button>
        </div>
        <button type="button" class="text-button text-button-muted" data-action="auth-mode" data-focus-key="auth-mode">
          ${a.mode === 'signin' ? '처음이에요 (가입하기)' : '이미 계정이 있어요 (로그인)'}
        </button>
      </form>
      ${a.info ? html`<p class="save-status" role="status">${a.info}</p>` : ''}
      ${a.error ? html`<p class="area-error" role="alert">${a.error}</p>` : ''}
    </div>`;
}

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
    ctx.rerender();
  }
}

export const authActions = {
  'kakao-login': (ctx) => authStep(ctx, () => signInWithKakao(ctx.ui.afterLogin || 'home')),
  'auth-mode': ({ ui, rerender }) => {
    const a = authUi(ui);
    ui.auth = { ...a, mode: a.mode === 'signin' ? 'signup' : 'signin', error: '', info: '' };
    rerender();
  },
};

export const authInputs = {
  'auth-email': ({ ui }, el) => {
    authUi(ui).email = el.value;
  },
  'auth-password': ({ ui }, el) => {
    authUi(ui).password = el.value;
  },
};

export const authForms = {
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
      ctx.announce('로그인했어요.');
    }),
};
