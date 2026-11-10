/**
 * Sign-in / sign-up / password reset (Kakao + email), used by the welcome
 * screen. Screens spread authActions / authInputs / authForms into theirs.
 *
 * modes: signin → signup, or signin → reset (email) → reset-code (code + new password)
 */
import { html } from '../utils/dom.js';
import {
  signInWithKakao,
  signInWithEmail,
  signUpWithEmail,
  requestPasswordReset,
  resetPasswordWithCode,
  resendConfirmation,
  PASSWORD_MIN,
  PASSWORD_RULE,
  passwordProblems,
} from '../services/backend/auth.js';

export function authUi(ui) {
  if (!ui.auth) ui.auth = { mode: 'signin', email: '', password: '', password2: '', code: '', busy: false, error: '', info: '' };
  return ui.auth;
}

const KAKAO_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M12 3C6.48 3 2 6.48 2 10.78c0 2.77 1.86 5.2 4.65 6.58l-.95 3.5c-.08.3.26.54.52.37l4.17-2.76c.53.06 1.07.09 1.61.09 5.52 0 10-3.48 10-7.78S17.52 3 12 3z"/></svg>`;

function emailField(a, autocomplete) {
  return html`
    <label class="visually-hidden" for="auth-email">이메일</label>
    <input id="auth-email" class="area-input" type="email" inputmode="email" autocomplete="${autocomplete}" placeholder="이메일" value="${a.email}" data-input="auth-email" data-focus-key="auth-email">`;
}

function passwordField(a, { autocomplete, placeholder }) {
  return html`
    <label class="visually-hidden" for="auth-password">${placeholder}</label>
    <input id="auth-password" class="area-input" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" minlength="${PASSWORD_MIN}" value="${a.password}" data-input="auth-password" data-focus-key="auth-password">`;
}

/** "8자 이상 · 특수문자 1개 이상" under a new password, ticked off while typing. */
function ruleHint(a) {
  const fine = a.password && !passwordProblems(a.password).length;
  return html`<p id="auth-password-rule" class="password-rule ${fine ? 'is-ok' : ''}" aria-live="polite">${ruleText(a.password)}</p>`;
}

function ruleText(password) {
  if (!password) return `${PASSWORD_RULE}`;
  const missing = passwordProblems(password);
  return missing.length ? `필요해요: ${missing.join(' · ')}` : `✓ ${PASSWORD_RULE}`;
}

/** Second password box, to catch typos in a new password. */
function confirmField(a) {
  const mismatch = a.password2 && a.password && a.password2 !== a.password;
  return html`
    <label class="visually-hidden" for="auth-password2">비밀번호 재입력</label>
    <input id="auth-password2" class="area-input" type="password" autocomplete="new-password" placeholder="비밀번호 재입력" minlength="${PASSWORD_MIN}" value="${a.password2}" data-input="auth-password2" data-focus-key="auth-password2" aria-describedby="auth-password2-hint" ${mismatch ? 'aria-invalid="true"' : ''}>
    <p id="auth-password2-hint" class="password-match ${mismatch ? 'is-bad' : a.password2 && a.password2 === a.password ? 'is-ok' : ''}" aria-live="polite">${mismatch ? '비밀번호가 서로 달라요.' : a.password2 && a.password2 === a.password ? '✓ 비밀번호가 같아요.' : ''}</p>`;
}

function submit(a, label) {
  return html`<button type="submit" class="button button-primary" ${a.busy ? 'disabled' : ''}>${a.busy ? '잠시만요…' : label}</button>`;
}

