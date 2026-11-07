const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea } = require('./helpers.cjs');
const fs = require('fs');
const FAKE = fs.readFileSync(__dirname + '/fake-kakao.js', 'utf8');
const IMG = { a: fs.readFileSync(ROOT + '/public/icons/icon-512.png'), b: fs.readFileSync(ROOT + '/brand/app-icon-256.png') };
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const photos = ['p0', 'blocked', 'p2', 'p3'].map((k) => ({ url: `https://photo.test/${k}.png`, thumb: k === 'blocked' ? 'https://photo.test/blocked-thumb.png' : null, site: '블로그 ' + k, link: 'https://blog.test/' + k, relevant: true }));

async function setup(browser, opts) {
  const c = await browser.newContext({ reducedMotion: 'reduce', ...opts });
  const backend = createBackend({ photos });
  await wire(c, backend);
  await c.route('https://photo.test/**', (r) => (r.request().url().includes('blocked') ? r.fulfill({ status: 403, body: '' }) : r.fulfill({ contentType: 'image/png', body: r.request().url().includes('p2') ? IMG.b : IMG.a })));
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://localhost:4175/');
  await signUp(p);
  await setArea(p);
  await p.click('text=오늘 시작하기'); await p.waitForSelector('#discover-title');
  await p.waitForSelector('.destination-visual.has-photo');
  return { c, p, errors };
}
const title = (p) => p.textContent('#discover-title');

