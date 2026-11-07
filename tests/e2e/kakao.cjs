const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const fs = require('fs');
const URL = 'http://localhost:4174/';
const FAKE = fs.readFileSync(__dirname + '/fake-kakao.js', 'utf8');
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  let sdkRequests = [];
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { weather_code: 1, temperature_2m: 18, precipitation: 0 } }) }));
  await ctx.route('https://dapi.kakao.com/**', (route) => {
    sdkRequests.push(route.request().url());
    route.fulfill({ contentType: 'application/javascript', body: FAKE });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL);
  assert(await page.isVisible('#area-query'), 'area search shown when key set');
  await page.waitForSelector('.area-map[data-fake-map]');
  assert(sdkRequests.length === 1, 'SDK loaded once for the home map');
  assert((await page.locator('[data-action="start"]').count()) === 0, 'no start before area');
  await page.goto(URL + '#discover');
  await page.waitForURL(/#home/);
  ok('home: location section + map first; no recommendations before a location is set');

  await page.fill('#area-query', '없는동네');
  await page.click('[data-form="area"] button[type=submit]');
  await page.waitForSelector('.area-error');
  assert((await page.textContent('.area-error')).includes('찾지 못했어요'), 'not-found error');
  assert(sdkRequests[0].includes('appkey=test-key') && sdkRequests[0].includes('libraries=services') && sdkRequests[0].includes('autoload=false'), 'sdk url');
  ok('unknown area -> friendly error; SDK URL has key/services/autoload=false');

  await page.fill('#area-query', '망원동');
  await page.press('#area-query', 'Enter');
  await page.waitForSelector('.home-mood');
  ok('area found → step 2:', (await page.textContent('.place-chip')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: OUT + '/k1-home.png', fullPage: true });

  await page.click('text=오늘 시작하기');
  await page.waitForURL(/#discover/); await page.waitForSelector('#discover-title');
  const eb = await page.textContent('.eyebrow'); assert(eb.includes('망원동 근처'), 'eyebrow area: ' + eb);
  assert((await page.textContent('.facts')).includes('동네 중심에서'), 'real facts label');
  const link = await page.getAttribute('.destination-details .fine-print a', 'href');
  assert(link.startsWith('https://place.map.kakao.com/'), 'kakao link');
  assert((await page.textContent('.destination-details .fine-print')).includes('장소 정보: 카카오'), 'attribution');
  const directions = await page.getAttribute('.directions-button', 'href');
  assert(/^https:\/\/map\.kakao\.com\/link\/to\/.+,37\.\d+,126\.\d+$/.test(directions), 'directions url ' + directions);
  assert((await page.getAttribute('.directions-button', 'target')) === '_blank', 'opens outside the app');
  await page.screenshot({ path: OUT + '/k2-discover.png', fullPage: true });
  ok('discover uses real place:', await page.textContent('#discover-title'));

  await page.click('[data-action="go"]');
  await page.waitForURL(/#explore/);
  await page.waitForSelector('[data-kakao-map][data-fake-map]');
  assert((await page.locator('.km-num').count()) === 3, '3 numbered markers');
  assert((await page.locator('.km-current').count()) === 1, 'current marker');
  assert(await page.isHidden('[data-schematic]'), 'schematic hidden');
  assert((await page.locator('.discovery .kicker').first().textContent()).includes('직선거리'), 'real distance');
  await page.screenshot({ path: OUT + '/k3-explore.png', fullPage: true });
  assert((await page.locator('.place-links .directions-link').count()) === 1, 'explore directions');
  ok('explore renders real map with markers + real walking estimates; 길찾기 link on the current place');

  await page.locator('[data-action="add"]').first().click();
  await page.waitForSelector('[data-kakao-map][data-fake-map]');
  assert((await page.locator('.km-route').count()) === 1, 'route marker after add');
  ok('map re-renders after adding to route');

  await page.reload();
  await page.waitForSelector('[data-kakao-map][data-fake-map]');
  assert((await page.textContent('[data-route-count]')) === '2', 'route persisted');
  ok('reload keeps area + route');
  await page.goto(URL + '#route');
  await page.waitForSelector('.stop');
  assert((await page.locator('.stop .directions-link').count()) === (await page.locator('.stop').count()), 'every real stop has 길찾기');
  ok('route: every stop has a 길찾기 link');



  // SDK blocked (e.g. unregistered domain) -> explore falls back to schematic
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  let allow = true;
  await ctx2.route('https://dapi.kakao.com/**', (route) => (allow ? route.fulfill({ contentType: 'application/javascript', body: FAKE }) : route.abort()));
  await ctx2.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { weather_code: 1, temperature_2m: 18, precipitation: 0 } }) }));
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(URL);
  await p2.fill('#area-query', '망원동');
  await p2.press('#area-query', 'Enter');
  await p2.waitForSelector('.home-mood');
  await p2.click('text=오늘 시작하기');
  await p2.click('[data-action="go"]');
  allow = false;
  await p2.reload(); // fresh page, SDK now blocked
  await p2.waitForSelector('[data-schematic]:not([hidden])', { timeout: 5000 });
  assert((await p2.locator('[data-real-map]').count()) === 0, 'real map removed');
  ok('SDK blocked -> schematic fallback, places still work');
  await p2.goto(URL + '#home');
  await p2.click('.place-chip');
  await p2.fill('#area-query', '연남동');
  await p2.press('#area-query', 'Enter');
  await p2.waitForSelector('.area-error');
  ok('SDK blocked on search ->', await p2.textContent('.area-error'));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'no overflow');
  const realErrors = errors.filter((e) => !e.includes('dapi.kakao.com') && !e.includes('ERR_FAILED'));
  console.log('page errors:', realErrors.length ? realErrors : 'none', `(ignored ${errors.length - realErrors.length} expected blocked-SDK network errors)`);
  await browser.close();
  if (realErrors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
