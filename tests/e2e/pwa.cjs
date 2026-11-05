const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const BASE = 'http://localhost:4180/named_nothing/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE);
  const manifestHref = await p.getAttribute('link[rel=manifest]', 'href');
  const manifest = await (await p.request.get(new URL(manifestHref, BASE).href)).json();
  for (const icon of manifest.icons) {
    const r = await p.request.get(new URL(icon.src, new URL(manifestHref, BASE)).href);
    assert(r.ok() && r.headers()['content-type'].includes('png'), 'icon ' + icon.src);
  }
  assert((await p.request.get(BASE + 'icons/apple-touch-icon.png')).ok(), 'apple icon');
  ok('manifest:', manifest.short_name, manifest.display, '| icons load');

  await p.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
  await p.reload();
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  const controlled = await p.evaluate(() => !!navigator.serviceWorker.controller);
  assert(controlled && scope === BASE, 'sw controls ' + scope);
  ok('service worker active, scope', scope);

  await p.click('text=오늘 시작하기');
  await p.click('[data-action="go"]');
  await ctx.setOffline(true);
  await p.goto(BASE + '#route');
  await p.reload();
  assert((await p.locator('.stop').count()) === 1, 'offline route persisted');
  await p.click('a[data-nav="discover"]');
  await p.click('[data-action="another"]');
  ok('works offline after install: route kept, recommendations still run');
  await ctx.setOffline(false);
  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
