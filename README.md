# 계획 있는 것처럼 사는 하루

> Not every day needs a plan. Every day can have a story.

A mobile-first web app for days with no particular plan. It gives you one small reason to step outside, suggests a single first destination, then lets the day unfold through nearby discoveries. You can change, skip or reorder anything, and there's an optional one-line reflection at the end.

**One first destination → discoveries along the way → flexible exploration → optional reflection.**

It isn't a productivity tracker, an itinerary planner or a navigation app. There are no schedules, scores, streaks or badges.

## Screens

| Screen | Route | What it does |
| --- | --- | --- |
| 오늘 (Home) | `#/home` | Today's date, "오늘의 작은 제안" card, four moods (`아무거나` preselected), "오늘 시작하기" |
| 발견 (Discovery) | `#/discover` | One destination: why it's interesting, things to try, walking time, how long to stay, cost. "여기로 가보기" / "다른 곳 보기" |
| 둘러보기 (Exploration) | `#/explore` | Current spot, an illustrative diagram (not a real map), three varied discoveries with reasons. Add them to the route or move there |
| 경로 (Route) | `#/route` | Reorder (↑/↓), mark visited, replace, remove (with undo), explore from any stop |
| 나의 하루 (My Day) | `#/day` | Visited / kept places, a gentle summary, optional feeling and one-line note, reset the day |

## Tech stack

- **Vite 6** with **vanilla JavaScript, HTML and CSS**. There are no frameworks and no runtime dependencies.
- `localStorage` for persistence.
- Built-in `node:test` for unit tests.
- No backend, map API, AI API, accounts, API keys, remote fonts or remote images.

## Getting started

Requires Node.js 18 or later.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build && npm run preview
```

## Install on a phone (PWA)

The deployed site (https://johnyang0323.github.io/named_nothing/) can be installed like an app:

- **iPhone (Safari):** Share → **홈 화면에 추가**.
- **Android (Chrome):** the **앱 설치** prompt, or menu → **홈 화면에 추가**.

It opens full-screen with its own icon. The app shell works offline after the first visit, and today's progress is kept on the device. Real-place search and the Kakao map still need a connection.

The service worker (`sw.js`) is generated at build time by a small plugin in `vite.config.js`. It holds the exact list of hashed files, so every deploy installs a fresh worker and drops the old cache. Page loads go to the network first, so updates appear on the next open. It is registered only in production builds.

On iPhone, the installed app keeps its own storage, separate from Safari. A day started in Safari doesn't carry over to the home-screen app.

## Real places with Kakao Map (optional)

Without a key, the app runs entirely on illustrative sample data. With a Kakao **JavaScript key**:

- Home shows an optional "어디서 시작할까요?" field. Type a neighborhood (e.g. `망원동`, `성수역`) and the app gathers real places within about 1.5 km: independent cafés (big chains are skipped), bookstores, parks, libraries, galleries, culture spaces, workshops, record shops, markets and walking trails.
- Recommendations, discoveries and the route then use those places. Exploration shows a real Kakao map with the same markers as the diagram.
- Walking times are straight-line estimates (about 4 km/h), shown as such. Opening hours and prices are not shown; each place links to Kakao Map instead.
- The "why visit" lines and activity ideas are general suggestions for that kind of place, not claims about the specific business.
- **A location is required** when Kakao is configured: nothing is recommended until a starting point is set (home blocks "오늘 시작하기", #discover redirects home, Exploration asks for a location). "어디서 시작할까요?" is the first block on home, with three ways in: neighborhood name, current location, or **tap on the map** and "이 위치에서 시작하기" (`kakao/picker.js`; the map element is reused across re-renders).
- **현재 위치로 찾기** asks for location only when tapped. It does a single lookup, with no background tracking. Coordinates are rounded to about 100 m before they are used for the Kakao search or saved on the device, and the area is labelled with its administrative 동, e.g. "망원1동 (현재 위치)". If permission is denied, the app explains how to allow it or suggests typing a neighborhood instead.

**Setup**

1. Go to [Kakao Developers](https://developers.kakao.com) → 내 애플리케이션 → 애플리케이션 추가하기.
2. Under **플랫폼 → Web**, register every origin you'll use, e.g. `http://localhost:5173` and your deployed domain. Unregistered origins can't load the map.
3. If your app settings have a **카카오맵** product toggle, turn it on.
4. Copy `.env.example` to `.env` and paste the **JavaScript 키**:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_KAKAO_MAP_KEY=your_javascript_key
   ```

5. Restart `npm run dev`. For a deployed build, set `VITE_KAKAO_MAP_KEY` in the host's build environment, because it is baked in at build time.

The JavaScript key is public by design; the registered-domain list protects it. `.env` is git-ignored anyway. **Never use the REST API or Admin key here.** Those are secrets and are not needed.

If the SDK can't load (wrong key, unregistered domain, offline), neighborhood search shows a clear message. Exploration falls back to the illustrative diagram, and the rest of the app keeps working.

## Accounts and place photos (optional, Supabase)

Step-by-step setup (Korean, browser-only): [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md).

- **Sign-in is required** when Supabase is configured: signed out, the app shows only a welcome/login screen, and after signing in it continues to the screen that was requested. Signing out first pushes pending changes, then clears this device's days (the account keeps them). If a different account signs in on the same browser, the previous person's local days are not uploaded to it.
- **Sign-in methods:** Kakao login (OAuth with PKCE, so the `?code=` doesn't clash with the `#screen` router) or email + password. Email + password sends no email, so it works on Supabase's free plan, where email templates can't be edited, and inside the iPhone home-screen app, where emailed links would open in Safari. It expects "Confirm email" to be off. 
- **Sync:** local-first. The app always uses localStorage. When signed in, today's day is upserted to `days` (one row per user and date, JSON payload) about 1.2 s after each change. On sign-in, the copy with the newer `updatedAt` wins, and earlier days that only exist in this browser are uploaded once. **지난 날들** on My Day lists earlier days from both sources.
- **Security:** Row Level Security on `days` (`supabase/schema.sql`) limits each user to their own rows. The frontend only gets the project URL and anon/publishable key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, set as GitHub Actions Variables).
- **Photos:** the `place-photo` Edge Function (`supabase/functions/place-photo/index.ts`) keeps the Kakao **REST** key server-side and returns the best Kakao image-search hit for "<place name> <district>". Photos load over the illustration with `referrerpolicy="no-referrer"`, falling back to the thumbnail and then to the illustration. They are cached for 14 days and always credited with the note that search results may differ from the real place.
- **Photo ranking (function):** it also runs a Kakao **blog** search and boosts images from posts whose *title* names the place (URLs matched across naver/m./PostView forms). Shops and news sink, as do extreme aspect ratios and posts over 4 years old. Each photo carries `relevant`, and the credit line says when a photo comes from a post about the place.
- **Shared votes:** `supabase/photo_votes.sql` adds a vote table (RLS: own rows only) and the `photo_scores()` RPC (net score only, no voter ids). "이 사진으로 정하기" is +1 and "아니에요" is -1. Upvoted photos come first for everyone. A photo is hidden for everyone at a net score of -2 or lower, and immediately for the voter. Votes only reorder or hide search results and never add images. Scores refresh every 6 h, and the app works without the table.
- **Photo gallery:** the function returns up to 6 candidates. On the discovery card, ‹ › flip through them and "이 사진으로 정하기" pins the one that really shows the place. The pin is remembered per place and used for thumbnails. Candidates that a host refuses to display are dropped automatically. Older function versions that return a single `photo` still work.
- **Swipe:** drag the discovery card right for "여기로 가보기" or left for "다른 곳 보기" (`src/components/swipe.js`). Vertical drags still scroll, a mouse drags only on the photo so text stays selectable, and the buttons remain the accessible equivalent.
- `@supabase/supabase-js` is loaded only when the backend is configured, as a separate chunk.