(async () => {
  const browser = await launch();

  // ---------- desktop: gallery + mouse swipe ----------
  const D = await setup(browser, { viewport: { width: 1280, height: 860 } });
  let p = D.p;
  assert((await p.textContent('.gallery-count')) === '1 / 4', 'count 1/4');
  assert((await p.textContent('.gallery-pin')).includes('대표 사진'), 'first is pinned by default');
  await p.click('.gallery-next');
  await p.waitForFunction(() => document.querySelector('.gallery-count').textContent === '2 / 3');
  assert((await p.getAttribute('.destination-visual .photo', 'src')).endsWith('p2.png'), 'blocked skipped to p2');
  assert((await p.textContent('.photo-credit')).includes('블로그 p2'), 'credit follows photo');
  ok('gallery: ‹ › flips; hotlink-blocked candidate dropped (1/4 → 2/3); credit follows the photo');
  await p.click('.gallery-pin');
  assert((await p.getAttribute('.gallery-pin', 'aria-pressed')) === 'true', 'pinned');
  const pinnedPlace = await title(p);
  await p.reload(); await p.waitForSelector('.destination-visual.has-photo');
  assert((await p.getAttribute('.destination-visual .photo', 'src')).endsWith('p2.png'), 'pin survives reload');
  ok('pin "이 사진으로 정하기" survives reload');

  // small drag snaps back
  const fig = await p.locator('.destination-figure').boundingBox();
  const cx = fig.x + fig.width / 2, cy = fig.y + fig.height / 3;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 40, cy, { steps: 5 }); await p.mouse.up();
  assert((await title(p)) === pinnedPlace, 'small drag no change');
  // drag on text with mouse does nothing (text selectable)
  const body = await p.locator('.destination-body .description').boundingBox();
  await p.mouse.move(body.x + 10, body.y + 5); await p.mouse.down(); await p.mouse.move(body.x - 300, body.y + 5, { steps: 8 }); await p.mouse.up();
  assert((await title(p)) === pinnedPlace, 'mouse drag on text ignored');
  // swipe left on photo
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 260, cy + 10, { steps: 10 }); await p.mouse.up();
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent !== t, pinnedPlace);
  ok('mouse: short drag springs back, drag on text ignored, swipe left on photo → 다른 곳:', await title(p));
  // gallery buttons don't start a swipe
  const before = await title(p);
  await p.click('.gallery-next');
  assert((await title(p)) === before, 'gallery button not a swipe');
  // swipe right → the previous card again
  const fig2 = await p.locator('.destination-figure').boundingBox();
  await p.mouse.move(fig2.x + fig2.width / 2, fig2.y + 100); await p.mouse.down(); await p.mouse.move(fig2.x + fig2.width / 2 + 260, fig2.y + 100, { steps: 10 }); await p.mouse.up();
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent === t, pinnedPlace);
  ok('swipe right on photo → back to the previous card:', pinnedPlace);
  // at the first card, swiping right again just springs back
  const fig3 = await p.locator('.destination-figure').boundingBox();
  await p.mouse.move(fig3.x + fig3.width / 2, fig3.y + 100); await p.mouse.down(); await p.mouse.move(fig3.x + fig3.width / 2 + 260, fig3.y + 100, { steps: 10 }); await p.mouse.up();
  await p.waitForSelector('#toast:has-text("첫 카드")');
  assert((await title(p)) === pinnedPlace, 'still the first card');
  // swipe down on the photo → kept in the envelope, next card shows
  const kept = await title(p);
  const fig4 = await p.locator('.destination-figure').boundingBox();
  await p.mouse.move(fig4.x + fig4.width / 2, fig4.y + 60); await p.mouse.down(); await p.mouse.move(fig4.x + fig4.width / 2, fig4.y + 260, { steps: 10 }); await p.mouse.up();
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent !== t, kept);
  await p.waitForSelector('[data-envelope-count]:has-text("1")');
  await p.goto('http://localhost:4175/#route');
  assert((await p.textContent('.stop-name')).includes(kept), 'kept place is in the route');
  ok('swipe down → into the envelope (count 1), next card shows; kept place is in 경로:', kept);
  await p.waitForSelector('.stop-visual.has-photo');
  ok('route thumbnail shows a photo');
  await D.c.close();

  // ---------- phone: real touch via CDP ----------
  const M = await setup(browser, { ...devices['iPhone 13'] });
  p = M.p;
  const cdp = await M.c.newCDPSession(p);
  const touch = async (points) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
    for (const [x, y] of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  assert(await p.isVisible('.swipe-tip'), 'tip on touch device');
  const t0 = await title(p);
  const desc = await p.locator('.destination-body .description').boundingBox();
  const y0 = await p.evaluate(() => scrollY);
  await touch([[200, 600], [198, 560], [196, 500], [195, 420], [195, 380]]);
  await p.waitForTimeout(400);
  assert((await title(p)) === t0, 'vertical touch no swipe');
  ok('touch: vertical drag scrolls (scrollY', y0, '→', await p.evaluate(() => scrollY), ') without swiping');
  await p.evaluate(() => scrollTo(0, 0));
  // swipe across the top of the photo (clear of its buttons), wherever the layout puts it
  const sy = Math.round((await p.locator('.destination-visual').boundingBox()).y + 60);
  await touch([[300, sy], [280, sy + 2], [220, sy + 5], [140, sy + 6], [60, sy + 8]]);
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent !== t, t0);
  assert(!(await p.isVisible('.swipe-tip')), 'tip hidden after learning');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'no horizontal overflow');
  ok('touch: swipe left anywhere on card → 다른 곳; tip disappears; no sideways scroll');
  await p.evaluate(() => scrollTo(0, 0));
  const sy2 = Math.round((await p.locator('.destination-visual').boundingBox()).y + 60);
  await touch([[80, sy2], [100, sy2], [180, sy2 + 2], [260, sy2 + 4], [340, sy2 + 5]]);
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent === t, t0);
  ok('touch: swipe right → previous card');
  const before2 = await title(p);
  const sy3 = Math.round((await p.locator('.destination-visual').boundingBox()).y + 40);
  await touch([[195, sy3], [195, sy3 + 30], [196, sy3 + 90], [196, sy3 + 160], [197, sy3 + 220]]);
  await p.waitForFunction((t) => document.querySelector('#discover-title')?.textContent !== t, before2);
  await p.waitForSelector('[data-envelope-count]:has-text("1")');
  ok('touch: swipe down → kept in the envelope');

  const errs = [...D.errors, ...M.errors];
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
  if (errs.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
