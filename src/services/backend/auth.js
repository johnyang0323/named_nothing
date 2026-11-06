/**
 * Optional accounts: Kakao login and email one-time code.
 * Everything still works signed out; signing in only adds cloud saving.
 */
import { getSupabase } from './client.js';
import { DELETE_FUNCTION } from './config.js';

const AFTER_LOGIN_KEY = 'plannish-after-login';
export class AuthError extends Error {}

const listeners = new Set();
let currentUser = null;
let ready = false;
// While resetting a password the reset code briefly signs the person in;
// keep that hidden from the app (no screen change, no syncing).
let holdAuthEvents = false;

export const getUser = () => currentUser;

/** If restoring the session failed (e.g. offline), still settle as "signed out". */
export function markAuthReady() {
  if (!ready) setUser(currentUser);
}
export const isAuthReady = () => ready;

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setUser(user) {
  const changed = (user?.id || null) !== (currentUser?.id || null);
  currentUser = user || null;
  if (changed || !ready) {
    ready = true;
    listeners.forEach((fn) => fn(currentUser));
  }
}

/** Show a person-friendly name for the signed-in account. */
export function displayName(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  // Kakao nickname first (it's what the person chose to show), then email
  return meta.name || meta.full_name || meta.nickname || meta.preferred_username || user.email || meta.email || '카카오 계정';
}

/**
 * Profile photo from the login provider (Kakao profile_image), or null.
 * Kakao can return http:// URLs; its CDN serves the same file over https,
 * which the https site needs to avoid mixed content.
 */
export function avatarUrl(user) {
  const meta = user?.user_metadata || {};
  const url = [meta.avatar_url, meta.picture, meta.profile_image].find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
  return url ? url.replace(/^http:/, 'https:') : null;
}