## Structure

```
index.html                 App shell: masthead, nav, <main id="view">, toast, live region
public/                    favicon.svg, manifest.webmanifest, icons/ (PWA icons)
src/
  sw-template.js           Service worker template (filled in at build time)
  main.js                  Hash router, delegated events, focus preservation, toast/announcer
  style.css                Design system (tokens, typography, components, responsive, reduced motion)
  data/places.js           ILLUSTRATIVE sample places, moods, mood weights, category transitions
  data/categoryTemplates.js  Gentle per-category copy used for real places
  services/
    placeRepository.js     Single access point for place data; switches between sample and real places
    kakao/
      config.js            Reads VITE_KAKAO_MAP_KEY
      sdk.js               Loads the Kakao Maps SDK once, on demand, with timeout and errors
      areaSearch.js        Neighborhood → center → real places via the SDK `services` library
      mapper.js            Pure: Kakao results → app places, filtering, distances, validation
      map.js               Real map with markers for the exploration screen
    backend/               Optional Supabase: config, lazy client, auth (Kakao + email/password), sync
    photos.js              Place photos via the Edge Function, with cache and fallbacks
    geolocation.js         One-shot, user-initiated location lookup
    recommender.js         Pure recommendation engine (mood weighting, alternatives, diverse nearby picks)
    store.js               Date-keyed state, actions, localStorage persistence with validation
  components/
    home.js discover.js explore.js route.js myday.js   One module per screen: render() + actions
    placeVisual.js         Locally generated editorial SVG illustrations per place category
    common.js              Shared fragments (facts, empty state, labels)
  utils/                   date.js (local date key, Korean date), dom.js (escaping html`` template)
tests/                     recommender.test.js, store.test.js, kakao.test.js
supabase/                  schema.sql (table + RLS), functions/place-photo (Edge Function)
docs/SUPABASE_SETUP.md     Browser-only setup guide for accounts and photos
```

### How recommendations work

