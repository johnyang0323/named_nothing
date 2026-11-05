import { getPlaceById } from '../services/placeRepository.js';
import { explainNext, describeProximity, schematicDistance } from '../services/recommender.js';
import { html, raw } from '../utils/dom.js';
import { categoryLabel, emptyState } from './common.js';
import { placeVisual, photoSlot } from './placeVisual.js';
import { isKakaoConfigured } from '../services/kakao/config.js';
import { mountKakaoMap } from '../services/kakao/map.js';
import { needsLocation } from './home.js';
import { metersBetween, walkMinutes } from '../services/kakao/mapper.js';

const useRealMap = (place) => Boolean(place.coords) && isKakaoConfigured();

/** Real walking hint when both places have coordinates, otherwise the schematic wording. */
function distanceHint(from, to) {
  if (from.coords && to.coords) return `걸어서 약 ${walkMinutes(metersBetween(from.coords, to.coords))}분 (직선거리)`;
  return `${describeProximity(schematicDistance(from, to))} (예시)`;
}

function legend(others) {
  return html`
    <span class="legend"><span class="dot dot-current" aria-hidden="true"></span>지금 여기</span>
    <span class="legend"><span class="dot dot-num" aria-hidden="true">1</span>발견</span>
    ${others.length ? html`<span class="legend"><span class="dot dot-route" aria-hidden="true"></span>담아둔 곳</span>` : ''}`;
}

function kakaoMapFigure(current, routePlaces) {
  const others = routePlaces.filter((p) => p.id !== current.id);
  return html`
    <figure class="schematic real-map" data-real-map>
      <div class="kakao-map" data-kakao-map role="img" aria-label="${current.name} 주변 지도">지도를 불러오는 중…</div>
      <figcaption>
        ${legend(others)}
        <span class="map-note">지도: 카카오맵. 길찾기가 아니라 주변을 가늠하는 용도예요.</span>
      </figcaption>
    </figure>`;
}

const MAP_PAD = 10;
const scale = (v) => MAP_PAD + (v / 100) * (100 - MAP_PAD * 2);

/** Illustrative, non-geographic diagram of where things sit relative to each other. */
function schematicMap(current, discoveries, routePlaces, { hidden = false } = {}) {
  const point = (p) => ({ x: scale(p.position.x), y: scale(p.position.y) });
  const c = point(current);
  const others = routePlaces.filter((p) => p.id !== current.id);
  const svg = `
    <svg viewBox="0 0 100 100" class="schematic-svg" role="img" aria-labelledby="map-desc">
      <desc id="map-desc">${discoveries.length}곳의 발견이 현재 위치 주변에 표시된 예시 그림. 실제 지리와 다를 수 있어요.</desc>
      <rect x="0" y="0" width="100" height="100" rx="4" fill="var(--surface)"/>
      <path d="M0 64 Q30 58 52 70 T100 72" fill="none" stroke="var(--line)" stroke-width="5" stroke-linecap="round" opacity=".7"/>
      <path d="M20 0 Q26 40 18 100 M70 0 Q64 50 78 100" fill="none" stroke="var(--line)" stroke-width="1.6" opacity=".9"/>
      ${others
        .map((p) => {
          const o = point(p);
          return `<circle cx="${o.x}" cy="${o.y}" r="1.8" fill="none" stroke="var(--text-secondary)" stroke-width=".7"/>`;
        })
        .join('')}
      ${discoveries
        .map((p, i) => {
          const o = point(p);
          return `<path d="M${c.x} ${c.y} L${o.x} ${o.y}" stroke="var(--text-secondary)" stroke-width=".5" stroke-dasharray="1 1.6"/>
            <circle cx="${o.x}" cy="${o.y}" r="3.6" fill="var(--bg)" stroke="var(--text)" stroke-width=".6"/>
            <text x="${o.x}" y="${o.y + 1.3}" text-anchor="middle" class="map-num">${i + 1}</text>`;
        })
        .join('')}
      <circle cx="${c.x}" cy="${c.y}" r="6" fill="var(--accent)" opacity=".2"/>
      <circle cx="${c.x}" cy="${c.y}" r="2.8" fill="var(--accent)"/>
    </svg>`;
  return html`
    <figure class="schematic" data-schematic ${hidden ? 'hidden' : ''}>
      ${raw(svg)}
      <figcaption>
        ${legend(others)}
        <span class="map-note">실제 지도가 아니라 분위기를 보여주는 예시 그림이에요.</span>
      </figcaption>
    </figure>`;
}

