const { chromium, devices } = require('playwright');
const { launch, OUT, ROOT } = require('./env.cjs');
const fs = require('fs');
const { createBackend, wire, signUp, setArea, until } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const IMG = fs.readFileSync(ROOT + '/public/icons/icon-512.png');
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const photos = [
  { url: 'https://photo.test/p0.png', site: '블로그 p0', link: 'https://b/p0', relevant: true },
  { url: 'https://photo.test/p1.png', site: '블로그 p1', link: 'https://b/p1', relevant: true },
  { url: 'https://photo.test/p2.png', site: '블로그 p2', link: 'https://b/p2', relevant: false },
  { url: 'https://photo.test/p3.png', site: '블로그 p3', link: 'https://b/p3', relevant: false },
];
const backend = createBackend({ photos });
const errors = [];
const shown = (p) => p.getAttribute('.destination-visual .photo', 'src');

async function openAs(browser, email, targetPlace) {
  const c = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(c, backend, { errors });
  await c.route('https://photo.test/**', (r) => r.fulfill({ contentType: 'image/png', body: IMG }));
  const p = await c.newPage();
  await p.goto(APP);
  await signUp(p, email, 'password-123');
  await setArea(p);
  await p.click('[data-action="start"]');
  await p.waitForSelector('#discover-title');
  if (targetPlace) {
    for (let i = 0; i < 60 && (await p.textContent('#discover-title')) !== targetPlace; i += 1) {
      await p.click('[data-action="another"]');
    }
    assert((await p.textContent('#discover-title')) === targetPlace, 'reached same place');
  }
  await p.waitForSelector('.destination-visual.has-photo');
  return { c, p };
}

(async () => {
  const browser = await launch();
  const A = await openAs(browser, 'a@test.com');
  const place = await A.p.textContent('#discover-title');
  assert(backend.fnBodies.at(-1).name === place, 'function receives the place name: ' + JSON.stringify(backend.fnBodies.at(-1)));
  assert((await shown(A.p)).endsWith('p0.png'), 'p0 first');
  assert((await A.p.textContent('.photo-credit')).includes(`‘${place}’을(를) 다룬 글에 실린 사진`), 'relevant credit');
  ok('A: function gets the place name; first photo is from a post titled with it; credit says so');

  await A.p.click('.gallery-reject');
  await A.p.waitForFunction(() => document.querySelector('.gallery-count').textContent === '1 / 3');
  assert((await shown(A.p)).endsWith('p1.png'), 'A no longer sees p0');
  await A.p.click('.gallery-next');
  await A.p.waitForFunction(() => document.querySelector('.destination-visual .photo').src.endsWith('p2.png'));
  await A.p.click('.gallery-pin');
  const idA = backend.accounts.get('a@test.com').id;
  await until(() => [...backend.votes.keys()].filter((k) => k.endsWith('|' + idA)).length >= 2, 8000, 'A votes stored');
  const votesA = [...backend.votes].filter(([k]) => k.endsWith('|' + backend.accounts.get('a@test.com').id)).map(([k, v]) => k.split('|')[1].split('/').pop() + ':' + v);
  assert(votesA.includes('p0.png:-1') && votesA.includes('p2.png:1'), 'votes stored ' + votesA);
  await A.p.reload(); await A.p.waitForSelector('.destination-visual.has-photo');
  assert((await shown(A.p)).endsWith('p2.png'), 'A pin survives reload');
  ok('A: "아니에요" hides p0 at once (1/3), pin p2 → votes', votesA.join(' '), '; pin kept after reload');

  const B = await openAs(browser, 'b@test.com', place);
  assert((await shown(B.p)).endsWith('p2.png'), 'B sees community pick first');
  assert((await B.p.textContent('.photo-credit')).includes('다른 사람들이'), 'community credit');
  assert((await B.p.textContent('.gallery-count')) === '1 / 4', 'B still has p0 (score -1)');
  ok('B: community pick p2 shown first with "다른 사람들이 고른 사진"; p0 still there (one down-vote isn’t enough)');

  await B.p.click('.gallery-prev'); // p0 (score -1) sorts last → wrap back to it
  await B.p.waitForFunction(() => document.querySelector('.destination-visual .photo').src.endsWith('p0.png'));
  const idB = () => backend.accounts.get('b@test.com').id;
  await B.p.click('.gallery-reject');
  await until(() => [...backend.votes.keys()].some((k) => k.endsWith('|' + idB()) && k.includes('p0.png')), 8000, 'B vote stored');

  const C = await openAs(browser, 'c@test.com', place);
  const urls = await C.p.evaluate((id) => JSON.parse(localStorage.getItem('plannish-photos'))[id].photos.map((x) => x.url.split('/').pop()), [...backend.votes.keys()][0].split('|')[0]);
  assert(!urls.includes('p0.png') && urls[0] === 'p2.png', 'C: p0 hidden for everyone ' + urls);
  ok('C: after two down-votes p0 is hidden for everyone; order', urls.join(' > '));

  // votes can't inject an image the search didn't return
  backend.votes.set(`${[...backend.votes.keys()][0].split('|')[0]}|https://evil.test/x.png|user-9`, 1);
  backend.votes.set(`${[...backend.votes.keys()][0].split('|')[0]}|https://evil.test/x.png|user-8`, 1);
  const D = await openAs(browser, 'd@test.com', place);
  const urlsD = await D.p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('plannish-photos'))).flatMap((e) => (e.photos || []).map((x) => x.url)));
  assert(!urlsD.some((u) => u.includes('evil.test')), 'no injected image');
  ok('D: up-voting an outside image URL does not make it appear');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
