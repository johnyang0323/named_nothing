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

## Real places with Kakao Map (optional)

Without a key, the app runs entirely on illustrative sample data. With a Kakao **JavaScript key**:

- Home shows an optional "어디서 시작할까요?" field. Type a neighborhood (e.g. `망원동`, `성수역`) and the app gathers real places within about 1.5 km: independent cafés (big chains are skipped), bookstores, parks, libraries, galleries, culture spaces, workshops, record shops, markets and walking trails.
- Recommendations, discoveries and the route then use those places. Exploration shows a real Kakao map with the same markers as the diagram.
- Walking times are straight-line estimates (about 4 km/h), shown as such. Opening hours and prices are not shown; each place links to Kakao Map instead.
- The "why visit" lines and activity ideas are general suggestions for that kind of place, not claims about the specific business.
- No geolocation is requested. The user types the neighborhood.

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

## Structure

```
index.html                 App shell: masthead, nav, <main id="view">, toast, live region
public/favicon.svg
src/
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
    recommender.js         Pure recommendation engine (mood weighting, alternatives, diverse nearby picks)
    store.js               Date-keyed state, actions, localStorage persistence with validation
  components/
    home.js discover.js explore.js route.js myday.js   One module per screen: render() + actions
    placeVisual.js         Locally generated editorial SVG illustrations per place category
    common.js              Shared fragments (facts, empty state, labels)
  utils/                   date.js (local date key, Korean date), dom.js (escaping html`` template)
tests/                     recommender.test.js, store.test.js, kakao.test.js
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

## Current limitations

- **Without a Kakao key, all places are fictional sample data.** Walking times, stay durations and costs are examples, and the UI labels them as such. The exploration diagram is then schematic.
- With Kakao, walking times are straight-line estimates, there are no opening hours, and there is no turn-by-turn navigation.
- The Kakao integration was tested against a stand-in SDK (unit tests plus a scripted browser run), not yet against the live Kakao service.
- The claude.ai artifact preview can't load the Kakao SDK, because its security policy blocks the script. There it always uses sample data.
- Illustrations are generated SVG, not photographs.
- Only today is kept in the UI. Past days remain in `localStorage` under their own keys, but there is no history view or automatic cleanup.
- If the app stays open past midnight, it keeps using the date it loaded with until it is refreshed.
- There are no automated accessibility audits (axe or Lighthouse). The checks were manual and scripted.

## Future integration points

- **Curated editorial layer:** store hand-written `whyVisit` text and photos for real Kakao place ids, and merge them in `kakao/mapper.js`. Setting `place.image` makes `placeVisual` show the photo.
- **Walking routes:** real walking times would need a directions API, which needs a server-side key.
- **AI recommendations:** keep the signatures of `pickInitial`, `pickAlternative` and `suggestNearby` (they could become async) and call a service instead.
- **Supabase:** put a remote adapter behind the `storage` parameter of `createStore`, or sync the date-keyed day objects.
- **PWA:** add a manifest and service worker. The app is already static and works offline once loaded.