/** Restore the session (and finish an OAuth redirect if we just came back from one). */
export async function initAuth() {
  const supabase = await getSupabase();
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!holdAuthEvents) setUser(session?.user || null);
  });
  const { data } = await supabase.auth.getSession();
  setUser(data?.session?.user || null);

  // Back from a login redirect: drop leftover ?code/error params and
  // return to the screen the person started from.
  let screen = '';
  try {
    screen = sessionStorage.getItem(AFTER_LOGIN_KEY) || '';
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error_description');
  const hadParams = ['code', 'error', 'error_code', 'error_description'].some((k) => url.searchParams.has(k));
  ['code', 'error', 'error_code', 'error_description'].forEach((k) => url.searchParams.delete(k));
  if (hadParams || (screen && !url.hash)) {
    window.history.replaceState(null, '', `${url.pathname}${url.search}${screen && !url.hash ? `#${screen}` : url.hash}`);
  }
  if (error) throw new AuthError(`로그인하지 못했어요: ${error}`);
}

const redirectUrl = () => `${window.location.origin}${window.location.pathname}`;

export async function signInWithKakao(returnScreen = 'day') {
  const supabase = await getSupabase();
  if (!supabase) throw new AuthError('계정 기능이 아직 설정되지 않았어요.');
  try {
    sessionStorage.setItem(AFTER_LOGIN_KEY, returnScreen);
  } catch {
    /* ignore */
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: redirectUrl() } });
  if (error) throw new AuthError('카카오 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;

function checkCredentials(email, password) {
  const address = String(email || '').trim();
  if (!EMAIL_RE.test(address)) throw new AuthError('이메일 주소를 확인해 주세요.');
  if (String(password || '').length < PASSWORD_MIN) throw new AuthError(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`);
  return address;
}

/** Email + password sign-in. No email is sent, so it works on the free plan and inside the iPhone app. */
export async function signInWithEmail(email, password) {
  const address = checkCredentials(email, password);
  const supabase = await getSupabase();
  if (!supabase) throw new AuthError('계정 기능이 아직 설정되지 않았어요.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
  if (error) {
    if (/confirm/i.test(error.message)) throw new AuthError('아직 이메일 확인이 끝나지 않은 계정이에요. 메일의 확인 링크를 누르거나 관리자에게 문의해 주세요.');
    if (error.status === 429) throw new AuthError('시도가 너무 많았어요. 잠시 후 다시 해주세요.');
    throw new AuthError('이메일이나 비밀번호가 맞지 않아요. 처음이라면 ‘처음이에요’를 눌러 가입해 주세요.');
  }
  setUser(data?.user || null);
  return currentUser;
}

/**
 * Create an account. With "Confirm email" turned off in Supabase the person
 * is signed in immediately; otherwise they get a confirmation link that
 * returns to this page.
 */
export async function signUpWithEmail(email, password, confirmPassword = password) {
  const address = checkCredentials(email, password);
  if (password !== confirmPassword) throw new AuthError('비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 입력해 주세요.');
  const supabase = await getSupabase();
  if (!supabase) throw new AuthError('계정 기능이 아직 설정되지 않았어요.');
  const { data, error } = await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: redirectUrl() } });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new AuthError('이미 가입된 이메일이에요. ‘로그인’으로 들어와 주세요.');
    if (/password/i.test(error.message)) throw new AuthError('비밀번호가 너무 쉬워요. 더 길거나 다른 비밀번호를 써주세요.');
    if (error.status === 429) throw new AuthError('시도가 너무 많았어요. 잠시 후 다시 해주세요.');
    throw new AuthError('가입하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  // Supabase returns a user with no identities when the address is already taken
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new AuthError('이미 가입된 이메일이에요. ‘로그인’으로 들어와 주세요.');
  }
  if (!data?.session) return { needsConfirmation: true };
  setUser(data.user);
  return { needsConfirmation: false };
}

/**
 * Forgot password, step 1: email a reset code. Supabase answers the same
 * whether or not the address has an account (no account fishing).
 * Needs an SMTP sender set up in Supabase (see docs/SUPABASE_SETUP.md).
 */
export async function requestPasswordReset(email) {
  const address = String(email || '').trim();
  if (!EMAIL_RE.test(address)) throw new AuthError('이메일 주소를 확인해 주세요.');
  const supabase = await getSupabase();
  if (!supabase) throw new AuthError('계정 기능이 아직 설정되지 않았어요.');
  const { error } = await supabase.auth.resetPasswordForEmail(address);
  if (error) {
    if (error.status === 429) throw new AuthError('메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.');
    throw new AuthError('재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  return address;
}

/**
 * Forgot password, step 2: the code from the email + a new password.
 * Afterwards everyone is signed out (this device and any others), so the
 * person signs in again with the new password.
 */
export async function resetPasswordWithCode(email, code, newPassword, confirmPassword = newPassword) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new AuthError('메일로 받은 숫자 코드를 입력해 주세요.');
  if (String(newPassword || '').length < PASSWORD_MIN) throw new AuthError(`새 비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`);
  if (newPassword !== confirmPassword) throw new AuthError('새 비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 입력해 주세요.');
  const supabase = await getSupabase();
  holdAuthEvents = true;
  let changed = false;
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new AuthError('코드가 맞지 않거나 시간이 지났어요. 코드를 다시 받아주세요.');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      if (/password/i.test(updateError.message)) throw new AuthError('비밀번호가 너무 쉬워요. 더 길거나 다른 비밀번호를 써주세요.');
      throw new AuthError('비밀번호를 바꾸지 못했어요. 다시 시도해 주세요.');
    }
    changed = true;
  } finally {
    // end the temporary session: everywhere after a change, here otherwise
    await supabase.auth.signOut({ scope: changed ? 'global' : 'local' }).catch(() => supabase.auth.signOut({ scope: 'local' }).catch(() => {}));
    holdAuthEvents = false;
    setUser(null);
  }
  return true;
}

/**
 * Permanently delete the signed-in account (and, through the database,
 * all of its days, taste and photo votes). Runs in an Edge Function,
 * which checks this person's own login token first.
 */
export async function deleteAccount() {
  const supabase = await getSupabase();
  if (!supabase || !currentUser) throw new AuthError('로그인한 상태에서만 계정을 삭제할 수 있어요.');
  const { data, error } = await supabase.functions.invoke(DELETE_FUNCTION, { body: {} });
  if (error || !data?.deleted) throw new AuthError('계정을 삭제하지 못했어요. 잠시 후 다시 시도하거나 운영자에게 알려주세요.');
  // the server session is gone; clear this device's copy too
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  setUser(null);
  return { kakaoUnlinked: data.kakaoUnlinked ?? null };
}

export async function signOut() {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  setUser(null);
}
