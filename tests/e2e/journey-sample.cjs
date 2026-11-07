const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const SHOTS = OUT + '/';
const URL = 'http://localhost:4173/';
const log = (...a) => console.log('✔', ...a);
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); }

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push('requestfailed ' + r.url()));

  await page.goto(URL);
  assert((await page.textContent('h1')).includes('어떤 하루가 끌리세요'), 'home heading (mood step, no location step without Kakao)');
  assert(await page.isChecked('input[value="anything"]'), '아무거나 default');
  await page.screenshot({ path: SHOTS + '1-home.png', fullPage: true });
  log('home renders, 아무거나 preselected');

  const s1 = await page.textContent('.small-suggestion-text');
  await page.click('[data-action="next-suggestion"]');
  assert(s1 !== (await page.textContent('.small-suggestion-text')), 'small suggestion changes');
  log('small suggestion switches');

  await page.click('label.mood:has-text("걸어보기")');
  assert(await page.isChecked('input[value="walk"]'), 'mood selected');
  await page.click('text=오늘 시작하기');
  await page.waitForURL(/#discover/);
  const first = await page.textContent('#discover-title');
  assert((await page.textContent('.eyebrow')).includes('걸어보기'), 'mood in discover');
  await page.screenshot({ path: SHOTS + '2-discover.png', fullPage: true });
  log('discover:', first);

  const seen = new Set([first]);
  for (let i = 0; i < 5; i++) {
    await page.click('[data-action="another"]');
    const name = await page.textContent('#discover-title');
    assert(!seen.has(name), 'another gives new place ' + name);
    seen.add(name);
  }
  log('다른 곳 보기 x5, all distinct');
  const chosen = await page.textContent('#discover-title');
  await page.click('[data-action="go"]');
  await page.waitForURL(/#explore/);
  assert((await page.textContent('#explore-title')) === chosen, 'explore current');
  assert((await page.locator('.discovery').count()) === 3, '3 discoveries');
  assert((await page.textContent('.schematic')).includes('실제 지도가 아니라'), 'map disclaimer');
  await page.screenshot({ path: SHOTS + '3-explore.png', fullPage: true });
  log('explore with 3 discoveries + schematic');

  await page.click('[data-action="refresh"]');
  const d1 = await page.locator('.discovery-name').first().textContent();
  await page.locator('[data-action="add"]').first().click();
  assert((await page.textContent('#toast')).includes('경로에 담았어요'), 'toast');
  await page.locator('[data-action="add"]').first().click();
  log('added 2 discoveries; first:', d1);
  assert((await page.textContent('[data-route-count]')) === '3', 'nav count 3');

  await page.click('[data-action="toggle-current-visited"]');
  assert((await page.getAttribute('[data-action="toggle-current-visited"]', 'aria-pressed')) === 'true', 'visited from explore');

  await page.click('.app-tabbar a[href="#route"]');
  await page.waitForURL(/#route/);
  const names = async () => page.locator('.stop-name').allTextContents();
  let order = await names();
  assert(order.length === 3 && order[0] === chosen, 'route order');
  await page.click(`[aria-label="${order[1]} 위로 옮기기"]`);
  let o2 = await names();
  assert(o2[0] === order[1] && o2[1] === order[0], 'move up works');
  const focusedKey = await page.evaluate(() => document.activeElement?.dataset?.focusKey);
  log('reorder ok; focus after moving to top:', focusedKey);

  await page.keyboard.press('Tab'); // keyboard keeps working
  await page.click(`[aria-label="${o2[2]} 다녀왔어요"]`);
  assert((await page.locator('.stop').nth(2).textContent()).includes('✓ 다녀왔어요'), 'visited mark');

  await page.click(`[aria-label="${o2[1]} 다른 곳으로 바꾸기"]`);
  assert((await page.locator('.replace-option').count()) > 0, 'replacement options');
  const newName = await page.locator('.replace-name').first().textContent();
  await page.locator('.replace-option').first().click();
  o2 = await names();
  assert(o2[1] === newName, 'replaced in place');
  log('replace ok ->', newName);

  await page.click(`[aria-label="${o2[0]} 경로에서 빼기"]`);
  assert((await names()).length === 2, 'removed');
  await page.click('.toast-action');
  assert((await names())[0] === o2[0], 'undo restored');
  await page.click(`[aria-label="${o2[0]} 경로에서 빼기"]`);
  assert((await names()).length === 2, 'removed again');
  await page.screenshot({ path: SHOTS + '4-route.png', fullPage: true });
  log('remove + undo + remove ok');

  await page.click('.app-tabbar a[href="#day"]');
  await page.waitForURL(/#day/);
  await page.click('.chip:has-text("설렜어요")');
  await page.fill('#journal-note', '처음 가본 골목에서 고양이를 만났다.');
  assert((await page.textContent('.save-status')).includes('저장하지 않은'), 'dirty state');
  await page.click('text=기록 저장');
  assert((await page.textContent('.save-status')).includes('저장했어요'), 'saved');
  await page.screenshot({ path: SHOTS + '5-myday.png', fullPage: true });
  log('journal saved');

  const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  await page.reload();
  assert((await page.inputValue('#journal-note')).includes('고양이'), 'note persisted');
  assert((await page.getAttribute('.chip:has-text("설렜어요")', 'aria-pressed')) === 'true', 'feeling persisted');
  await page.goto(URL + '#route');
  assert((await names()).length === 2, 'route persisted');
  log('state persisted after reload');
  assert((await page.locator('.directions-link, .directions-button').count()) === 0, 'sample places have no directions');

  // malformed storage
  await page.evaluate(() => Object.keys(localStorage).forEach((k) => localStorage.setItem(k, '{broken')));
  await page.reload();
  assert((await page.textContent('.empty-title')).includes('아직 담은 곳이 없어요'), 'graceful malformed');
  await page.goto(URL + '#explore');
  assert((await page.textContent('h1')).includes('출발점이 없어요'), 'explore empty state');
  log('malformed storage + empty states ok');

  // reset flow
  await page.goto(URL + '#home');
  await page.click('text=오늘 시작하기');
  await page.click('[data-action="go"]');
  await page.goto(URL + '#day');
  await page.click('[data-action="reset"]');
  await page.click('[data-action="reset-confirm"]');
  await page.waitForURL(/#home/);
  await page.waitForSelector('#home-title');
  assert((await page.locator('.resume').count()) === 0, 'reset cleared (no "담아둔 곳" line)');
  log('reset ok');

  // horizontal overflow check on every screen at mobile width
  for (const r of ['home', 'discover', 'explore', 'route', 'day']) {
    await page.goto(URL + '#' + r);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, 'horizontal overflow on ' + r);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).length);
    assert(broken === 0, 'broken img on ' + r);
  }
  log('no overflow / broken images at mobile width');

  // keyboard-only: tab to mood radio and arrow-select
  await page.goto(URL + '#home');
  await page.focus('input[value="anything"]');
  await page.keyboard.press('ArrowLeft');
  const kbMood = await page.evaluate(() => document.querySelector('input[name=mood]:checked').value);
  log('keyboard mood select ->', kbMood);

  // desktop
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errors.push(String(e)));
  await dp.goto(URL);
  await dp.screenshot({ path: SHOTS + '6-desktop-home.png' });
  await dp.click('text=오늘 시작하기');
  await dp.screenshot({ path: SHOTS + '7-desktop-discover.png' });
  await dp.click('[data-action="go"]');
  await dp.screenshot({ path: SHOTS + '8-desktop-explore.png', fullPage: true });

  // reduced motion context loads fine
  const rctx = await browser.newContext({ reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  rp.on('pageerror', (e) => errors.push(String(e)));
  await rp.goto(URL);

  console.log('console/page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