- **Mood** weights the internal experience types (`active`, `enriching`, `productive`, `creative`, `scenic`, `restful`). For example, `여유롭게` leans toward restful and scenic places, and `아무거나` weights everything equally. These types are never shown to the user as labels.
- **"다른 곳 보기"** never repeats the current place, and it skips places you've already seen until every option has been shown. It strongly prefers a different experience type.
- **Nearby discoveries** score how well a place follows the previous one (for example, gallery → park, street or café; bookstore → architecture or a scenic route). They add a bonus for a different experience type, only a small one for being close, and some randomness. They then pick greedily so the three suggestions have different types. Places already visited or already on the route are avoided.
- Every function takes an injectable `random` source, so tests are deterministic.

### State and persistence

- State is stored under `plannish-day:YYYY-MM-DD` using the local date. Refreshing keeps today's progress, and a new day starts fresh.
- Stored data is sanitised on load. Unknown place ids, bad moods and malformed JSON are dropped rather than crashing the app. If storage is unavailable (for example in private mode), the app still works in memory.
- "오늘 기록 지우기" on My Day clears the current day after an inline confirmation.
- Nothing personal is collected. No geolocation is requested.

## Accessibility

- Semantic landmarks, headings and lists. Moods are real radio inputs, so arrow keys work.
- Toggles use `aria-pressed`. Icon-only ↑/↓ buttons have descriptive `aria-label`s.
- Visible `:focus-visible` outlines. Focus is kept on the same control after a re-render, or moves to the remaining arrow when an item reaches the top or bottom.
- On navigation, focus moves to the new screen's heading. A polite live region announces changes.
- Visited state is shown in text (`✓ 다녀왔어요`), not only by colour.
- `prefers-reduced-motion` turns off animations.

## Personal recommendations

No questionnaire. The app learns from what people already do.

- **Taste:** each action nudges a score for that kind of place (and, more gently, its experience type). The signals are 가보기 +1, 다른 곳 −0.4, 담기 +0.7, 빼기 −0.5, 다녀왔어요 +1, and the day's feeling for places visited (±). Scores are clamped and turned into a 0.3–3× multiplier, which only kicks in after 2 signals. The code is in `src/services/personalize.js`, which is pure and unit-tested.
- **Situation:** weather from Open-Meteo (free, no key, area centre only). Rain, snow or extreme temperatures push picks indoors. The time of day also counts (evening → viewpoints and riversides, night → fewer parks), as does **쓸 수 있는 시간** on home step 2 (2시간 → nearby and short stays; 하루 종일 → farther and longer).
- **Serendipity kept on purpose:** about 20% of first picks, and one of the three nearby discoveries, deliberately go *against* the taste. These are labelled "새로운 발견".
- **Transparent and controllable:** the discovery card shows why a place was picked (취향 반영 / 새로운 발견 / 비가 와서 실내 위주로 / …). **나의 하루 → 나의 취향** shows what the app has learned, with an on/off switch and 초기화 (with undo).
- **Stored:** on the device, and in the account via `supabase/prefs.sql` (RLS: own row). The newer copy wins. Taste is cleared from the device on sign-out, and when another account signs in on the same browser it is cleared *before* syncing.

## Next ideas

- **AI check for place photos:** after the function ranks candidates, ask a vision model whether each image really shows that kind of place (and isn't food, people, a menu or a map screenshot), and drop the misses. It fits in the Edge Function, so the key stays server-side. It needs a paid AI API.

## Current limitations

- **Without a Kakao key, all places are fictional sample data.** Walking times, stay durations and costs are examples, and the UI labels them as such. The exploration diagram is then schematic.
- With Kakao, walking times are straight-line estimates, there are no opening hours, and there is no turn-by-turn navigation.
- The Kakao integration was tested against a stand-in SDK (unit tests plus a scripted browser run), not yet against the live Kakao service.
- The claude.ai artifact preview can't load the Kakao SDK, because its security policy blocks the script. There it always uses sample data.
- Accounts, sync and photos were tested against a stand-in Supabase (scripted browser runs), not yet against a live project.
- No account deletion UI yet. Two devices editing the same day resolve as last-write-wins.
- Illustrations are generated SVG, not photographs.
- Only today is kept in the UI. Past days remain in `localStorage` under their own keys, but there is no history view or automatic cleanup.
- If the app stays open past midnight, it keeps using the date it loaded with until it is refreshed.
- There are no automated accessibility audits (axe or Lighthouse). The checks were manual and scripted.

## Future integration points

- **Curated editorial layer:** store hand-written `whyVisit` text and photos for real Kakao place ids, and merge them in `kakao/mapper.js`. Setting `place.image` makes `placeVisual` show the photo.
- **Walking routes:** real walking times would need a directions API, which needs a server-side key.
- **AI recommendations:** keep the signatures of `pickInitial`, `pickAlternative` and `suggestNearby` (they could become async) and call a service instead.
- **Store apps:** Android can be packaged from the PWA with PWABuilder (Trusted Web Activity) for Google Play. An iOS App Store build needs a Mac with Xcode, plus app-specific features to pass review.