function emailForms(a) {
  if (a.mode === 'reset') {
    return html`
      <form class="email-form" data-form="reset-request" novalidate>
        <p class="note-label">비밀번호 재설정</p>
        <p class="fine-print">가입한 이메일로 6자리 코드를 보내드려요.</p>
        <div class="auth-fields">
          ${emailField(a, 'email')}
          ${submit(a, '재설정 코드 받기')}
        </div>
        <button type="button" class="text-button text-button-muted" data-action="auth-back">로그인으로 돌아가기</button>
      </form>`;
  }
  if (a.mode === 'reset-code') {
    return html`
      <form class="email-form" data-form="reset-confirm" novalidate>
        <p class="note-label">${a.email}(으)로 보낸 코드와 새 비밀번호를 입력해 주세요</p>
        <div class="auth-fields">
          <label class="visually-hidden" for="auth-code">메일로 받은 코드</label>
          <input id="auth-code" class="area-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="메일로 받은 코드" value="${a.code}" data-input="auth-code" data-focus-key="auth-code">
          ${passwordField(a, { autocomplete: 'new-password', placeholder: '새 비밀번호' })}
          ${ruleHint(a)}
          ${confirmField(a)}
          ${submit(a, '비밀번호 바꾸기')}
        </div>
        <button type="button" class="text-button text-button-muted" data-action="auth-forgot">코드 다시 받기</button>
      </form>`;
  }
  const signin = a.mode === 'signin';
  return html`
    <form class="email-form" data-form="email-auth" novalidate>
      <p class="note-label">${signin ? '이메일로 로그인' : '이메일로 가입하기'}</p>
      <div class="auth-fields">
        ${emailField(a, signin ? 'username' : 'email')}
        ${passwordField(a, { autocomplete: signin ? 'current-password' : 'new-password', placeholder: '비밀번호' })}
        ${signin ? '' : ruleHint(a)}
        ${signin ? '' : confirmField(a)}
        ${signin
          ? ''
          : html`<label class="row toggle age-check">
              <input type="checkbox" data-input="auth-age" data-focus-key="auth-age" ${a.age ? 'checked' : ''}>
              <span>만 14세 이상이에요</span>
            </label>`}
        ${submit(a, signin ? '로그인' : '가입하고 시작하기')}
      </div>
      <div class="auth-links">
        <button type="button" class="text-button text-button-muted" data-action="auth-mode" data-focus-key="auth-mode">
          ${signin ? '처음이에요 (가입하기)' : '이미 계정이 있어요 (로그인)'}
        </button>
        ${signin ? html`<button type="button" class="text-button text-button-muted" data-action="auth-forgot" data-focus-key="auth-forgot">비밀번호를 잊었어요</button>` : ''}
      </div>
    </form>`;
}

