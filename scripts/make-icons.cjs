// Draws the app icon (black / white / purple) and writes every size the web
// app and the Android app need. Run: node scripts/make-icons.cjs
// The artwork lives in a 100×100 box; `pad` extends the sky and hills
// outwards so shapes that a launcher crops (maskable / adaptive) stay full.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'android/app/src/main/res');

function art(pad = 0, { rx = 0, bg = true } = {}) {
  const a = -pad, s = 100 + pad * 2, e = 100 + pad;
  // aurora palette on white: #3B82F6 · #60A5FA · #A78BFA · #FBCFE8
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a} ${a} ${s} ${s}">
  <defs>
    <clipPath id="c"><rect x="${a}" y="${a}" width="${s}" height="${s}" rx="${rx}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    ${bg ? `<rect x="${a}" y="${a}" width="${s}" height="${s}" fill="#FFFFFF"/>` : ''}
    <circle cx="60" cy="43" r="15" fill="#A78BFA"/>
    <path d="M${a} 66 Q36 50 ${e} 60 V${e} H${a} Z" fill="#60A5FA"/>
    <path d="M${a} 80 Q56 62 ${e} 76 V${e} H${a} Z" fill="#3B82F6"/>
    <path d="M30 92 Q52 78 74 71" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 7"/>
  </g>
</svg>`;
}

function splash(w, h) {
  const icon = Math.round(Math.min(w, h) * 0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#FFFFFF"/>
  <g transform="translate(${(w - icon) / 2} ${(h - icon) / 2})">
    <svg width="${icon}" height="${icon}">${art(0, { rx: 22 }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
  </g>
</svg>`.replace('<svg width', `<svg viewBox="0 0 100 100" width`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(svg, w, h, out, transparent = false) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: transparent });
  }

  // Web / PWA
  fs.writeFileSync(path.join(ROOT, 'public/favicon.svg'), art(0, { rx: 22 }).replace(/\n\s*/g, ''));
  await render(art(0, { rx: 22 }), 192, 192, path.join(ROOT, 'public/icons/icon-192.png'), true);
  await render(art(0, { rx: 22 }), 512, 512, path.join(ROOT, 'public/icons/icon-512.png'), true);
  await render(art(12), 512, 512, path.join(ROOT, 'public/icons/icon-maskable-512.png'));
  await render(art(0), 180, 180, path.join(ROOT, 'public/icons/apple-touch-icon.png'));
  await render(art(0), 1024, 1024, path.join(ROOT, 'resources/icon-1024.png'));

  // Android launcher icons
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, px] of Object.entries(dens)) {
    await render(art(0, { rx: 18 }), px, px, `${RES}/mipmap-${d}/ic_launcher.png`, true);
    await render(art(0, { rx: 50 }), px, px, `${RES}/mipmap-${d}/ic_launcher_round.png`, true);
    // adaptive: 108dp layer, centre 72dp visible → the 100-unit art spans 2/3
    await render(art(25), Math.round(px * 2.25), Math.round(px * 2.25), `${RES}/mipmap-${d}/ic_launcher_foreground.png`);
  }
  fs.writeFileSync(`${RES}/values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n');

  // Android splash images, same sizes Capacitor generated
  const splashes = {
    drawable: [480, 320],
    'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
    'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
    'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
  };
  for (const [dir, [w, h]] of Object.entries(splashes)) await render(splash(w, h), w, h, `${RES}/${dir}/splash.png`);

  await browser.close();
  console.log('icons written');
})().catch((e) => { console.error(e); process.exit(1); });
