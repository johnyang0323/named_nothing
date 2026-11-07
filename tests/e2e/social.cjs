const { chromium, devices } = require('playwright');
const { launch } = require('./env.cjs');
const { createBackend, wire, signUp, setArea, until, goHere } = require('./helpers.cjs');
const APP = 'http://localhost:4175/';
const ok = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await launch();
  const backend = createBackend();
  const S = backend.social;
  const errors = [];
  const person = async (email) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
    await wire(ctx, backend, { errors });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept()); // confirm() for report / block / delete
    return { ctx, page, email };
  };
  const idOf = (email) => backend.accounts.get(email).id;
  const isFriendNow = () => S.friendships.some((f) => f.user_id === idOf('a@test.com') && f.friend_id === idOf('b@test.com'));

  // a JPEG that carries GPS EXIF, like a phone photo
  const A = await person('a@test.com');
  await A.page.goto(APP);
  const photo = Buffer.from(
    await A.page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 1800;
      const g = c.getContext('2d');
      g.fillStyle = '#78816A'; g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = '#D9BFA9'; g.beginPath(); g.arc(1200, 900, 500, 0, 7); g.fill();
      const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
      const payload = new TextEncoder().encode('Exif\0\0GPSLatitude 37.5563 GPSLongitude 126.9223');
      const app1 = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
      return [...jpg.slice(0, 2), ...app1, ...jpg.slice(2)];
    }),
  );
  assert(photo.includes('GPSLatitude'), 'test photo carries GPS');
  const file = (name) => ({ name, mimeType: 'image/jpeg', buffer: photo });

  // ── A: profile ──
  await signUp(A.page, 'a@test.com', 'password-a1');
  await A.page.goto(APP + '#account');
  await A.page.waitForSelector('#nickname');
  assert((await A.page.inputValue('#nickname')) === 'a', 'default nickname from email');
  await A.page.fill('#nickname', '산책하는A');
  await A.page.setInputFiles('[data-input="avatar-file"]', file('me.jpg'));
  await A.page.waitForSelector('.profile .avatar-img');
  await A.page.click('[data-form="profile"] button[type=submit]');
  await until(() => S.profiles.get(idOf('a@test.com'))?.nickname === '산책하는A', 5000, 'profile saved');
  const profA = S.profiles.get(idOf('a@test.com'));
  assert(/^\d{5}$/.test(profA.tag) && profA.avatar_path?.startsWith(idOf('a@test.com') + '/'), 'tag + avatar ' + JSON.stringify(profA));
  const avatarFile = S.files.get('avatars/' + profA.avatar_path);
  assert(avatarFile && !avatarFile.includes('GPSLatitude') && !avatarFile.includes('Exif'), 'avatar stripped of EXIF/GPS');
  await A.page.waitForSelector('[data-account-button] .avatar-img');
  assert((await A.page.textContent('.tag-text')) === `산책하는A#${profA.tag}`, 'my tag shown');
  ok(`profile: nickname + photo saved (photo resized, EXIF/GPS removed), header shows it, tag 산책하는A#${profA.tag}`);

  // ── B: profile, then add A by tag ──
  const B = await person('b@test.com');
  await B.page.goto(APP);
  await signUp(B.page, 'b@test.com', 'password-b1');
  await B.page.goto(APP + '#account');
  await B.page.waitForSelector('#nickname');
  await B.page.fill('#nickname', '비');
  await B.page.click('[data-form="profile"] button[type=submit]');
  await until(() => S.profiles.get(idOf('b@test.com'))?.nickname === '비', 5000, 'B profile');
  await B.page.goto(APP + '#together');
  await B.page.waitForSelector('#friend-tag');
  await B.page.fill('#friend-tag', `산책하는A#${profA.tag === '99999' ? '11111' : '99999'}`);
  await B.page.click('[data-form="friend-add"] button[type=submit]');
  await B.page.waitForSelector('.add-friend .area-error');
  await B.page.fill('#friend-tag', `산책하는A#${profA.tag}`);
  await B.page.click('[data-form="friend-add"] button[type=submit]');
  await B.page.waitForSelector('text=친구 요청을 보냈어요');
  await B.page.waitForSelector('#sent-title');
  assert(!isFriendNow(), 'not friends before A accepts');
  // A sees the request (badge on 함께, inbox) and accepts it
  await A.page.goto(APP + '#together');
  await A.page.waitForSelector('#requests-title');
  await A.page.click('[data-action="together-tab"][data-tab="inbox"]');
  await A.page.waitForSelector('.note-text:has-text("비님이 친구 요청을 보냈어요")');
  await A.page.click('#requests-title ~ .people [data-action="request-accept"]');
  await A.page.waitForSelector('text=친구가 됐어요');
  assert(isFriendNow(), 'friends after accepting');
  await B.page.reload();
  await B.page.waitForSelector('.person-name:has-text("산책하는A")');
  await B.page.click('[data-action="together-tab"][data-tab="inbox"]');
  await B.page.waitForSelector('.note-text:has-text("산책하는A님과 친구가 됐어요")');
  ok('friends: wrong tag refused; exact tag sends a request; A accepts from the inbox; B is told');

  // ── A: journal entry with photos, shared with friends; plus a private one ──
  await setupDay(A.page);
  await A.page.goto(APP + '#day');
  await A.page.click('[data-action="editor-open"]');
  await A.page.fill('#entry-note', '창가 자리에서 한참 앉아 있었다');
  await A.page.setInputFiles('[data-input="entry-files"]', [file('1.jpg'), file('2.jpg')]);
  await A.page.waitForSelector('.editor-photo img[src^="blob:"] >> nth=1');
  await A.page.click('.budget-chip:has-text("친구에게")');
  await A.page.click('[data-form="entry-save"] button[type=submit]');
  await until(() => [...S.entries.values()].some((e) => e.note.startsWith('창가')), 8000, 'entry saved');
  const shared = [...S.entries.values()].find((e) => e.note.startsWith('창가'));
  assert(shared.visibility === 'friends' && shared.photo_paths.length === 2, 'shared entry ' + JSON.stringify(shared));
  for (const p of shared.photo_paths) {
    const f = S.files.get('journal/' + p);
    assert(f && f[0] === 0xff && f[1] === 0xd8 && !f.includes('Exif') && !f.includes('GPSLatitude'), 'journal photo is a clean JPEG');
  }
  await A.page.waitForFunction(() => [...document.querySelectorAll('.entry img[data-journal-photo]')].filter((i) => i.complete && i.naturalWidth > 0).length >= 2);
  ok('journal: note + 2 photos saved as clean JPEGs (no EXIF/GPS); photos load through signed links');

  // private entry on another visited place
  await A.page.click('[data-action="editor-open"] >> nth=0');
  await A.page.fill('#entry-note', '나만 아는 기록');
  await A.page.click('[data-form="entry-save"] button[type=submit]');
  await until(() => [...S.entries.values()].some((e) => e.note === '나만 아는 기록'), 8000, 'private entry');
  assert([...S.entries.values()].find((e) => e.note === '나만 아는 기록').visibility === 'private', 'default is 나만 보기');

  // ── B sees only the shared one, comments ──
  await B.page.goto(APP + '#together');
  await B.page.reload();
  await B.page.waitForSelector('.entry-note:has-text("창가 자리에서")');
  assert(!(await B.page.isVisible('text=나만 아는 기록')), 'private stays private');
  await B.page.waitForFunction(() => [...document.querySelectorAll('.entry img[data-journal-photo]')].some((i) => i.complete && i.naturalWidth > 0));
  await B.page.fill('.comment-form input', '저도 가보고 싶어요!');
  await B.page.click('.comment-form button[type=submit]');
  await B.page.waitForSelector('.comment-body:has-text("저도 가보고 싶어요!")');
  await B.page.click('.entry .reaction[data-emoji="❤️"]');
  await B.page.waitForSelector('.entry .reaction.is-on[data-emoji="❤️"] .reaction-count:has-text("1")');
  ok('friend B sees the shared entry with photos, not the private one; comments and reacts ❤️');

  await A.page.goto(APP + '#day');
  await A.page.reload();
  await A.page.waitForSelector('.comment-body:has-text("저도 가보고 싶어요!")');
  await A.page.waitForSelector('.reaction[data-emoji="❤️"] .reaction-count:has-text("1")');
  await A.page.waitForSelector('.app-tabbar [data-inbox-count]');
  await A.page.goto(APP + '#together');
  await A.page.click('[data-action="together-tab"][data-tab="inbox"]');
  await A.page.waitForSelector('.note-text:has-text("비님이 내 기록에 댓글을 남겼어요")');
  await A.page.waitForSelector('.note-text:has-text("비님이 내 기록에 ❤️")');
  await A.page.waitForFunction(() => !document.querySelector('.app-tabbar [data-inbox-count]'));
  ok('A sees B’s comment and ❤️ on 나의 하루; inbox lists both, the 함께 badge clears once opened');

  // ── groups ──
  await A.page.goto(APP + '#together');
  await A.page.click('[data-action="together-tab"][data-tab="groups"]');
  await A.page.fill('#group-name', '주말 산책 모임');
  await A.page.click('[data-form="group-create"] button[type=submit]');
  await A.page.waitForSelector('.group-title:has-text("주말 산책 모임")');
  const group = [...S.groups.values()].find((g) => g.name === '주말 산책 모임');
  // C joins by link before signing in
  const C = await person('c@test.com');
  await C.page.goto(`${APP}?group=${group.invite_code}`);
  await C.page.waitForSelector('.welcome');
  await signUp(C.page, 'c@test.com', 'password-c1');
  await C.page.waitForSelector('.invite-banner');
  assert((await C.page.textContent('.invite-banner')).includes(group.invite_code), 'invite banner after sign-up');
  await C.page.click('[data-action="invite-accept"]');
  await C.page.waitForSelector('.group-title:has-text("주말 산책 모임")');
  ok('group: A creates "주말 산책 모임"; C opens the invite link, signs up, confirms and is in');

  // A posts to the group
  await A.page.goto(APP + '#day');
  await A.page.click('[data-action="entry-edit"] >> nth=0');
  await A.page.click('.budget-chip:has-text("단체방에")');
  await A.page.waitForSelector('#entry-group');
  await A.page.click('[data-form="entry-save"] button[type=submit]');
  await until(() => [...S.entries.values()].some((e) => e.visibility === 'group' && e.group_id === group.id), 8000, 'posted to group');
  await C.page.click('[data-action="together-tab"][data-tab="friends"]');
  await C.page.click('[data-action="together-tab"][data-tab="groups"]');
  await C.page.waitForSelector('.group-title');
  await C.page.click('[data-action="group-back"]').catch(() => {});
  await C.page.click(`[data-action="group-open"][data-id="${group.id}"]`);
  await C.page.waitForSelector('#group-feed-title ~ .entries .entry');
  await C.page.fill('.comment-form input', '다음엔 같이 가요');
  await C.page.click('.comment-form button[type=submit]');
  await C.page.waitForSelector('.comment-body:has-text("다음엔 같이 가요")');
  ok('A posts an entry to the group; member C reads it and comments');

  // A (owner) removes C's comment; C reports A's entry
  await A.page.goto(APP + '#together');
  await A.page.reload();
  await A.page.click('[data-action="together-tab"][data-tab="groups"]');
  await A.page.click(`[data-action="group-open"][data-id="${group.id}"]`);
  await A.page.waitForSelector('.comment-body:has-text("다음엔 같이 가요")');
  await A.page.click('.comment:has-text("다음엔 같이 가요") [data-action="comment-delete"]');
  await until(() => ![...S.comments.values()].some((c) => c.body === '다음엔 같이 가요'), 5000, 'owner removed comment');
  await C.page.reload();
  await C.page.click('[data-action="together-tab"][data-tab="groups"]');
  await C.page.click(`[data-action="group-open"][data-id="${group.id}"]`);
  await C.page.waitForSelector('.entry [data-action="report"][data-type="entry"]');
  await C.page.click('.entry [data-action="report"][data-type="entry"]');
  await until(() => S.reports.some((r) => r.target_type === 'entry'), 5000, 'report stored');
  ok('moderation: group owner deletes a member’s comment; member reports an entry');

  // A finds an older private entry and posts it to the room from inside the room
  await A.page.click('[data-action="group-pick-open"]');
  await A.page.waitForSelector('.pick-item');
  await A.page.fill('.pick-search', '나만 아는');
  await A.page.waitForFunction(() => document.querySelectorAll('.pick-item').length === 1);
  assert((await A.page.textContent('.pick-item')).includes('나만 보기'), 'shows where it is shared now');
  await A.page.click('.pick-item [data-action="group-pick"]');
  await until(() => [...S.entries.values()].some((e) => e.note === '나만 아는 기록' && e.visibility === 'group' && e.group_id === group.id), 8000, 'picked entry posted');
  await A.page.waitForSelector('#group-feed-title ~ .entries .entry:has-text("나만 아는 기록")');
  await A.page.click('[data-action="group-pick-open"]');
  await A.page.waitForSelector('.pick-item.is-here:has-text("나만 아는 기록")');
  await A.page.click('[data-action="group-pick-close"]');
  await C.page.reload();
  await C.page.click('[data-action="together-tab"][data-tab="groups"]');
  await C.page.click(`[data-action="group-open"][data-id="${group.id}"]`);
  await C.page.waitForSelector('.entry:has-text("나만 아는 기록")');
  ok('group: A searches their own entries inside the room and posts one; C sees it');

  // ── B blocks A ──
  await B.page.goto(APP + '#together');
  await B.page.reload();
  await B.page.waitForSelector('.person-name:has-text("산책하는A")');
  await B.page.click('[data-action="friend-block"]');
  await B.page.waitForSelector('text=아직 친구가 없어요');
  assert(!(await B.page.isVisible('text=창가 자리에서')), 'blocked user’s entries hidden');
  assert(!S.friendships.some((f) => f.user_id === idOf('b@test.com')), 'friendship removed');
  ok('block: friendship removed and their entries disappear for B');

  // ── A deletes the account: photos and data go too ──
  const aId = idOf('a@test.com');
  await A.page.goto(APP + '#account');
  await A.page.click('[data-action="delete-account"]');
  await A.page.click('[data-action="delete-account-confirm"]');
  await A.page.waitForSelector('.welcome');
  assert(![...S.files.keys()].some((k) => k.split('/')[1] === aId), 'A’s photos deleted');
  assert(![...S.entries.values()].some((e) => e.user_id === aId) && !S.profiles.has(aId) && !S.groups.has(group.id), 'A’s entries, profile and owned group deleted');
  ok('account deletion removes profile, entries, photos and owned groups');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);

  async function setupDay(page) {
    await page.goto(APP + '#home');
    await setArea(page);
    await page.click('[data-action="start"]');
    await page.waitForSelector('#discover-title');
    await goHere(page);
    await page.waitForSelector('#explore-title');
    await page.click('[data-action="toggle-current-visited"]');
    await page.locator('[data-action="add"]').first().click();
    await page.goto(APP + '#route');
    await page.waitForSelector('.stop');
    const unvisited = page.locator('.stop:not(.is-visited) [data-action="toggle-visited"]');
    if (await unvisited.count()) await unvisited.first().click();
  }
})().catch((e) => { console.error(e); process.exit(1); });
