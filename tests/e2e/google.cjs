// Abroad with Google Maps (Kakao stays for Korea): search, photos, map, picker.
const { devices } = require('playwright');
const { goHere } = require('./helpers.cjs');
const { launch } = require('./env.cjs');
const fs = require('fs');
const URL = 'http://localhost:4176/';
const KAKAO = fs.readFileSync(__dirname + '/fake-kakao.js', 'utf8');
const GOOGLE = fs.readFileSync(__dirname + '/fake-google.js', 'utf8');
const PNG = fs.readFileSync(__dirname + '/../../public/icons/icon-512.png');
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { weather_code: 1, temperature_2m: 18, precipitation: 0 } }) }));
  await ctx.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: KAKAO }));
  await ctx.route('https://maps.googleapis.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: GOOGLE }));
  await ctx.route('https://lh3.googleusercontent.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // ── home: Kakao map by default, a 해외 switch ──
  await page.goto(URL);
  await page.waitForSelector('.area-map[data-fake-map]');
  assert(await page.isVisible('[data-action="map-region"]:has-text("해외")'), 'region switch');
  assert(!(await page.evaluate(() => window.__googleSdk)), 'Google not loaded until needed');
  ok('home: Kakao map for Korea, with a 🌏 해외 switch; Google not loaded yet');

  // ── a name abroad → Google places ──
  await page.fill('#area-query', '시부야');
  await page.press('#area-query', 'Enter');
  await page.waitForSelector('.home-mood');
  const sdk = await page.evaluate(() => window.__googleSdk[0]);
  assert(sdk.includes('key=test-google') && sdk.includes('loading=async') && sdk.includes('language=ko'), 'sdk url ' + sdk);
  assert((await page.evaluate(() => window.__nearby)) === 3, 'three nearby searches');
  const area = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('plannish-day:')))).area);
  assert(area.label === '시부야' && area.places.every((p) => p.id.startsWith('g-') && p.source === 'google'), 'google area');
  assert(!JSON.stringify(area).includes('googleusercontent'), 'Google photos are not stored');
  ok(`"시부야" → Google: ${area.places.length} places (photos not stored)`);

  await page.click('text=오늘 시작하기');
  await page.waitForSelector('#discover-title');
  assert((await page.textContent('.destination-details .fine-print')).includes('장소 정보: Google'), 'attribution');
  assert((await page.textContent('.destination-details')).includes('구글 지도에서 실제 사진 보기'), 'google link');
  assert((await page.getAttribute('.directions-button', 'href')).startsWith('https://www.google.com/maps/dir/?api=1&destination=35.'), 'google directions');
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.src.includes('googleusercontent') && i.complete && i.naturalWidth > 0));
  await page.waitForSelector('[data-photo-credit-for]:has-text("구글 지도에 올라온 사진이에요 (Taro)")');
  ok('discover: Google place, attribution, Google directions, photo from Google credited to its author');

  await goHere(page);
  await page.waitForSelector('[data-kakao-map][data-fake-google]');
  assert((await page.textContent('.map-note')).includes('구글 지도'), 'map note');
  assert((await page.locator('.km-current').count()) === 1, 'current marker');
  ok('explore: Google map with the same markers');

  // after a reload the photo comes from Google again (not from storage)
  await page.reload();
  await page.goto(URL + '#discover');
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.src.includes('googleusercontent')));
  assert((await page.evaluate(() => window.__fetchFields)) >= 1, 'asked Google for photos after reload');
  ok('after a reload, photos are fetched from Google again');

  // ── picker abroad → tap → start there ──
  await page.goto(URL + '#home');
  await page.click('.place-chip');
  await page.waitForSelector('[data-action="map-region"]:has-text("국내")');
  await page.waitForSelector('.area-map[data-fake-google]');
  await page.evaluate(() => window.__gMapClick(35.6702, 139.7027));
  await page.click('[data-action="use-picked"]');
  await page.waitForSelector('.home-mood');
  assert((await page.textContent('.place-chip')).includes('시부야구 (지도에서 고른 곳)'), 'picked abroad');
  ok('picker abroad: tap the Google map → start there (name from Geocoding)');

  // ── back in Korea → Kakao ──
  await page.click('.place-chip');
  await page.click('[data-action="map-region"]');
  await page.waitForSelector('.area-map[data-fake-map]');
  await page.fill('#area-query', '망원동');
  await page.press('#area-query', 'Enter');
  await page.waitForSelector('.home-mood');
  const kArea = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('plannish-day:')))).area);
  assert(kArea.places.every((p) => p.id.startsWith('k-')), 'kakao in Korea');
  ok('Korean address → Kakao as before');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'no overflow');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
