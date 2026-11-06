// Place photos: no random search pictures, a link to Kakao Map's photos, and
// photos people took there and chose to share ("장소 사진으로 함께 보여주기").
const { devices } = require('playwright');
const fs = require('fs');
const { launch, ROOT } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const IMG = fs.readFileSync(ROOT + '/public/icons/icon-512.png');
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

const photos = [
  { url: 'https://photo.test/about.png', site: '블로그', link: 'https://b/about', relevant: true },
  { url: 'https://photo.test/random.png', site: '쇼핑몰', link: 'https://b/random', relevant: false },
];

(async () => {
  const browser = await launch();
  const backend = createBackend({ photos });
  const S = backend.social;
  const errors = [];
  const person = async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
    await wire(ctx, backend, { errors });
    await ctx.route('https://photo.test/**', (r) => r.fulfill({ contentType: 'image/png', body: IMG }));
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    return page;
  };
  const shown = (p) => p.getAttribute('.destination-visual .photo', 'src');

  // ── A visits a place and shares a photo of it ──
  const A = await person();
  await A.goto(APP);
  await signUp(A, 'a@test.com', 'password-a1');
  await A.goto(APP + '#account');
  await A.waitForSelector('#nickname');
  await A.fill('#nickname', '찍는사람');
  await A.click('[data-form="profile"] button[type=submit]');
  await until(() => [...S.profiles.values()].some((p) => p.nickname === '찍는사람'), 5000, 'A profile');

  await A.goto(APP + '#home');
  await setArea(A);
  await A.click('[data-action="start"]');
  await A.waitForSelector('.destination-visual.has-photo');
  const place = await A.textContent('#discover-title');
  assert((await shown(A)).endsWith('about.png'), 'post-titled photo shown');
  assert((await A.textContent('.gallery-count')) === '1 / 1' || (await A.locator('.gallery-count').isHidden()), 'random search photo left out');
  const link = await A.getAttribute('.kakao-photos-link', 'href');
  assert(link && link.startsWith('https://place.map.kakao.com/'), 'link to the place on Kakao Map: ' + link);
  ok(`search: only the photo from a post about "${place}" is shown, the unrelated one is not; "카카오맵에서 실제 사진 보기" → ${link}`);

  await A.click('[data-action="go"]');
  await A.waitForSelector('#explore-title');
  await A.click('[data-action="toggle-current-visited"]');
  await A.goto(APP + '#day');
  await A.click('[data-action="editor-open"]');
  assert(!(await A.locator('[data-input="entry-share-place"]').count()), 'no share switch before a photo is added');
  await A.fill('#entry-note', '비밀 메모: 다른 사람은 못 봐요');
  await A.setInputFiles('[data-input="entry-files"]', { name: 'mine.png', mimeType: 'image/png', buffer: IMG });
  await A.waitForSelector('[data-input="entry-share-place"]');
  assert(!(await A.isChecked('[data-input="entry-share-place"]')), 'off by default');
  await A.click('.share-place');
  assert(await A.isChecked('[data-input="entry-share-place"]'), 'switched on');
  await A.click('[data-form="entry-save"] button[type=submit]');
  await until(() => [...S.entries.values()].some((e) => e.share_place_photos), 8000, 'entry saved with sharing');
  const entry = [...S.entries.values()].find((e) => e.share_place_photos);
  assert(entry.visibility === 'private' && entry.place_name === place && entry.photo_paths.length === 1, 'private entry, shared photo ' + JSON.stringify(entry));
  await A.waitForSelector('.vis-place');
  ok('A: 장소 사진 switch appears once a photo is added (off by default); entry stays 나만 보기, card shows "장소 사진"');

  // ── B, a stranger, sees A's photo first on that place ──
  const B = await person();
  await B.goto(APP);
  await signUp(B, 'b@test.com', 'password-b1');
  await setArea(B);
  await B.click('[data-action="start"]');
  await B.waitForSelector('#discover-title');
  for (let i = 0; i < 60 && (await B.textContent('#discover-title')) !== place; i += 1) await B.click('[data-action="another"]');
  assert((await B.textContent('#discover-title')) === place, 'B reached the same place');
  await B.waitForFunction(() => document.querySelector('.destination-visual .photo')?.src.includes('/object/sign/journal/'));
  const credit = await B.textContent('.photo-credit');
  assert(credit.includes('찍는사람님') && credit.includes('직접 찍어'), 'credited to the nickname: ' + credit);
  assert(!(await B.content()).includes('비밀 메모'), "A's note is not exposed");
  assert((await B.textContent('.gallery-count')) === '1 / 2', 'shared photo + post photo');
  assert(await B.locator('.gallery-pin').isHidden(), 'no "대표 사진" button on someone’s own photo');
  assert((await B.textContent('.gallery-reject')).trim() === '신고', 'report button');
  ok('B (not a friend): A’s photo comes first, credited "찍는사람님", note not shown; 신고 instead of 아니에요');

  await B.click('.gallery-reject');
  await until(() => S.reports.some((r) => r.target_type === 'entry' && r.target_id === entry.id), 5000, 'report stored');
  await B.waitForFunction(() => document.querySelector('.destination-visual .photo')?.src.endsWith('about.png'));
  await B.reload();
  await B.waitForSelector('.destination-visual.has-photo');
  assert((await shown(B)).endsWith('about.png'), 'reported photo stays hidden for B after reload');
  ok('B: 신고 files a report on the entry and hides the photo for B (also after reload)');

  // ── A turns sharing off → gone for everyone ──
  await A.click('[data-action="entry-edit"]');
  await A.click('.share-place');
  await A.click('[data-form="entry-save"] button[type=submit]');
  await until(() => !entry.share_place_photos, 5000, 'sharing off');
  const C = await person();
  await C.goto(APP);
  await signUp(C, 'c@test.com', 'password-c1');
  await setArea(C);
  await C.click('[data-action="start"]');
  await C.waitForSelector('#discover-title');
  for (let i = 0; i < 60 && (await C.textContent('#discover-title')) !== place; i += 1) await C.click('[data-action="another"]');
  await C.waitForSelector('.destination-visual.has-photo');
  assert((await shown(C)).endsWith('about.png') && (await C.locator('.gallery-count').isHidden()), 'only the post photo');
  ok('A switches it off → nobody else sees it any more');

  // ── the photo function exists only under its older name ──
  const old = createBackend({ photos, photoFunction: 'hyper-responder' });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await wire(ctx, old, { errors: [] });
  await ctx.route('https://photo.test/**', (r) => r.fulfill({ contentType: 'image/png', body: IMG }));
  const D = await ctx.newPage();
  await D.goto(APP);
  await signUp(D, 'd@test.com', 'password-d1');
  await setArea(D);
  await D.click('[data-action="start"]');
  await D.waitForSelector('.destination-visual.has-photo');
  const calls = old.log.filter((l) => l.includes('/functions/v1/'));
  assert(calls.some((l) => l.endsWith('/place-photo')) && calls.some((l) => l.endsWith('/hyper-responder')), 'tried both names: ' + calls.join(', '));
  await D.click('[data-action="another"]');
  await D.waitForSelector('.destination-visual.has-photo');
  const later = old.log.filter((l) => l.includes('/functions/v1/')).slice(calls.length);
  assert(later.length && later.every((l) => l.endsWith('/hyper-responder')), 'then sticks with the one that answered: ' + later.join(', '));
  ok('function found under its other name (place-photo → hyper-responder) and remembered');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
