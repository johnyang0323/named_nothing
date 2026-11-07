const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until, goHere } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const backend = createBackend();
const errors = [];

(async () => {
  const browser = await launch();
  const A = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(A, backend, { errors, weather: { weather_code: 63, temperature_2m: 12.4, precipitation: 2.1 } });
  // Recommendations are random; a fixed seed keeps the share checks below stable.
  await A.addInitScript(() => {
    let t = 0x2f6b1d;
    Math.random = () => {
      t = (t + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  });
  const p = await A.newPage();
  await p.goto(APP);
  await signUp(p);
  await setArea(p);
  await p.waitForSelector('.weather-badge');
  const badge = (await p.textContent('.weather-badge')).replace(/\s+/g, ' ').trim();
  assert(badge.includes('비 12°') && badge.includes('실내 위주로'), badge);
  ok('step 2 shows weather from Open-Meteo:', badge);

  assert((await p.textContent('.budget-control [role=radio][aria-checked=true]')).includes('반나절'), 'default 반나절');
  await p.click('.budget-control [role=radio]:has-text("2시간")');
  await p.waitForFunction(() => document.querySelector('.budget-control [role=radio][aria-checked=true]')?.textContent.includes('2시간'));
  ok('time budget chips: 반나절 by default → 2시간');

  // in the rain, first picks should mostly be indoor
  const indoorCats = ['cafe', 'bookstore', 'library', 'gallery', 'museum', 'workshop', 'recordshop'];
  let indoor = 0;
  await p.click('[data-action="start"]');
  await p.waitForSelector('#discover-title');
  for (let i = 0; i < 12; i += 1) {
    const kind = await p.textContent('.destination-body .kicker');
    if (/카페|서점|도서관|갤러리|전시관|공방|레코드/.test(kind)) indoor += 1;
    await p.click('[data-action="another"]');
  }
  assert(indoor >= 8, `indoor ${indoor}/12`);
  const why = await p.locator('.why-tags').count() ? await p.textContent('.why-tags') : '';
  ok(`rain → ${indoor}/12 suggestions indoors; reason tags e.g. "${why.trim().slice(0, 30)}"`);

  // teach a taste: go to 2 bookstores-ish: accept whatever, then visit
  await p.goto(APP + '#home');
  for (let n = 0; n < 3; n += 1) {
    await p.goto(APP + '#home');
    await p.waitForSelector('.home-mood');
    await p.click('[data-action="start"]');
    await p.waitForSelector('#discover-title');
    await goHere(p);
    await p.waitForSelector('#explore-title');
    await p.click('[data-action="toggle-current-visited"]');
  }
  await p.goto(APP + '#account');
  await p.waitForSelector('.taste');
  const tasteText = (await p.textContent('.taste')).replace(/\s+/g, ' ');
  assert(tasteText.includes('자주 고른 곳'), tasteText);
  ok('나의 취향:', tasteText.match(/자주 고른 곳 [^우]+?(?= 덜| 고른 곳과)/)?.[0] || tasteText.slice(0, 60));

  await p.goto(APP + '#explore');
  await p.waitForSelector('.discovery');
  assert((await p.locator('.wild-tag').count()) === 1, 'one wild discovery');
  ok('explore: one of three discoveries is tagged "새로운 발견"');

  await until(() => backend.prefs.get('user-1')?.taste.events >= 6, 10000, 'taste synced'); // push is debounced
  const remote = backend.prefs.get('user-1');
  assert(remote && remote.taste.events >= 6, 'taste synced ' + JSON.stringify(remote?.taste));
  ok('taste saved to the account (', remote.taste.events, 'signals )');

  // toggle off + reset with undo
  await p.goto(APP + '#account');
  await p.uncheck('[data-input="taste-enabled"]');
  assert(!(await p.isChecked('[data-input="taste-enabled"]')), 'off');
  await p.check('[data-input="taste-enabled"]');
  await p.click('[data-action="taste-reset"]');
  await p.waitForSelector('text=아직 배운 게 없어요');
  await p.click('.toast-action');
  await p.waitForSelector('text=자주 고른 곳');
  ok('취향 반영 on/off toggle; 초기화 → 되돌리기 restores it');

  // device B gets the taste after signing in; sign-out clears it locally
  const B = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(B, backend, { errors });
  const pb = await B.newPage();
  await pb.goto(APP + '#account');
  await pb.waitForSelector('.welcome');
  await pb.click('[data-action="auth-mode"]'); // already exists → sign in instead
  await pb.click('[data-action="auth-mode"]');
  await pb.fill('#auth-email', 'me@test.com');
  await pb.fill('#auth-password', 'correct-horse');
  await pb.click('[data-form="email-auth"] button[type=submit]');
  await pb.waitForSelector('text=자주 고른 곳', { timeout: 10000 });
  ok('device B: taste restored from the account after sign-in');
  await pb.goto(APP + '#account');
  await pb.click('[data-action="sign-out"]');
  await pb.waitForSelector('.welcome');
  assert((await pb.evaluate(() => localStorage.getItem('plannish-taste'))) === null, 'taste cleared on sign-out');
  ok('sign-out removes taste from the device');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
