const { chromium, devices } = require('playwright');
const { launch } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const backend = createBackend();
  const errors = [];
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(ctx, backend, { errors });
  const p = await ctx.newPage();

  // ---- legal pages are linked and load ----
  await p.goto(APP);
  await p.waitForSelector('.welcome');
  for (const [sel, title] of [['.legal-note a[href="./terms.html"]', '이용약관'], ['.legal-note a[href="./privacy.html"]', '개인정보 처리방침']]) {
    assert(await p.isVisible(sel), 'link ' + sel);
    const href = await p.getAttribute(sel, 'href');
    const res = await p.request.get(new URL(href, APP).href);
    assert(res.ok() && (await res.text()).includes(`<h1>${title}</h1>`), title + ' page');
  }
  ok('welcome links to 이용약관 and 개인정보 처리방침; both pages load');

  // ---- password reset with an emailed code ----
  await signUp(p, 'reset@test.com', 'first-password');
  await p.goto(APP + '#day');
  await p.click('[data-action="sign-out"]');
  await p.waitForSelector('.welcome');
  await p.click('[data-action="auth-forgot"]');
  assert(!(await p.isVisible('.kakao-login')), 'kakao hidden while resetting');
  await p.fill('#auth-email', 'reset@test.com');
  await p.click('[data-form="reset-request"] button[type=submit]');
  await p.waitForSelector('#auth-code');
  assert(backend.resetCodes.get('reset@test.com') === '654321', 'code issued');
  await p.fill('#auth-code', '000000');
  await p.fill('#auth-password', 'new-password-1');
  await p.click('[data-form="reset-confirm"] button[type=submit]');
  await p.waitForSelector('.welcome .area-error');
  assert((await p.textContent('.area-error')).includes('코드가 맞지 않거나'), 'wrong code');
  await p.fill('#auth-code', '654321');
  await p.fill('#auth-password', 'short');
  await p.click('[data-form="reset-confirm"] button[type=submit]');
  await p.waitForSelector('text=8자 이상');
  await p.fill('#auth-password', 'new-password-1');
  await p.click('[data-form="reset-confirm"] button[type=submit]');
  await p.waitForFunction(() => !document.body.classList.contains('is-gated'));
  assert(backend.accounts.get('reset@test.com').password === 'new-password-1', 'password changed');
  ok('비밀번호를 잊었어요 → code by email → wrong code / short password refused → new password set and signed in');

  // ---- error reports ----
  await p.goto(APP + '#home');
  await p.evaluate(() => {
    setTimeout(() => { throw new Error('boom from test'); });
    setTimeout(() => { throw new Error('boom from test'); }); // duplicate
    Promise.reject(new Error('rejected from test'));
    setTimeout(() => { throw new Error('Script error.'); }); // ignored noise
  });
  await until(() => backend.errorsLog.length >= 2, 6000, 'error reports');
  await p.waitForTimeout(500);
  const msgs = backend.errorsLog.map((e) => e.message);
  assert(msgs.filter((m) => m === 'boom from test').length === 1, 'deduplicated ' + msgs);
  assert(msgs.includes('rejected from test') && !msgs.includes('Script error.'), 'rejection kept, noise ignored ' + msgs);
  const row = backend.errorsLog[0];
  assert(row.screen === 'home' && row.app_version && row.user_agent && !('note' in row), 'row ' + JSON.stringify(row));
  ok('errors reported once each (with screen, version, browser), promise rejections too, noise ignored:', msgs.join(' | '));
  // only expected errors reached the console
  for (let i = errors.length - 1; i >= 0; i -= 1) if (/boom from test|rejected from test|Script error/.test(errors[i])) errors.splice(i, 1);

  // ---- account deletion ----
  await setArea(p);
  await p.click('[data-action="start"]');
  await p.waitForSelector('#discover-title');
  await p.click('[data-action="go"]');
  await p.goto(APP + '#day');
  await p.click('#journal-note');
  await p.keyboard.type('지울 기록');
  await p.click('text=기록 저장');
  const id = backend.accounts.get('reset@test.com').id;
  await until(() => [...backend.db.keys()].some((k) => k.startsWith(id + '|')), 8000, 'day synced');
  await until(() => backend.prefs.has(id), 10000, 'taste synced');
  assert(await p.isVisible('.legal-links a[href="./privacy.html"]'), 'My Day legal links');

  await p.click('[data-action="delete-account"]');
  await p.waitForSelector('.danger-zone');
  assert((await p.textContent('.danger-zone')).includes('영구히'), 'explains');
  await p.click('[data-action="delete-account-cancel"]');
  assert(!(await p.isVisible('.danger-zone')), 'cancel closes');
  await p.click('[data-action="delete-account"]');
  await p.click('[data-action="delete-account-confirm"]');
  await p.waitForSelector('.welcome');
  assert(backend.deleted.includes(id), 'function called for this user');
  assert(!backend.accounts.has('reset@test.com'), 'account gone');
  assert(![...backend.db.keys()].some((k) => k.startsWith(id + '|')) && !backend.prefs.has(id), 'their data gone');
  const left = await p.evaluate(() => ({
    days: Object.keys(localStorage).filter((k) => k.startsWith('plannish-day:')).map((k) => JSON.parse(localStorage[k]).updatedAt),
    taste: localStorage.getItem('plannish-taste'),
    owner: localStorage.getItem('plannish-owner'),
  }));
  assert(left.days.every((u) => u === null) && left.taste === null && left.owner === null, 'device cleared ' + JSON.stringify(left));
  ok('계정 삭제: explained, can cancel, then account + days + taste removed server-side and on this device; back to login');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
