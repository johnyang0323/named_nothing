import './style.css';
import { createStore } from './services/store.js';
import * as home from './components/home.js';
import * as discover from './components/discover.js';
import * as explore from './components/explore.js';
import * as route from './components/route.js';
import * as myday from './components/myday.js';
import { isBackendConfigured } from './services/backend/config.js';
import { initAuth, onAuthChange } from './services/backend/auth.js';
import { createSync } from './services/backend/sync.js';
import { hydratePhotos } from './services/photos.js';

const SCREENS = { home, discover, explore, route, day: myday };
const DEFAULT_SCREEN = 'home';

const store = createStore();
const view = document.getElementById('view');
const announcer = document.getElementById('announcer');
const toastEl = document.getElementById('toast');

/** UI-only state that does not need to survive a refresh. */
const ui = { replacingId: null, replacementOptions: [], journalDraft: null, confirmReset: false };

let currentName = null;
let toastTimer = null;

const sync = createSync(store);

const ctx = {
  store,
  sync,
  ui,
  getScreen: () => currentName,
  navigate,
  rerender: render,
  announce,
  toast,
};

function screenFromHash() {
  const name = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return SCREENS[name] ? name : DEFAULT_SCREEN;
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

  view.innerHTML = String(screen.render(store.getState(), ctx));
  screen.afterRender?.(store.getState(), ctx);
  hydratePhotos(view);

  if (focusKey || itemKey) {
    const target = view.querySelector(`[data-focus-key="${CSS.escape(focusKey || '')}"]`);
    const fallback = itemKey && view.querySelector(`[data-focus-key="${CSS.escape(itemKey)}"]`);
    const sibling = target?.disabled
      ? target.parentElement?.querySelector('button:not(:disabled)')
      : null;
    const el = target && !target.disabled ? target : sibling || fallback || target;
    el?.focus({ preventScroll: true });
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
  const count = store.getState().route.length;
  document.querySelectorAll('[data-route-count]').forEach((el) => {
    el.textContent = count ? String(count) : '';
  });
}

function handleRoute() {
  const isFirst = currentName === null;
  currentName = screenFromHash();
  ui.replacingId = null;
  ui.confirmReset = false;
  SCREENS[currentName].onEnter?.(ctx);
  render();
  view.firstElementChild?.classList.add('is-entering');
  if (!isFirst) {
    window.scrollTo({ top: 0 });
    view.querySelector('h1')?.focus({ preventScroll: true });
  }
  document.title = `${document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim()} · 계획 있는 것처럼 사는 하루`;
}

// ---- delegated events ------------------------------------------------------
view.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || !view.contains(el) || el.disabled) return;
  const handler = SCREENS[currentName].actions?.[el.dataset.action];
  if (handler) {
    event.preventDefault();
    handler(ctx, el.dataset, el);
  }
});

const onInput = (event) => {
  const el = event.target.closest('[data-input]');
  if (!el) return;
  SCREENS[currentName].inputs?.[el.dataset.input]?.(ctx, el);
};
view.addEventListener('input', (event) => event.target.type !== 'radio' && onInput(event));
view.addEventListener('change', (event) => event.target.type === 'radio' && onInput(event));

view.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  SCREENS[currentName].forms?.[form.dataset.form]?.(ctx, form);
});

store.subscribe(() => render());
window.addEventListener('hashchange', handleRoute);
handleRoute();

// Optional accounts (Supabase). Without configuration none of this runs.
if (isBackendConfigured()) {
  onAuthChange(() => {
    if (currentName === 'day') {
      ui.history = null;
      SCREENS.day.onEnter?.(ctx);
    }
    render();
  });
  sync.onStatus(() => currentName === 'day' && render());
  initAuth()
    .catch((error) => toast(error.message || '로그인하지 못했어요.'))
    .finally(() => {
      sync.start();
      if (window.location.hash !== `#${currentName}`) handleRoute();
    });
}

// Installable app (PWA): offline shell + home-screen install. Production only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* the app works without it */
    });
  });
}
