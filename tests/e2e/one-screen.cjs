// Does each home step fit on one screen (no vertical scroll) at common sizes?
const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea } = require('./helpers.cjs');
(async () => {
  const b = await launch();
  const failures = [];
  const sizes = [['iPhone SE', devices['iPhone SE']], ['iPhone 13', devices['iPhone 13']], ['Galaxy S9+', devices['Galaxy S9+']], ['laptop 1366x768', { viewport: { width: 1366, height: 768 } }], ['desktop 1920x1080', { viewport: { width: 1920, height: 1080 } }]];
  for (const [name, d] of sizes) {
    const c = await b.newContext({ ...d, reducedMotion: 'reduce' });
    await wire(c, createBackend());
    const p = await c.newPage();
    await p.goto('http://localhost:4175/');
    await signUp(p);
    await p.waitForSelector('.home-place .area-map[data-fake-map]');
    const m = async () => p.evaluate(() => ({ scroll: document.documentElement.scrollHeight - innerHeight, map: Math.round(document.querySelector('.area-map-wrap')?.getBoundingClientRect().height || 0), wide: document.documentElement.scrollWidth > innerWidth }));
    const one = await m();
    const tag = name.replace(/\W+/g, '-');
    await p.screenshot({ path: `${OUT}/fit-${tag}-1.png` });
    await setArea(p);
    const two = await p.evaluate(() => ({ scroll: document.documentElement.scrollHeight - innerHeight, wide: document.documentElement.scrollWidth > innerWidth }));
    await p.screenshot({ path: `${OUT}/fit-${tag}-2.png` });
    if (one.scroll > 0 || two.scroll > 0 || one.wide || two.wide) failures.push(name);
    console.log(`${name.padEnd(18)} ${d.viewport.width}x${d.viewport.height} | step1 overflow ${one.scroll}px, map ${one.map}px | step2 overflow ${two.scroll}px | sideways ${one.wide || two.wide}`);
    await c.close();
  }
  await b.close();
  if (failures.length) {
    console.error('home steps do not fit one screen on:', failures.join(', '));
    process.exit(1);
  }
  console.log('errors: none');
})().catch((e) => { console.error(e); process.exit(1); });