export function render(state) {
  const current = getPlaceById(state.currentId);
  if (needsLocation(state)) {
    return html`
      <section class="screen" aria-labelledby="explore-title">
        <p class="eyebrow">둘러보기</p>
        <h1 id="explore-title" class="title" tabindex="-1">어디서 시작할까요?</h1>
        ${emptyState({
          title: '출발할 위치를 먼저 정해주세요',
          body: '동네 이름, 현재 위치, 지도 중 하나로 정하면 그 근처의 실제 장소를 보여드려요.',
          actionLabel: '위치 정하러 가기',
          href: '#home',
        })}
      </section>`;
  }
  if (!current) {
    return html`
      <section class="screen" aria-labelledby="explore-title">
        <p class="eyebrow">둘러보기</p>
        <h1 id="explore-title" class="title" tabindex="-1">아직 출발점이 없어요</h1>
        ${emptyState({
          title: '첫 목적지를 하나만 골라볼까요?',
          body: '한 곳에 도착하면, 그 근처에서 만날 수 있는 것들을 보여드릴게요.',
          actionLabel: '첫 목적지 추천받기',
          href: '#discover',
        })}
      </section>`;
  }

  const discoveries = state.discoveryIds.map(getPlaceById).filter(Boolean);
  const routePlaces = state.route.map((s) => getPlaceById(s.id)).filter(Boolean);
  const currentVisited = state.route.find((s) => s.id === current.id)?.visited;

  return html`
    <section class="screen explore" aria-labelledby="explore-title">
      <p class="eyebrow">지금 여기 · ${categoryLabel(current)}</p>
      <h1 id="explore-title" class="title" tabindex="-1">${current.name}</h1>
      <p class="description">${current.description}</p>
      <p class="inline-status">
        ${currentVisited ? '다녀온 곳으로 표시했어요.' : '도착했다면 표시해둘 수 있어요.'}
        <button type="button" class="text-button" data-action="toggle-current-visited" data-focus-key="toggle-current" aria-pressed="${currentVisited ? 'true' : 'false'}">
          ${currentVisited ? '표시 취소' : '다녀왔어요'}
        </button>
      </p>

      ${current.placeUrl ? html`<p class="quiet-link"><a href="${current.placeUrl}" target="_blank" rel="noopener noreferrer">카카오맵에서 위치 보기</a></p>` : ''}

      ${useRealMap(current) ? kakaoMapFigure(current, routePlaces) : ''}
      ${schematicMap(current, discoveries, routePlaces, { hidden: useRealMap(current) })}

      <section class="block" aria-labelledby="discoveries-title">
        <div class="block-head">
          <h2 class="section-label" id="discoveries-title">가는 길에 만날 수 있는 것들</h2>
          <button type="button" class="text-button" data-action="refresh" data-focus-key="refresh">다른 발견 보기</button>
        </div>
        ${discoveries.length
          ? html`<ol class="discoveries">
              ${discoveries.map((place, i) => {
                const proximity = distanceHint(current, place);
                return html`
                  <li class="discovery">
                    <div class="discovery-visual"${photoSlot(place)}>${placeVisual(place)}<span class="discovery-num" aria-hidden="true">${i + 1}</span></div>
                    <div class="discovery-body">
                      <p class="kicker">${categoryLabel(place)} · ${proximity}</p>
                      <h3 class="discovery-name">${place.name}</h3>
                      <p class="discovery-reason">${explainNext(current, place)}</p>
                      <p class="discovery-try">해볼 만한 것 — ${place.suggestedActivities[0]}</p>
                      <div class="actions actions-compact">
                        <button type="button" class="button button-secondary button-small" data-action="add" data-id="${place.id}" data-focus-key="add-${place.id}" aria-label="${place.name} 경로에 담기">경로에 담기</button>
                        <button type="button" class="text-button" data-action="move-here" data-id="${place.id}" aria-label="${place.name}(으)로 이동해서 둘러보기">여기로 이동</button>
                      </div>
                    </div>
                  </li>`;
              })}
            </ol>`
          : emptyState({
              title: '근처의 것들은 이미 다 담았어요',
              body: '다른 발견을 다시 찾아보거나, 경로에서 오늘을 정리해보세요.',
            })}
      </section>

      <p class="route-link"><a href="#route" class="button button-ghost">내 경로 보기 (${state.route.length}곳)</a></p>
    </section>`;
}

/** Mount the real map after the markup is in the DOM; fall back to the diagram on failure. */
export function afterRender(state) {
  const container = document.querySelector('[data-kakao-map]');
  const current = getPlaceById(state.currentId);
  if (!container || !current) return;
  mountKakaoMap(container, {
    current,
    discoveries: state.discoveryIds.map(getPlaceById).filter(Boolean),
    routePlaces: state.route.map((s) => getPlaceById(s.id)).filter(Boolean),
  }).then((ok) => {
    if (ok || !container.isConnected) return;
    container.closest('[data-real-map]')?.remove();
    const schematic = document.querySelector('[data-schematic]');
    if (schematic) schematic.hidden = false;
  });
}

export const actions = {
  add: ({ store, toast }, data) => {
    const place = getPlaceById(data.id);
    if (store.actions.addToRoute(data.id)) {
      toast(`‘${place.name}’을(를) 경로에 담았어요.`, { label: '경로 보기', run: ({ navigate }) => navigate('route') });
    }
  },
  'move-here': ({ store, announce }, data) => {
    store.actions.addToRoute(data.id);
    store.actions.setCurrent(data.id);
    announce(`${getPlaceById(data.id)?.name}(으)로 이동했어요.`);
    window.scrollTo({ top: 0 });
    document.getElementById('explore-title')?.focus();
  },
  refresh: ({ store, announce }) => {
    store.actions.refreshDiscoveries();
    announce('새로운 발견을 가져왔어요.');
  },
  'toggle-current-visited': ({ store }) => store.actions.toggleVisited(store.getState().currentId),
};
