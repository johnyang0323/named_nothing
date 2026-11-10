/**
 * Home, as two short steps that each fit on one screen (no scrolling):
 *   1. 어디서 시작할까요?  — search / current location / tap the map
 *   2. 어떤 하루가 끌리세요? — time, mood, one small suggestion, start
 * Drawn with React and glisse (iOS 26 liquid glass controls).
 */
import { useEffect, useRef } from 'react';
import { Button, Glass, SegmentedControl } from 'glisse';
import { moods } from '../data/places.js';
import { canUseLocation } from '../services/geolocation.js';
import { mountAreaPicker } from '../services/kakao/picker.js';
import { TIME_BUDGETS } from '../services/personalize.js';
import { currentStep, todaysSuggestion, stepEyebrow, goToStep, start, searchByName, searchByLocation, searchByPick } from './homeLogic.js';

function AreaMap({ ctx, focus }) {
  const host = useRef(null);
  useEffect(() => {
    // the Kakao map owns this box's content; React leaves it alone
    const slot = document.createElement('div');
    slot.className = 'area-map area-map-slot';
    slot.dataset.areaMap = '';
    slot.textContent = '지도를 불러오는 중…';
    host.current.replaceChildren(slot);
    mountAreaPicker(slot, {
      focus,
      onPick: (point) => {
        ctx.ui.pick = point;
        ctx.rerender();
        ctx.announce('지도에 위치를 표시했어요. ‘이 위치에서 시작하기’를 누르면 그 근처로 추천해 드려요.');
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={host} className="area-map-host" />;
}

function PlaceStep({ state, ctx }) {
  const { ui } = ctx;
  const loading = ui.areaStatus === 'loading';
  const error = ui.areaStatus && ui.areaStatus.error;
  return (
    <section className="screen home home-flow home-place" aria-labelledby="home-title">
      <p className="eyebrow">{stepEyebrow('place')}</p>
      <h1 id="home-title" className="flow-title" tabIndex={-1}>어디서 시작할까요?</h1>

      <form
        className="area-form"
        data-form="area"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          searchByName(ctx);
        }}
      >
        <label className="visually-hidden" htmlFor="area-query">동네 이름</label>
        <input
          id="area-query"
          className="area-input"
          type="text"
          inputMode="search"
          placeholder="동네·역 이름 (예: 망원동)"
          autoComplete="off"
          maxLength={40}
          defaultValue={ui.areaQuery || ''}
          data-focus-key="area-query"
          onChange={(event) => {
            ui.areaQuery = event.target.value;
          }}
        />
        <Button type="submit" data-focus-key="area-submit" disabled={loading}>{loading ? '찾는 중…' : '찾기'}</Button>
      </form>

      <Glass className="area-map-wrap">
        <AreaMap ctx={ctx} focus={ui.pick || state.area?.center || null} />
        {canUseLocation() ? (
          <Button className="map-chip map-chip-gps" data-action="use-location" data-focus-key="use-location" disabled={loading} onClick={() => searchByLocation(ctx)}>
            ◎ 현재 위치
          </Button>
        ) : null}
        {ui.pick ? null : <p className="map-hint" aria-hidden="true">지도를 눌러 핀을 꽂아도 돼요</p>}
        <Button
          variant="filled"
          className="map-confirm"
          data-action="use-picked"
          data-focus-key="use-picked"
          hidden={!ui.pick}
          disabled={loading}
          onClick={() => searchByPick(ctx)}
        >
          이 위치에서 시작하기
        </Button>
      </Glass>

      {error ? (
        <p className="area-error" role="alert">{error}</p>
      ) : (
        <p className="fine-print">
          위치는 근처 장소를 찾을 때만 쓰고, 약 100m 단위로 어림해서 저장해요.{state.route.length ? ' 위치를 바꾸면 오늘 경로는 새로 시작돼요.' : ''}
        </p>
      )}
      {state.area ? (
        <button type="button" className="text-button text-button-muted flow-back" data-action="to-mood" onClick={() => goToStep(ctx, 'mood')}>
          {state.area.label}에서 계속하기 →
        </button>
      ) : null}
    </section>
  );
}

function WeatherBadge({ context }) {
  const w = context?.weather;
  if (!w) return null;
  return (
    <span className="weather-badge" title="날씨: Open-Meteo">
      <span aria-hidden="true">{w.icon}</span> {w.label} {w.temp}°{context.badWeather ? <span className="weather-note"> · 실내 위주로</span> : null}
    </span>
  );
}

function MoodStep({ state, ctx }) {
  const suggestion = todaysSuggestion(state);
  const stops = state.route.length;
  const context = ctx.context?.();
  return (
    <section className="screen home home-flow home-mood" aria-labelledby="home-title">
      <p className="eyebrow">{stepEyebrow('mood')}</p>
      <div className="context-row">
        {state.area ? (
          <button
            type="button"
            className="place-chip"
            data-action="to-place"
            data-focus-key="to-place"
            aria-label={`출발 위치 바꾸기 (지금: ${state.area.label})`}
            onClick={() => goToStep(ctx, 'place')}
          >
            <span className="place-chip-dot" aria-hidden="true" />
            {state.area.label}
            <span className="place-chip-edit" aria-hidden="true">바꾸기</span>
          </button>
        ) : null}
        <WeatherBadge context={context} />
      </div>
      <h1 id="home-title" className="flow-title" tabIndex={-1}>어떤 하루가 끌리세요?</h1>

      <div className="budget" role="group" aria-labelledby="budget-label">
        <span className="budget-label" id="budget-label">쓸 수 있는 시간</span>
        <SegmentedControl
          className="budget-control"
          aria-labelledby="budget-label"
          items={TIME_BUDGETS.map((b) => ({ value: b.id, label: b.label }))}
          value={state.timeBudget}
          onValueChange={(value) => ctx.store.actions.setTimeBudget(value)}
        />
      </div>

      <fieldset className="moods">
        <legend className="visually-hidden">오늘의 기분</legend>
        <Glass className="mood-grid">
          {moods.map((mood) => (
            <label className="mood" key={mood.id}>
              <input
                type="radio"
                name="mood"
                value={mood.id}
                data-focus-key={`mood-${mood.id}`}
                checked={state.mood === mood.id}
                onChange={() => ctx.store.actions.setMood(mood.id)}
              />
              <span className="mood-label">{mood.label}</span>
              <span className="mood-hint">{mood.hint}</span>
            </label>
          ))}
        </Glass>
      </fieldset>

      <p className="small-suggestion">
        <span className="small-suggestion-label">오늘의 작은 제안</span>
        <span className="small-suggestion-text">{suggestion.body}</span>
        <button
          type="button"
          className="text-button"
          data-action="next-suggestion"
          data-focus-key="next-suggestion"
          aria-label="다른 작은 제안 보기"
          onClick={() => ctx.store.actions.nextSmallSuggestion()}
        >
          다른 제안
        </button>
      </p>

      <div className="cta-area">
        <Button variant="glass" className="cta-button is-selected-glass" data-action="start" data-focus-key="start" onClick={() => start(ctx)}>
          오늘 시작하기
        </Button>
        {stops ? (
          <p className="resume">
            오늘 담아둔 곳 {stops}곳 · <a href="#route">이어서 보기</a>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function HomeScreen({ state, ctx }) {
  return currentStep(state, ctx.ui) === 'place' ? <PlaceStep state={state} ctx={ctx} /> : <MoodStep state={state} ctx={ctx} />;
}
