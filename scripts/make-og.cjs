// Link-preview image (public/og.png, 1200×630) for KakaoTalk, Slack, etc.
// node scripts/make-og.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const font = (w) => fs.readFileSync(path.join(ROOT, `node_modules/pretendard/dist/web/static/woff2/Pretendard-${w}.woff2`)).toString('base64');
const logo = fs.readFileSync(path.join(ROOT, 'public/favicon.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: P; font-weight: 800; src: url(data:font/woff2;base64,${font('ExtraBold')}) format('woff2'); }
    @font-face { font-family: P; font-weight: 500; src: url(data:font/woff2;base64,${font('Medium')}) format('woff2'); }
    html, body { margin: 0; width: 1200px; height: 630px; }
    body { font-family: P; background: #fff; display: grid; place-items: center; position: relative; overflow: hidden; }
    .glow { position: absolute; inset: -20%; background:
      radial-gradient(40% 50% at 15% 20%, rgba(59,130,246,.22), transparent 70%),
      radial-gradient(35% 45% at 85% 25%, rgba(167,139,250,.22), transparent 70%),
      radial-gradient(45% 50% at 70% 95%, rgba(251,207,232,.45), transparent 70%); }
    .card { position: relative; display: flex; align-items: center; gap: 56px; }
    .logo { width: 220px; height: 220px; filter: drop-shadow(0 18px 40px rgba(59,130,246,.25)); }
    h1 { margin: 0; font-size: 104px; font-weight: 800; letter-spacing: -0.04em; color: #0f172a; }
    p { margin: 18px 0 0; font-size: 36px; font-weight: 500; color: #475569; letter-spacing: -0.02em; }
  </style></head><body><div class="glow"></div><div class="card">
    <div class="logo">${logo.replace('<svg ', '<svg width="220" height="220" ')}</div>
    <div><h1>계획 있는 척</h1><p>계획 없는 날, 문을 나설 작은 이유</p></div>
  </div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(ROOT, 'public/og.png') });
  await browser.close();
  console.log('public/og.png');
})();
