// Pretendard: the stand-in for SF / Apple SD Gothic Neo on non-Apple devices.
// Split by character range, so a device only downloads the pieces it shows.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './style.css';
import { createStore } from './services/store.js';
import * as home from './components/home.js';
import * as discover from './components/discover.js';
import * as explore from './components/explore.js';
import * as route from './components/route.js';
import * as myday from './components/myday.js';
import * as account from './components/account.js';
import * as together from './components/together.js';
import { syncLine } from './components/account.js';
import { captureInvite } from './components/share.js';
import { avatar } from './components/entryCard.js';
import { getMyProfile, loadMyProfile, onProfileChange, avatarSrc } from './services/backend/social.js';
import { hydrateJournalPhotos } from './components/entryCard.js';
import * as welcome from './components/welcome.js';
import * as splash from './components/splash.js';
import { isBackendConfigured } from './services/backend/config.js';
import { initAuth, onAuthChange, getUser, isAuthReady, markAuthReady, avatarUrl } from './services/backend/auth.js';
import { createSync } from './services/backend/sync.js';
import { hydratePhotos } from './services/photos.js';
import { createTasteStore } from './services/tasteStore.js';
import { buildContext, makeBias, tasteActive, WILDCARD_RATE } from './services/personalize.js';
import { getWeather } from './services/weather.js';
import { installErrorReporting } from './services/errorLog.js';
import { isNativeApp } from './services/native.js';
import { renderReact, unmountReact } from './react/root.jsx';
import { renderTabBar } from './react/TabBar.jsx';
import { getUnread, onUnread, startInbox, refreshUnread } from './services/backend/inbox.js';

/** Screens reachable by #hash. */
const APP_SCREENS = { home, discover, explore, route, day: myday, account, together };
/** All renderable screens, including the sign-in gate. */
const SCREENS = { ...APP_SCREENS, login: welcome, splash };
const DEFAULT_SCREEN = 'home';

// personal recommendations: learned taste × situation (weather, time, time budget)
const taste = createTasteStore();
const live = { weather: null, weatherFor: null };
const contextFor = (state) => buildContext({ weather: live.weather, budget: state.timeBudget });
const store = createStore({
  personalize: {
    bias: (state) => makeBias(taste.get(), contextFor(state)),
    signal: (event, place) => taste.signal(event, place),
    wild: () => tasteActive(taste.get()) && Math.random() < WILDCARD_RATE,
  },
});
const view = document.getElementById('view');
const announcer = document.getElementById('announcer');
const toastEl = document.getElementById('toast');

/** UI-only state that does not need to survive a refresh. */
const ui = { replacingId: null, replacementOptions: [], journalDraft: null, confirmReset: false };

let currentName = null;
let toastTimer = null;

const sync = createSync(store, {
  onForeignDevice: () => taste.forgetDevice(),
  onSignedIn: () => taste.pull(),
});

/** Fetch weather for the current area (once per area per hour). */
function refreshWeather() {
  const center = store.getState().area?.center;
  const key = center ? `${center.lat},${center.lng}` : null;
  if (!key || key === live.weatherFor) return;
  live.weatherFor = key;
  getWeather(center).then((weather) => {
    if (live.weatherFor !== key) return;
    live.weather = weather;
    if (['home', 'discover'].includes(currentName)) render();
  });
}

const ctx = {
  store,
  sync,
  taste,
  context: () => contextFor(store.getState()),
  ui,
  getScreen: () => currentName,
  /** Refresh the current screen's data after a change (social screens). */
  reload: async () => {
    const screen = SCREENS[currentName];
    if (screen.reload) await screen.reload(ctx);
    else render();
  },
  refreshAccountButton: () => refreshAccountButton(),
  navigate,
  rerender: render,
  announce,
  toast,
};

function screenFromHash() {
  const name = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return APP_SCREENS[name] ? name : DEFAULT_SCREEN;
}

function navigate(name) {
  const target = `#${name}`;
  if (window.location.hash === target) handleRoute();
  else window.location.hash = target;
}

function announce(message) {
  announcer.textContent = '';
  // next frame so repeated identical messages are still announced
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  toastEl.append(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      hideToast();
      action.run(ctx);
    });
    toastEl.append(button);
  }
  toastEl.hidden = false;
  toastEl.classList.add('is-visible');
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}

function hideToast() {
  toastEl.classList.remove('is-visible');
  toastEl.hidden = true;
}

/** Re-render the current screen while keeping keyboard focus where it was. */
function render() {
  const screen = SCREENS[currentName];
  const active = document.activeElement;
  const focusKey = view.contains(active) ? active?.dataset?.focusKey : null;
  const itemKey = view.contains(active) ? active?.closest('[data-focus-key^="item-"]')?.dataset.focusKey : null;
  const scrollY = window.scrollY;
  // keep the caret where it was when a text field is redrawn
  const selection = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

  if (screen.Component) {
    // React screens (glisse components) draw themselves; same state and ctx
    renderReact(view, screen.Component, { state: store.getState(), ctx });
  } else {
    unmountReact(view);
    view.innerHTML = String(screen.render(store.getState(), ctx));
    screen.afterRender?.(store.getState(), ctx);
  }
  hydratePhotos(view, { announce });
  hydrateJournalPhotos(view);

  if (focusKey || itemKey) {
    const target = view.querySelector(`[data-focus-key="${CSS.escape(focusKey || '')}"]`);
    const fallback = itemKey && view.querySelector(`[data-focus-key="${CSS.escape(itemKey)}"]`);
    const sibling = target?.disabled
      ? target.parentElement?.querySelector('button:not(:disabled)')
      : null;
    const el = target && !target.disabled ? target : sibling || fallback || target;
    el?.focus({ preventScroll: true });
    if (selection && el === target && typeof el.setSelectionRange === 'function') {
      try {
        el.setSelectionRange(...selection);
      } catch {
        /* not a text field */
      }
    }
    window.scrollTo({ top: scrollY });
    el?.scrollIntoView?.({ block: 'nearest' });
  }
  updateNav();
}

