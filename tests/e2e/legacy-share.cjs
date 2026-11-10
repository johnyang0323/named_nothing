// Before multi_share.sql is run: an entry still has one audience, and the app copes.
const { devices } = require('playwright');
const { launch } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until, goHere } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const backend = createBackend({ noMultiShare: true });
  const S = backend.social;
  const errors = [];
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(ctx, backend, { errors });
  const A = await ctx.newPage();
  A.on('dialog', (d) => d.accept());
  await A.goto(APP);
  await signUp(A, 'a@test.com', 'password-a1');

  // a room to share into
  await A.goto(APP + '#together');
  await A.click('.tabs [data-tab="meet"]');
  await A.click('[data-action="meet-form"][data-form-name="group"]');
  await A.fill('#group-name', '동네 모임');
  await A.click('[data-form="group-create"] button[type=submit]');
  await A.waitForSelector('.group-title:has-text("동네 모임")');
  const group = [...S.groups.values()][0];

  // visit a place, pick 친구 + the room → kept as one audience, and told why
  await A.goto(APP + '#home');
  await setArea(A);
  await A.click('[data-action="start"]');
  await A.waitForSelector('#discover-title');
  await goHere(A);
  await A.click('[data-action="toggle-current-visited"]');
  await A.goto(APP + '#day');
  await A.click('[data-action="editor-open"]');
  await A.fill('#entry-note', '오래된 서버에서도 남는 기록');
  await A.click('.audience-chip:has-text("친구")');
  await A.click('.audience-chip:has-text("동네 모임")');
  await A.click('[data-form="entry-save"] button[type=submit]');
  await A.waitForSelector('text=한 곳에만 공개했어요');
  const entry = () => [...S.entries.values()][0];
  assert(entry().visibility === 'friends' && !('group_ids' in entry()), 'saved with the old single audience');
  await A.waitForSelector('.entry-audience .vis-friends');
  ok('before multi_share.sql: 친구 + 단체방 picked → saved for friends, with a note to run the SQL');

  // posting it from the room moves it there (after a confirm)
  await A.goto(APP + '#together');
  await A.click('.tabs [data-tab="meet"]');
  await A.click(`[data-action="group-open"][data-id="${group.id}"]`);
  await A.click('[data-action="group-pick-open"]');
  await A.click('.pick-item [data-action="group-pick"]');
  await until(() => entry().visibility === 'group' && entry().group_id === group.id, 8000, 'moved to the room');
  await A.waitForSelector('#group-feed-title ~ .entries .entry:has-text("오래된 서버에서도")');
  ok('…and posting it to a room from inside the room moves it there; the room lists it');

  // 계정 → 서버 설정 점검 names the one SQL file that wasn't run
  await A.goto(APP + '#account');
  await A.click('[data-action="check-setup"]');
  await A.waitForSelector('.diag-result.is-bad:has-text("아직 실행하지 않은 SQL이 1개")');
  assert((await A.textContent('.diag-result')).includes('multi_share.sql'), 'names multi_share.sql');
  ok('계정 → 서버 설정 점검: "multi_share.sql" is listed as not run yet');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
