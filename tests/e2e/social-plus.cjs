// Invite tokens, place cards sent to friends, friends' traces on cards.
const { devices } = require('playwright');
const fs = require('fs');
const { launch, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until, goHere } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const IMG = fs.readFileSync(ROOT + '/public/icons/icon-512.png');
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const backend = createBackend();
  const S = backend.social;
  const errors = [];
  const person = async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
    await wire(ctx, backend, { errors });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    return page;
  };
  const nickname = async (page, name) => {
    await page.goto(APP + '#account');
    await page.waitForSelector('#nickname');
    await page.fill('#nickname', name);
    await page.click('[data-form="profile"] button[type=submit]');
    await until(() => [...S.profiles.values()].some((p) => p.nickname === name), 5000, 'profile ' + name);
  };

  // ── A makes an invite link; B opens it before signing up → friends at once ──
  const A = await person();
  await A.goto(APP);
  await signUp(A, 'a@test.com', 'password-a1');
  await nickname(A, '에이');
  await A.goto(APP + '#together');
  await A.waitForSelector('[data-action="copy-invite"]');
  await A.click('[data-action="copy-invite"]');
  await until(() => S.invites.size === 1, 5000, 'invite token made');
  const token = [...S.invites.keys()][0];
  assert(/^[A-Za-z0-9]{20}$/.test(token), 'token shape');

  const B = await person();
  await B.goto(`${APP}?invite=${token}`);
  await B.waitForSelector('.welcome');
  await signUp(B, 'b@test.com', 'password-b1');
  await B.waitForSelector('.invite-banner:has-text("친구 초대 링크")');
  await B.click('[data-action="invite-accept"]');
  await B.waitForSelector('text=친구가 됐어요');
  const ids = () => [backend.accounts.get('a@test.com').id, backend.accounts.get('b@test.com').id];
  assert(S.friendships.some((f) => f.user_id === ids()[0] && f.friend_id === ids()[1]), 'friends through the token');
  assert(!(await B.url()).includes('invite='), 'token removed from the address bar');
  await nickname(B, '비');
  ok('invite link carries a one-time token (not the #tag); opening it makes friends right away');

  // ── A visits a place and shares a note with friends ──
  await A.goto(APP + '#home');
  await setArea(A);
  await A.click('[data-action="start"]');
  await A.waitForSelector('#discover-title');
  const place = (await A.textContent('#discover-title')).trim();
  await goHere(A);
  await A.click('[data-action="toggle-current-visited"]');
  await A.goto(APP + '#day');
  await A.click('[data-action="editor-open"]');
  await A.fill('#entry-note', '창가 자리가 좋았어');
  await A.setInputFiles('[data-input="entry-files"]', { name: 'a.png', mimeType: 'image/png', buffer: IMG });
  await A.click('.budget-chip:has-text("친구에게")');
  await A.click('[data-form="entry-save"] button[type=submit]');
  await until(() => [...S.entries.values()].some((e) => e.note === '창가 자리가 좋았어'), 8000, 'entry saved');

  // ── B meets that place on a card: the trace and A's note show ──
  await B.goto(APP + '#home');
  await setArea(B);
  await B.click('[data-action="start"]');
  await B.waitForSelector('#discover-title');
  for (let i = 0; i < 60 && (await B.textContent('#discover-title')).trim() !== place; i += 1) await B.click('[data-action="another"]');
  assert((await B.textContent('#discover-title')).trim() === place, 'B reached the place');
  await B.waitForSelector('.friend-trace:has-text("친구 1명이 다녀간 곳 · 에이")');
  await B.waitForSelector('.destination-details .entry-note:has-text("창가 자리가 좋았어")');
  ok(`friends' traces: "친구 1명이 다녀간 곳 · 에이" on ${place}, and A's shared note under the card`);

  // ── B sends a different place to A as a card ──
  await B.click('[data-action="another"]');
  const sent = (await B.textContent('#discover-title')).trim();
  await B.click('[data-action="send-open"]');
  await B.waitForSelector('.send-friend:has-text("에이")');
  await B.click('.send-friend:has-text("에이")');
  await B.fill('#send-note', '여기 같이 갈래?');
  await B.click('[data-action="send-card"]');
  await B.waitForSelector(`text=에이님에게 ‘${sent}’ 카드를 보냈어요`);
  assert(S.cards.length === 1 && S.cards[0].note === '여기 같이 갈래?', 'card stored');

  await A.goto(APP + '#together');
  await A.click('[data-action="together-tab"][data-tab="inbox"]');
  await A.waitForSelector(`.shared-card:has-text("${sent}")`);
  await A.waitForSelector('.shared-card-note:has-text("여기 같이 갈래?")');
  await A.waitForSelector(`.note-text:has-text("비님이 장소 카드를 보냈어요: ${sent}")`);
  await A.click('[data-action="card-keep"]');
  await A.waitForSelector('text=봉투에 담았어요');
  await until(() => S.cards.length === 0, 5000, 'card cleared after keeping');
  await A.goto(APP + '#route');
  await A.waitForSelector(`.stop-name:has-text("${sent}")`);
  ok(`place card: B sends "${sent}" with a note → A's inbox → 봉투에 담기 → in A's 경로`);

  // ── 함께 하루: a shared envelope with B, filled while swiping, voted on ──
  await A.goto(APP + '#together');
  await A.click('[data-action="together-tab"][data-tab="outing"]');
  await A.fill('#outing-title', '토요일 나들이');
  await A.click('[data-form="outing-create"] .send-friend:has-text("비")');
  await A.click('[data-form="outing-create"] button[type=submit]');
  await A.waitForSelector('.group-title:has-text("토요일 나들이")');
  assert(S.tdays.size === 1 && S.tmembers.length === 2, 'day with A and B');
  await A.click('[data-action="outing-swipe"]');
  await A.waitForSelector('.together-banner:has-text("토요일 나들이")');
  const first = (await A.textContent('#discover-title')).trim();
  await A.click('[data-action="keep"]');
  await A.waitForSelector('text=함께 봉투에 담았어요');
  await A.waitForFunction((t) => document.querySelector('#discover-title')?.textContent.trim() !== t, first);
  const second = (await A.textContent('#discover-title')).trim();
  await A.click('[data-action="keep"]');
  await until(() => S.titems.length === 2, 5000, 'two places in the shared envelope');

  await B.goto(APP + '#together');
  await B.click('[data-action="together-tab"][data-tab="inbox"]');
  await B.waitForSelector('.note-text:has-text("에이님이 함께 하루에 초대했어요: 토요일 나들이")');
  await B.click('.note-item:has-text("함께 하루에 초대했어요") [data-action="outing-open"]');
  await B.waitForSelector('.group-title:has-text("토요일 나들이")');
  await B.waitForSelector(`.outing-item:has-text("${first}")`);
  await B.waitForSelector(`.outing-item:has-text("${second}")`);
  await B.click(`.outing-item:has-text("${second}") [data-action="outing-vote"]`);
  await B.waitForSelector(`.outing-item.is-top:has-text("${second}")`);
  await B.click(`.outing-item.is-top [data-action="outing-go"]`);
  await B.waitForURL(/#route/);
  await B.waitForSelector(`.stop-name:has-text("${second}")`);
  ok(`함께 하루: A invites B, keeps "${first}" and "${second}" while swiping; B votes 👍 → "${second}" goes on top; 여기로 출발 → B's 경로`);

  // ── an old ?friend= link now sends a request instead ──
  const C = await person();
  const tagA = [...S.profiles.values()].find((p) => p.nickname === '에이').tag;
  await C.goto(`${APP}?friend=${encodeURIComponent('에이#' + tagA)}`);
  await C.waitForSelector('.welcome');
  await signUp(C, 'c@test.com', 'password-c1');
  await C.waitForSelector('.invite-banner:has-text("친구 요청을 보낼까요")');
  await C.click('[data-action="invite-accept"]');
  await C.waitForSelector('text=친구 요청을 보냈어요');
  assert(S.requests.length === 1 && !S.friendships.some((f) => f.user_id === backend.accounts.get('c@test.com').id), 'request, not friends');
  ok('older ?friend= links send a friend request instead of adding directly');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