function updateNav() {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === currentName) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  const state = store.getState();
  const profile = getMyProfile();
  renderTabBar(tabbar, {
    current: currentName,
    routeCount: state.route.length,
    // the day has started → the logo opens today's recommendation
    started: Boolean(state.recommendationId),
    inbox: getUnread(),
    account: {
      initial: Array.from(profile?.nickname || '나')[0],
      src: (profile && avatarSrc(profile)) || avatarUrl(getUser()) || null,
      label: '계정',
    },
  });
}

/**
 * With accounts configured, nothing is usable signed out: show a short
 * splash while the session restores, then the sign-in screen if needed.
 */
function gateScreen() {
  if (!isBackendConfigured()) return null;
  if (!isAuthReady()) return 'splash';
  return getUser() ? null : 'login';
}

function handleRoute() {
  const isFirst = currentName === null;
  const gate = gateScreen();
  ui.afterLogin = screenFromHash();
  currentName = gate || screenFromHash();
  document.body.classList.toggle('is-gated', Boolean(gate));
  document.body.dataset.screen = currentName;
  ui.replacingId = null;
  ui.confirmReset = false;
  // a screen can send the person elsewhere first (e.g. no location yet → home)
  const redirect = SCREENS[currentName].onEnter?.(ctx);
  if (typeof redirect === 'string' && redirect !== currentName && APP_SCREENS[redirect]) {
    navigate(redirect);
    return;
  }
  render();
  view.firstElementChild?.classList.add('is-entering');
  if (!isFirst) {
    window.scrollTo({ top: 0 });
    view.querySelector('h1')?.focus({ preventScroll: true });
  }
  document.title = `${document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim()} · 계획 있는 척`;
}

// ---- delegated events ------------------------------------------------------
view.addEventListener('click', (event) => {
  if (SCREENS[currentName].Component) return; // React screen handles its own events
  const el = event.target.closest('[data-action]');
  if (!el || !view.contains(el) || el.disabled) return;
  const handler = SCREENS[currentName].actions?.[el.dataset.action];
  if (handler) {
    event.preventDefault();
    handler(ctx, el.dataset, el);
  }
});

const onInput = (event) => {
  if (SCREENS[currentName].Component) return;
  const el = event.target.closest('[data-input]');
  if (!el) return;
  SCREENS[currentName].inputs?.[el.dataset.input]?.(ctx, el);
};
view.addEventListener('input', (event) => event.target.type !== 'radio' && onInput(event));
// radios report through "change" (mood, time budget)
view.addEventListener('change', (event) => event.target.type === 'radio' && onInput(event));

view.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-form]');
  if (!form || SCREENS[currentName].Component) return;
  event.preventDefault();
  SCREENS[currentName].forms?.[form.dataset.form]?.(ctx, form);
});

/** The profile picture (or initial) in the header, linking to 계정. */
function refreshAccountButton() {
  updateNav(); // the 계정 tab shows my photo
  const button = document.querySelector('header [data-account-button]');
  if (!button) return;
  const profile = getMyProfile();
  const fallbackSrc = avatarUrl(getUser()); // Kakao photo until a profile photo is set
  button.innerHTML = String(avatar({ ...(profile || { nickname: '나' }), fallbackSrc }));
  button.setAttribute('aria-label', profile ? `${profile.nickname} 계정` : '계정');
}

// an invite link (?friend= / ?group=) opens 함께 after signing in
captureInvite();

// coming back to the app (switched tabs/apps): refresh shared content
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !['together', 'day'].includes(currentName)) return;
  if (SCREENS[currentName].reload && !ui.editor) SCREENS[currentName].reload(ctx);
});

store.subscribe(() => {
  refreshWeather();
  render();
});
taste.subscribe(() => currentName === 'account' && render());
refreshWeather();
window.addEventListener('hashchange', handleRoute);
handleRoute();

installErrorReporting(() => currentName || '');

// Optional accounts (Supabase). Without configuration none of this runs.
if (isBackendConfigured()) {
  // signing in or out swaps between the gate and the app
  onAuthChange((user) => {
    ui.history = null;
    ui.myEntries = null;
    ui.together = null;
    if (user) loadMyProfile().catch(() => null);
    refreshUnread();
    refreshAccountButton();
    handleRoute();
  });
  onProfileChange(() => refreshAccountButton());
  onUnread(() => updateNav());
  startInbox();
  // update only the status line, so saving in the background never redraws
  // the screen under someone who is typing
  sync.onStatus(() => {
    if (currentName !== 'account') return;
    if (SCREENS.account.Component) render(); // React keeps fields and focus as they are
    else {
      const line = view.querySelector('.account-sync');
      if (line) line.innerHTML = String(syncLine(sync));
    }
  });
  initAuth()
    .catch((error) => toast(error.message || '로그인하지 못했어요.'))
    .finally(() => {
      markAuthReady();
      sync.start();
      handleRoute();
    });
}

// Installable app (PWA): offline shell + home-screen install. Production only.
// Not inside the Android/iOS app: its files are already on the device.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNativeApp()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* the app works without it */
    });
  });
}