export function renderAuthPanel(ui) {
  const a = authUi(ui);
  const resetting = a.mode === 'reset' || a.mode === 'reset-code';
  return html`
    <div class="auth-panel">
      ${resetting
        ? ''
        : html`<button type="button" class="kakao-login" data-action="kakao-login" data-focus-key="kakao-login" ${a.busy ? 'disabled' : ''}>${KAKAO_ICON} 카카오 로그인</button>
            <p class="auth-or"><span>또는</span></p>`}
      ${emailForms(a)}
      ${a.info ? html`<p class="save-status" role="status">${a.info}</p>` : ''}
      ${a.unconfirmed
        ? html`<p class="auth-resend">
            메일이 안 왔나요? 스팸함도 확인해 주세요.
            <button type="button" class="text-button" data-action="auth-resend" data-focus-key="auth-resend" ${a.busy ? 'disabled' : ''}>확인 메일 다시 보내기</button>
          </p>`
        : ''}
      ${a.error ? html`<p class="area-error" role="alert">${a.error}</p>` : ''}
      <p class="legal-note">
        만 14세 이상만 가입할 수 있어요. 가입하거나 로그인하면 <a href="./terms.html" target="_blank" rel="noopener">이용약관</a>과
        <a href="./privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a>에 동의하는 것으로 봐요.
      </p>
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
    if (error.code === 'unconfirmed') a.unconfirmed = a.email;
    ctx.announce(a.error);
  } finally {
    a.busy = false;
    ctx.rerender();
  }
}

const switchMode = ({ ui, rerender }, mode, extra = {}) => {
  ui.auth = { ...authUi(ui), mode, password2: '', error: '', info: '', ...extra };
  rerender();
};

export const authActions = {
  'kakao-login': (ctx) => authStep(ctx, () => signInWithKakao(ctx.ui.afterLogin || 'home')),
  'auth-mode': (ctx) => switchMode(ctx, authUi(ctx.ui).mode === 'signin' ? 'signup' : 'signin'),
  'auth-forgot': (ctx) => switchMode(ctx, 'reset', { password: '', code: '' }),
  'auth-back': (ctx) => switchMode(ctx, 'signin'),
  'auth-resend': (ctx) =>
    authStep(ctx, async (a) => {
      const address = await resendConfirmation(a.unconfirmed || a.email);
      a.info = `${address}(으)로 확인 메일을 다시 보냈어요. 받은편지함과 스팸함을 확인해 주세요.`;
      ctx.announce(a.info);
    }),
};

export const authInputs = {
  'auth-age': (ctx, el) => {
    authUi(ctx.ui).age = el.checked;
  },
  'auth-email': ({ ui }, el) => {
    authUi(ui).email = el.value;
  },
  'auth-password': (ctx, el) => {
    const a = authUi(ctx.ui);
    a.password = el.value;
    if (a.password2) updateMatchHint(a);
    const rule = document.getElementById('auth-password-rule');
    if (rule) {
      rule.textContent = ruleText(a.password);
      rule.classList.toggle('is-ok', !passwordProblems(a.password).length);
    }
  },
  'auth-password2': (ctx, el) => {
    authUi(ctx.ui).password2 = el.value;
    updateMatchHint(authUi(ctx.ui));
  },
  'auth-code': ({ ui }, el) => {
    authUi(ui).code = el.value;
  },
};

/** Update "같아요 / 달라요" in place, so typing isn't interrupted by a re-render. */
function updateMatchHint(a) {
  const hint = document.getElementById('auth-password2-hint');
  const box = document.getElementById('auth-password2');
  if (!hint || !box) return;
  const mismatch = Boolean(a.password2 && a.password && a.password2 !== a.password);
  const same = Boolean(a.password2 && a.password2 === a.password);
  hint.textContent = mismatch ? '비밀번호가 서로 달라요.' : same ? '✓ 비밀번호가 같아요.' : '';
  hint.className = `password-match ${mismatch ? 'is-bad' : same ? 'is-ok' : ''}`;
  if (mismatch) box.setAttribute('aria-invalid', 'true');
  else box.removeAttribute('aria-invalid');
}

export const authForms = {
  'email-auth': (ctx) =>
    authStep(ctx, async (a) => {
      if (a.mode === 'signin') {
        await signInWithEmail(a.email, a.password);
      } else {
        if (!a.age) throw new Error('만 14세 이상만 가입할 수 있어요. 해당되면 "만 14세 이상이에요"에 체크해 주세요.');
        const { needsConfirmation } = await signUpWithEmail(a.email, a.password, a.password2);
        if (needsConfirmation) {
          a.password = '';
          a.password2 = '';
          a.mode = 'signin';
          a.info = `${a.email}(으)로 확인 메일을 보냈어요. 메일의 "가입 확인하기"를 누른 뒤 로그인해 주세요.`;
          a.unconfirmed = a.email;
          ctx.announce(a.info);
          return;
        }
      }
      ctx.ui.auth = null;
      ctx.announce('로그인했어요.');
    }),
  'reset-request': (ctx) =>
    authStep(ctx, async (a) => {
      a.email = await requestPasswordReset(a.email);
      a.mode = 'reset-code';
      a.code = '';
      a.password = '';
      a.info = '가입된 이메일이라면 코드를 보냈어요. 받은편지함과 스팸함을 확인해 주세요.';
      ctx.announce(a.info);
    }),
  'reset-confirm': (ctx) =>
    authStep(ctx, async (a) => {
      await resetPasswordWithCode(a.email, a.code, a.password, a.password2);
      a.mode = 'signin';
      a.code = '';
      a.password = '';
      a.password2 = '';
      a.info = '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.';
      ctx.announce(a.info);
    }),
};
