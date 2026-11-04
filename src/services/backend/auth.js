/**
 * Optional accounts: Kakao login and email one-time code.
 * Everything still works signed out; signing in only adds cloud saving.
 */
import { getSupabase } from './client.js';

const AFTER_LOGIN_KEY = 'plannish-after-login';
export class AuthError extends Error {}

const listeners = new Set();
let currentUser = null;
let ready = false;

export const getUser = () => currentUser;
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
  return user.email || meta.email || meta.name || meta.full_name || meta.preferred_username || '카카오 계정';
}

/** Restore the session (and finish an OAuth redirect if we just came back from one). */
export async function initAuth() {
  const supabase = await getSupabase();
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user || null));
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

export async function sendEmailCode(email) {
  const address = String(email || '').trim();
  if (!EMAIL_RE.test(address)) throw new AuthError('이메일 주소를 확인해 주세요.');
  const supabase = await getSupabase();
  if (!supabase) throw new AuthError('계정 기능이 아직 설정되지 않았어요.');
  const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
  if (error) {
    if (error.status === 429) throw new AuthError('메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.');
    throw new AuthError('인증 메일을 보내지 못했어요. 주소를 확인하고 다시 시도해 주세요.');
  }
  return address;
}

export async function verifyEmailCode(email, code) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new AuthError('메일로 받은 숫자 코드를 입력해 주세요.');
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw new AuthError('코드가 맞지 않거나 시간이 지났어요. 새 코드를 받아 다시 시도해 주세요.');
  setUser(data?.user || data?.session?.user || null);
  return currentUser;
}

export async function signOut() {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  setUser(null);
}
