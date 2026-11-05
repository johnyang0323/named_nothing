const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

(async () => {
  const browser = await launch();
  const backend = createBackend();
  const errors = [];

  // ---------------- Device A ----------------
  const A = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(A, backend, { errors });
  const pa = await A.newPage();
  await pa.goto(APP + '#discover');
  await pa.waitForSelector('.welcome');
  assert(await pa.evaluate(() => document.body.classList.contains('is-gated')), 'gated');
  assert(!(await pa.isVisible('.nav')), 'nav hidden on gate');
  assert(await pa.isVisible('.kakao-login') && await pa.isVisible('#auth-email'), 'kakao + email shown');
  ok('signed out: only the welcome/login screen, nav hidden (even for #discover)');

  // an earlier day already in this browser (from before accounts were required)
  await pa.evaluate(() => localStorage.setItem('plannish-day:2026-11-01', JSON.stringify({ version: 1, date: '2026-11-01', route: [{ id: 'p02', visited: true }], journal: { note: '느티나무 아래에서 쉬었다', feeling: '평온했어요' }, updatedAt: '2026-11-01T10:00:00Z' })));
  await signUp(pa);
  await pa.waitForURL(/#home/);
  ok('after sign-up → home (requested #discover sent back to home: no location yet)');
  assert(await pa.isVisible('.home-place'), 'step 1 first');
  assert((await pa.textContent('#home-title')) === '어디서 시작할까요?', 'step 1 title');
  assert(!(await pa.isVisible('.moods')), 'mood not on step 1');
  ok('home step 1 = "어디서 시작할까요?" only (no mood yet)');

  assert((await pa.locator('[data-action="start"]').count()) === 0, 'no start button before a location');
  assert((await pa.textContent('.area-error')).includes('위치 없이는 추천하지 않아요'), 'start blocked');
  await pa.goto(APP + '#discover');
  await pa.waitForURL(/#home/);
  await pa.waitForSelector('.home-place .area-error');
  await pa.goto(APP + '#explore');
  await pa.waitForSelector('text=출발할 위치를 먼저 정해주세요');
  ok('no location → no start button, #discover redirects to step 1, #explore asks for location');

  // pick on the map
  await pa.goto(APP + '#home');
  await pa.waitForSelector('.area-map[data-fake-map]');
  assert(await pa.isHidden('[data-action="use-picked"]'), 'confirm hidden before pick');
  await pa.evaluate(() => window.__mapClick(37.55632, 126.92271));
  await pa.waitForSelector('[data-action="use-picked"]:not([hidden])');
  assert((await pa.getAttribute('.km-pick', 'data-pos')) === '37.55632,126.92271', 'pin placed');
  const mapsBefore = await pa.evaluate(() => window.__maps);
  await pa.click('[data-action="use-picked"]');
  await pa.waitForSelector('.home-mood');
  const label = (await pa.textContent('.place-chip')).replace('바꾸기', '').trim();
  assert((await pa.textContent('#home-title')) === '어떤 하루가 끌리세요?', 'auto step 2');
  // back to step 1 via the chip and forward again: the map is reused, not rebuilt
  await pa.click('.place-chip');
  await pa.waitForSelector('.home-place .area-map[data-fake-map]');
  assert((await pa.evaluate(() => window.__maps)) === mapsBefore, 'map reused');
  await pa.click('.flow-back');
  await pa.waitForSelector('.home-mood');
  await pa.click('label.mood:has-text("걸어보기")');
  assert(label === '망원1동 (지도에서 고른 곳)', label);
  const center = await pa.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('plannish-day:2026-11-0') && !k.endsWith('11-01'))?.[1] || 'null')?.area?.center);
  assert(center.lat === 37.556 && center.lng === 126.923, 'coarse ' + JSON.stringify(center));
  ok('map tap → pin → "이 위치에서 시작하기" → step 2 automatically;', label, '| chip → step 1 → back keeps the same map;', '| stored ~100m:', JSON.stringify(center), '| map not rebuilt on re-render');

  await pa.click('[data-action="start"]');
  await pa.waitForSelector('#discover-title');
  assert((await pa.textContent('.facts')).includes('고른 위치에서'), 'walking from label');
  const placeName = await pa.textContent('#discover-title');
  await pa.click('[data-action="go"]');
  await pa.waitForSelector('#explore-title');
  await pa.goto(APP + '#day');
  await pa.fill('#journal-note', '지도에서 고른 동네 산책');
  await pa.click('text=기록 저장');
  await pa.waitForTimeout(1800);
  assert(backend.db.get(`user-1|${TODAY}`)?.data.journal.note === '지도에서 고른 동네 산책', 'synced');
  assert(backend.db.has('user-1|2026-11-01'), 'earlier local day uploaded on first login');
  await pa.waitForSelector('text=느티나무 아래에서 쉬었다');
  ok('discover → explore → journal synced; earlier local day uploaded and listed in 지난 날들');

  // sign out → device cleared, gate back
  await pa.click('[data-action="sign-out"]');
  await pa.waitForSelector('.welcome');
  const keys = await pa.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('plannish-day:')).map((k) => [k, JSON.parse(localStorage[k]).updatedAt]));
  assert(keys.every(([, u]) => u === null), 'only empty days left: ' + JSON.stringify(keys));
  assert(backend.db.get(`user-1|${TODAY}`).data.journal.note === '지도에서 고른 동네 산책', 'account copy untouched');
  ok('sign-out → back to login, this device cleared, account copy intact');

  // someone else signs in on the same device → gets nothing from user-1
  await signUp(pa, 'friend@test.com', 'another-pass');
  await pa.goto(APP + '#home');
  await pa.waitForSelector('.home-flow');
  assert(!(await pa.isVisible('.home-mood')), 'friend starts without area');
  await pa.goto(APP + '#day');
  await pa.waitForSelector('#journal-note');
  assert((await pa.inputValue('#journal-note')) === '', 'friend sees empty journal');
  assert(![...backend.db.keys()].some((k) => k.startsWith('user-2|')), 'nothing of user-1 uploaded to friend: ' + [...backend.db.keys()]);
  ok('another account on the same device starts clean; nothing leaks between accounts');
  await pa.click('[data-action="sign-out"]');
  await pa.waitForSelector('.welcome');

  // ---------------- Device B: Kakao login restores user-1's day ----------------
  const B = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(B, backend, { errors });
  const pb = await B.newPage();
  await pb.goto(APP + '#route');
  await pb.waitForSelector('.welcome');
  await pb.click('.kakao-login');
  await pb.waitForURL((u) => !u.search.includes('code=') && u.hash === '#route', { timeout: 10000 });
  await pb.waitForFunction((n) => document.querySelector('.stop-name')?.textContent === n, placeName, { timeout: 8000 });
  ok('device B: Kakao login returns to the requested #route with user-1’s route:', placeName);
  await pb.goto(APP + '#day');
  await pb.waitForFunction(() => { const i = document.querySelector('.avatar-img'); return i && i.complete && i.naturalWidth > 0; });
  assert((await pb.inputValue('#journal-note')) === '지도에서 고른 동네 산책', 'journal pulled');
  await pb.goto(APP + '#home');
  await pb.waitForSelector('.home-mood');
  ok('device B: journal + area pulled; home opens on step 2 with the place chip');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
